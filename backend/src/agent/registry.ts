// The full tool set the agent sees. Domain toolkits register here; the
// legacy tools.ts set is included with each tool's kind declared so the
// write guard applies to it too.

import type { AgentTool } from './types.js';
import { AGENT_TOOLS as LEGACY } from './tools.js';

// Kinds for the legacy tools (the toolkits replace most of them).
const LEGACY_KIND: Record<string, AgentTool['kind']> = {
  read_lift_progress: 'read', read_profile: 'read', read_nutrition_today: 'read', read_body_weight_trend: 'read',
  read_recent_workouts: 'read', read_wellness: 'read', read_program: 'read', read_schedule_week: 'read',
  read_latest_diagnostic: 'read', query_research: 'read', read_micro_status: 'read', read_nutrition_plan: 'read',
  read_adaptation: 'read', log_meal: 'log', log_body_weight: 'log', log_workout: 'log', log_wellness: 'log',
  adjust_macros: 'set', apply_program_update: 'set', propose_program_update: 'propose', propose_workout_swap: 'propose',
  propose_exercise_swap: 'propose', remember: 'log',
};

const toolkits: AgentTool[][] = [];
export function registerToolkit(tools: AgentTool[]) { toolkits.push(tools); }

// Retired from the agent. adjust_macros and apply_program_update changed the
// plan with no card and no undo (confirm-first is the rule); the others are
// replaced by richer toolkit tools (read_coaching_profile + read_account,
// read_diagnostics, propose_program_edit).
const RETIRED = new Set(['adjust_macros', 'apply_program_update', 'read_profile', 'read_latest_diagnostic', 'propose_program_update', 'swap_exercise_in_program']);

function build(): AgentTool[] {
  const fresh = toolkits.flat();
  const names = new Set(fresh.map((t) => t.name));
  const legacy = LEGACY.filter((t) => !names.has(t.name) && !RETIRED.has(t.name)).map((t) => ({ ...t, kind: t.kind ?? LEGACY_KIND[t.name] ?? 'read', core: t.core ?? true }));
  const all = [...fresh, ...legacy];
  const seen = new Set<string>();
  for (const t of all) {
    if (seen.has(t.name)) throw new Error(`Duplicate agent tool ${t.name}`);
    seen.add(t.name);
  }
  return all;
}

/**
 * The classic app (card contract 1) can't render the new cards. It keeps the
 * tools it can show today: reads, logs, settings, the three proposal kinds it
 * renders (week move, exercise swap, program diff — which also carries a
 * rebuilt program) and its two direct-apply
 * tools. Proposal/draft/confirm/intent tools without a v1 rendering are left
 * out so a v1 user is never shown "tap Apply" with nothing to tap.
 */
// propose_new_program also returns a program_update proposal (with a rebuild
// marker applyProgramUpdate understands), so "give me a PPL split" / "I'm
// intermediate now" no longer dead-ends on the classic app.
const V1_PROPOSALS = new Set(['propose_workout_swap', 'propose_exercise_swap', 'propose_program_edit', 'propose_program_update', 'propose_new_program']);
// Legacy tools only the classic app gets (its Strength "Apply to your program"
// diff comes from propose_program_update).
const V1_DIRECT = new Set(['adjust_macros', 'apply_program_update', 'propose_program_update']);
let cachedV1: AgentTool[] | null = null;
export function toolsFor(contract: 1 | 2): AgentTool[] {
  if (contract === 2) return [...AGENT_TOOLS];
  if (!cachedV1) {
    const all = [...AGENT_TOOLS];
    const legacyDirect = LEGACY.filter((t) => V1_DIRECT.has(t.name)).map((t) => ({ ...t, kind: (t.name.startsWith('propose_') ? 'propose' : 'set') as AgentTool['kind'], core: true }));
    cachedV1 = [...all.filter((t) => ['read', 'log', 'set'].includes(t.kind ?? 'read') || V1_PROPOSALS.has(t.name)), ...legacyDirect];
  }
  return cachedV1;
}

// Toolkits import this module to register; the list is resolved lazily so
// registration order doesn't matter.
let cached: AgentTool[] | null = null;
export const AGENT_TOOLS: AgentTool[] = new Proxy([] as AgentTool[], {
  get(_t, prop, _r) {
    if (!cached) cached = build();
    const v = (cached as any)[prop];
    return typeof v === 'function' ? v.bind(cached) : v;
  },
});
export function resetRegistryForTests() { cached = null; cachedV1 = null; }
