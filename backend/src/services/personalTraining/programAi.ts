// Guardrailed AI program generation (handoff A4, gap #9).
//
//   trainer's brief + structured selectors
//     → the model drafts a ProgramDoc, with a reason for each decision
//     → the rules engine validates it against the client's contraindications
//       (one rewrite naming every refusal; anything still refused is removed
//       and the removal is written on the canvas)
//     → saved as a DRAFT on the builder canvas, never published
//     → the trainer edits and publishes; the audit row says "suggested by AI,
//       approved by trainer".
//
// Refusals are part of the output, shown with confidence: if the brief asks
// for something the client is not cleared for, the draft says what it left
// out and why.

import { chatComplete } from '../chatClient.js';
import { parseModelJson } from '../modelJson.js';
import { audit } from './drafts.js';
import { prisma } from './db.js';
import { contraindicationsFor, toRuleInput } from './contraindications.js';
import { exercisePatterns, hardRulesPrompt, patternsFor, type Pattern } from './contraindicationRules.js';
import { libraryFor } from './exerciseLibrary.js';
import { getIntake } from './intake.js';
import { LIFTS, liftHistory } from './lifts.js';
import { ProgramError, checkProgram, normaliseDoc, toProgram } from './programs.js';
import { PROSPECT_PREFIX, loadClients } from './roster.js';
import type { ProgramAiRequest, ProgramAnnotation, ProgramDoc, TrainerProgram } from './types.js';

export type DraftFn = (system: string, user: string) => Promise<string | null>;

const llmEnabled = () => process.env.PERSONAL_TRAINING_LLM !== '0' && process.env.NODE_ENV !== 'test' && !process.env.VITEST;

const defaultDraft: DraftFn = async (system, user) => {
  if (!llmEnabled()) return null;
  try {
    const res = await chatComplete({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_completion_tokens: 12_000,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      ...(process.env.PT_PROGRAM_MODEL ? { modelOverride: process.env.PT_PROGRAM_MODEL } : {}),
    } as any, { requireJson: true, timeoutMs: 90_000, label: 'pt-program-generate' });
    return (res as any)?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.warn('[personal-training] program generation failed', (err as Error)?.message);
    return null;
  }
};

export function validateRequest(raw: any): ProgramAiRequest {
  const brief = typeof raw?.brief === 'string' ? raw.brief.trim().slice(0, 2000) : '';
  if (brief.length < 10) throw new ProgramError('Describe the block you want in a sentence or two', 400);
  const weeks = Number(raw?.weeks);
  const days = Number(raw?.daysPerWeek);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) throw new ProgramError('weeks must be 1 to 12', 400);
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new ProgramError('daysPerWeek must be 1 to 7', 400);
  const minutes = raw?.sessionMinutes === undefined ? undefined : Number(raw.sessionMinutes);
  if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 15 || minutes > 180)) throw new ProgramError('sessionMinutes must be 15 to 180', 400);
  const equipment = Array.isArray(raw?.equipment) ? raw.equipment.filter((x: unknown) => typeof x === 'string').slice(0, 12) : undefined;
  const experience = ['beginner', 'intermediate', 'advanced'].includes(raw?.experience) ? raw.experience : undefined;
  const focus = typeof raw?.focus === 'string' ? raw.focus.trim().slice(0, 120) || undefined : undefined;
  return { brief, weeks, daysPerWeek: days, ...(minutes ? { sessionMinutes: minutes } : {}), ...(equipment?.length ? { equipment } : {}), ...(experience ? { experience } : {}), ...(focus ? { focus } : {}) };
}

const SCHEMA = `{"name": string, "description": string, "rationale": string,
 "weeks": [{"label": string, "days": [{"name": string, "weekday": 0-6 or null, "why": string,
   "blocks": [{"kind": "single"|"superset"|"circuit"|"amrap"|"emom", "rounds"?: int, "timeCapMin"?: int,
     "items": [{"name": string, "sets": int, "reps": string, "load": {"type": "percent1rm"|"rpe"|"rir"|"kg"|"lb"|"bodyweight"|"none", "value"?: number}, "restSec"?: int, "tempo"?: string, "notes"?: string, "why": string}]}]}]}]}`;

const SYSTEM = [
  'You are drafting a training block for a personal trainer to review and edit. The trainer decides; you propose.',
  'Return ONE JSON object exactly in this shape:', SCHEMA,
  'Write every week out in full (no "repeat week 1"). Progress sensibly week to week (load or volume), with a deload if the block is longer than 5 weeks.',
  'Use exercise names from the library list when one fits. Prefer %1RM or RPE for main lifts and RPE/RIR for accessories.',
  'Each "why" is one short sentence a coach would accept: the reason for that choice for this client.',
  'Contraindications listed as hard rules are absolute. Never program a refused movement, even if the trainer brief asks for it; choose a safe alternative and say so in "why".',
].join('\n');

/** Movement patterns the brief itself asks for that a contraindication refuses — the refusal is stated up front. */
export function refusedByBrief(brief: string, rules: ReturnType<typeof toRuleInput>[]): ProgramAnnotation[] {
  const asked = new Set<Pattern>();
  for (const phrase of brief.split(/[,.;\n]| and | with /i)) exercisePatterns(phrase).forEach((p) => asked.add(p));
  const out: ProgramAnnotation[] = [];
  for (const r of rules) {
    const { block } = patternsFor(r);
    const hit = [...asked].filter((p) => block.has(p));
    if (hit.length) out.push({ target: 'program', kind: 'guardrail', text: `Not programmed: ${hit.map((p) => p.replace(/_/g, ' ')).join(', ')} — ${r.condition} is ${r.clearance === 'not_cleared' ? 'not cleared' : 'still restricted'}. Safe alternatives were used instead.` });
  }
  return out;
}

function stripRefused(doc: ProgramDoc, refused: Set<string>): { doc: ProgramDoc; removed: ProgramAnnotation[] } {
  const removed: ProgramAnnotation[] = [];
  for (const w of doc.weeks) for (const d of w.days) {
    for (const b of d.blocks) {
      const kept = b.items.filter((it) => !refused.has(it.name.toLowerCase()));
      for (const it of b.items) if (refused.has(it.name.toLowerCase())) removed.push({ target: d.id, kind: 'removed', text: `${w.label} ${d.name}: removed ${it.name} (conflicts with a contraindication)` });
      b.items = kept;
    }
    d.blocks = d.blocks.filter((b) => b.items.length);
  }
  return { doc, removed };
}

function annotationsFrom(raw: any, doc: ProgramDoc): ProgramAnnotation[] {
  const out: ProgramAnnotation[] = [];
  if (typeof raw?.rationale === 'string' && raw.rationale.trim()) out.push({ target: 'program', kind: 'rationale', text: raw.rationale.trim().slice(0, 600) });
  (raw?.weeks ?? []).forEach((w: any, wi: number) => (w?.days ?? []).forEach((d: any, di: number) => {
    const day = doc.weeks[wi]?.days[di];
    if (!day) return;
    if (typeof d?.why === 'string' && d.why.trim()) out.push({ target: day.id, kind: 'rationale', text: d.why.trim().slice(0, 300) });
    const items = day.blocks.flatMap((b) => b.items);
    const rawItems = (d?.blocks ?? []).flatMap((b: any) => (b?.items ?? []).filter((it: any) => typeof it?.name === 'string' && it.name.trim()));
    rawItems.forEach((it: any, ii: number) => {
      if (items[ii] && typeof it?.why === 'string' && it.why.trim()) out.push({ target: items[ii].id, kind: 'rationale', text: it.why.trim().slice(0, 300) });
    });
  }));
  return out;
}

async function clientContext(practiceId: string, clientId: string) {
  const [[client], contras, intake, workouts, goals] = await Promise.all([
    loadClients(practiceId, { ids: [clientId], includeArchived: true }),
    contraindicationsFor(practiceId, clientId),
    getIntake(practiceId, clientId),
    prisma.workoutLog.findMany({ where: { userId: clientId }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true, exercises: true } }),
    prisma.ptGoal.findMany({ where: { practiceId, clientId, status: 'active' }, select: { label: true, target: true, unit: true, deadline: true } }),
  ]);
  const rules = contras.map(toRuleInput);
  const e1rms = LIFTS.map((l) => {
    const h = liftHistory(workouts, l.key);
    return h.length ? `${l.label}: about ${Math.round(h[h.length - 1].e1rm)} kg estimated 1RM` : null;
  }).filter(Boolean);
  return { client, rules, intake, e1rms, goals };
}

/**
 * Draft a program for a client and save it as a draft on the canvas.
 * `draftFn` is the model call; tests pass their own.
 */
export async function generateProgram(practiceId: string, trainerId: string, clientId: string, rawRequest: unknown, draftFn: DraftFn = defaultDraft): Promise<TrainerProgram> {
  if (clientId.startsWith(PROSPECT_PREFIX)) throw new ProgramError('Give this client a link or invite them before programming for them', 409);
  const req = validateRequest(rawRequest);
  const ctx = await clientContext(practiceId, clientId);
  if (!ctx.client) throw new ProgramError('Client not found', 404);

  const library = await libraryFor(practiceId);
  const allowed = library.filter((e) => !ctx.rules.some((r) => e.patterns.some((p) => patternsFor(r).block.has(p as Pattern))));
  const equipmentOk = req.equipment?.length ? allowed.filter((e) => e.equipment.length === 0 || e.equipment.some((x) => req.equipment!.includes(x) || x === 'bodyweight')) : allowed;

  const user = [
    `Client: ${ctx.client.name.split(' ')[0]}`,
    hardRulesPrompt(ctx.rules) || 'Contraindications: none on record.',
    ctx.goals.length ? `Goals: ${ctx.goals.map((g) => `${g.label}${g.target != null ? ` → ${g.target}${g.unit ? ` ${g.unit}` : ''}` : ''}${g.deadline ? ` by ${g.deadline}` : ''}`).join('; ')}` : '',
    ...ctx.intake.fields.filter((f) => f.answer && ['experience', 'schedule', 'equipment', 'preferences', 'goal'].includes(f.key)).map((f) => `${f.label} (client's words): ${f.answer}`),
    ctx.e1rms.length ? `Logged strength: ${ctx.e1rms.join('; ')}` : '',
    `Trainer's brief: ${req.brief}`,
    `Block: ${req.weeks} weeks, ${req.daysPerWeek} days a week${req.sessionMinutes ? `, about ${req.sessionMinutes} minutes a session` : ''}${req.experience ? `, ${req.experience} lifter` : ''}${req.focus ? `, focus: ${req.focus}` : ''}.`,
    req.equipment?.length ? `Equipment available: ${req.equipment.join(', ')}.` : '',
    `Exercise library (safe for this client): ${equipmentOk.slice(0, 160).map((e) => e.name).join(', ')}`,
  ].filter(Boolean).join('\n');

  const attempt = async (extra = '') => {
    const raw = await draftFn(SYSTEM, extra ? `${user}\n\n${extra}` : user);
    if (!raw) return null;
    try {
      const parsed = parseModelJson<any>(raw);
      const doc = normaliseDoc(parsed);
      if (doc.weeks.length === 0) return null;
      return { parsed, doc };
    } catch {
      return null;
    }
  };

  let draft = await attempt();
  if (!draft) throw new ProgramError('Axiom could not draft this program right now. Try again, or start from a template.', 503);
  let check = await checkProgram(practiceId, clientId, draft.doc, []);
  const refusedNames = () => new Set(check.guardrails?.violations.filter((v) => v.level === 'block').map((v) => v.exercise.toLowerCase()) ?? []);
  if (refusedNames().size) {
    const names = [...new Set(check.guardrails!.violations.filter((v) => v.level === 'block').map((v) => `${v.exercise} (${v.reason})`))];
    const second = await attempt(`YOUR LAST DRAFT BROKE THE HARD RULES with: ${names.join('; ')}. Rewrite the whole block without them.`);
    if (second) { draft = second; check = await checkProgram(practiceId, clientId, draft.doc, []); }
  }
  const annotations = [...refusedByBrief(req.brief, ctx.rules), ...annotationsFrom(draft.parsed, draft.doc)];
  const stillRefused = refusedNames();
  if (stillRefused.size) {
    const { doc, removed } = stripRefused(draft.doc, stillRefused);
    draft.doc = doc;
    annotations.push(...removed);
  }
  for (const v of (await checkProgram(practiceId, clientId, draft.doc, [])).guardrails?.violations ?? []) {
    if (v.level === 'warn') annotations.push({ target: 'program', kind: 'guardrail', text: `Check before publishing: ${v.reason}.` });
  }

  const row = await prisma.ptProgram.create({
    data: {
      practiceId, clientId, name: typeof draft.parsed?.name === 'string' && draft.parsed.name.trim() ? draft.parsed.name.trim().slice(0, 80) : `${req.weeks}-week block`,
      description: typeof draft.parsed?.description === 'string' ? draft.parsed.description.trim().slice(0, 1000) || null : null,
      docJson: JSON.stringify(draft.doc), source: 'ai', aiRequestJson: JSON.stringify(req), annotationsJson: JSON.stringify(annotations), createdById: trainerId,
    },
  });
  await audit({
    practiceId, trainerId, clientId, action: 'program_suggested', itemType: 'program', itemId: row.id,
    meta: { suggestedBy: 'ai', removed: annotations.filter((a) => a.kind === 'removed').length, refusedFromBrief: annotations.filter((a) => a.kind === 'guardrail' && a.text.startsWith('Not programmed')).length },
  });
  return toProgram(row);
}
