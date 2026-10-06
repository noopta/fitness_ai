// The coaching profile, canonicalised.
//
// User.coachProfile is a JSON blob written by three intakes (web v1, mobile
// v1, v2 onboarding) with different key names and option values — and the
// program / nutrition generators only read the web names. This registry maps
// every field to ONE canonical key (the one the generators read), lists the
// older keys as aliases with value maps, and writes by MERGING: the blob also
// holds `nutrition`, `consent` and `welcome*` sub-keys that other routes own,
// so it is never replaced wholesale.

import { PrismaClient } from '@prisma/client';
import { cacheDelete } from '../../services/cacheService.js';

const prisma = new PrismaClient();

export type FieldType = 'text' | 'number' | 'select' | 'multi';
export interface ProfileField {
  key: string;
  label: string;
  group: 'Goal' | 'Training' | 'Health' | 'Diet' | 'Lifestyle' | 'Coaching';
  type: FieldType;
  /** canonical option values → display labels */
  options?: Record<string, string>;
  /** blob key the generators read (canonical) */
  blobKey: string;
  /** other blob keys holding the same answer, with value maps */
  aliases?: { key: string; map?: Record<string, string> }[];
  /** flat User column mirrored on write */
  column?: 'coachGoal' | 'trainingAge' | 'equipment' | 'coachBudget' | 'constraintsText';
  min?: number; max?: number;
  /** health answers render privately and are never agent-suggested */
  private?: boolean;
  /** changing it usually means the program or targets should change too */
  affects?: 'program' | 'nutrition' | 'both';
}

const f = (x: ProfileField) => x;
export const PROFILE_FIELDS: ProfileField[] = [
  f({ key: 'goal', label: 'Main goal', group: 'Goal', type: 'text', blobKey: 'primaryGoal', column: 'coachGoal', affects: 'program' }),
  f({ key: 'why', label: 'Why it matters', group: 'Goal', type: 'text', blobKey: 'goalWhy' }),
  f({ key: 'pastAttempts', label: 'What you tried before', group: 'Goal', type: 'text', blobKey: 'pastAttempts' }),
  f({ key: 'obstacle', label: 'Biggest obstacle', group: 'Goal', type: 'select', blobKey: 'obstacleToConsistency',
    options: { time: 'Time', motivation: 'Motivation', no_right_plan: 'No plan that fits', injury: 'Injury', results: 'Not seeing results', none: 'Nothing, I’m consistent' },
    aliases: [{ key: 'obstacle', map: { no_plan: 'no_right_plan', no_results: 'results', consistent: 'none' } }] }),
  f({ key: 'commitment', label: 'Commitment (1–10)', group: 'Goal', type: 'number', blobKey: 'commitment', min: 1, max: 10 }),
  f({ key: 'aestheticGoals', label: 'Areas to improve', group: 'Goal', type: 'multi', blobKey: 'aestheticGoals',
    options: { chest: 'Chest', shoulders: 'Shoulders', arms: 'Arms', back: 'Back', core: 'Core', legs: 'Legs', glutes: 'Glutes', posture: 'Posture', overall_leanness: 'Overall leanness' },
    aliases: [{ key: 'aestheticGoals', map: { leanness: 'overall_leanness' } }] }),

  f({ key: 'trainingAge', label: 'Training experience', group: 'Training', type: 'select', blobKey: 'trainingAge', column: 'trainingAge',
    options: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', elite: 'Elite' },
    aliases: [{ key: 'experience', map: { early_intermediate: 'intermediate' } }, { key: 'trainingAge', map: { early_intermediate: 'intermediate', 'Under a year': 'beginner', '1–3 years': 'intermediate', '3+ years': 'advanced' } }],
    affects: 'program' }),
  f({ key: 'daysPerWeek', label: 'Days per week', group: 'Training', type: 'number', blobKey: 'daysPerWeek', min: 2, max: 7, aliases: [{ key: 'frequency' }, { key: 'trainingDays' }], affects: 'program' }),
  f({ key: 'sessionMinutes', label: 'Session length (min)', group: 'Training', type: 'number', blobKey: 'sessionDuration', min: 20, max: 180, affects: 'program' }),
  f({ key: 'equipment', label: 'Equipment', group: 'Training', type: 'select', blobKey: 'equipment', column: 'equipment',
    options: { commercial: 'Full gym', limited: 'Limited (dumbbells, bands)', home: 'Home gym' },
    aliases: [{ key: 'equipment', map: { full_gym: 'commercial', home_gym: 'home', 'Full gym': 'commercial', 'Dumbbells only': 'limited', 'Home — barbell': 'home' } }],
    affects: 'program' }),
  f({ key: 'trainingStyle', label: 'Training style', group: 'Training', type: 'select', blobKey: 'trainingPreference',
    options: { strength: 'Strength', hypertrophy: 'Muscle', athletic: 'Athletic', mixed: 'Balanced' },
    aliases: [{ key: 'trainingStyle', map: { muscle: 'hypertrophy', balanced: 'mixed' } }], affects: 'program' }),
  f({ key: 'trainingTypes', label: 'Training you like', group: 'Training', type: 'multi', blobKey: 'trainingTypes',
    options: { barbell: 'Barbell', dumbbells: 'Dumbbells', machines: 'Machines', cables: 'Cables', bodyweight: 'Bodyweight', cardio: 'Cardio', hiit: 'HIIT' } }),
  f({ key: 'currentRoutine', label: 'Current routine', group: 'Training', type: 'text', blobKey: 'currentRoutine' }),

  f({ key: 'sex', label: 'Sex', group: 'Health', type: 'select', blobKey: 'gender', options: { male: 'Male', female: 'Female', prefer_not_to_say: 'Prefer not to say' },
    aliases: [{ key: 'biologicalSex', map: { prefer_not: 'prefer_not_to_say' } }], affects: 'nutrition' }),
  f({ key: 'parq', label: 'Health screening', group: 'Health', type: 'multi', blobKey: 'parqScreening', private: true,
    options: { heart_condition: 'Heart condition', chest_pain: 'Chest pain', dizziness: 'Dizziness', joint_bone: 'Joint or bone problem', bp_heart_meds: 'BP or heart medication', chronic_condition: 'Chronic condition', other_concern: 'Other concern', none: 'None' },
    aliases: [{ key: 'parq', map: { heart: 'heart_condition', joint: 'joint_bone', bp_meds: 'bp_heart_meds', chronic: 'chronic_condition', other: 'other_concern' } }] }),
  f({ key: 'medicalConditions', label: 'Conditions', group: 'Health', type: 'multi', blobKey: 'medicalConditions', private: true,
    options: { hypertension: 'Hypertension', type2_diabetes: 'Type 2 diabetes', type1_diabetes: 'Type 1 diabetes', heart_condition: 'Heart condition', asthma: 'Asthma', hypothyroidism: 'Hypothyroidism', hyperthyroidism: 'Hyperthyroidism', arthritis: 'Arthritis', osteoporosis: 'Osteoporosis', sleep_apnea: 'Sleep apnea', chronic_fatigue: 'Chronic fatigue', anxiety_depression: 'Anxiety or depression', none: 'None' },
    aliases: [{ key: 'medicalConditions', map: { t2_diabetes: 'type2_diabetes', t1_diabetes: 'type1_diabetes', heart: 'heart_condition', hypothyroid: 'hypothyroidism', hyperthyroid: 'hyperthyroidism', fatigue: 'chronic_fatigue', mental: 'anxiety_depression' } }] }),
  f({ key: 'medications', label: 'Medications', group: 'Health', type: 'text', blobKey: 'medications', private: true }),
  f({ key: 'hormonal', label: 'Hormonal health', group: 'Health', type: 'text', blobKey: 'hormonal', private: true, aliases: [{ key: 'hormonalHealth' }] }),

  f({ key: 'dietaryRestrictions', label: 'Diet', group: 'Diet', type: 'multi', blobKey: 'dietaryRestrictions',
    options: { none: 'No restrictions', vegetarian: 'Vegetarian', vegan: 'Vegan', gluten_free: 'Gluten free', dairy_free: 'Dairy free', halal_kosher: 'Halal or kosher', allergies: 'Allergies' }, affects: 'nutrition' }),
  f({ key: 'allergies', label: 'Allergies', group: 'Diet', type: 'text', blobKey: 'allergyNotes', affects: 'nutrition' }),
  f({ key: 'nutritionQuality', label: 'How you eat now', group: 'Diet', type: 'select', blobKey: 'nutritionQuality',
    options: { poor: 'Poor', inconsistent: 'Inconsistent', decent: 'Decent', solid: 'Solid', optimized: 'Dialled in' } }),
  f({ key: 'proteinIntake', label: 'Usual protein', group: 'Diet', type: 'text', blobKey: 'proteinIntake', aliases: [{ key: 'dailyProtein' }] }),
  f({ key: 'budget', label: 'Weekly food budget', group: 'Diet', type: 'text', blobKey: 'budget', column: 'coachBudget', aliases: [{ key: 'weeklyBudget' }] }),

  f({ key: 'activityLevel', label: 'Daily activity', group: 'Lifestyle', type: 'select', blobKey: 'activityLevel',
    options: { sedentary: 'Mostly sitting', light: 'Lightly active', moderate: 'Moderately active', very_active: 'Very active' }, affects: 'nutrition' }),
  f({ key: 'sleep', label: 'Sleep', group: 'Lifestyle', type: 'select', blobKey: 'sleep', options: { great: 'Great', ok: 'Okay', poor: 'Poor', very_poor: 'Very poor' },
    aliases: [{ key: 'sleepQuality', map: { decent: 'ok', severe: 'very_poor' } }] }),
  f({ key: 'stress', label: 'Stress and energy', group: 'Lifestyle', type: 'select', blobKey: 'stressEnergy',
    options: { low_stress: 'Low stress', moderate: 'Moderate', high_stress: 'High stress', burnout: 'Burnt out' },
    aliases: [{ key: 'stressEnergy', map: { low: 'low_stress', high: 'high_stress' } }] }),
  f({ key: 'typicalDay', label: 'A typical day', group: 'Lifestyle', type: 'text', blobKey: 'lifestyle', aliases: [{ key: 'typicalWeekday' }] }),
  f({ key: 'recoveryPractices', label: 'Recovery', group: 'Lifestyle', type: 'multi', blobKey: 'recoveryPractices',
    options: { sauna: 'Sauna', cold_plunge: 'Cold plunge', massage: 'Massage', foam_rolling: 'Foam rolling', meditation: 'Meditation', yoga: 'Yoga', none: 'None' },
    aliases: [{ key: 'recoveryPractices', map: { foam_roll: 'foam_rolling' } }] }),

  f({ key: 'accountability', label: 'Check-ins', group: 'Coaching', type: 'select', blobKey: 'accountability',
    options: { app_daily: 'Daily', weekly_review: 'Weekly', on_demand: 'Only when I ask', flexible: 'Flexible' },
    aliases: [{ key: 'accountability', map: { daily: 'app_daily', weekly: 'weekly_review' } }] }),
];
export const FIELD_BY_KEY: Record<string, ProfileField> = Object.fromEntries(PROFILE_FIELDS.map((x) => [x.key, x]));

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Read one field from a blob: canonical key first, then aliases (mapped). */
export function readField(blob: Record<string, any>, field: ProfileField): unknown {
  // An alias can share the canonical key (mobile wrote `equipment: full_gym`
  // into the same slot); its value map then applies to the canonical read too.
  const sameKey = (field.aliases ?? []).find((a) => a.key === field.blobKey)?.map;
  const sources = [{ key: field.blobKey, map: sameKey }, ...(field.aliases ?? []).filter((a) => a.key !== field.blobKey)];
  for (const src of sources) {
    const raw = blob[src.key];
    if (raw == null || raw === '') continue;
    if (field.type === 'multi') {
      const list = toList(raw).map((x) => src.map?.[x] ?? x);
      if (list.length) return [...new Set(list)];
      continue;
    }
    const v = typeof raw === 'string' ? (src.map?.[raw] ?? raw) : raw;
    if (field.type === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
      continue;
    }
    return v;
  }
  return null;
}

export function parseBlob(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}

export function displayValue(field: ProfileField, v: unknown): string {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return 'Not set';
  if (field.type === 'multi') return (v as string[]).map((x) => field.options?.[x] ?? x).join(', ');
  if (field.type === 'select') return field.options?.[String(v)] ?? String(v);
  return String(v);
}

/** Validate + normalise a value the model supplied for a field. */
export function normaliseValue(field: ProfileField, v: unknown): unknown {
  if (v == null || v === '') return null;
  if (field.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${field.label} must be a number.`);
    if ((field.min != null && n < field.min) || (field.max != null && n > field.max)) throw new Error(`${field.label} must be between ${field.min} and ${field.max}.`);
    return n;
  }
  const opts = field.options ? Object.keys(field.options) : null;
  const matchOpt = (x: string) => {
    if (!opts) return x;
    const lx = x.toLowerCase().trim();
    const hit = opts.find((o) => o === lx || o === lx.replace(/[\s-]+/g, '_') || field.options![o].toLowerCase() === lx)
      ?? (field.aliases ?? []).map((a) => a.map?.[x]).find(Boolean);
    if (!hit) throw new Error(`${field.label} must be one of: ${Object.values(field.options!).join(', ')}.`);
    return hit;
  };
  if (field.type === 'multi') return [...new Set(toList(v).map(matchOpt))];
  if (field.type === 'select') return matchOpt(String(v));
  return String(v).trim().slice(0, 500);
}

/** Current canonical value of every field (plus flat-column fallbacks). */
export async function readProfile(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { coachProfile: true, coachGoal: true, trainingAge: true, equipment: true, coachBudget: true, constraintsText: true },
  });
  if (!u) throw new Error('User not found');
  const blob = parseBlob(u.coachProfile);
  const values: Record<string, unknown> = {};
  for (const fd of PROFILE_FIELDS) {
    let v = readField(blob, fd);
    if ((v == null || v === '') && fd.column && (u as any)[fd.column]) v = normaliseSafe(fd, (u as any)[fd.column]);
    values[fd.key] = v;
  }
  return { values, blob, injuries: readInjuries(blob, u.constraintsText) };
}
function normaliseSafe(fd: ProfileField, v: unknown) { try { return normaliseValue(fd, v); } catch { return v; } }

/**
 * Merge field changes into the blob (canonical key written, stale alias keys
 * removed so reads stay consistent) and mirror flat columns. Returns the
 * previous values for undo.
 */
export async function writeFields(userId: string, changes: Record<string, unknown>) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
  if (!u) throw new Error('User not found');
  const blob = parseBlob(u.coachProfile);
  const previous: Record<string, unknown> = {};
  const columns: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(changes)) {
    const fd = FIELD_BY_KEY[key];
    if (!fd) throw new Error(`Unknown profile field: ${key}`);
    previous[key] = readField(blob, fd);
    const v = normaliseValue(fd, raw);
    for (const a of fd.aliases ?? []) if (a.key !== fd.blobKey) delete blob[a.key];
    if (v == null) delete blob[fd.blobKey];
    else blob[fd.blobKey] = fd.type === 'multi' ? (v as string[]).join(',') : fd.type === 'number' ? String(v) : v;
    // The v2 intake also mirrors a few answers for the web parser.
    if (fd.key === 'trainingStyle' && v) blob.trainingStyle = v === 'hypertrophy' ? 'muscle' : v === 'mixed' ? 'balanced' : v;
    if (fd.column) columns[fd.column] = v == null ? null : fd.type === 'multi' ? (v as string[]).join(', ') : String(v);
  }
  await prisma.user.update({ where: { id: userId }, data: { coachProfile: JSON.stringify(blob), ...columns } });
  cacheDelete(`userctx:${userId}`);
  cacheDelete(`program:${userId}`);
  return { previous };
}

// ── Injuries: the list lives in BOTH coachProfile.injuries and
// User.constraintsText (a known gotcha — program personalisation reads both).
export interface Injury { area: string; note?: string; since?: string; severity?: 'mild' | 'moderate' | 'severe'; resolvedAt?: string }
export function readInjuries(blob: Record<string, any>, constraintsText: string | null): Injury[] {
  if (Array.isArray(blob.injuryList)) return blob.injuryList as Injury[];
  const text = [blob.injuries, constraintsText].filter((x) => typeof x === 'string' && x.trim()).join('; ');
  const parts = [...new Set(text.split(/;\s*|\n/).map((s) => s.trim()).filter(Boolean))];
  return parts.map((p) => ({ area: p }));
}
export async function writeInjuries(userId: string, list: Injury[]) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true, constraintsText: true } });
  if (!u) throw new Error('User not found');
  const blob = parseBlob(u.coachProfile);
  const previous = { injuryList: blob.injuryList ?? null, injuries: blob.injuries ?? null, constraintsText: u.constraintsText ?? null };
  const active = list.filter((i) => !i.resolvedAt);
  const text = active.map((i) => [i.area, i.note].filter(Boolean).join(' — ')).join('; ');
  blob.injuryList = list;
  blob.injuries = text;
  await prisma.user.update({ where: { id: userId }, data: { coachProfile: JSON.stringify(blob), constraintsText: text || null } });
  cacheDelete(`userctx:${userId}`);
  cacheDelete(`program:${userId}`);
  return { previous };
}
export async function restoreInjuries(userId: string, prev: { injuryList: unknown; injuries: unknown; constraintsText: string | null }) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
  const blob = parseBlob(u?.coachProfile);
  if (prev.injuryList == null) delete blob.injuryList; else blob.injuryList = prev.injuryList;
  if (prev.injuries == null) delete blob.injuries; else blob.injuries = prev.injuries;
  await prisma.user.update({ where: { id: userId }, data: { coachProfile: JSON.stringify(blob), constraintsText: prev.constraintsText } });
  cacheDelete(`userctx:${userId}`);
}

/** Merge arbitrary sub-keys (consent, nutrition assessment) without touching the rest. */
export async function mergeBlobKeys(userId: string, patch: Record<string, unknown>) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
  const blob = parseBlob(u?.coachProfile);
  const previous: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    previous[k] = blob[k] ?? null;
    if (v == null) delete blob[k]; else blob[k] = v;
  }
  await prisma.user.update({ where: { id: userId }, data: { coachProfile: JSON.stringify(blob) } });
  cacheDelete(`userctx:${userId}`);
  return { previous };
}

/**
 * What the intake told us, as the lines "What Anakin knows" shows next to the
 * agent's own notes. Set, non-private fields in registry order plus open
 * injuries. Private health answers (screening, conditions, medications,
 * hormonal) stay off the page.
 */
export interface KnownFact { label: string; value: string }
export function factsFromProfile(values: Record<string, unknown>, injuries: Injury[]): KnownFact[] {
  const out: KnownFact[] = [];
  for (const fd of PROFILE_FIELDS) {
    if (fd.private) continue;
    const v = values[fd.key];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out.push({ label: fd.label, value: displayValue(fd, v) });
  }
  for (const inj of injuries) {
    if (inj.resolvedAt || !inj.area?.trim()) continue;
    out.push({ label: 'Injury', value: [inj.area.trim(), inj.note?.trim()].filter(Boolean).join(' — ') });
  }
  return out;
}
export async function knownFacts(userId: string): Promise<KnownFact[]> {
  const { values, injuries } = await readProfile(userId);
  return factsFromProfile(values, injuries);
}
