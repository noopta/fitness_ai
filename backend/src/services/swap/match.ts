// Exercise swaps (Oct 2026): a swap keeps the JOB the exercise was doing.
// Pure — no Prisma, no LLM — so the same inputs always rank the same way.
//
//   1. hard filters    modality, movement / primary target, a main lift's load
//                      capacity, equipment, injuries, "only hinge in the session"
//   2. field scores    each 0–1, candidate vs the original
//   3. weighted sum    weights depend on the slot's role (main / secondary /
//                      accessory / cardio / mobility) and the swap reason;
//                      + history bonus − penalty for a demand drop nobody asked for
//   4. rank            score, then name; top 3 spread out (MMR); confidence;
//                      a reason line from the fields that scored the most

import { CATALOG, GROUP, REGION_LABEL, PATTERN_LABEL, type ExerciseProfile, type Pattern, type Region, type Group, type Joint, type Energy, type Equipment } from './catalog.js';

// ─── Names → profiles ────────────────────────────────────────────────────────

const SYNONYM: [RegExp, string][] = [
  [/\btriceps\b/g, 'tricep'], [/\bbiceps\b/g, 'bicep'], [/\bpressdowns?\b/g, 'pushdown'],
  [/\bdb\b/g, 'dumbbell'], [/\bbb\b/g, 'barbell'], [/\bkb\b/g, 'kettlebell'],
  [/\bpullups?\b/g, 'pull up'], [/\bchinups?\b/g, 'chin up'], [/\bpushups?\b/g, 'push up'], [/\bsitups?\b/g, 'sit up'],
  [/\bskull ?crushers?\b/g, 'skullcrusher'], [/\bone arm\b/g, 'single arm'], [/\bone leg\b/g, 'single leg'], [/\bunilateral\b/g, 'single arm'],
];

/** Lowercase, hyphens and punctuation to spaces, tricep/bicep, simple plurals. */
export function normalizeName(name: string): string {
  let n = String(name ?? '').toLowerCase().replace(/[’']/g, '').replace(/[—–\-_/]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of SYNONYM) n = n.replace(re, to);
  return n.split(' ').map((w) => (w.length > 3 && /sses$/.test(w) ? w.slice(0, -2) : w.length > 3 && /[^s]s$/.test(w) && !/(us|is)$/.test(w) ? w.slice(0, -1) : w)).join(' ').trim();
}

interface Indexed { profile: ExerciseProfile; keys: string[]; tokens: string[][] }
let INDEX: Indexed[] | null = null;
const index = (): Indexed[] => {
  if (INDEX) return INDEX;
  INDEX = CATALOG.map((profile) => {
    const keys = [profile.name, ...(profile.aka ?? [])].map(normalizeName);
    return { profile, keys, tokens: keys.map((k) => k.split(' ')) };
  });
  return INDEX;
};

const EQUIP_WORDS = ['machine', 'smith', 'cable', 'dumbbell', 'barbell', 'kettlebell', 'band', 'landmine'];

/**
 * The catalog profile for a name: an exact name/alias, else the entry whose
 * words all appear in it (most words wins: "single arm cable tricep pushdown"
 * → Single Arm Tricep Pushdown, "machine lateral raise" → Machine Lateral
 * Raise), never one that drops an equipment word the name has. `extra` holds
 * profiles classified for names the catalog doesn't know.
 */
export function resolveProfile(name: string, extra?: Map<string, ExerciseProfile>): ExerciseProfile | null {
  const n = normalizeName(name);
  if (!n) return null;
  const fromExtra = extra?.get(n);
  for (const e of index()) if (e.keys.includes(n)) return e.profile;
  if (fromExtra) return fromExtra;
  const words = new Set(n.split(' '));
  let best: { p: ExerciseProfile; len: number } | null = null;
  for (const e of index()) {
    for (const t of e.tokens) {
      if (!t.every((w) => words.has(w))) continue;
      // "machine lateral raise" must not resolve to the dumbbell entry.
      if (EQUIP_WORDS.some((w) => words.has(w) && !t.includes(w) && /\b(machine|smith|cable)\b/.test(w))) continue;
      if (!best || t.length > best.len) best = { p: e.profile, len: t.length };
    }
  }
  return best?.p ?? null;
}

// ─── The slot's job ──────────────────────────────────────────────────────────

export type Role = 'main' | 'secondary' | 'accessory' | 'cardio' | 'mobility';
export type SwapReason = 'default' | 'pain' | 'equipment';

export interface SlotJob {
  role: Role;
  /** What the prescription trains (from the reps / notes). */
  energy: Energy;
  /** The only exercise of its movement in the session: the swap must keep the movement. */
  keepPattern: boolean;
}

export interface SlotInput { reps?: number | string | null; notes?: string | null; index?: number | null; session?: string[] }

const repsOf = (r: number | string | null | undefined): number | null => {
  const m = String(r ?? '').match(/\d+/g);
  if (!m) return null;
  const nums = m.map(Number).filter((x) => x > 0);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

export function slotJob(p: ExerciseProfile, slot: SlotInput = {}, extra?: Map<string, ExerciseProfile>): SlotJob {
  const reps = repsOf(slot.reps);
  const notes = String(slot.notes ?? '').toLowerCase();
  if (p.mod === 'cardio') {
    const energy: Energy = /interval|sprint|hiit|tabata|all out|vo2/.test(notes) ? 'anaerobic' : 'aerobic';
    return { role: 'cardio', energy, keepPattern: false };
  }
  if (p.mod === 'mobility') return { role: 'mobility', energy: 'mobility', keepPattern: false };
  const energy: Energy = p.mod === 'power' ? 'power' : reps == null ? (p.load >= 4 ? 'strength' : 'hypertrophy') : reps <= 5 ? 'strength' : reps <= 15 ? 'hypertrophy' : 'endurance';
  const compound = Object.keys(p.m).length >= 3 && p.load >= 3;
  const early = slot.index == null || slot.index <= 1;
  const role: Role = compound && p.load >= 4 && (early || (reps != null && reps <= 6)) ? 'main' : compound ? 'secondary' : 'accessory';
  const others = (slot.session ?? []).map((n) => resolveProfile(n, extra)).filter((x): x is ExerciseProfile => !!x && x.name !== p.name);
  const keepPattern = p.mod !== 'power' && ['squat', 'hinge', 'h_push', 'v_push', 'h_pull', 'v_pull', 'lunge'].includes(p.pattern)
    && others.length > 0 && !others.some((o) => patternSim(o.pattern, p.pattern) >= 0.6);
  return { role, energy, keepPattern };
}

// ─── Field similarities ──────────────────────────────────────────────────────

const PAIRS: [Pattern, Pattern, number][] = [
  ['squat', 'lunge', 0.6], ['squat', 'hinge', 0.2], ['squat', 'knee_ext', 0.3], ['squat', 'jump', 0.3], ['squat', 'sled', 0.3],
  ['lunge', 'hip_ext', 0.3], ['hinge', 'hip_ext', 0.6], ['hinge', 'knee_flex', 0.3], ['hinge', 'olympic', 0.4], ['hip_ext', 'hip_abd', 0.2],
  ['h_push', 'v_push', 0.4], ['h_push', 'dip', 0.6], ['h_push', 'fly', 0.5], ['dip', 'elbow_ext', 0.3], ['v_push', 'shoulder_abd', 0.2], ['v_push', 'shoulder_flex', 0.3],
  ['shoulder_abd', 'shoulder_flex', 0.3], ['shoulder_abd', 'rear_delt', 0.2],
  ['h_pull', 'v_pull', 0.5], ['h_pull', 'rear_delt', 0.4], ['v_pull', 'shoulder_ext', 0.5], ['h_pull', 'shrug', 0.2],
  ['core_flex', 'anti_ext', 0.5], ['anti_ext', 'anti_rot', 0.5], ['anti_rot', 'rotation', 0.5], ['core_flex', 'rotation', 0.3], ['carry', 'anti_rot', 0.4],
  ['jump', 'olympic', 0.4], ['throw', 'olympic', 0.3],
  ['run', 'walk', 0.6], ['run', 'stair', 0.5], ['run', 'jump_rope', 0.5], ['run', 'bike', 0.5], ['run', 'elliptical', 0.6], ['run', 'sled', 0.3],
  ['bike', 'elliptical', 0.7], ['bike', 'stair', 0.6], ['elliptical', 'stair', 0.7], ['elliptical', 'walk', 0.6], ['walk', 'stair', 0.6],
  ['row_erg', 'bike', 0.5], ['row_erg', 'swim', 0.5], ['swim', 'elliptical', 0.4],
];
const PAIR = new Map<string, number>();
for (const [a, b, v] of PAIRS) { PAIR.set(`${a}|${b}`, v); PAIR.set(`${b}|${a}`, v); }
const CARDIO: Pattern[] = ['run', 'walk', 'bike', 'row_erg', 'elliptical', 'stair', 'swim', 'jump_rope', 'climb'];

export function patternSim(a: Pattern, b: Pattern): number {
  if (a === b) return 1;
  const v = PAIR.get(`${a}|${b}`);
  if (v != null) return v;
  return CARDIO.includes(a) && CARDIO.includes(b) ? 0.3 : 0;
}

const groupsOf = (m: ExerciseProfile['m']) => {
  const g: Partial<Record<Group, number>> = {};
  for (const [r, w] of Object.entries(m) as [Region, number][]) g[GROUP[r]] = (g[GROUP[r]] ?? 0) + w;
  return g;
};
const wJaccard = (a: Record<string, number>, b: Record<string, number>) => {
  let mn = 0, mx = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const x = a[k] ?? 0, y = b[k] ?? 0; mn += Math.min(x, y); mx += Math.max(x, y); }
  return mx ? mn / mx : 0;
};
/** Region overlap, with partial credit for the same muscle group (long vs lateral head). */
export const muscleSim = (a: ExerciseProfile, b: ExerciseProfile) => 0.7 * wJaccard(a.m as any, b.m as any) + 0.3 * wJaccard(groupsOf(a.m) as any, groupsOf(b.m) as any);

export function primaryGroup(p: ExerciseProfile): Group {
  return (Object.entries(groupsOf(p.m)) as [Group, number][]).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
}
const topRegion = (p: ExerciseProfile): Region => (Object.entries(p.m) as [Region, number][]).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
const modClass = (p: ExerciseProfile) => (p.mod === 'power' ? 'strength' : p.mod);
const ord = (a: number | null, b: number | null, range: number) => (a == null || b == null ? 1 : 1 - Math.abs(a - b) / range);

type Field = 'muscles' | 'pattern' | 'load' | 'profile' | 'energy' | 'demand' | 'setup' | 'joint';
const W: Record<Role, Partial<Record<Field, number>>> = {
  main:      { muscles: 0.25, pattern: 0.30, load: 0.25, profile: 0.05, energy: 0.05, demand: 0.05, setup: 0.05 },
  secondary: { muscles: 0.30, pattern: 0.25, load: 0.15, profile: 0.10, energy: 0.05, demand: 0.10, setup: 0.05 },
  accessory: { muscles: 0.40, pattern: 0.15, load: 0.05, profile: 0.20, energy: 0.05, demand: 0.10, setup: 0.05 },
  cardio:    { muscles: 0.10, pattern: 0.25, energy: 0.35, demand: 0.25, setup: 0.05 },
  mobility:  { muscles: 0.60, pattern: 0.10, demand: 0.10, setup: 0.20 },
};
export const WEIGHTS = W;

/** The role's weights, adjusted for the reason: pain adds joint relief, no-equipment raises setup. Sums to 1. */
export function weightsFor(role: Role, reason: SwapReason): Partial<Record<Field, number>> {
  const base = { ...W[role] };
  if (reason === 'pain') { for (const k of Object.keys(base) as Field[]) base[k]! *= 0.75; base.joint = 0.25; }
  if (reason === 'equipment') { for (const k of Object.keys(base) as Field[]) base[k]! *= 0.9; base.setup = (base.setup ?? 0) + 0.1; }
  return base;
}

const topJoint = (p: ExerciseProfile): Joint | null => (Object.entries(p.joints) as [Joint, number][]).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;

function fieldSims(o: ExerciseProfile, c: ExerciseProfile, job: SlotJob, reason: SwapReason, ctx: SwapContext): Record<Field, number> {
  const tj = painJointFor(o, ctx);
  return {
    muscles: muscleSim(o, c),
    pattern: patternSim(o.pattern, c.pattern),
    load: ord(o.load, c.load, 4),
    profile: ord(o.prof, c.prof, 2),
    energy: c.energy.includes(job.energy) ? 1 : wJaccard(Object.fromEntries(o.energy.map((e) => [e, 1])), Object.fromEntries(c.energy.map((e) => [e, 1]))),
    demand: ord(o.demand, c.demand, 4),
    setup: (o.eq === c.eq ? 1 : 0.5) * 0.7 + (!!o.uni === !!c.uni ? 1 : 0.5) * 0.3,
    joint: reason !== 'pain' || !tj ? 1 : Math.min(1, Math.max(0, ((o.joints[tj] ?? 0) - (c.joints[tj] ?? 0)) / Math.max(1, o.joints[tj] ?? 1))),
  };
}

// ─── Who's swapping ──────────────────────────────────────────────────────────

export interface SwapContext {
  /** Equipment they have; null = a full gym. */
  equipment: Set<Equipment> | null;
  /** Joints with a current injury or niggle. */
  injured: Set<Joint>;
  /** Exercise names they avoid. */
  avoid: Set<string>;
  /** Normalized names they've logged (for the history bonus). */
  history: Set<string>;
  /** For reason 'pain': the joint that hurts, when known. */
  painJoint?: Joint | null;
}
export const emptyContext = (): SwapContext => ({ equipment: null, injured: new Set(), avoid: new Set(), history: new Set() });

/** The joint a pain swap must spare: the one they named, else an injured joint this exercise loads, else the one it loads most. */
export function painJointFor(o: ExerciseProfile, ctx: SwapContext): Joint | null {
  if (ctx.painJoint) return ctx.painJoint;
  const injured = [...ctx.injured].filter((j) => (o.joints[j] ?? 0) > 0).sort((a, b) => (o.joints[b] ?? 0) - (o.joints[a] ?? 0) || a.localeCompare(b));
  return injured[0] ?? topJoint(o);
}

/** "full_gym" / "home_gym" / "barbell,dumbbells,rack" / "Bodyweight only" → what's available (null = everything). */
export function equipmentFrom(text: string | null | undefined): Set<Equipment> | null {
  const t = String(text ?? '').toLowerCase();
  if (!t || /full|commercial|gym$/.test(t) && !/home|limited/.test(t)) return null;
  const always: Equipment[] = ['bodyweight', 'none', 'band'];
  if (/bodyweight/.test(t)) return new Set(always);
  if (/limited/.test(t)) return new Set([...always, 'dumbbell', 'kettlebell']);
  if (/home/.test(t)) return new Set([...always, 'dumbbell', 'kettlebell', 'barbell', 'ez_bar', 'landmine']);
  const out = new Set<Equipment>(always);
  const map: [RegExp, Equipment[]][] = [[/barbell|rack/, ['barbell', 'ez_bar', 'landmine']], [/dumbbell/, ['dumbbell']], [/kettlebell/, ['kettlebell']], [/cable/, ['cable']], [/machine/, ['machine', 'smith']], [/bike|treadmill|rower|elliptical|cardio/, ['cardio_machine']], [/trap|hex/, ['trap_bar']]];
  for (const [re, eq] of map) if (re.test(t)) eq.forEach((e) => out.add(e));
  return out.size > always.length ? out : null;
}

/** Injury text (constraints + coach profile) → joints. */
export function jointsFrom(text: string): Set<Joint> {
  const t = text.toLowerCase();
  const out = new Set<Joint>();
  const map: [RegExp, Joint][] = [[/shoulder|rotator|labrum|ac joint/, 'shoulder'], [/elbow|tennis elbow|golfer/, 'elbow'], [/wrist|carpal/, 'wrist'], [/knee|patell|acl|mcl|meniscus/, 'knee'], [/lower back|low back|lumbar|disc|sciatica|spine/, 'lower_back'], [/\bhip\b|hips|groin|labral/, 'hip'], [/ankle|achilles/, 'ankle'], [/neck|cervical/, 'neck']];
  for (const [re, j] of map) if (re.test(t)) out.add(j);
  return out;
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

export interface SwapOption { name: string; score: number; why: string; eq: Equipment; history: boolean; parts: Partial<Record<Field, number>> }

/** Why a candidate fails the hard filters, or null when it passes. */
export function rejectReason(o: ExerciseProfile, c: ExerciseProfile, job: SlotJob, ctx: SwapContext, reason: SwapReason): string | null {
  if (c.name === o.name) return 'same';
  if (modClass(c) !== modClass(o)) return 'modality';
  const ps = patternSim(o.pattern, c.pattern);
  if (job.role === 'main' || job.role === 'secondary') { if (ps < 0.6) return 'movement'; }
  else if (job.role === 'accessory') { if (ps < 0.6 && primaryGroup(c) !== primaryGroup(o)) return 'target'; }
  else if (job.role === 'mobility') { if (muscleSim(o, c) < 0.12) return 'target'; }
  if (job.keepPattern && ps < 0.6) return 'only_pattern';
  if (job.role === 'main' && c.load < o.load - 1) return 'load_capacity';
  if (ctx.equipment && !ctx.equipment.has(c.eq)) return 'equipment';
  for (const j of ctx.injured) if ((c.joints[j] ?? 0) >= 2) return 'injury';
  if (ctx.avoid.has(normalizeName(c.name))) return 'avoid';
  if (reason === 'pain') { const tj = painJointFor(o, ctx); if (tj && (o.joints[tj] ?? 0) > 0 && (c.joints[tj] ?? 0) >= (o.joints[tj] ?? 0)) return 'same_strain'; }
  return null;
}

export function scoreCandidate(o: ExerciseProfile, c: ExerciseProfile, job: SlotJob, ctx: SwapContext, reason: SwapReason): { score: number; parts: Partial<Record<Field, number>> } {
  const w = weightsFor(job.role, reason);
  const sims = fieldSims(o, c, job, reason, ctx);
  const parts: Partial<Record<Field, number>> = {};
  let score = 0;
  for (const [f, wt] of Object.entries(w) as [Field, number][]) { parts[f] = wt * sims[f]; score += parts[f]!; }
  if (ctx.history.has(normalizeName(c.name))) score += 0.05;
  for (const j of ctx.injured) if ((c.joints[j] ?? 0) === 1) score -= 0.1;
  // Never easier unless they asked: a drop in demand (or a main lift's load) costs.
  if (reason !== 'pain') {
    if (c.demand < o.demand) score -= 0.05 * (o.demand - c.demand);
    if ((job.role === 'main' || job.role === 'secondary') && c.load < o.load) score -= 0.05 * (o.load - c.load);
  }
  return { score: Math.round(score * 1000) / 1000, parts };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const EQ_LABEL: Partial<Record<Equipment, string>> = { cable: 'cable', machine: 'machine', dumbbell: 'dumbbells', barbell: 'barbell', bodyweight: 'bodyweight', kettlebell: 'kettlebell', smith: 'Smith machine', ez_bar: 'EZ bar', landmine: 'landmine', band: 'band' };

/** One line from the fields that added the most: "Same triceps lateral head focus, one arm at a time." */
export function whyLine(o: ExerciseProfile, c: ExerciseProfile, parts: Partial<Record<Field, number>>, history: boolean, painJoint: Joint | null = topJoint(o)): string {
  const phrase = (f: Field): string | null => {
    switch (f) {
      case 'muscles': return muscleSim(o, c) >= 0.75 ? `same ${REGION_LABEL[topRegion(c)]} focus` : `hits the ${REGION_LABEL[topRegion(c)]}`;
      case 'pattern': return o.pattern === c.pattern && PATTERN_LABEL[c.pattern] ? `same ${PATTERN_LABEL[c.pattern]}` : null;
      case 'load': return c.load >= o.load ? 'loads as heavy' : c.load === o.load - 1 ? 'loads nearly as heavy' : null;
      case 'profile': return c.prof === 2 && o.prof === 2 ? 'same stretch-position emphasis' : c.prof === 2 ? 'more stretch at the bottom' : c.prof === o.prof ? 'same strength curve' : null;
      case 'energy': return o.mod === 'cardio' ? 'same energy system' : null;
      case 'demand': return c.demand === o.demand ? 'same effort' : c.demand > o.demand ? 'a harder effort' : null;
      case 'setup': return c.uni && !o.uni ? 'one side at a time' : c.eq !== o.eq && EQ_LABEL[c.eq] ? `on the ${EQ_LABEL[c.eq]}` : null;
      case 'joint': return painJoint ? `easier on your ${painJoint.replace('_', ' ')}` : null;
    }
  };
  const ranked = (Object.entries(parts) as [Field, number][]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out: string[] = [];
  for (const [f] of ranked) { const ph = phrase(f); if (ph && !out.includes(ph)) out.push(ph); if (out.length === 2) break; }
  const setupBit = phrase('setup');
  if (out.length < 3 && setupBit && !out.includes(setupBit)) out.push(setupBit);
  const line = out.slice(0, history ? 2 : 3);
  if (history) line.push("you've done it before");
  return `${capital(line.join(', '))}.`;
}

/** How hard the top 3 are pushed apart (0 = pure score order). */
const MMR = 0.15;

export interface RankResult { options: SwapOption[]; top: SwapOption[]; lowConfidence: boolean; rejected: Record<string, string> }

/**
 * Every catalog exercise (plus `pool`) that passes the filters, best first,
 * and the top 3 spread out so they aren't three near-identical variants.
 */
export function rankSwaps(o: ExerciseProfile, job: SlotJob, ctx: SwapContext, reason: SwapReason = 'default', pool: ExerciseProfile[] = []): RankResult {
  const seen = new Set<string>();
  const options: SwapOption[] = [];
  const rejected: Record<string, string> = {};
  for (const c of [...CATALOG, ...pool]) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const r = rejectReason(o, c, job, ctx, reason);
    if (r) { rejected[c.name] = r; continue; }
    const { score, parts } = scoreCandidate(o, c, job, ctx, reason);
    const history = ctx.history.has(normalizeName(c.name));
    options.push({ name: c.name, score, why: whyLine(o, c, parts, history, painJointFor(o, ctx)), eq: c.eq, history, parts });
  }
  options.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const byName = new Map([...CATALOG, ...pool].map((x) => [x.name, x]));
  const top: SwapOption[] = [];
  const rest = [...options];
  while (top.length < 3 && rest.length) {
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const cp = byName.get(rest[i].name)!;
      const sim = top.length ? Math.max(...top.map((t) => { const tp = byName.get(t.name)!; return 0.5 * muscleSim(cp, tp) + 0.3 * patternSim(cp.pattern, tp.pattern) + 0.2 * (cp.eq === tp.eq ? 1 : 0); })) : 0;
      const v = rest[i].score - MMR * sim;
      if (v > bv + 1e-9) { bv = v; bi = i; }
    }
    top.push(rest.splice(bi, 1)[0]);
  }
  return { options, top, lowConfidence: !top.length || top[0].score < 0.6, rejected };
}

/** Same movement and same primary target: the variants row. */
export function variantsOf(o: ExerciseProfile, ranked: SwapOption[], pool: ExerciseProfile[] = []): SwapOption[] {
  const byName = new Map([...CATALOG, ...pool].map((x) => [x.name, x]));
  return ranked.filter((r) => { const c = byName.get(r.name); return !!c && c.pattern === o.pattern && primaryGroup(c) === primaryGroup(o); });
}
