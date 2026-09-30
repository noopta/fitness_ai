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

function build(): AgentTool[] {
  const fresh = toolkits.flat();
  const names = new Set(fresh.map((t) => t.name));
  const legacy = LEGACY.filter((t) => !names.has(t.name)).map((t) => ({ ...t, kind: t.kind ?? LEGACY_KIND[t.name] ?? 'read', core: t.core ?? true }));
  const all = [...fresh, ...legacy];
  const seen = new Set<string>();
  for (const t of all) {
    if (seen.has(t.name)) throw new Error(`Duplicate agent tool ${t.name}`);
    seen.add(t.name);
  }
  return all;
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
export function resetRegistryForTests() { cached = null; }
