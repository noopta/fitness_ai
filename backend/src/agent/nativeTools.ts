// Native screens running Anakin's tools (v2 handoff H-02, H-03, T-04–T-06,
// T-10): Swap, Life happened, the freestyle pick and an exercise swap show
// the same Proposal card chat would, without a chat turn. Only these tools —
// each one deterministic (no model call) and either read-only or a proposal
// that changes nothing until the user taps Apply on the card.

import { AGENT_TOOLS } from './registry.js';
import { toolCtx, runToolCall } from './turn.js';
import type { Card } from './cards/types.js';
import './toolkits/index.js';

export const NATIVE_TOOLS = new Set([
  'propose_workout_swap',
  'propose_rest_days',
  'propose_program_shift',
  'propose_today_adjustment',
  'propose_deload',
  'propose_exercise_swap',
  'suggest_session',
]);

export const isNativeTool = (name: string) => NATIVE_TOOLS.has(name);

export class NativeToolError extends Error { constructor(message: string, public status = 400) { super(message); } }

/** Run one allowed tool for a screen: its result (as the model would see it) and its cards. */
export async function runNativeTool(userId: string, name: string, input: Record<string, unknown>): Promise<{ result: unknown; cards: Card[] }> {
  if (!isNativeTool(name)) throw new NativeToolError('That isn’t available here.', 404);
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) throw new NativeToolError('That isn’t available here.', 404);
  const ctx = await toolCtx(userId);
  const out = await runToolCall(tool, input, userId, ctx, { buildCards: true });
  const r: any = out.modelResult;
  // A tool that answers with { error } (nothing scheduled today, ambiguous name) says so in one line.
  if (!out.cards.length && r && typeof r === 'object' && typeof r.error === 'string') throw new NativeToolError(r.error, 422);
  return { result: out.modelResult, cards: out.cards };
}
