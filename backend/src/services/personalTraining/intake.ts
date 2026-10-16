// Conversational intake (coach-platform handoff gap #10): the client answers
// one question at a time, a vague answer gets one follow-up, and injuries
// become structured contraindications the moment they are mentioned.
//
// Division of labour, as everywhere in this feature: what was asked, what
// counts as answered, when to probe and how complete the intake is are all
// rules in this file. The model only (a) reads a free-text answer into the
// fields and injury list, and (b) words a follow-up. Either can fail and the
// intake still works: the answer is filed under the question asked, and the
// follow-up uses the template.

import { chatComplete } from '../chatClient.js';
import { parseModelJson } from '../modelJson.js';
import { inferBodyPart, inferSeverity, inferSide, BODY_PARTS, type BodyPart } from './contraindicationRules.js';
import { recordFromIntake } from './contraindications.js';
import { audit } from './drafts.js';
import { prisma } from './db.js';
import type { IntakeField, IntakeState, IntakeTurn } from './types.js';

export class IntakeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IntakeError';
    this.status = status;
  }
}

interface FieldSpec {
  key: IntakeField;
  label: string;
  question: string;
  probe: string;
  required: boolean;
  /** An answer to this must carry a number (days, minutes, years). */
  wantsNumber?: boolean;
}

export const INTAKE_FIELDS: FieldSpec[] = [
  { key: 'goal', label: 'Main goal', required: true,
    question: 'What do you most want to get out of training with me?',
    probe: 'What would that look like in three months? A number on the scale, a lift, an event, how your clothes fit, how you feel?' },
  { key: 'experience', label: 'Training experience', required: true, wantsNumber: true,
    question: 'How long have you been training, and what kind of training have you done?',
    probe: 'Roughly how many months or years, and was it mostly weights, classes, running or sport?' },
  { key: 'schedule', label: 'Days and session length', required: true, wantsNumber: true,
    question: 'How many days a week can you realistically train, and for how long each time?',
    probe: 'If you had to put numbers on it: how many days, and how many minutes a session?' },
  { key: 'equipment', label: 'Where and with what', required: true,
    question: 'Where will you train, and what equipment do you have there?',
    probe: 'Is that a full gym, a home setup (which weights?), or bodyweight only?' },
  { key: 'injuries', label: 'Injuries and pain', required: true,
    question: 'Any injuries, pain or surgeries, past or current? Say "none" if there are none.',
    probe: 'Which body part, roughly when did it start, and has a doctor or physio cleared you to train it?' },
  { key: 'medical', label: 'Medical conditions', required: true,
    question: 'Any medical conditions, medications or pregnancy I should know about? Say "none" if not.',
    probe: 'What is the condition, and has a doctor given you any limits on exercise?' },
  { key: 'lifestyle', label: 'Sleep and stress', required: false,
    question: 'How are your sleep and stress in a normal week?',
    probe: 'About how many hours do you sleep, and is stress low, medium or high most weeks?' },
  { key: 'nutrition', label: 'Eating habits', required: false,
    question: 'How do you usually eat on a normal day?',
    probe: 'Roughly how many meals, and is there anything you avoid or are trying to change?' },
  { key: 'preferences', label: 'Likes and dislikes', required: false,
    question: 'Anything you love or hate doing in training?',
    probe: 'Any exercises or styles you would rather avoid, or ones that keep you coming back?' },
];

const FIELD = new Map(INTAKE_FIELDS.map((f) => [f.key, f]));
const NONE = /^\s*(no|none|nope|nothing|n\/?a|not really|no injuries|nothing to report)\b[.!]?\s*$/i;
const VAGUE = /^\s*(idk|i don'?t know|not sure|unsure|dunno|maybe|depends|some|a bit|a little|whatever|anything|get fit|be healthy|healthy|tone up|tone|fit|stuff|things|ok|okay|fine|normal|average|good|bad)\b[.!]?\s*$/i;

interface Answer { text: string; vague: boolean; probes: number }
type Answers = Partial<Record<IntakeField, Answer>>;

/** Rules for "this answer needs a follow-up". */
export function isVague(field: IntakeField, text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if ((field === 'injuries' || field === 'medical') && NONE.test(t)) return false;
  if (VAGUE.test(t)) return true;
  if (t.split(/\s+/).length < 3 && field !== 'injuries' && field !== 'medical') return true;
  if (FIELD.get(field)?.wantsNumber && !/\d|\b(one|two|three|four|five|six|seven|once|twice|few|couple)\b/i.test(t)) return true;
  // An injury named without when or whether it is cleared is worth one question.
  if (field === 'injuries' && !/\b(\d|ago|since|last|year|month|week|cleared|physio|doctor|surgery|old|current|recent|still)\b/i.test(t)) return true;
  return false;
}

/** 0–100: required fields count for 70%, optional ones 30%; a vague answer counts half. */
export function completeness(answers: Answers): number {
  const score = (f: FieldSpec) => {
    const a = answers[f.key];
    if (!a || !a.text.trim()) return 0;
    return a.vague ? 0.5 : 1;
  };
  const req = INTAKE_FIELDS.filter((f) => f.required);
  const opt = INTAKE_FIELDS.filter((f) => !f.required);
  const r = req.reduce((s, f) => s + score(f), 0) / req.length;
  const o = opt.reduce((s, f) => s + score(f), 0) / opt.length;
  return Math.round(100 * (0.7 * r + 0.3 * o));
}

/** The next field to ask about: a vague answer gets one probe; then the first unanswered field. */
export function nextStep(answers: Answers, current: IntakeField | null): { field: IntakeField; probe: boolean } | null {
  if (current) {
    const a = answers[current];
    if (a && a.vague && a.probes < 1) return { field: current, probe: true };
  }
  const next = INTAKE_FIELDS.find((f) => !answers[f.key]);
  return next ? { field: next.key, probe: false } : null;
}

// ── Reading an answer ────────────────────────────────────────────────────────

export interface Extracted {
  fields: Partial<Record<IntakeField, string>>;
  injuries: { text: string; bodyPart?: BodyPart | 'unknown'; severity?: 'mild' | 'moderate' | 'severe'; side?: string | null; onsetDate?: string | null }[];
}

const llmEnabled = () => process.env.PERSONAL_TRAINING_LLM !== '0' && process.env.NODE_ENV !== 'test' && !process.env.VITEST;

/** Without the model: the whole answer belongs to the question that was asked; injuries are split on ; and newlines. */
export function extractByRules(field: IntakeField, text: string): Extracted {
  const t = text.trim();
  const injuries = (field === 'injuries' || field === 'medical') && !NONE.test(t)
    ? t.split(/\s*;\s*|\n+/).map((s) => s.trim()).filter(Boolean).map((s) => ({
        text: s.slice(0, 200), bodyPart: field === 'medical' ? 'systemic' as const : inferBodyPart(s), severity: inferSeverity(s), side: inferSide(s),
      }))
    : [];
  return { fields: { [field]: t }, injuries };
}

async function extractWithModel(field: IntakeField, question: string, text: string): Promise<Extracted | null> {
  if (!llmEnabled()) return null;
  try {
    const res = await Promise.race([
      chatComplete({
        messages: [
          { role: 'system', content: [
            'You read one answer from a personal-training intake into JSON. Copy the client\'s words; never invent details.',
            `Fields: ${INTAKE_FIELDS.map((f) => `${f.key} (${f.label})`).join(', ')}.`,
            `Return {"fields": {fieldKey: "the part of the answer about that field"}, "injuries": [{"text": "one injury or condition in the client's words", "bodyPart": one of ${BODY_PARTS.join('|')}|unknown, "severity": "mild|moderate|severe", "side": "left|right|both|null", "onsetDate": "YYYY-MM-DD or null"}]}.`,
            `The answer is mainly to the "${field}" question, but put anything clearly about another field under that field.`,
            'List every injury, pain, surgery or medical condition mentioned anywhere in the answer (a condition such as pregnancy or hypertension is bodyPart "systemic"). If none, "injuries": [].',
          ].join(' ') },
          { role: 'user', content: `Question: ${question}\nAnswer: ${text}` },
        ],
        max_completion_tokens: 600,
        temperature: 0,
        response_format: { type: 'json_object' },
      } as any, { requireJson: true, timeoutMs: 12_000, label: 'pt-intake-extract' }),
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    const raw = (res as any)?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = parseModelJson<any>(raw);
    const fields: Extracted['fields'] = {};
    for (const [k, v] of Object.entries(parsed?.fields ?? {})) if (FIELD.has(k as IntakeField) && typeof v === 'string' && v.trim()) fields[k as IntakeField] = v.trim().slice(0, 1000);
    if (!fields[field]) fields[field] = text.trim();
    const injuries: Extracted['injuries'] = Array.isArray(parsed?.injuries) ? parsed.injuries
      .filter((i: any) => typeof i?.text === 'string' && i.text.trim())
      .slice(0, 8)
      .map((i: any) => ({
        text: i.text.trim().slice(0, 200),
        bodyPart: (BODY_PARTS as readonly string[]).includes(i.bodyPart) ? i.bodyPart : inferBodyPart(i.text),
        severity: ['mild', 'moderate', 'severe'].includes(i.severity) ? i.severity : inferSeverity(i.text),
        side: ['left', 'right', 'both'].includes(i.side) ? i.side : null,
        onsetDate: typeof i.onsetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.onsetDate) ? i.onsetDate : null,
      })) : [];
    return { fields, injuries };
  } catch {
    return null;
  }
}

async function wordProbe(spec: FieldSpec, answer: string): Promise<string> {
  if (!llmEnabled()) return spec.probe;
  try {
    const res = await Promise.race([
      chatComplete({
        messages: [
          { role: 'system', content: 'You are a personal trainer asking one short follow-up question in an intake chat. One sentence, plain and warm, no exclamation marks, no emoji. Ask only for what the example asks for.' },
          { role: 'user', content: `They were asked: ${spec.question}\nThey said: ${answer}\nAsk for this: ${spec.probe}` },
        ],
        max_completion_tokens: 80,
        temperature: 0.4,
      } as any, { timeoutMs: 6000, label: 'pt-intake-probe' }),
      new Promise<null>((r) => setTimeout(() => r(null), 7000)),
    ]);
    const text = (res as any)?.choices?.[0]?.message?.content?.trim();
    return text && text.length > 10 && text.length < 300 && text.endsWith('?') ? text.replace(/!/g, '.') : spec.probe;
  } catch {
    return spec.probe;
  }
}

// ── State ────────────────────────────────────────────────────────────────────

type Row = NonNullable<Awaited<ReturnType<typeof prisma.ptIntake.findUnique>>>;

const parse = <T>(raw: string, fallback: T): T => {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

export function toState(row: Row | null, opts: { forTrainer?: boolean } = {}): IntakeState {
  if (!row) return { status: 'not_started', completeness: 0, transcript: [], fields: [], current: INTAKE_FIELDS[0].key };
  const answers = parse<Answers>(row.answersJson, {});
  const transcript = parse<IntakeTurn[]>(row.transcriptJson, []);
  const lastAsked = [...transcript].reverse().find((t) => t.role === 'trainer' && t.field)?.field ?? null;
  return {
    status: row.status as IntakeState['status'],
    completeness: row.completeness,
    transcript,
    current: row.status === 'complete' ? null : lastAsked,
    fields: INTAKE_FIELDS.map((f) => ({
      key: f.key, label: f.label, required: f.required,
      ...(answers[f.key] ? { answer: answers[f.key]!.text, vague: answers[f.key]!.vague } : {}),
    })).filter((f) => opts.forTrainer || f.answer !== undefined),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
  };
}

export async function getIntake(practiceId: string, clientId: string, opts: { forTrainer?: boolean } = {}): Promise<IntakeState> {
  const row = await prisma.ptIntake.findUnique({ where: { practiceId_clientId: { practiceId, clientId } } });
  return toState(row, opts);
}

/** Open the intake: the first question, asked as the trainer. Idempotent. */
export async function startIntake(practiceId: string, clientId: string, now: Date = new Date()): Promise<IntakeState> {
  const existing = await prisma.ptIntake.findUnique({ where: { practiceId_clientId: { practiceId, clientId } } });
  if (existing) return toState(existing);
  const first = INTAKE_FIELDS[0];
  const transcript: IntakeTurn[] = [{ role: 'trainer', text: first.question, field: first.key, at: now.toISOString() }];
  const row = await prisma.ptIntake.create({ data: { practiceId, clientId, transcriptJson: JSON.stringify(transcript) } });
  return toState(row);
}

/**
 * The client's answer to whatever was asked last. Files it, records any
 * injuries as contraindications (not cleared, needing review), then asks the
 * probe or the next question — or closes the intake.
 */
export async function answerIntake(practiceId: string, clientId: string, rawText: unknown, now: Date = new Date()): Promise<IntakeState> {
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, 2000) : '';
  if (!text) throw new IntakeError('Write an answer first', 400);
  const row = await prisma.ptIntake.findUnique({ where: { practiceId_clientId: { practiceId, clientId } } });
  if (!row) throw new IntakeError('Start the intake first', 409);
  if (row.status === 'complete') throw new IntakeError('This intake is already complete', 409);

  const answers = parse<Answers>(row.answersJson, {});
  const transcript = parse<IntakeTurn[]>(row.transcriptJson, []);
  const asked = [...transcript].reverse().find((t) => t.role === 'trainer' && t.field)?.field ?? INTAKE_FIELDS[0].key;
  const spec = FIELD.get(asked)!;
  transcript.push({ role: 'client', text, at: now.toISOString() });

  const extracted = (await extractWithModel(asked, spec.question, text)) ?? extractByRules(asked, text);
  for (const [k, v] of Object.entries(extracted.fields) as [IntakeField, string][]) {
    const prev = answers[k];
    // An earlier answer to another question stands; only the question asked takes a follow-up answer.
    if (prev && k !== asked) continue;
    // A probe's answer adds to what they said before rather than replacing it.
    const combined = (prev ? `${prev.text} — ${v}` : v).slice(0, 2000);
    answers[k] = { text: combined, vague: isVague(k, combined), probes: prev ? prev.probes + 1 : 0 };
  }
  if (extracted.injuries.length) await recordFromIntake(practiceId, clientId, extracted.injuries);

  const step = nextStep(answers, asked);
  if (step) {
    const s = FIELD.get(step.field)!;
    transcript.push({ role: 'trainer', text: step.probe ? await wordProbe(s, answers[step.field]?.text ?? text) : s.question, field: step.field, at: new Date().toISOString(), ...(step.probe ? { probe: true } : {}) });
  } else {
    transcript.push({ role: 'trainer', text: 'Thank you. That is everything I need for now. I will look through it and come back to you with a plan.', at: new Date().toISOString() });
  }
  const done = !step;
  const updated = await prisma.ptIntake.update({
    where: { id: row.id },
    data: {
      answersJson: JSON.stringify(answers), transcriptJson: JSON.stringify(transcript), completeness: completeness(answers),
      ...(done ? { status: 'complete', completedAt: now } : {}),
    },
  });
  if (done) {
    const coach = await prisma.institutionMember.findFirst({ where: { institutionId: practiceId, role: 'coach', active: true }, orderBy: { joinedAt: 'asc' }, select: { userId: true } });
    if (coach) await audit({ practiceId, trainerId: coach.userId, clientId, action: 'intake_completed', itemType: 'intake', itemId: row.id, meta: { completeness: updated.completeness } });
  }
  return toState(updated);
}

/** Start over (trainer only): the record of what was said stays in the audit log; the answers go. */
export async function resetIntake(practiceId: string, trainerId: string, clientId: string) {
  const row = await prisma.ptIntake.findUnique({ where: { practiceId_clientId: { practiceId, clientId } } });
  if (!row) return;
  await prisma.ptIntake.delete({ where: { id: row.id } });
  await audit({ practiceId, trainerId, clientId, action: 'intake_reset', itemType: 'intake', itemId: row.id, meta: { completeness: row.completeness } });
}
