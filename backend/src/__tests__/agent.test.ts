// Agent tests — exercise the tool registry, context assembler, memory store,
// and the full tool-use loop WITHOUT any live Anthropic API call. The loop
// test injects a mock client that scripts a tool_use → end_turn exchange, so
// CI spends $0 while still proving the orchestration wiring end-to-end.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma (constructor form per CLAUDE.md — arrow fns break `this`) ──
// vi.hoisted so the mock object exists when the hoisted vi.mock factory runs.
const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  mealEntry: { findMany: vi.fn(), create: vi.fn() },
  bodyWeightLog: { findMany: vi.fn(), create: vi.fn() },
  wellnessCheckin: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  workoutLog: { findMany: vi.fn(), create: vi.fn() },
  session: { findFirst: vi.fn() },
  feedItem: { findMany: vi.fn() },
  agentMemory: { findUnique: vi.fn(), upsert: vi.fn() },
  agentConversation: { findUnique: vi.fn(), upsert: vi.fn() },
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    Object.assign(this, mocks);
  });
  return { PrismaClient };
});

// Mock the heavy llmService so importing it doesn't pull OpenAI/Gemini init.
vi.mock('../services/llmService.js', () => ({
  parseMealMacros: vi.fn(async (desc: string) => ({
    name: desc.slice(0, 40),
    calories: 500, proteinG: 40, carbsG: 50, fatG: 15,
  })),
}));

import { runAgentTurn } from '../agent/loop.js';
import { assembleContext, renderContext } from '../agent/context.js';
import { TOOLS_BY_NAME, AGENT_TOOLS } from '../agent/tools.js';
import { readMemory, appendMemory } from '../agent/memory.js';
import { loadConversation, appendTurn } from '../agent/conversation.js';
import { evaluateProactiveTrigger } from '../agent/proactive.js';
import { runProactiveSweep } from '../agent/proactiveSweep.js';

const USER = 'user_test_1';

beforeEach(() => {
  Object.values(mocks).forEach((m) => Object.values(m).forEach((fn: any) => fn.mockReset()));
  // Sensible defaults.
  mocks.user.findUnique.mockResolvedValue({
    name: 'Test', tier: 'pro', heightCm: 180, weightKg: 82,
    trainingAge: 'intermediate', equipment: 'full gym',
    constraintsText: null, coachGoal: 'gain muscle', coachBudget: null,
  });
  mocks.mealEntry.findMany.mockResolvedValue([]);
  mocks.bodyWeightLog.findMany.mockResolvedValue([]);
  mocks.wellnessCheckin.findFirst.mockResolvedValue(null);
  mocks.wellnessCheckin.findMany.mockResolvedValue([]);
  mocks.workoutLog.findMany.mockResolvedValue([]);
  mocks.agentMemory.findUnique.mockResolvedValue(null);
  mocks.agentMemory.upsert.mockResolvedValue({});
  mocks.agentConversation.findUnique.mockResolvedValue(null);
  mocks.agentConversation.upsert.mockResolvedValue({});
});

// ─── Tool registry ────────────────────────────────────────────────────────────
describe('tool registry', () => {
  it('every tool has a name, description, schema, and executor', () => {
    for (const t of AGENT_TOOLS) {
      expect(t.name).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.input_schema.type).toBe('object');
      expect(typeof t.execute).toBe('function');
    }
  });

  it('read_nutrition_today rolls up meal macros', async () => {
    mocks.mealEntry.findMany.mockResolvedValue([
      { name: 'eggs', mealType: 'breakfast', calories: 200, proteinG: 18, carbsG: 2, fatG: 14 },
      { name: 'rice', mealType: 'lunch', calories: 300, proteinG: 6, carbsG: 65, fatG: 1 },
    ]);
    const out: any = await TOOLS_BY_NAME.read_nutrition_today.execute({}, USER);
    expect(out.totals.calories).toBe(500);
    expect(out.totals.proteinG).toBe(24);
    expect(out.mealCount).toBe(2);
  });

  it('log_meal parses a description when no macros are given', async () => {
    mocks.mealEntry.create.mockImplementation(async ({ data }: any) => ({ id: 'm1', ...data }));
    const out: any = await TOOLS_BY_NAME.log_meal.execute(
      { description: 'chicken and rice', mealType: 'dinner' },
      USER,
    );
    expect(out.logged.calories).toBe(500); // from mocked parseMealMacros
    expect(out.logged.mealType).toBe('dinner');
    expect(mocks.mealEntry.create).toHaveBeenCalledOnce();
  });

  it('log_meal uses explicit macros without parsing', async () => {
    mocks.mealEntry.create.mockImplementation(async ({ data }: any) => ({ id: 'm2', ...data }));
    const out: any = await TOOLS_BY_NAME.log_meal.execute(
      { name: 'shake', calories: 250, proteinG: 30, carbsG: 20, fatG: 3 },
      USER,
    );
    expect(out.logged.calories).toBe(250);
    expect(out.logged.proteinG).toBe(30);
  });

  it('read_body_weight_trend computes a weekly slope', async () => {
    const today = new Date();
    const series = Array.from({ length: 10 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - (9 - i));
      return { date: d.toISOString().slice(0, 10), weightLbs: 200 - i }; // losing 1lb/entry
    });
    mocks.bodyWeightLog.findMany.mockResolvedValue(series);
    const out: any = await TOOLS_BY_NAME.read_body_weight_trend.execute({ days: 30 }, USER);
    expect(out.latestLbs).toBe(191);
    expect(out.trendLbsPerWeek).toBeLessThan(0); // trending down
  });

  it('log_body_weight rejects non-positive weight', async () => {
    await expect(TOOLS_BY_NAME.log_body_weight.execute({ weightLbs: 0 }, USER)).rejects.toThrow();
  });

  it('log_body_weight creates a row', async () => {
    mocks.bodyWeightLog.create.mockImplementation(async ({ data }: any) => ({ id: 'bw1', ...data }));
    const out: any = await TOOLS_BY_NAME.log_body_weight.execute({ weightLbs: 185.5 }, USER);
    expect(out.logged.weightLbs).toBe(185.5);
  });

  it('log_wellness clamps 1-5 fields', async () => {
    mocks.wellnessCheckin.create.mockImplementation(async ({ data }: any) => ({ id: 'w1', ...data }));
    const out: any = await TOOLS_BY_NAME.log_wellness.execute(
      { mood: 9, energy: 0, stress: 3, sleepHours: 7.5 }, USER,
    );
    expect(out.logged.mood).toBe(5);   // clamped down from 9
    expect(out.logged.energy).toBe(1); // clamped up from 0
    expect(out.logged.sleepHours).toBe(7.5);
  });

  it('log_workout stores exercises', async () => {
    mocks.workoutLog.create.mockImplementation(async ({ data }: any) => ({ id: 'wk1', ...data }));
    const out: any = await TOOLS_BY_NAME.log_workout.execute(
      { title: 'Push', exercises: 'bench 3x5, ohp 3x8', durationMin: 50 }, USER,
    );
    expect(out.logged.title).toBe('Push');
    expect(out.logged.duration).toBe(50);
  });

  it('read_latest_diagnostic returns the most recent session + plan', async () => {
    mocks.session.findFirst.mockResolvedValue({
      selectedLift: 'bench', goal: 'strength', createdAt: new Date(),
      plans: [{ planText: 'Triceps are your limiter. Add close-grip.' }],
    });
    const out: any = await TOOLS_BY_NAME.read_latest_diagnostic.execute({}, USER);
    expect(out.found).toBe(true);
    expect(out.lift).toBe('bench');
    expect(out.planText).toContain('Triceps');
  });

  it('query_research returns matching feed items', async () => {
    mocks.feedItem.findMany.mockResolvedValue([
      { title: 'Creatine timing', summary: 'No meaningful difference.', source: 'PubMed', url: 'http://x' },
    ]);
    const out: any = await TOOLS_BY_NAME.query_research.execute({ query: 'creatine' }, USER);
    expect(out.count).toBe(1);
    expect(out.results[0].source).toBe('PubMed');
  });
});

// ─── Context assembler ──────────────────────────────────────────────────────
describe('context assembler', () => {
  it('assembles profile + renders a compact prompt fragment', async () => {
    mocks.mealEntry.findMany.mockResolvedValue([
      { calories: 400, proteinG: 30, carbsG: 40, fatG: 12 },
    ]);
    const ctx = await assembleContext(USER);
    expect(ctx.profile.goal).toBe('gain muscle');
    expect(ctx.todayNutrition?.calories).toBe(400);
    const rendered = renderContext(ctx);
    expect(rendered).toContain('gain muscle');
    expect(rendered).toContain("Today's intake");
  });

  it('handles a user with no logged data', async () => {
    const ctx = await assembleContext(USER);
    expect(ctx.todayNutrition).toBeNull();
    expect(ctx.bodyWeight).toBeNull();
    expect(renderContext(ctx)).toContain('nothing logged yet');
  });
});

// ─── Memory store ─────────────────────────────────────────────────────────────
describe('memory store', () => {
  it('reads empty memory as []', async () => {
    expect(await readMemory(USER)).toEqual([]);
  });

  it('appends + dedupes notes', async () => {
    let stored = '[]';
    mocks.agentMemory.findUnique.mockImplementation(async () => ({ notesJson: stored }));
    mocks.agentMemory.upsert.mockImplementation(async ({ create, update }: any) => {
      stored = (update?.notesJson ?? create?.notesJson); return {};
    });
    await appendMemory(USER, 'targeting 405 deadlift');
    await appendMemory(USER, 'targeting 405 deadlift'); // dup — should not double
    const notes = await readMemory(USER);
    expect(notes).toEqual(['targeting 405 deadlift']);
  });
});

// ─── Conversation persistence ─────────────────────────────────────────────────
describe('conversation persistence', () => {
  it('loads empty history as []', async () => {
    expect(await loadConversation(USER)).toEqual([]);
  });

  it('round-trips text turns and maps to Anthropic message shape', async () => {
    let stored = '[]';
    mocks.agentConversation.findUnique.mockImplementation(async () => ({ messagesJson: stored }));
    mocks.agentConversation.upsert.mockImplementation(async ({ create, update }: any) => {
      stored = update?.messagesJson ?? create?.messagesJson; return {};
    });
    await appendTurn(USER, 'how much protein left?', 'About 60g.');
    const history = await loadConversation(USER);
    expect(history).toEqual([
      { role: 'user', content: 'how much protein left?' },
      { role: 'assistant', content: 'About 60g.' },
    ]);
  });

  it('trims to the most recent window', async () => {
    // Pre-load 30 messages; appendTurn should cap at 24.
    const big = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }));
    let stored = JSON.stringify(big);
    mocks.agentConversation.findUnique.mockImplementation(async () => ({ messagesJson: stored }));
    mocks.agentConversation.upsert.mockImplementation(async ({ update }: any) => { stored = update.messagesJson; return {}; });
    await appendTurn(USER, 'newU', 'newA');
    const parsed = JSON.parse(stored);
    expect(parsed.length).toBe(24);
    expect(parsed[parsed.length - 1]).toEqual({ role: 'assistant', text: 'newA' });
  });
});

// ─── Orchestration loop (mock Anthropic — zero spend) ─────────────────────────
describe('runAgentTurn (mocked client)', () => {
  function mockClient(scripted: any[]) {
    let i = 0;
    const snapshots: any[] = [];
    return {
      // Snapshot args at call time — the loop mutates the messages array by
      // reference, so inspecting it post-hoc would show the final state, not
      // what was sent on each call.
      messages: {
        create: vi.fn(async (args: any) => {
          snapshots.push(structuredClone(args));
          return scripted[i++];
        }),
      },
      snapshots,
    } as any;
  }

  it('answers directly when no tools are needed', async () => {
    const client = mockClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hey, ready to lift?' }] },
    ]);
    const res = await runAgentTurn(USER, 'hi', [], client);
    expect(res.reply).toBe('Hey, ready to lift?');
    expect(res.toolsUsed).toEqual([]);
    expect(res.iterations).toBe(1);
  });

  it('runs a tool then produces a final answer', async () => {
    mocks.mealEntry.findMany.mockResolvedValue([
      { name: 'eggs', mealType: 'breakfast', calories: 200, proteinG: 18, carbsG: 2, fatG: 14 },
    ]);
    const client = mockClient([
      // Turn 1: ask for nutrition
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tu_1', name: 'read_nutrition_today', input: {} },
        ],
      },
      // Turn 2: final answer
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'You\'re at 200 kcal so far.' }] },
    ]);
    const res = await runAgentTurn(USER, "how many calories today?", [], client);
    expect(res.toolsUsed).toContain('read_nutrition_today');
    expect(res.reply).toContain('200 kcal');
    expect(res.iterations).toBe(2);
    // Second create call must have received the tool_result in the messages.
    const secondCall = client.snapshots[1];
    const lastMsg = secondCall.messages[secondCall.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content[0].type).toBe('tool_result');
  });

  it('feeds tool errors back to the model instead of throwing', async () => {
    // First findMany call (context assembly) succeeds; the second (the tool)
    // rejects — so we exercise the tool's error path, not context assembly.
    mocks.mealEntry.findMany.mockResolvedValueOnce([]).mockRejectedValue(new Error('db down'));
    const client = mockClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_e', name: 'read_nutrition_today', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Had trouble reading that.' }] },
    ]);
    const res = await runAgentTurn(USER, 'calories?', [], client);
    expect(res.reply).toContain('trouble');
    const secondCall = client.snapshots[1];
    const toolResult = secondCall.messages[secondCall.messages.length - 1].content[0];
    expect(toolResult.is_error).toBe(true);
  });

  it('supports extra per-turn tools (proactive propose_notification path)', async () => {
    const client = mockClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'pn', name: 'propose_notification', input: { title: 'Hit protein', body: '60g to go — grab a shake.' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sent a protein nudge.' }] },
    ]);
    let captured: any = null;
    const extra = [{
      name: 'propose_notification',
      description: 'x',
      input_schema: { type: 'object', properties: {} } as any,
      execute: async (input: any) => { captured = input; return { accepted: true }; },
    }];
    const res = await runAgentTurn(USER, 'evaluate', { injectClient: client, extraTools: extra as any });
    expect(res.toolsUsed).toContain('propose_notification');
    expect(captured.title).toBe('Hit protein');
  });

  it('stops at the iteration ceiling without infinite-looping', async () => {
    // Always ask for a tool — never finish.
    const client = {
      messages: {
        create: vi.fn(async () => ({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tu_x', name: 'read_profile', input: {} }],
        })),
      },
    } as any;
    const res = await runAgentTurn(USER, 'loop forever', [], client);
    expect(res.iterations).toBeLessThanOrEqual(8);
    expect(res.reply).toContain('ran out of steps');
  });
});

// ─── Proactive layer (Stage 5) ────────────────────────────────────────────────
describe('evaluateProactiveTrigger (mocked, decision-only — never sends)', () => {
  function mockClient(scripted: any[]) {
    let i = 0;
    return { messages: { create: vi.fn(async () => scripted[i++]) } } as any;
  }

  it('returns shouldNotify=false when the agent declines', async () => {
    const client = mockClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nothing worth interrupting them for.' }] },
    ]);
    const d = await evaluateProactiveTrigger(USER, 'nightly_review', client);
    expect(d.shouldNotify).toBe(false);
    expect(d.title).toBeNull();
    expect(d.reasoning).toContain('Nothing worth');
  });

  it('captures a proposed notification when the agent decides to send', async () => {
    const client = mockClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'pn', name: 'propose_notification', input: { title: 'Protein gap', body: '55g left and it\'s 8pm — grab a shake.' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Worth a nudge — they always miss protein on Tuesdays.' }] },
    ]);
    const d = await evaluateProactiveTrigger(USER, 'nutrition_gap', client);
    expect(d.shouldNotify).toBe(true);
    expect(d.title).toBe('Protein gap');
    expect(d.body).toContain('shake');
    expect(d.toolsUsed).toContain('propose_notification');
  });
});

// ─── Phase 5: proactive sweep (decision-only by default) ──────────────────────
describe('runProactiveSweep', () => {
  it('evaluates candidates and does NOT send when delivery is gated off', async () => {
    delete process.env.AGENT_PROACTIVE_ENABLED; // ensure gate is OFF
    mocks.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    // Each user's evaluation: one proposes, one declines.
    let turn = 0;
    const client = {
      messages: {
        create: vi.fn(async () => {
          turn++;
          return turn === 1
            ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'p', name: 'propose_notification', input: { title: 'T', body: 'B' } }] }
            : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
        }),
      },
    } as any;
    const result = await runProactiveSweep('streak_at_risk', undefined, { injectClient: client });
    expect(result.evaluated).toBe(2);
    expect(result.wouldNotify).toBe(1);
    expect(result.sent).toBe(0); // gate off → nothing sent
  });
});

// ─── Phase 6: sub-agent delegation ────────────────────────────────────────────
describe('delegate_task (sub-agent, depth-bounded)', () => {
  it('top-level turn is offered the delegate tool; sub-agent is not', async () => {
    // Script: top-level delegates, sub-agent answers, top-level wraps up.
    let call = 0;
    const seenToolNames: string[][] = [];
    const client = {
      messages: {
        create: vi.fn(async (args: any) => {
          seenToolNames.push((args.tools ?? []).map((t: any) => t.name));
          call++;
          if (call === 1) {
            // top-level: delegate
            return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'd1', name: 'delegate_task', input: { task: 'draft a split' } }] };
          }
          if (call === 2) {
            // sub-agent turn: just answer
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Upper/Lower x4.' }] };
          }
          // top-level final
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is your split: Upper/Lower x4.' }] };
        }),
      },
    } as any;

    const res = await runAgentTurn(USER, 'build me a program', { injectClient: client });
    expect(res.toolsUsed).toContain('delegate_task');
    expect(res.reply).toContain('Upper/Lower');
    // Call 1 (top-level) had delegate_task available; call 2 (sub-agent) did NOT.
    expect(seenToolNames[0]).toContain('delegate_task');
    expect(seenToolNames[1]).not.toContain('delegate_task');
  });
});
