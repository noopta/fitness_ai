// Hard injury constraints for program generation (founder test, Oct 2026: an
// un-cleared Achilles rupture still got squat and deadlift days, and the coach
// re-generated ten times trying to fix it). The injury reached the model as one
// line among dozens of profile notes; it now leads the prompt as a rule, and a
// draft that breaks it is checked here and corrected before anyone sees it.

import { canonicalizeSync } from './exerciseCanonical.js';

const LOWER_AREA = /\b(achilles|ankle|calf|calves|foot|feet|plantar|heel|shin|tibia|fibula|knee|acl|mcl|meniscus|patella|hamstring|quad(riceps)?|hip|groin|leg)\b/i;
const NOT_CLEARED = /\b(rupture[ds]?|torn|tear|fracture[ds]?|broken|surgery|post[- ]?op|not (yet )?cleared|cast|boot|crutch|non[- ]?weight[- ]?bearing|can'?t (bear|put) weight|recovering)\b/i;

/** Injury text with intake artifacts removed ("No; Achilles…" → "Achilles…"). */
export function cleanInjuryText(...texts: (string | null | undefined)[]): string {
  const parts = texts.flatMap((t) => String(t ?? '').split(/\s*;\s*|\n/)).map((s) => s.trim()).filter((s) => s && !/^(no|none|n\/a|nothing)\.?$/i.test(s));
  return [...new Set(parts)].join('; ');
}

/** Whether lower-body loading is off the table (a lower-limb injury that isn't cleared). */
export function lowerBodyBlocked(injuryText: string): boolean {
  return LOWER_AREA.test(injuryText) && NOT_CLEARED.test(injuryText);
}

const LOWER_NAME = /\b(squat|lunge|deadlift|rdl|romanian|leg press|leg curl|leg extension|hamstring curl|calf|step[- ]?up|hip thrust|glute bridge|split squat|hack squat|good morning|jump|box jump|sprint|running|run\b|skipping|nordic|sled|kettlebell swing|kb swing|clean|snatch|thruster|burpee|wall sit|hip abduction|hip adduction|adductor|abductor)\b/i;

/** Exercises in a program that load the lower body. */
export function lowerBodyExercises(program: any): string[] {
  const out = new Set<string>();
  for (const ph of program?.phases ?? []) for (const d of ph?.trainingDays ?? ph?.days ?? []) for (const e of d?.exercises ?? []) {
    const name = String(e?.name ?? e?.exercise ?? '').trim();
    if (!name || /\bcurl\b/i.test(name) && !/leg|hamstring/i.test(name)) continue;
    const c = canonicalizeSync(name);
    if ((c && (c.category === 'legs' || c.category === 'hinge')) || LOWER_NAME.test(name)) out.add(name);
  }
  return [...out];
}

/** Drop lower-body exercises; a day left empty becomes a rest day (it keeps its weekday). */
export function stripLowerBody(program: any): any {
  const bad = new Set(lowerBodyExercises(program).map((n) => n.toLowerCase()));
  for (const ph of program?.phases ?? []) for (const d of ph?.trainingDays ?? []) {
    d.exercises = (d.exercises ?? []).filter((e: any) => !bad.has(String(e?.name ?? e?.exercise ?? '').trim().toLowerCase()));
    if (!d.exercises.length) { d.focus = 'Rest'; d.day = String(d.day ?? '').replace(/—.*$/, '— Rest').trim() || 'Rest'; }
  }
  return program;
}

/** The rule that leads the program prompt. Empty when there's nothing to enforce. */
export function hardConstraintBlock(injuryText: string, daysPerWeek: number): { block: string; daysPerWeek: number } {
  if (!injuryText) return { block: '', daysPerWeek };
  const lower = lowerBodyBlocked(injuryText);
  const days = lower ? Math.min(daysPerWeek, 4) : daysPerWeek;
  const lines = [
    'HARD CONSTRAINTS — these override every other instruction, the goal included:',
    `- Injury: ${injuryText}`,
    ...(lower ? [
      '- Not cleared for lower-body loading: NO squats, lunges, deadlifts or hinges, leg press, leg curls or extensions, calf work, step-ups, hip thrusts, jumps, running, sleds, Olympic lifts or anything standing and loaded on the legs.',
      '- Program the upper body (seated or supported where possible) and core that does not load the injured leg. Keep squat and deadlift goals on record but out of the plan.',
      `- ${days} training days a week: upper-body-only training needs rest between sessions; more days do not get them there faster.`,
    ] : ['- Avoid anything that loads the injured area; choose alternatives that keep training safe.']),
  ];
  return { block: lines.join('\n'), daysPerWeek: days };
}
