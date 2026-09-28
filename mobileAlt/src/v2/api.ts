// v2 API client — the agent stream and the handful of endpoints the new shell
// adds on top of the existing `src/lib/api.ts` surface.
//
// Streaming: RN's global fetch cannot expose a readable body, but Expo 55's
// `expo/fetch` can. We read the SSE body as it arrives and feed the parser
// from @axiom/agent-ui-core, so receipts appear as tools run. No native
// module involved — this ships OTA.

import { fetch as expoFetch } from 'expo/fetch';
import { apiFetch, getToken, API_BASE, LONG_TIMEOUT_MS } from '../lib/api';
import { createSseParser, parseJsonFrame, type StreamEvent, type Receipt as CoreReceipt } from '@axiom/agent-ui-core';

export interface Brief {
  date: string;
  sentence: string;
  receipts: Omit<CoreReceipt, 'id'>[];
  session: {
    name: string; focus: string | null; minutes: number | null; exerciseCount: number;
    date: string; isToday: boolean; isLogged: boolean;
  } | null;
  suggestions: string[];
  weekNumber: number | null;
  phaseName: string | null;
  source: 'agent' | 'fallback';
}

export const v2Api = {
  brief: (): Promise<Brief> => apiFetch('/coach/brief', { timeoutMs: LONG_TIMEOUT_MS }),

  /** Legacy non-streaming turn — the fallback when the stream can't open. */
  sendTurn: (message: string) =>
    apiFetch('/coach/agent', { method: 'POST', body: JSON.stringify({ message }), timeoutMs: LONG_TIMEOUT_MS }),

  history: () => apiFetch('/coach/agent/history'),

  confirmProposal: (body: Record<string, unknown>) =>
    apiFetch('/coach/agent/confirm-proposal', { method: 'POST', body: JSON.stringify(body) }),

  runTask: (taskId: string, input?: string) =>
    apiFetch(`/coach/agent/task/${taskId}`, { method: 'POST', body: JSON.stringify({ input }), timeoutMs: LONG_TIMEOUT_MS }),

  memory: (): Promise<{ notes: string[] }> => apiFetch('/coach/agent/memory'),

  lastExercise: (name: string) => apiFetch(`/workouts/exercise/${encodeURIComponent(name)}/last`),

  /**
   * Stream one agent turn. Resolves when the server sends `done` (or `end`),
   * rejects on transport failure before any `done` arrived. Events are
   * delivered in order; the caller feeds them to threadReducer.
   */
  async streamTurn(
    message: string,
    onEvent: (e: StreamEvent) => void,
    opts: { signal?: AbortSignal; resetConversation?: boolean } = {},
  ): Promise<void> {
    const token = await getToken();
    const res = await expoFetch(`${API_BASE}/coach/agent/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, resetConversation: opts.resetConversation }),
      signal: opts.signal,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
      throw new Error(msg);
    }
    const body = res.body;
    if (!body) throw new Error('No response body');
    let sawDone = false;
    const parser = createSseParser((frame) => {
      if (frame.event === 'end') { sawDone = sawDone || true; return; }
      const ev = parseJsonFrame<StreamEvent>(frame);
      if (!ev || typeof ev !== 'object' || !('type' in ev)) return;
      if (ev.type === 'done') sawDone = true;
      onEvent(ev);
    });
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.end();
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
    if (!sawDone) throw new Error('Stream closed before done');
  },
};

/** Map a legacy tool name to a receipt, mirroring backend/src/agent/receipts.ts for history rendering. */
export function receiptForTool(tool: string): { verb: CoreReceipt['verb']; text: string } {
  const map: Record<string, { verb: CoreReceipt['verb']; text: string }> = {
    read_profile: { verb: 'Read', text: 'Profile' },
    read_program: { verb: 'Read', text: 'Program' },
    read_schedule_week: { verb: 'Read', text: 'This week' },
    read_latest_diagnostic: { verb: 'Read', text: 'Latest diagnostic' },
    read_nutrition_plan: { verb: 'Read', text: 'Nutrition plan' },
    read_adaptation: { verb: 'Checked', text: 'Pending adaptations' },
    read_recent_workouts: { verb: 'Pulled', text: 'Recent sessions' },
    read_nutrition_today: { verb: 'Pulled', text: 'Nutrition — today' },
    read_body_weight_trend: { verb: 'Pulled', text: 'Body weight' },
    read_wellness: { verb: 'Pulled', text: 'Wellness' },
    read_micro_status: { verb: 'Pulled', text: 'Micronutrients' },
    read_lift_progress: { verb: 'Pulled', text: 'Lift history' },
    query_research: { verb: 'Searched', text: 'Research' },
    log_meal: { verb: 'Logged', text: 'Meal' },
    log_body_weight: { verb: 'Logged', text: 'Body weight' },
    log_workout: { verb: 'Logged', text: 'Workout' },
    log_wellness: { verb: 'Logged', text: 'Wellness' },
    adjust_macros: { verb: 'Adjusted', text: 'Macros' },
    apply_program_update: { verb: 'Adjusted', text: 'Program' },
    swap_exercise_in_program: { verb: 'Adjusted', text: 'Exercise swap' },
    remember: { verb: 'Noted', text: 'For next time' },
    propose_program_update: { verb: 'Proposed', text: 'Program change' },
    propose_workout_swap: { verb: 'Proposed', text: 'Workout swap' },
    propose_exercise_swap: { verb: 'Proposed', text: 'Exercise swap' },
    delegate_task: { verb: 'Delegated', text: 'A sub-task' },
  };
  return map[tool] ?? { verb: 'Read', text: tool.replace(/_/g, ' ') };
}
