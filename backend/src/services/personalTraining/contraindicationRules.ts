// The contraindication rules engine (coach-platform handoff §2.2).
//
// Injuries and conditions are data: a body part, a severity and a clearance.
// Exercises are classified into movement patterns. A pattern that loads a
// body part which is not cleared is refused, wherever the request came from:
// the program builder, AI generation, the briefing's suggestions or the
// client's own program generation. Pure and deterministic; no LLM, no I/O.
//
// Conservative on purpose. A false conflict costs the trainer one click to
// allow a pattern for that client; a missed one can cost the client an injury.

export const BODY_PARTS = [
  'neck', 'shoulder', 'elbow', 'wrist_hand', 'chest', 'upper_back', 'lower_back', 'abdominal',
  'hip', 'groin', 'hamstring', 'quad', 'knee', 'calf_achilles', 'ankle_foot', 'systemic',
] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const BODY_PART_LABELS: Record<BodyPart, string> = {
  neck: 'Neck', shoulder: 'Shoulder', elbow: 'Elbow', wrist_hand: 'Wrist / hand', chest: 'Chest / pec',
  upper_back: 'Upper back', lower_back: 'Lower back', abdominal: 'Abdominal / hernia', hip: 'Hip', groin: 'Groin / adductor',
  hamstring: 'Hamstring', quad: 'Quad', knee: 'Knee', calf_achilles: 'Calf / Achilles', ankle_foot: 'Ankle / foot',
  systemic: 'Whole body (condition)',
};

export const PATTERNS = [
  'squat', 'hinge', 'lunge', 'knee_extension', 'knee_flexion', 'hip_thrust', 'hip_adduction', 'calf_raise',
  'plyometric', 'running', 'horizontal_press', 'overhead_press', 'dip', 'vertical_pull', 'horizontal_pull',
  'chest_fly', 'lateral_raise', 'elbow_flexion', 'elbow_extension', 'grip', 'axial_load', 'spinal_flexion',
  'rotation', 'loaded_carry', 'olympic', 'neck_loading', 'max_effort', 'supine',
] as const;
export type Pattern = (typeof PATTERNS)[number];

export type Clearance = 'not_cleared' | 'modified' | 'cleared';
export type Severity = 'mild' | 'moderate' | 'severe';

/** What the engine needs from a contraindication. Rows, inferred client text and test fixtures all fit. */
export interface RuleInput {
  id: string;
  bodyPart: BodyPart | 'unknown';
  condition: string;
  clearance: Clearance;
  severity: Severity;
  /** Patterns the trainer blocked on top of the body part's defaults. */
  extraBlocks?: Pattern[];
  /** Patterns the trainer allowed for this client despite the defaults. */
  allow?: Pattern[];
  active?: boolean;
}

/**
 * For each body part: `primary` patterns load it directly and are refused
 * until it is cleared; `secondary` load it indirectly — refused while not
 * cleared, allowed with a warning once the trainer marks it "modified".
 */
export const BODY_PART_RULES: Record<BodyPart, { primary: Pattern[]; secondary: Pattern[] }> = {
  neck: { primary: ['neck_loading', 'olympic'], secondary: ['overhead_press', 'axial_load', 'loaded_carry'] },
  shoulder: { primary: ['overhead_press', 'dip', 'lateral_raise', 'olympic'], secondary: ['horizontal_press', 'chest_fly', 'vertical_pull', 'max_effort'] },
  elbow: { primary: ['elbow_extension', 'elbow_flexion', 'dip'], secondary: ['horizontal_press', 'overhead_press', 'vertical_pull', 'grip'] },
  wrist_hand: { primary: ['grip', 'olympic'], secondary: ['horizontal_press', 'overhead_press', 'loaded_carry', 'dip'] },
  chest: { primary: ['horizontal_press', 'chest_fly', 'dip'], secondary: ['overhead_press', 'max_effort'] },
  upper_back: { primary: ['horizontal_pull', 'vertical_pull'], secondary: ['hinge', 'olympic', 'axial_load'] },
  lower_back: { primary: ['hinge', 'axial_load', 'olympic', 'spinal_flexion'], secondary: ['squat', 'rotation', 'loaded_carry', 'overhead_press', 'max_effort', 'running', 'plyometric'] },
  abdominal: { primary: ['max_effort', 'spinal_flexion', 'axial_load'], secondary: ['hinge', 'squat', 'rotation', 'olympic'] },
  hip: { primary: ['squat', 'lunge', 'hip_thrust'], secondary: ['hinge', 'plyometric', 'running', 'hip_adduction'] },
  groin: { primary: ['hip_adduction', 'lunge'], secondary: ['squat', 'plyometric', 'running'] },
  hamstring: { primary: ['hinge', 'knee_flexion', 'running'], secondary: ['plyometric', 'lunge', 'olympic'] },
  quad: { primary: ['knee_extension', 'squat', 'lunge'], secondary: ['plyometric', 'running'] },
  knee: { primary: ['squat', 'lunge', 'knee_extension', 'plyometric', 'running'], secondary: ['knee_flexion', 'olympic', 'hinge'] },
  calf_achilles: { primary: ['calf_raise', 'plyometric', 'running'], secondary: ['squat', 'lunge', 'olympic'] },
  ankle_foot: { primary: ['plyometric', 'running', 'calf_raise'], secondary: ['squat', 'lunge', 'olympic', 'loaded_carry'] },
  // A condition rather than a joint (pregnancy, hypertension, recent surgery):
  // no maximal efforts or breath-held lifts, and nothing ballistic.
  systemic: { primary: ['max_effort', 'olympic'], secondary: ['plyometric', 'axial_load', 'supine'] },
};

// ── Classifying free text into a body part ───────────────────────────────────

const BODY_PART_TEXT: [RegExp, BodyPart][] = [
  [/achilles|calf|calves|soleus|gastroc/i, 'calf_achilles'],
  [/ankle|foot|feet|plantar|heel|toe|metatars/i, 'ankle_foot'],
  [/knee|patell|acl|mcl|pcl|lcl|menisc|it ?band/i, 'knee'],
  [/hamstring/i, 'hamstring'],
  [/quad/i, 'quad'],
  [/groin|adductor/i, 'groin'],
  [/hip|glute|piriformis|labrum.*hip/i, 'hip'],
  [/lower back|low back|lumbar|disc|sciatic|\bsi joint|herniat.*(disc|back)|l[45]|s1/i, 'lower_back'],
  [/hernia|abdominal|diastasis|\babs?\b|c-?section/i, 'abdominal'],
  [/upper back|thoracic|rhomboid|lat\b|lats\b/i, 'upper_back'],
  [/neck|cervical|whiplash|trap/i, 'neck'],
  [/shoulder|rotator|ac joint|labr|impinge|frozen/i, 'shoulder'],
  [/elbow|tennis|golfer|epicondyl/i, 'elbow'],
  [/wrist|hand|finger|thumb|carpal/i, 'wrist_hand'],
  [/\bpec|chest|sternum|rib/i, 'chest'],
  [/back|spine|spinal/i, 'lower_back'],
  [/pregnan|postpartum|hypertension|blood pressure|heart|cardiac|surgery|concussion|osteopor|diabet|asthma/i, 'systemic'],
];

/** Best guess at the body part a free-text injury describes; 'unknown' when nothing matches. */
export function inferBodyPart(text: string): BodyPart | 'unknown' {
  for (const [re, part] of BODY_PART_TEXT) if (re.test(text)) return part;
  return 'unknown';
}

const SEVERE_TEXT = /\b(rupture[ds]?|torn|tear|fracture[ds]?|broken|surgery|post[- ]?op|reconstruct|dislocat|herniat|cast|boot|crutch|non[- ]?weight[- ]?bearing|can'?t (bear|put) weight)\b/i;
const MILD_TEXT = /\b(tight|stiff|niggle|minor|slight|mild|old|history of|occasional)\b/i;

export function inferSeverity(text: string): Severity {
  if (SEVERE_TEXT.test(text)) return 'severe';
  if (MILD_TEXT.test(text)) return 'mild';
  return 'moderate';
}

export function inferSide(text: string): 'left' | 'right' | 'both' | null {
  const l = /\bleft\b|\bl\b/i.test(text);
  const r = /\bright\b|\br\b/i.test(text);
  if (l && r) return 'both';
  if (l) return 'left';
  if (r) return 'right';
  if (/both|bilateral/i.test(text)) return 'both';
  return null;
}

// ── Classifying exercises into movement patterns ─────────────────────────────

const EXERCISE_PATTERNS: [RegExp, Pattern[]][] = [
  [/\b(clean|snatch)\b|\bjerk\b/i, ['olympic', 'hinge', 'grip']],
  [/thruster/i, ['squat', 'overhead_press']],
  [/squat|leg press|hack|pendulum|wall sit/i, ['squat']],
  [/split squat|bulgarian|lunge|step[- ]?up|pistol|skater|cossack/i, ['lunge']],
  [/deadlift|\brdl\b|romanian|stiff[- ]?leg|good morning|rack pull|swing|pull[- ]?through|back extension|hyperextension|reverse hyper/i, ['hinge']],
  [/deadlift|rack pull|farmer|shrug/i, ['grip']],
  [/hip thrust|glute bridge|hip bridge|frog pump/i, ['hip_thrust']],
  [/leg extension|knee extension|terminal knee/i, ['knee_extension']],
  [/leg curl|hamstring curl|nordic|glute[- ]?ham|\bghr\b|slider curl/i, ['knee_flexion']],
  [/adduct|copenhagen/i, ['hip_adduction']],
  [/calf raise|calf press|heel raise/i, ['calf_raise']],
  [/jump|\bhop|bound|plyo|skipping|burpee|depth drop/i, ['plyometric']],
  [/\b(run|running|sprint|sprints|jog|jogging|shuttle|high knees)\b|sled|prowler/i, ['running']],
  [/bench press|floor press|chest press|push[- ]?up|press[- ]?up|incline (db |dumbbell |barbell )?press|decline (db |dumbbell |barbell )?press|close[- ]?grip bench|landmine press|svend|^(db |dumbbell )?bench$/i, ['horizontal_press']],
  [/overhead press|\bohp\b|military press|shoulder press|arnold press|push press|z press|handstand|pike push|landmine press|\bjerk\b|thruster/i, ['overhead_press']],
  [/\bdips?\b/i, ['dip']],
  [/pull[- ]?ups?\b|chin[- ]?ups?\b|lat pull|pulldown|pull[- ]?down|straight[- ]?arm/i, ['vertical_pull']],
  [/\brows?\b|seal row|pendlay|t-bar|face pull|reverse fl(y|ye)|rear delt|high pull/i, ['horizontal_pull']],
  [/\bfl(y|ye|yes|ies)\b|pec deck|crossover/i, ['chest_fly']],
  [/lateral raise|side raise|front raise|upright row|\by raise|lu raise/i, ['lateral_raise']],
  [/curl/i, ['elbow_flexion']],
  [/tricep|skull ?crusher|push[- ]?down|kickback|french press|jm press|overhead extension/i, ['elbow_extension']],
  [/carry|yoke|sled|prowler/i, ['loaded_carry']],
  [/farmer|dead hang|grip|wrist curl|plate pinch|towel|pull[- ]?ups?\b|chin[- ]?ups?\b|hanging/i, ['grip']],
  [/shrug|neck|wrestler bridge/i, ['neck_loading']],
  [/crunch|sit[- ]?up|v[- ]?up|toes to bar|knees to elbow|leg raise|knee raise|ab wheel|rollout|jackknife/i, ['spinal_flexion']],
  [/twist|wood ?chop|rotation|pallof|slam|rotational/i, ['rotation']],
  [/\b1 ?rm\b|max (single|out)|true max|heavy single|\bmax\b/i, ['max_effort']],
  [/bench|floor press|lying|supine|skull|pullover|glute bridge|hip thrust/i, ['supine']],
  // Barbell loads that travel through the spine.
  [/(back|front|overhead|zercher|safety[- ]?bar|box|pause|high[- ]?bar|low[- ]?bar|barbell) squat|^squats?$|good morning|deadlift|rack pull|thruster|barbell (lunge|split squat|step|reverse lunge)|standing (barbell )?(overhead|military|shoulder) press|push press|^ohp$|^overhead press$|military press|yoke|farmer|\bclean\b|snatch|\bjerk\b/i, ['axial_load']],
];

/** The movement patterns an exercise loads, read from its name. Empty when nothing is recognised. */
export function exercisePatterns(name: string): Pattern[] {
  const hit = new Set<Pattern>();
  for (const [re, patterns] of EXERCISE_PATTERNS) if (re.test(name)) patterns.forEach((p) => hit.add(p));
  // A split squat is a lunge pattern, not a bilateral squat.
  if (/split squat|bulgarian|pistol|skater|cossack/i.test(name)) hit.delete('squat');
  // "Leg curl" and "hamstring curl" are not elbow work.
  if (/leg curl|hamstring curl|slider curl|nordic/i.test(name)) hit.delete('elbow_flexion');
  // A seated or supported press does not load the spine.
  if (/seated|machine|smith|supported|chest[- ]?supported/i.test(name)) hit.delete('axial_load');
  return [...hit];
}

// ── The rule ─────────────────────────────────────────────────────────────────

export interface Violation {
  exercise: string;
  pattern: Pattern;
  contraindicationId: string;
  condition: string;
  bodyPart: BodyPart | 'unknown';
  /** block: refused. warn: allowed only after the trainer acknowledges it. */
  level: 'block' | 'warn';
  reason: string;
}

export interface ValidationResult {
  /** Active contraindications examined. */
  checked: number;
  violations: Violation[];
  /** Exercises whose name the engine could not classify — never silently passed. */
  unclassified: string[];
  /** Contraindications whose body part is unknown — the trainer must classify them. */
  unclassifiedConditions: string[];
  ok: boolean;
  label: string;
}

/** Patterns refused (block) and allowed-with-warning (warn) for one contraindication. */
export function patternsFor(c: RuleInput): { block: Set<Pattern>; warn: Set<Pattern> } {
  const block = new Set<Pattern>();
  const warn = new Set<Pattern>();
  if (c.active === false || c.clearance === 'cleared' || c.bodyPart === 'unknown') {
    for (const p of c.extraBlocks ?? []) if (c.active !== false && c.clearance !== 'cleared') block.add(p);
    return { block, warn };
  }
  const rule = BODY_PART_RULES[c.bodyPart];
  if (c.clearance === 'not_cleared') {
    rule.primary.forEach((p) => block.add(p));
    rule.secondary.forEach((p) => block.add(p));
  } else {
    // modified: the trainer has said training around it is fine. A severe one keeps its primary patterns refused.
    if (c.severity === 'severe') rule.primary.forEach((p) => block.add(p));
    else rule.primary.forEach((p) => warn.add(p));
    rule.secondary.forEach((p) => warn.add(p));
  }
  for (const p of c.extraBlocks ?? []) { block.add(p); warn.delete(p); }
  for (const p of c.allow ?? []) { block.delete(p); warn.delete(p); }
  return { block, warn };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Check exercises against a client's contraindications. `acknowledged` holds
 * `${exercise}|${contraindicationId}` keys the trainer accepted; acknowledging
 * only ever clears a warning, never a block.
 */
export function validateExercises(contras: RuleInput[], exercises: string[], acknowledged: Set<string> = new Set()): ValidationResult {
  const active = contras.filter((c) => c.active !== false && c.clearance !== 'cleared');
  const rules = active.map((c) => ({ c, ...patternsFor(c) }));
  const violations: Violation[] = [];
  const unclassified: string[] = [];
  const seen = new Set<string>();
  for (const raw of exercises) {
    const exercise = raw.trim();
    if (!exercise || seen.has(exercise.toLowerCase())) continue;
    seen.add(exercise.toLowerCase());
    const patterns = exercisePatterns(exercise);
    if (patterns.length === 0) { unclassified.push(exercise); continue; }
    for (const { c, block, warn } of rules) {
      const blocked = patterns.find((p) => block.has(p));
      if (blocked) {
        violations.push({
          exercise, pattern: blocked, contraindicationId: c.id, condition: c.condition, bodyPart: c.bodyPart, level: 'block',
          reason: `${exercise} loads ${blocked.replace(/_/g, ' ')}, which ${c.condition} is ${c.clearance === 'not_cleared' ? 'not cleared for' : 'still restricted from'}`,
        });
        continue;
      }
      const warned = patterns.find((p) => warn.has(p));
      if (warned && !acknowledged.has(`${exercise.toLowerCase()}|${c.id}`)) {
        violations.push({
          exercise, pattern: warned, contraindicationId: c.id, condition: c.condition, bodyPart: c.bodyPart, level: 'warn',
          reason: `${exercise} loads ${warned.replace(/_/g, ' ')}; ${c.condition} is cleared with modifications`,
        });
      }
    }
  }
  const unclassifiedConditions = active.filter((c) => c.bodyPart === 'unknown').map((c) => c.condition);
  const blocks = violations.filter((v) => v.level === 'block').length;
  const warns = violations.length - blocks;
  return {
    checked: active.length,
    violations,
    unclassified,
    unclassifiedConditions,
    ok: violations.length === 0,
    label: violations.length === 0
      ? `Checked against ${plural(active.length, 'contraindication')}`
      : [blocks ? `${plural(blocks, 'conflict')}` : '', warns ? `${plural(warns, 'warning')}` : ''].filter(Boolean).join(', '),
  };
}

/** The exercises a program document mentions, in order. Accepts the builder's shape and the app's saved-program shape. */
export function programExerciseNames(program: any): string[] {
  const out: string[] = [];
  const visitItems = (items: any[]) => {
    for (const e of items ?? []) {
      const name = String(e?.name ?? e?.exercise ?? '').trim();
      if (name) out.push(name);
    }
  };
  for (const w of program?.weeks ?? []) for (const d of w?.days ?? []) for (const b of d?.blocks ?? []) visitItems(b?.items);
  for (const ph of program?.phases ?? []) for (const d of ph?.trainingDays ?? ph?.days ?? []) visitItems(d?.exercises);
  return out;
}

/** Does any active contraindication refuse this pattern outright? (Briefing suggestions use this.) */
export function patternBlocked(contras: RuleInput[], pattern: Pattern): RuleInput[] {
  return contras.filter((c) => c.active !== false && c.clearance !== 'cleared' && patternsFor(c).block.has(pattern));
}

/** Remove exercises the rules refuse (block level) from an app saved-program; a day left empty becomes a rest day. */
export function stripBlocked(program: any, contras: RuleInput[]): { program: any; removed: string[] } {
  const removed = new Set<string>();
  if (contras.length === 0) return { program, removed: [] };
  for (const ph of program?.phases ?? []) for (const d of ph?.trainingDays ?? ph?.days ?? []) {
    const keep: any[] = [];
    for (const e of d?.exercises ?? []) {
      const name = String(e?.name ?? e?.exercise ?? '').trim();
      const r = name ? validateExercises(contras, [name]) : null;
      if (r && r.violations.some((v) => v.level === 'block')) removed.add(name);
      else keep.push(e);
    }
    if (Array.isArray(d?.exercises)) {
      d.exercises = keep;
      if (!keep.length) { d.focus = 'Rest'; d.day = String(d.day ?? '').replace(/—.*$/, '— Rest').trim() || 'Rest'; }
    }
  }
  return { program, removed: [...removed] };
}

/** The lines that lead a generation prompt, from a trainer's not-cleared contraindications. Empty when none apply. */
export function hardRulesPrompt(contras: RuleInput[]): string {
  const live = contras.filter((c) => c.active !== false && c.clearance !== 'cleared');
  if (!live.length) return '';
  const lines = live.map((c) => {
    const { block } = patternsFor(c);
    const what = [...block].map((p) => p.replace(/_/g, ' ')).join(', ');
    return `- ${c.condition} (${c.bodyPart.replace(/_/g, ' ')}, ${c.clearance.replace('_', ' ')}): no ${what || 'loading of the area'}.`;
  });
  return ['TRAINER CONTRAINDICATIONS — set by the client\'s personal trainer; these override every other instruction:', ...lines].join('\n');
}
