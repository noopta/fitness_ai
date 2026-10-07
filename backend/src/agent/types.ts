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

/**
 * What a tool may do (CHAT_CARDS_RN_SPEC §2 server rules):
 *  read    — nothing changes
 *  log     — the user stated a fact; runs its op at once, card offers Undo
 *  set     — the user asked for a setting/profile change; runs at once, Undo
 *  propose — program / schedule / targets; stores a pending op, applied on tap
 *  draft   — anything other people see; nothing leaves until Send
 *  confirm — deletes; runs on tap
 *  intent  — a client action (camera, store sheet, sign out…)
 * Only log and set tools may call executeOp; the loop's write guard throws
 * for the rest.
 */
export type ToolKind = 'read' | 'log' | 'set' | 'propose' | 'draft' | 'confirm' | 'intent';

/** Per-turn facts card builders need (display unit, timezone, today). */
export interface ToolCtx { userId: string; unit: 'metric' | 'imperial'; tz: string; today: string }

/** A single tool the agent can call. `execute` runs the real side effect. */
export interface AgentTool {
  kind?: ToolKind;
  /** Capability id from the catalog (e.g. 'PRG-07'); drives card.fn. */
  fn?: string;
  /** Always loaded; the rest are found through tool search. */
  core?: boolean;
  /** Build the card(s) shown under the reply from this call's result. */
  card?: (input: Record<string, unknown>, result: any, ctx: ToolCtx) => import('./cards/types.js').CardDraft | import('./cards/types.js').CardDraft[] | null | Promise<import('./cards/types.js').CardDraft | import('./cards/types.js').CardDraft[] | null>;
  /** Receipt shown while the tool runs, and the refined one after. */
  receipt?: (input: Record<string, unknown>, userId?: string) => { verb: string; text: string };
  /** Sharpen the receipt from the result: new text, or a new verb and text ("Reading" → "Read"). */
  refine?: (result: any, input: Record<string, unknown>) => string | { verb: string; text: string } | null;
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
  /** Adaptive-progression snapshot — a pending proposal is usually what a
   *  user means by "your suggestion"; details come from read_adaptation. */
  adaptation?: { pendingCount: number; latestTitle: string | null } | null;
  /** Compact workout-history block (services/trainingSummary.ts, contract 7);
   *  null when the flags are off, logs consent is off, or there's no history. */
  trainingSummary?: string | null;
  /** Consent sources the user switched off (You › Privacy); kept out of context. */
  consentOff?: Array<'logs' | 'health' | 'research' | 'nutrition'>;
  profile: {
    name: string | null;
    tier: string;
    heightCm: number | null;
    weightKg: number | null;
    /** User's display-unit preference — drives how weights are rendered to them. */
    unitPreference: 'metric' | 'imperial';
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
  // Canonical kilograms — rendered into the user's unit at display time.
  bodyWeight: {
    latestKg: number | null;
    sevenDayAvgKg: number | null;
    trendKgPerWeek: number | null;
  } | null;
  lastWellness: {
    date: string;
    // Optional — a check-in saves only what was answered.
    mood: number | null;
    energy: number | null;
    sleepHours: number;
    stress: number | null;
  } | null;
  // Durable cross-session memory — goals, preferences, flagged constraints
  // ("knee hurts on squats"). This is what turns a chatbot into an agent
  // that knows you. Free-form notes the agent itself maintains.
  memory: string[];
}

/** Structured proposal returned by a non-persisting tool (e.g.
 *  propose_program_update, propose_workout_swap). Discriminated union on
 *  `kind` so new proposal shapes can be added without breaking existing
 *  clients — they just ignore kinds they don't know how to render. */
export type AgentProposal =
  | {
      kind: 'program_update';
      updatedProgram: any;
      summary: string;
      changedDays?: string[];
    }
  | {
      kind: 'workout_swap';
      proposedWeek: any[];        // resolved week, returned by buildSwapProposal
      rationale: string;
      summary: string;
      sourceDate: string;
      chosenSessionName: string;
    }
  | {
      kind: 'plan_patch';
      day: string | null;
      scope: 'day' | 'program';
      from: { name: string; sets?: number | string; reps?: number | string };
      to: { name: string; sets?: number | string; reps?: number | string };
      meta: { primaryTarget?: string[]; equipment?: string; stimulusDelta?: string; shoulderLoad?: string };
      rationale: string;
      summary: string;
    };

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
  /** Contract-2 cards shown under the reply (server ids, max 3 + summary). */
  cards?: import('./cards/types.js').Card[];
}
