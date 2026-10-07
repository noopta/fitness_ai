// Receipts — the agent's work made visible.
//
// The v2 mobile shell renders every tool call as a one-line receipt:
// `PULLED — Last 14 days of sessions`. The verb is the tool's CLASS (read /
// write / propose), never something the model invents, and the noun comes
// from the tool's input so the line is specific when the tool was specific
// and a fixed noun when it wasn't (no-arg reads are "verb + fixed noun only",
// per the design system). Nothing here calls the model — it's a pure mapping
// so the client can trust that a receipt on screen corresponds 1:1 to a tool
// event that actually happened.
//
// Verb set (settled with design, 2026-09-28): eight canonical verbs plus
// `Checked` for validation reads. Write verbs render crimson on the client;
// read verbs render muted.

// Verbs = tool class (design §2). Reads render muted, writes crimson.
export type ReceiptVerb =
  | 'Reading' | 'Read' | 'Pulled' | 'Searched' | 'Computed' | 'Checked' | 'Heard' | 'Delegated'
  | 'Logged' | 'Adjusted' | 'Proposed' | 'Noted' | 'Saved' | 'Drafted' | 'Sent' | 'Posted'
  | 'Deleted' | 'Corrected' | 'Started' | 'Opened' | 'Forgot' | 'Removed';

export interface Receipt {
  verb: ReceiptVerb;
  text: string;
  /** Nested (sub-agent) receipts indent 16px on the client. */
  indent?: boolean;
}

export const WRITE_VERBS: ReadonlySet<ReceiptVerb> = new Set(['Logged', 'Adjusted', 'Proposed', 'Noted', 'Saved', 'Drafted', 'Sent', 'Posted', 'Deleted', 'Corrected', 'Started', 'Opened', 'Forgot', 'Removed']);

type Input = Record<string, unknown>;

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const clip = (s: string, n = 64) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Receipt emitted when a tool is CALLED (before its result is known). */
export function receiptForCall(tool: string, input: Input = {}): Receipt {
  switch (tool) {
    // ── No-arg reads: verb + fixed noun ────────────────────────────────────
    case 'read_profile': return { verb: 'Read', text: 'Profile' };
    case 'read_program': return { verb: 'Read', text: 'Program' };
    case 'read_schedule_week': return { verb: 'Read', text: 'This week' };
    case 'read_latest_diagnostic': return { verb: 'Read', text: 'Latest diagnostic' };
    case 'read_nutrition_plan': return { verb: 'Read', text: 'Nutrition plan' };
    case 'read_adaptation': return { verb: 'Checked', text: 'Pending adaptations' };

    // ── Reads with a window ────────────────────────────────────────────────
    case 'read_recent_workouts':
      return { verb: 'Pulled', text: `Last ${num(input.days, 14)} days of sessions` };
    case 'read_nutrition_today': {
      const date = str(input.date);
      return { verb: 'Pulled', text: date ? `Nutrition — ${date}` : 'Nutrition — today' };
    }
    case 'read_body_weight_trend':
      return { verb: 'Pulled', text: `Body weight — ${num(input.days, 30)} days` };
    case 'read_wellness':
      return { verb: 'Pulled', text: `Wellness — last ${num(input.limit, 7)} check-ins` };
    case 'read_micro_status':
      return { verb: 'Pulled', text: `Micronutrients — ${num(input.days, 7)} days` };
    case 'read_lift_progress': {
      const l = str(input.lift);
      return { verb: 'Pulled', text: l ? `${l.charAt(0).toUpperCase()}${l.slice(1)} history` : 'Lift history' };
    }
    case 'query_research': {
      const q = str(input.query);
      return { verb: 'Searched', text: q ? `“${clip(q, 48)}”` : 'Research' };
    }

    // ── Writes ─────────────────────────────────────────────────────────────
    case 'log_meal': {
      const name = str(input.name) || str(input.description);
      const kcal = Number(input.calories);
      const tail = Number.isFinite(kcal) && kcal > 0 ? ` — ${Math.round(kcal)} kcal` : '';
      return { verb: 'Logged', text: name ? `${clip(name, 48)}${tail}` : 'Meal' };
    }
    case 'log_body_weight': {
      const w = Number(input.weight);
      return { verb: 'Logged', text: Number.isFinite(w) ? `Body weight — ${w}` : 'Body weight' };
    }
    case 'log_workout': {
      const t = str(input.title);
      return { verb: 'Logged', text: t ? `Workout — ${clip(t, 40)}` : 'Workout' };
    }
    case 'log_wellness': {
      const parts: string[] = [];
      if (input.sleepHours != null) parts.push(`sleep ${input.sleepHours} h`);
      if (input.energy != null) parts.push(`energy ${input.energy}/5`);
      return { verb: 'Logged', text: parts.length ? `Wellness — ${parts.join(', ')}` : 'Wellness' };
    }
    case 'adjust_macros': {
      const parts: string[] = [];
      if (input.calories != null) parts.push(`${input.calories} kcal`);
      if (input.proteinG != null) parts.push(`${input.proteinG} g protein`);
      return { verb: 'Adjusted', text: parts.length ? `Macros — ${parts.join(', ')}` : 'Macros' };
    }
    case 'apply_program_update':
      return { verb: 'Adjusted', text: str(input.summary) ? clip(str(input.summary), 64) : 'Program' };
    case 'swap_exercise_in_program': {
      const a = str(input.fromExerciseName), b = str(input.toExerciseName);
      return { verb: 'Adjusted', text: a && b ? `${a} → ${b}` : 'Exercise swap' };
    }
    case 'remember':
      return { verb: 'Noted', text: clip(str(input.note) || 'For next time', 64) };

    // ── Proposals ──────────────────────────────────────────────────────────
    case 'propose_program_update':
      return { verb: 'Proposed', text: clip(str(input.summary) || 'Program change', 64) };
    case 'propose_workout_swap': {
      const s = str(input.sourceDate), d = str(input.date);
      return { verb: 'Proposed', text: s ? `Move ${s}${d ? ` → ${d}` : ' → today'}` : 'Workout swap' };
    }
    case 'propose_exercise_swap': {
      const a = str(input.fromExerciseName), b = str(input.toExerciseName);
      return { verb: 'Proposed', text: a && b ? `${a} → ${b}` : 'Exercise swap' };
    }

    // ── Sub-agent ──────────────────────────────────────────────────────────
    case 'delegate_task':
      return { verb: 'Delegated', text: clip(str(input.task) || 'A sub-task', 64) };

    default:
      return { verb: 'Read', text: tool.replace(/_/g, ' ') };
  }
}

/**
 * Optional one-line summary of a tool's RESULT, used to sharpen the receipt
 * after execution (e.g. "Last 14 days of sessions" → "Last 14 days — 6
 * sessions"). Returns null when the result adds nothing worth saying; the
 * client keeps the call receipt in that case.
 */
export function summarizeResult(tool: string, result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, any>;
  if (r.error) return null;
  switch (tool) {
    case 'read_recent_workouts':
      return typeof r.count === 'number' ? `Last ${r.days ?? 14} days — ${r.count} session${r.count === 1 ? '' : 's'}` : null;
    case 'read_nutrition_today': {
      const kcal = r.totals?.calories ?? r.calories;
      const n = r.mealCount ?? (Array.isArray(r.meals) ? r.meals.length : undefined);
      if (typeof kcal === 'number' && typeof n === 'number') return `Today — ${Math.round(kcal)} kcal, ${n} meal${n === 1 ? '' : 's'}`;
      return null;
    }
    case 'read_wellness': {
      const last = Array.isArray(r.checkins) ? r.checkins[0] : Array.isArray(r) ? r[0] : null;
      if (last && typeof last.sleepHours === 'number') return `Wellness — sleep ${last.sleepHours} h, energy ${last.energy}/5`;
      return null;
    }
    case 'read_schedule_week': {
      const days = Array.isArray(r.weekDays) ? r.weekDays : [];
      const done = days.filter((d: any) => d?.isLogged).length;
      const planned = days.filter((d: any) => d?.session).length;
      if (planned) return `This week — ${done} of ${planned} done`;
      return null;
    }
    case 'query_research': {
      const n = Array.isArray(r.results) ? r.results.length : Array.isArray(r.chunks) ? r.chunks.length : typeof r.count === 'number' ? r.count : null;
      return n != null ? `${n} source${n === 1 ? '' : 's'}` : null;
    }
    case 'read_micro_status': {
      const gaps = Array.isArray(r.gaps) ? r.gaps : Array.isArray(r.coverage) ? r.coverage.filter((c: any) => c?.status !== 'ok') : null;
      if (gaps) return gaps.length ? `${gaps.length} nutrient${gaps.length === 1 ? '' : 's'} short` : 'No gaps';
      return null;
    }
    case 'read_lift_progress':
      if (r.empty) return `${r.lift} — no sets logged yet`;
      if (typeof r.weeks === 'number' && r.weeks > 0) return `${r.lift} — ${r.weeks} week${r.weeks === 1 ? '' : 's'} of sessions`;
      return null;
    case 'log_meal': {
      const kcal = r.meal?.calories ?? r.calories;
      const name = r.meal?.name ?? r.name;
      if (name && typeof kcal === 'number') return `${clip(String(name), 44)} — ${Math.round(kcal)} kcal`;
      return null;
    }
    default:
      return null;
  }
}

/** Card the client may render under the reply, derived from tool results. */
export type AgentCard =
  | { type: 'week'; data: { weekDays: any[]; weekNumber: number | null; phaseName: string | null; proposal?: { proposedWeek: any[]; rationale: string; summary: string; sourceDate: string } } }
  | { type: 'bench'; data: { lift: string; series: { week: string; rm: number }[]; forecast?: { value: number; week: string } | null; delta?: number | null; current1RMkg?: number | null; weeks?: number; empty?: boolean } }
  | { type: 'food'; data: { totals: { calories: number; proteinG: number; carbsG: number; fatG: number }; mealCount: number } }
  | { type: 'proposal'; data: { summary: string; rationale?: string } };

/**
 * Decide whether a tool result should surface as an inline card. Cards
 * accumulate across a turn; the last card wins (the client renders one per
 * reply). A proposal card always wins over a plain week card.
 */
export function cardForResult(tool: string, input: Input, result: unknown, prev: AgentCard | null): AgentCard | null {
  if (!result || typeof result !== 'object') return prev;
  const r = result as Record<string, any>;
  if (r.error) return prev;
  switch (tool) {
    case 'read_schedule_week':
      if (Array.isArray(r.weekDays)) {
        // Don't downgrade a proposal-bearing week card to a plain one.
        if (prev?.type === 'week' && prev.data.proposal) return prev;
        return { type: 'week', data: { weekDays: r.weekDays, weekNumber: r.weekNumber ?? null, phaseName: r.phaseName ?? null } };
      }
      return prev;
    case 'propose_workout_swap':
      if (r._proposal && Array.isArray(r.proposedWeek)) {
        const base = prev?.type === 'week' ? prev.data : { weekDays: [], weekNumber: null, phaseName: null };
        return { type: 'week', data: { ...base, proposal: { proposedWeek: r.proposedWeek, rationale: String(r.rationale ?? ''), summary: String(r.summary ?? ''), sourceDate: String(r.sourceDate ?? '') } } };
      }
      return prev;
    case 'read_lift_progress':
      if (typeof r.lift === 'string' && Array.isArray(r.series)) {
        return { type: 'bench', data: { lift: r.lift, series: r.series, forecast: r.forecast ?? null, delta: r.deltaKg ?? null, current1RMkg: r.current1RMkg ?? null, weeks: r.weeks ?? r.series.length, empty: !!r.empty || r.series.length === 0 } };
      }
      return prev;
    case 'read_nutrition_today': {
      const t = r.totals ?? r;
      if (typeof t?.calories === 'number') {
        return { type: 'food', data: { totals: { calories: t.calories, proteinG: t.proteinG ?? 0, carbsG: t.carbsG ?? 0, fatG: t.fatG ?? 0 }, mealCount: r.mealCount ?? (Array.isArray(r.meals) ? r.meals.length : 0) } };
      }
      return prev;
    }
    case 'propose_program_update':
    case 'propose_exercise_swap':
      if (r._proposal) return { type: 'proposal', data: { summary: String(r.summary ?? 'Proposed change'), rationale: typeof r.rationale === 'string' ? r.rationale : undefined } };
      return prev;
    default:
      return prev;
  }
}
