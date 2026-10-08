// v2 API client — the agent stream and the handful of endpoints the new shell
// adds on top of the existing `src/lib/api.ts` surface.
//
// Streaming: RN's global fetch cannot expose a readable body, but Expo 55's
// `expo/fetch` can. We read the SSE body as it arrives and feed the parser
// from @axiom/agent-ui-core, so receipts appear as tools run. No native
// module involved — this ships OTA.

import { fetch as expoFetch } from 'expo/fetch';
import { apiFetch, getToken, API_BASE, LONG_TIMEOUT_MS } from '../lib/api';
import { createSseParser, parseJsonFrame, type StreamEvent, type Receipt as CoreReceipt, type Card } from '@axiom/agent-ui-core';

/** What a tap can carry besides its action id: a typed confirm, a segmented choice, a batch card's ticks and dates. */
export interface CardActionExtra { typed?: string; choice?: number; selection?: { skip?: number[]; dates?: Record<string, string> } }

/** This client renders server cards (card2 events, /coach/agent/cards/*). */
const CARD_CONTRACT = { 'X-Card-Contract': '2' };

export interface HistoryMessage { role: 'user' | 'assistant'; content: string; cardIds?: string[]; origin?: 'anakin'; at?: string }

const post = (path: string, body: Record<string, unknown> = {}) =>
  apiFetch(path, { method: 'POST', body: JSON.stringify(body), timeoutMs: LONG_TIMEOUT_MS });

export interface Brief {
  date: string;
  sentence: string;
  receipts: Omit<CoreReceipt, 'id'>[];
  session: {
    name: string; focus: string | null; minutes: number | null; exerciseCount: number;
    date: string; isToday: boolean; isLogged: boolean;
  } | null;
  suggestions: string[];
  ask: { key: string; question: string; reason: string; options: string[] } | null;
  weekNumber: number | null;
  phaseName: string | null;
  source: 'agent' | 'fallback';
  /** Anakin's line is still being written — refetch shortly. */
  pending?: boolean;
}

/** GET /training/overview — the four Training bands (RN spec "Focus bands", 3 Oct 2026). */
export interface TrainingOverview {
  unit: 'lb' | 'kg';
  goal: {
    text: string | null;
    lifts: { name: string; start: number; current: number; target: number; reps: string; pace: 'ahead' | 'on' | 'behind'; progress: number; targetSource: 'goal' | 'projected' }[];
    pct: number;
  };
  program: {
    week: number; totalWeeks: number; currentPhase: number;
    phases: { name: string; focus: string; weeks: number; from: number; why: string; sessions: string; effort: string; focusLine: string }[];
  } | null;
  week: {
    done: number; planned: number;
    days: { dow: string; date: string; name: string; minutes: number | null; status: 'done' | 'today' | 'planned' | 'rest'; exercises: { name: string; spec: string }[] }[];
  };
  archive: {
    count: number;
    items: { kind: 'program' | 'diagnostic'; title: string; sub: string; value: string; id: string; source?: 'form' | 'lift'; flow?: 'conversation' | 'wizard'; done?: boolean }[];
  };
  /** Set the day the last session is logged (T-09); the tab shows the result until a new program replaces it. */
  finished?: { weeks: number; goal: string | null; sessionsLogged: number | null; sessionsPlanned: number | null; bodyWeightChangeLb: number | null } | null;
  /** Freestyle (no program): the strength lifts so the tab isn't empty. */
  strength?: { lifts: { name: string; current1RMkg: number; sessionCount: number | null; weekSeries: { week: string; rm: number }[] }[] };
}

/** GET /nutrition/plan — the plan page summary (bug fixes 5 Oct, 2b). 404 → no plan yet. */
export interface NutritionPlanSummary {
  week: number;
  weeks: number;
  onTrack: number;
  total: number;
  focus: { key: string; nutrient: string; amount: number; target: number; unit: string; onTrack: boolean }[];
  gut: {
    plants: { n: number; target: number };
    fiberG: { n: number; target: number };
    fermentedDays: { n: number; target: number };
    upfPct: { n: number; max: number };
  };
  supplements: { name: string; dose: string; when: string | null }[];
  sources: { id: number; type: string; title: string; detail?: string | null; url?: string | null }[];
  plan: { summary?: string; focusNutrients?: { key: string; why?: string }[] };
  generatedAt: string;
}

/** GET /nutrition/food-search — one ranked row (bug fixes 5 Oct, 4a). */
export interface FoodResult {
  kind: 'mine' | 'recipe' | 'usda';
  id: string;
  name: string;
  caption: string;
  kcal: number;
  portion: { grams: number | null; label: string };
  macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
  per100g: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  nutrients: Record<string, number> | null;
}

export const v2Api = {
  /** Null when there's no plan yet (the endpoint 404s). */
  foodSearch: (q: string, scope: 'all' | 'mine' | 'recipes'): Promise<{ results: FoodResult[] }> =>
    apiFetch(`/nutrition/food-search?q=${encodeURIComponent(q)}&scope=${scope}`) as Promise<{ results: FoodResult[] }>,
  /** A meal logged from search opened from chat → a Logged card in the thread. */
  loggedCard: (mealIds: string[]): Promise<{ card: Card }> =>
    apiFetch('/coach/agent/cards/logged', { method: 'POST', body: JSON.stringify({ mealIds }) }) as Promise<{ card: Card }>,
  nutritionPlan: async (): Promise<NutritionPlanSummary | null> => {
    try { return await apiFetch('/nutrition/plan', { silent404: true } as any) as NutritionPlanSummary; }
    catch (e: any) { if (e?.status === 404 || /no nutrition plan/i.test(String(e?.message))) return null; throw e; }
  },

  trainingOverview: (): Promise<TrainingOverview> => apiFetch('/training/overview'),
  /** GET /training/freestyle — the no-program home (T-04): sessions as trained, lift trends. */
  freestyle: (): Promise<any> => apiFetch('/training/freestyle'),

  /** A native screen asks for one of Anakin's proposals (Swap, Life happened, freestyle pick). Nothing changes until Apply. */
  runTool: (tool: string, input: Record<string, unknown> = {}): Promise<{ result: any; cards: Card[] }> =>
    post('/coach/agent/cards/run', { tool, input }),
  /** The program a new-program proposal would start (T-07). */
  cardProgram: (id: string): Promise<{ card: Card; program: any }> => apiFetch(`/coach/agent/cards/${id}/program`),
  /** Fuel's targets, or none yet (N-07, N-08) — and today's workout burn. */
  dayTargets: (date: string): Promise<{ targets: { calories: number; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null; source: string } | null; burn: { kcal: number; label: string | null; addToTarget: boolean } }> =>
    apiFetch(`/nutrition/day-targets?date=${date}`),
  /** Set targets from four answers (N-08). */
  quickTargets: (a: { sex: 'male' | 'female' | 'unknown'; ageYears: number; heightCm: number; weightKg: number; goal: 'lose' | 'maintain' | 'gain' | 'strength'; trainingDaysPerWeek: number }): Promise<{ targets: any }> =>
    post('/nutrition/day-targets/quick', a as any),
  /** Change any daily target; with a program plan its macros change (same as chat). */
  editTargets: (edit: { calories?: number; proteinG?: number; carbsG?: number; fatG?: number; fiberG?: number }): Promise<{ targets: any }> =>
    apiFetch('/nutrition/day-targets', { method: 'PUT', body: JSON.stringify(edit) }),
  /** Opening chat raises pending suggestions it hasn't shown yet. */
  surfaceAdaptations: (): Promise<{ posted: number }> => post('/coach/agent/adaptation/surface'),
  /** Today / 7 / 30 days (N-09): daily totals, averages over logged days, meal shares. */
  nutritionSummary: (range: 'today' | '7d' | '30d', date: string): Promise<{ range: string; days: { date: string; logged: boolean; kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number }[]; loggedDays: number; avg: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number } | null; byMeal: { mealType: string; avgKcal: number; pct: number }[] }> =>
    apiFetch(`/nutrition/summary?range=${range}&date=${date}`),
  /** What Swap offers on an exercise page (T-10). */
  exerciseAlternatives: (name: string): Promise<{ alternatives: { name: string; primaryMuscle: string; isCompound: boolean }[] }> =>
    apiFetch(`/workouts/exercise-alternatives?name=${encodeURIComponent(name)}`),

  brief: (): Promise<Brief> => apiFetch('/coach/brief', { timeoutMs: LONG_TIMEOUT_MS }),

  /** Legacy non-streaming turn — the fallback when the stream can't open. */
  sendTurn: (message: string) =>
    apiFetch('/coach/agent', { method: 'POST', headers: CARD_CONTRACT, body: JSON.stringify({ message }), timeoutMs: LONG_TIMEOUT_MS }),

  history: (): Promise<{ messages: HistoryMessage[] }> => apiFetch('/coach/agent/history'),

  // ── Cards (spec §2, §6): taps name the card + action; the server runs it. ──
  cards: async (ids: string[]): Promise<Card[]> => {
    if (!ids.length) return [];
    const out: Card[] = [];
    // The route caps a batch at 60 ids.
    for (let i = 0; i < ids.length; i += 60) {
      const r = await apiFetch(`/coach/agent/cards?ids=${encodeURIComponent(ids.slice(i, i + 60).join(','))}`);
      out.push(...((r?.cards ?? []) as Card[]));
    }
    return out;
  },
  cardAction: (id: string, actionId: string, extra: CardActionExtra = {}): Promise<{ card: Card }> =>
    post(`/coach/agent/cards/${id}/action`, { actionId, ...extra }),
  cardUndo: (id: string): Promise<{ card: Card }> => post(`/coach/agent/cards/${id}/undo`),
  cardEdit: (id: string, field: string, value: string | number): Promise<{ card: Card }> =>
    post(`/coach/agent/cards/${id}/edit`, { field, value }),
  cardToggle: (id: string, field: string, on: boolean): Promise<{ card: Card }> =>
    post(`/coach/agent/cards/${id}/toggle`, { field, on }),
  cardDraft: (id: string, body: string): Promise<{ card: Card }> => post(`/coach/agent/cards/${id}/draft`, { body }),
  cardAnswer: (id: string, answer: { option?: number; text?: string }): Promise<{ card: Card; sendAsMessage?: string; next?: Card | null }> =>
    post(`/coach/agent/cards/${id}/answer`, answer),

  confirmProposal: (body: Record<string, unknown>) =>
    apiFetch('/coach/agent/confirm-proposal', { method: 'POST', body: JSON.stringify(body) }),

  runTask: (taskId: string, input?: string) =>
    apiFetch(`/coach/agent/task/${taskId}`, { method: 'POST', body: JSON.stringify({ input }), timeoutMs: LONG_TIMEOUT_MS }),

  // notes: saved from chat; profile: from the intake (older backends omit it).
  memory: (): Promise<{ notes: string[]; profile?: { label: string; value: string }[] }> => apiFetch('/coach/agent/memory'),

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
        ...CARD_CONTRACT,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, resetConversation: opts.resetConversation }),
      signal: opts.signal,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
      // The server answered and refused (limit, auth, validation): the turn never ran.
      throw Object.assign(new Error(msg), { status: res.status });
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
