// Digest + recommendation generator. Takes a MetricsSnapshot, asks Gemini
// 3.1 Pro (via Vertex AI on our GCP credits) to produce:
//   1. A short structured markdown digest (what changed, what's interesting)
//   2. A typed list of 2-4 change recommendations with mechanism + risk
//
// The output is RIGIDLY shaped via JSON schema so the Telegram publisher
// and the recommendation persistence layer can rely on it.

import { GoogleGenAI } from '@google/genai';
import type { MetricsSnapshot } from './metricsCollector.js';
import { getRecentImpactReport } from './impactMeasurement.js';

const PROJECT = process.env.GCP_PROJECT;
const LOCATION = process.env.GCP_LOCATION || 'us-central1';
const MODEL = process.env.GROWTH_DIGEST_MODEL || 'gemini-2.5-pro';

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!PROJECT) throw new Error('GCP_PROJECT not set');
  if (!_client) _client = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
  return _client;
}

// ─── Output schema ──────────────────────────────────────────────────────────

export interface DigestOutput {
  /** Headline TL;DR (1-2 sentences) the Telegram message leads with. */
  headline: string;
  /** Structured markdown body: what's changed, what's notable. */
  body: string;
  /** 2-4 specific recommendations the user can act on. */
  recommendations: Recommendation[];
}

export interface Recommendation {
  /** Title (short, action-oriented, fits in a Telegram inline button). */
  title: string;
  /** What the change is, in plain language. 2-3 sentences. */
  description: string;
  /** The specific metric / funnel step this would move. */
  targetMetric: string;
  /** Why we think it will work — named mechanism, falsifiable. */
  mechanism: string;
  /** S | M | L estimate. */
  effort: 'S' | 'M' | 'L';
  /** What could go wrong. 1 sentence. */
  risk: string;
  /** If X happens, we were wrong. Forces the LLM to be honest. */
  falsification: string;
  /** auto_ship = trivial copy/threshold; spec_only = real code; manual = idea only. */
  tier: 'auto_ship' | 'spec_only' | 'manual';
}

// ─── Prompts ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior product growth advisor for Axiom, a fitness coaching app.
Your job: read yesterday's metrics, identify what changed (signal vs noise), and propose 2-4 specific changes the team can make.

YOU MUST:
- Distinguish signal from noise. Axiom has a few hundred users; day-to-day swings of <10 events are usually noise. Call this out when relevant.
- Anchor every recommendation in a NAMED mechanism (Fogg behavior model, Hook model, IKEA effect, loss aversion, social proof, etc.) AND state what specifically about Axiom makes it apply. No generic "growth hacks".
- Tag every recommendation with a FALSIFICATION condition. "If we ship this and X doesn't change in 14 days, we were wrong."
- Prefer changes that move LEADING-QUALITY metrics (D7 retention, % of users hitting first-value moments, NPS) over LAGGING-VOLUME metrics (DAU). Optimizing the wrong metric is worse than no change.
- Be honest. If the data doesn't support strong claims, say so. Hedge proportionally.

DO NOT:
- Cite fake studies. If you reference research, name the actual paper/author honestly. Better to skip a citation than fabricate one.
- Propose "blast more notifications" or anything that boosts short-term engagement at the cost of long-term trust.
- Suggest changes that require months of work (those go in a separate roadmap, not the daily digest).

Output format: a JSON object exactly matching the schema in the user message.`;

function metricsToContext(m: MetricsSnapshot): string {
  return `## Metrics for ${m.date}

USERS
- Total registered: ${m.users.totalRegistered}
- Yesterday signups: ${m.users.registeredYesterday}
- Last 7d signups: ${m.users.registeredLast7d} (prior 7d: ${m.users.registeredPrior7d}, ${m.users.weekOverWeekChangePct > 0 ? '+' : ''}${m.users.weekOverWeekChangePct}% WoW)
- Tier split — free: ${m.users.freeTier}, pro: ${m.users.proTier}, enterprise: ${m.users.enterpriseTier}

ENGAGEMENT
- DAU yesterday: ${m.engagement.dauYesterday ?? 'n/a'}
- WAU last 7d: ${m.engagement.wauLast7d ?? 'n/a'}
- App opens yesterday: ${m.engagement.appOpensYesterday ?? 'n/a'}

ACQUISITION FUNNEL (last 7d)
- Auth screen shown: ${m.funnel.authScreenShown7d ?? 'n/a'}
- OAuth/email tapped: ${m.funnel.authProviderTapped7d ?? 'n/a'}
- Register completed: ${m.funnel.registerCompleted7d ?? 'n/a'}
- Diagnostic started: ${m.funnel.diagnosticStarted7d ?? 'n/a'}
- Diagnostic completed: ${m.funnel.diagnosticCompleted7d ?? 'n/a'}
- Plan generated: ${m.funnel.workoutPlanGenerated7d ?? 'n/a'}

REVENUE (Stripe only — Apple/Google IAP not yet ingested)
- Active subs: ${m.revenue.activeSubsTotal}
- New subs last 7d: ${m.revenue.newSubsLast7d}
- Canceled last 7d: ${m.revenue.canceledSubsLast7d}
- MRR estimate: $${(m.revenue.mrrEstimateCents / 100).toFixed(2)}
- Trailing 30d revenue: $${(m.revenue.trailingRevenueLast30dCents / 100).toFixed(2)}

FEATURE ADOPTION (last 7d)
- Form video analyses: ${m.features.formVideoAnalyzed7d ?? 'n/a'}
- Barcode scans: ${m.features.barcodeScans7d ?? 'n/a'}
- Coach chat messages: ${m.features.coachMessagesSent7d ?? 'n/a'}
- Workouts logged: ${m.features.workoutsLogged7d ?? 'n/a'}
- Food photo scans: ${m.features.foodPhotoLogged7d ?? 'n/a'}
- Social posts: ${m.features.socialPosts7d ?? 'n/a'}

ERRORS
- JS exceptions last 24h: ${m.errors.jsExceptionsLast24h ?? 'n/a'}
- Coach ErrorBoundary trips last 7d: ${m.errors.coachErrorBoundaryLast7d ?? 'n/a'}`;
}

// Response JSON schema — Gemini enforces structure when responseSchema is set.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    body: { type: 'string' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          targetMetric: { type: 'string' },
          mechanism: { type: 'string' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          risk: { type: 'string' },
          falsification: { type: 'string' },
          tier: { type: 'string', enum: ['auto_ship', 'spec_only', 'manual'] },
        },
        required: ['title', 'description', 'targetMetric', 'mechanism', 'effort', 'risk', 'falsification', 'tier'],
      },
    },
  },
  required: ['headline', 'body', 'recommendations'],
};

// ─── Entry ──────────────────────────────────────────────────────────────────

export async function generateDigest(snapshot: MetricsSnapshot): Promise<{
  output: DigestOutput;
  modelUsed: string;
  promptTokens?: number;
  completionTokens?: number;
}> {
  const c = client();

  // Pull recent measured outcomes so the model can SEE what its past
  // recommendations actually moved (or didn't). This is what closes the loop.
  const impactReport = await getRecentImpactReport(8).catch(() => []);
  const impactContext = impactReport.length === 0
    ? '\n\n(No prior shipped recommendations have measured outcomes yet — this is an early run.)'
    : '\n\n## Past recommendations — measured outcomes\n' + impactReport
        .map((r) => `- "${r.title}" → target=${r.targetMetric}, tier=${r.tier}, shipped=${r.shippedAt?.toISOString().slice(0,10)}, 7d-snapshot=${r.after7dMetricJson ? 'captured' : 'pending'}, 30d-snapshot=${r.after30dMetricJson ? 'captured' : 'pending'}`)
        .join('\n')
    + '\n\nUse this to calibrate: which mechanisms have produced movement, which haven\'t. If a class of recommendation hasn\'t moved its metric, propose something different today.';

  const contents = [
    { role: 'user', parts: [
      { text: metricsToContext(snapshot) + impactContext },
      { text: '\n\nReturn JSON exactly matching the schema. Be specific, honest, and skeptical.' },
    ]},
  ];

  const res = await c.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA as any,
      maxOutputTokens: 4096,
      temperature: 0.5,
    } as any,
  });

  const text = res.text ?? '';
  if (!text) throw new Error('Gemini returned empty digest');

  let output: DigestOutput;
  try {
    output = JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }

  return {
    output,
    modelUsed: MODEL,
    promptTokens: (res.usageMetadata as any)?.promptTokenCount,
    completionTokens: (res.usageMetadata as any)?.candidatesTokenCount,
  };
}
