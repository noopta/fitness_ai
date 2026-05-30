// Shared types for the Anakin agent (Phase 1 of the agentic build).
//
// The agent is a Claude tool-use loop: it receives a user message + an
// assembled UserContext, decides which tools to call, executes them against
// the existing backend services/DB, and loops until it has an answer.
//
// This is greenfield on the `agentic-main` branch — it does NOT replace the
// existing OpenAI Assistants "Anakin" (coachThreadId) flow. Both can run in
// parallel behind the AGENT_ENABLED feature flag until the new path is proven.

import type Anthropic from '@anthropic-ai/sdk';

/** A single tool the agent can call. `execute` runs the real side effect. */
export interface AgentTool {
  name: string;
  description: string;
  // JSON Schema for the tool's input, passed straight to the Anthropic API.
  input_schema: Anthropic.Tool.InputSchema;
  // Executor — receives validated-ish input + the calling user's id, returns
  // a JSON-serialisable result that gets fed back to the model as a
  // tool_result. Throwing is fine; the loop converts it to an error result
  // the model can react to.
  execute: (input: Record<string, unknown>, userId: string) => Promise<unknown>;
}

/** Everything the agent knows about the user at the start of a turn. */
export interface UserContext {
  userId: string;
  profile: {
    name: string | null;
    tier: string;
    heightCm: number | null;
    weightKg: number | null;
    trainingAge: string | null;
    equipment: string | null;
    constraints: string | null;
    goal: string | null;
    budget: string | null;
  };
  // Compact snapshots — full detail is available on demand via tools. The
  // context is the "what's probably relevant" layer; tools are the "go get
  // the specifics" layer.
  todayNutrition: {
    date: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    mealCount: number;
  } | null;
  bodyWeight: {
    latestLbs: number | null;
    sevenDayAvgLbs: number | null;
    trendLbsPerWeek: number | null;
  } | null;
  lastWellness: {
    date: string;
    mood: number;
    energy: number;
    sleepHours: number;
    stress: number;
  } | null;
  // Durable cross-session memory — goals, preferences, flagged constraints
  // ("knee hurts on squats"). This is what turns a chatbot into an agent
  // that knows you. Free-form notes the agent itself maintains.
  memory: string[];
}

/** Structured proposal returned by a non-persisting tool (e.g.
 *  propose_program_update). Surfaced to clients so the UI can render a
 *  side-by-side diff and let the user confirm before persisting. */
export interface AgentProposal {
  kind: 'program_update';
  updatedProgram: any;
  summary: string;
  changedDays?: string[];
}

/** Result of one agent turn. */
export interface AgentTurnResult {
  reply: string;
  // Names of tools the agent invoked this turn — for logging / debugging /
  // the eventual "Anakin did X for you" UI affordance.
  toolsUsed: string[];
  // Number of model round-trips (1 = answered without tools). Useful for
  // cost monitoring.
  iterations: number;
  // Set when the agent called a propose_* tool — the client uses this to
  // render a confirm-before-apply UI instead of persisting directly.
  proposal?: AgentProposal;
}
