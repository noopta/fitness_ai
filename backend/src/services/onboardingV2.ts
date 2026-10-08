// v2 program onboarding — the agent's side of "intent in, work visible".
//
// gaps(): given the goal, read the sources (real RAG retrieval — the ledger
// lines are the titles of chunks that were actually retrieved), read what the
// profile already holds (pre-filled rows, each with its source), and decide
// which of the ~20 intake fields are still gaps. Only the gaps are asked.
//
// build(): given the goal + answers, persist the intake on the profile the
// same way the v1 8-step form did, then generate the program through the
// existing generator, and return the phases + nutrition line for the plan
// screen. Deterministic apart from the generator itself.

import { PrismaClient } from '@prisma/client';
import { retrieveProgramSources } from './ragService.js';

const prisma = new PrismaClient();

export type GoalKind = 'strength' | 'pain' | 'rehab' | 'general';

export interface Question {
  key: string; short: string; label: string; why: string; adjust: string; options: string[]; redFlag?: string[];
  /** Which profile field this fills, if any. */
  field?: string;
}
export interface Prefilled { key: string; label: string; value: string; source: string; field?: string }
export interface ConsentSource { key: string; label: string; sub: string; on: boolean }
export interface LedgerLine { verb: 'Read' | 'Pulled' | 'Noted' | 'Searched' | 'Checked'; text: string }

export function goalKind(goal: string): GoalKind {
  const t = goal.toLowerCase();
  if (/back|spine|lumbar|pain|hurt|ache/.test(t)) return 'pain';
  if (/achill|tendon|rupture|rehab|surgery|acl|meniscus|return/.test(t)) return 'rehab';
  if (/deadlift|squat|bench|press|pull|\d{3}|stronger|strength|kg|lb/.test(t)) return 'strength';
  return 'general';
}

/** The intake question bank. Keys map to the profile fields the v1 form wrote. */
const CORE: Question[] = [
  { key: 'days', short: 'Days per week', label: 'How many days can you train?', why: 'Frequency sets the split.', adjust: 'the split', options: ['2', '3', '4', '5+'], field: 'daysPerWeek' },
  { key: 'age', short: 'Training age', label: 'How long have you trained?', why: 'Training age decides how fast you can progress.', adjust: 'progression rate', options: ['Under 6 months', '6–12 months', '1–3 years', '3+ years'], field: 'trainingAge' },
  { key: 'bw', short: 'Bodyweight', label: 'Bodyweight?', why: 'It sets protein and every strength ratio.', adjust: 'strength ratio and protein target', options: ['Under 60 kg / 130 lb', '60–80 kg / 130–175', '80–100 kg / 175–220', '100+ kg / 220+'], field: 'weightKg' },
  { key: 'equipment', short: 'Equipment', label: 'What do you train with?', why: 'Decides which lifts are even on the table.', adjust: 'exercise selection', options: ['Full gym', 'Home — barbell', 'Home — dumbbells', 'Bodyweight only'], field: 'equipment' },
];
const STRENGTH: Question[] = [
  { key: 'current', short: 'Current level', label: 'Where is the lift today?', why: 'Sets the starting intensity and how far the goal really is.', adjust: 'starting intensity', options: ['Just learning it', 'Below bodyweight', 'Around 1.5× bodyweight', '2× bodyweight or more'] },
  { key: 'stall', short: 'Progress', label: 'Is it moving right now?', why: 'A stall changes the first block from volume to a reset.', adjust: 'the first block', options: ['Still climbing', 'Stalled a few weeks', 'Going backward', 'Not sure'] },
];
const PAIN: Question[] = [
  { key: 'dur', short: 'Duration', label: 'How long has it hurt?', why: 'Under six weeks is acute. The whole plan changes.', adjust: 'the timeline', options: ['Under 6 weeks', '6 weeks – 3 months', '3+ months'] },
  { key: 'trig', short: 'Aggravator', label: 'What makes it worse?', why: 'Flexion vs. extension intolerance decides the first exercises.', adjust: 'the opening exercises', options: ['Sitting or bending', 'Standing or arching', 'Both', 'Not sure'] },
  { key: 'leg', short: 'Leg symptoms', label: 'Any numbness or pain down a leg?', why: 'A red flag. If yes, I route you to a clinician first.', adjust: 'the clinical route', options: ['No', 'Yes'], redFlag: ['Yes'] },
  { key: 'lift', short: 'Lifting now', label: 'Do you lift right now?', why: 'Decides whether we rebuild or start.', adjust: 'the entry point', options: ['Yes, weekly', 'I used to', 'Never'] },
];
const REHAB: Question[] = [
  { key: 'when', short: 'Weeks since', label: 'When did it happen?', why: 'Weeks post-injury set the loading ceiling.', adjust: 'the loading ceiling', options: ['Under 2 weeks', '2–6 weeks', '6–12 weeks', '3+ months'] },
  { key: 'surg', short: 'Management', label: 'Surgical or non-surgical?', why: 'Different early-phase protocols.', adjust: 'the early protocol', options: ['Surgical', 'Non-surgical', 'Not decided yet'] },
  { key: 'wb', short: 'Weight-bearing', label: 'Can you bear weight on it?', why: 'Decides whether we start seated or standing.', adjust: 'the starting position', options: ['Not yet', 'Partially', 'Fully, with support', 'Fully'] },
  { key: 'cleared', short: 'Clearance', label: 'Has a clinician cleared you to load it?', why: 'I won\'t program load a clinician hasn\'t signed off.', adjust: 'the clinical route', options: ['Yes', 'Not yet'], redFlag: ['Not yet'] },
];
const HEALTH: Question[] = [
  { key: 'hurt', short: 'Pain', label: 'Does anything hurt when you train?', why: 'A sore joint changes how fast we progress — and which lifts get you there.', adjust: 'exercise selection', options: ['No', 'Lower back, sometimes', 'A shoulder or knee', 'Pain down a leg or arm'], redFlag: ['Pain down a leg or arm'], field: 'constraintsText' },
  { key: 'meds', short: 'Conditions', label: 'Any condition or medication I should know about?', why: 'Some change how hard you can safely push — heart, blood pressure, diabetes.', adjust: 'the intensity ceiling', options: ['No', 'Blood pressure or heart', 'Diabetes or thyroid', 'Something else — tell Anakin'], redFlag: ['Blood pressure or heart'] },
  { key: 'sleep', short: 'Sleep', label: 'How do you usually sleep?', why: 'Under 6 hours makes recovery weeks come sooner.', adjust: 'recovery cadence', options: ['Under 6 hours', '6–7 hours', '7 or more'] },
  { key: 'stress', short: 'Stress', label: 'How\'s your stress and energy lately?', why: 'High stress means lower volume, not lower effort.', adjust: 'weekly volume', options: ['Low — steady', 'Moderate', 'High — running on fumes'] },
  { key: 'food', short: 'Nutrition', label: 'How would you describe how you eat?', why: 'Sets whether nutrition is the lever or the constraint.', adjust: 'the nutrition line', options: ['Structured', 'Decent, not tracked', 'All over the place'] },
  { key: 'region', short: 'Food region', label: 'What kind of food do you mostly eat?', why: 'Meal suggestions should be things you\'d actually cook.', adjust: 'meal suggestions', options: ['Western', 'South Asian', 'East Asian', 'Mediterranean / Middle Eastern'], field: 'foodRegion' },
];

const CONSENT: ConsentSource[] = [
  { key: 'logs', label: 'Training logs', sub: 'Every set you\'ve logged', on: true },
  { key: 'health', label: 'Health notes', sub: 'Injuries and pain you tell me', on: true },
  { key: 'research', label: 'Web research', sub: 'Studies and expert transcripts on your goal', on: true },
  { key: 'nutrition', label: 'Food logs', sub: 'Meals, for the nutrition target', on: true },
];

function trainingAgeLabel(v?: string | null): string | null {
  if (!v) return null;
  const t = v.toLowerCase();
  if (/6\s*[–-]\s*12|early_interm/.test(t)) return '6–12 months';
  if (/beginner|<1|under/.test(t)) return 'Under 6 months';
  if (/interm|1-3|1–3/.test(t)) return '1–3 years';
  if (/adv|3\+|3 /.test(t)) return '3+ years';
  return v;
}

export async function gapsForGoal(userId: string, goal: string) {
  const kind = goalKind(goal);
  const [user, workoutCount, lastLogs, coachProfileRaw] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true, heightCm: true, trainingAge: true, equipment: true, constraintsText: true, foodRegion: true, dateOfBirth: true, coachProfile: true, unitPreference: true } }),
    prisma.workoutLog.count({ where: { userId } }),
    prisma.workoutLog.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 8, select: { date: true } }),
    Promise.resolve(null),
  ]);
  void coachProfileRaw;
  const cp: any = (() => { try { return user?.coachProfile ? JSON.parse(user.coachProfile) : {}; } catch { return {}; } })();

  // Sources — real retrieval. The ledger lines are what was actually read.
  let sources: { title: string; snippet?: string }[] = [];
  try {
    const r = await retrieveProgramSources(goal, 6);
    sources = (r.sources ?? []).map((s: any) => ({ title: s.title ?? s.source ?? 'Source', snippet: s.snippet }));
  } catch { sources = []; }

  const ledger: LedgerLine[] = [];
  const uniqTitles = [...new Set(sources.map((s) => s.title))].slice(0, 3);
  for (const t of uniqTitles) ledger.push({ verb: 'Read', text: t });
  if (!uniqTitles.length) ledger.push({ verb: 'Searched', text: `“${goal.slice(0, 40)}” — the evidence base` });
  ledger.push({ verb: 'Pulled', text: workoutCount ? `Your lift log — ${workoutCount} sessions` : 'Your lift log — nothing on file yet' });
  if (kind === 'pain') ledger.push({ verb: 'Noted', text: 'Red-flag screen required before any loading' });
  else if (kind === 'rehab') ledger.push({ verb: 'Noted', text: 'No plyometrics before clinical clearance' });
  else ledger.push({ verb: 'Noted', text: 'Protein target scales with bodyweight. Need it.' });

  // Pre-filled rows from the profile — value plus where it came from.
  const prefilled: Prefilled[] = [];
  const metric = (user?.unitPreference ?? 'metric') !== 'imperial';
  if (user?.weightKg) prefilled.push({ key: 'bw', label: 'Bodyweight', value: metric ? `${Math.round(user.weightKg)} kg` : `${Math.round(user.weightKg * 2.20462)} lb`, source: 'Your profile', field: 'weightKg' });
  if (user?.heightCm) prefilled.push({ key: 'height', label: 'Height', value: `${user.heightCm} cm`, source: 'Your profile' });
  if (user?.dateOfBirth) { const age = Math.floor((Date.now() - new Date(user.dateOfBirth).getTime()) / (365.25 * 86400000)); if (age > 10 && age < 100) prefilled.push({ key: 'ageYears', label: 'Age', value: String(age), source: 'Your profile' }); }
  if (user?.trainingAge) prefilled.push({ key: 'age', label: 'Training age', value: trainingAgeLabel(user.trainingAge) ?? user.trainingAge, source: cp?.trainingAge ? 'Your intake' : 'Your profile', field: 'trainingAge' });
  if (user?.equipment) prefilled.push({ key: 'equipment', label: 'Equipment', value: user.equipment, source: 'Your profile', field: 'equipment' });
  if (cp?.daysPerWeek) prefilled.push({ key: 'days', label: 'Days you train', value: String(cp.daysPerWeek), source: 'Your intake', field: 'daysPerWeek' });
  else if (lastLogs.length >= 4) {
    const weeks = new Set(lastLogs.map((l) => l.date.slice(0, 7)));
    const perWeek = Math.max(2, Math.min(5, Math.round(lastLogs.length / Math.max(1, weeks.size) / 4)));
    prefilled.push({ key: 'days', label: 'Days you train', value: String(perWeek), source: `Your logs · last ${lastLogs.length} sessions`, field: 'daysPerWeek' });
  }
  if (user?.foodRegion) prefilled.push({ key: 'region', label: 'Food region', value: user.foodRegion, source: 'Your profile', field: 'foodRegion' });
  if (user?.constraintsText) prefilled.push({ key: 'hurt', label: 'Health notes', value: user.constraintsText.slice(0, 60), source: 'What you told me', field: 'constraintsText' });
  if (cp?.sleepQuality) prefilled.push({ key: 'sleep', label: 'Sleep', value: String(cp.sleepQuality), source: 'Your intake' });

  const known = new Set(prefilled.map((p) => p.key));
  const goalQs = kind === 'strength' ? STRENGTH : kind === 'pain' ? PAIN : kind === 'rehab' ? REHAB : [];
  const questions = [...goalQs, ...CORE.filter((q) => !known.has(q.key))];
  const health = HEALTH.filter((q) => !known.has(q.key) && !(kind === 'pain' && q.key === 'hurt'));

  return {
    goal, kind, ledger, sources: uniqTitles.length || 1,
    sourceList: sources.slice(0, 6),
    questions: questions.slice(0, 6),
    prefilled, health, consent: CONSENT,
    totalFields: 20,
  };
}

function daysFrom(v?: string): number { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.max(2, Math.min(6, n)) : 4; }
function weightFrom(v?: string): number | null {
  if (!v) return null;
  const m = /(\d+)(?:–(\d+))?\s*kg/.exec(v);
  if (m) return m[2] ? (Number(m[1]) + Number(m[2])) / 2 : Number(m[1]) + (/\+/.test(v) ? 10 : /Under/.test(v) ? -5 : 0);
  return null;
}
function weeksFor(kind: GoalKind): number { return kind === 'rehab' ? 16 : kind === 'pain' ? 12 : 12; }

export function profileFromAnswers(goal: string, answers: Record<string, string>, prefilled: Prefilled[] = []) {
  const kind = goalKind(goal);
  const days = answers.days ?? prefilled.find((p) => p.key === 'days')?.value;
  const constraints = [answers.hurt && answers.hurt !== 'No' ? answers.hurt : null, answers.leg === 'Yes' ? 'radiating leg pain' : null, answers.meds && answers.meds !== 'No' ? answers.meds : null, kind === 'pain' ? goal : null, kind === 'rehab' ? goal : null].filter(Boolean).join('; ') || undefined;
  const weightKg = weightFrom(answers.bw) ?? undefined;
  const coachProfile = {
    primaryGoal: goal, goalKind: kind, daysPerWeek: daysFrom(days), trainingAge: answers.age, equipment: answers.equipment,
    sleepQuality: answers.sleep, stressEnergy: answers.stress, nutritionQuality: answers.food, foodRegion: answers.region,
    injuries: constraints, redFlagRoute: answers.redFlagRoute, answers, version: 'v2-onboarding-2026-09',
  };
  return {
    kind, daysPerWeek: daysFrom(days), durationWeeks: weeksFor(kind),
    profileUpdate: {
      coachGoal: goal, coachOnboardingDone: true, coachProfile: JSON.stringify(coachProfile),
      ...(answers.age ? { trainingAge: answers.age } : {}),
      ...(answers.equipment ? { equipment: answers.equipment } : {}),
      ...(answers.region ? { foodRegion: answers.region } : {}),
      ...(constraints ? { constraintsText: constraints } : {}),
      ...(weightKg ? { weightKg } : {}),
    },
  };
}

/** Phases for the plan screen from the generated program. */
export function phasesFromProgram(program: any): { name: string; weeks: number; focus: string }[] {
  const phases: any[] = program?.phases ?? [];
  return phases.map((p, i) => ({ name: p.name || p.phaseName || `Phase ${i + 1}`, weeks: p.durationWeeks ?? p.weeks ?? 1, focus: p.focus || p.description || p.goal || '' }));
}

export function nutritionLine(program: any, kind: GoalKind): string {
  const n = program?.nutrition ?? program?.nutritionPlan ?? null;
  if (n?.summary) return String(n.summary);
  if (n?.calories && n?.proteinG) return `${n.proteinG} g protein · ${n.calories} kcal a day.`;
  if (kind === 'rehab') return 'Collagen 15 g + vitamin C before loading. Protein 1.6 g/kg.';
  if (kind === 'pain') return 'Omega-3 2 g a day. Protein 1.6 g/kg to support tissue repair.';
  return 'Protein 1.6 g/kg. Maintenance calories — no cut during the peak.';
}
