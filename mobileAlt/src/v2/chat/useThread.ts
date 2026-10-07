// The chat thread: streaming turns, the busy lock, history, and the recovery
// path for replies that finish after the connection died.
//
// Send → open the SSE stream → feed events to threadReducer. If the stream
// can't open (older binary, proxy, network) fall back to the non-streaming
// turn and synthesise receipts from toolsUsed. If a stream dies mid-turn the
// server still persists the reply, so we poll history once and take the last
// assistant message — the same recovery ChatTab shipped for the 499s.
//
// Cards (contract 2): card2 events land on the turn; history brings card ids
// that are fetched in one batch. The server has no live push yet, so after
// every turn (and when the app comes back) the thread refetches its live
// cards — that's how "Replaced" and "Changed since" reach older cards.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { threadReducer, emptyThread, canSend, turnFromResult, allCards, isLive, isWriteVerb, type Turn, type ThreadState, type StreamEvent, type ReceiptVerb, awayRange } from '@axiom/agent-ui-core';
import { v2Api, receiptForTool } from '../api';
import { useShellOptional } from '../shell/ShellContext';
import { useInvalidate } from '../data';
import { haptics } from '../haptics';

const MUTATING = new Set(['log_meal', 'log_workout', 'log_body_weight', 'log_wellness', 'adjust_macros', 'apply_program_update', 'swap_exercise_in_program']);

let idSeq = 0;
const nextId = (p: string) => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}`;

export type Thread = ReturnType<typeof useThread>;

export function useThread() {
  const [state, dispatch] = useReducer(threadReducer, undefined, emptyThread);
  const shell = useShellOptional();
  const invalidate = useInvalidate();
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<ThreadState>(state);
  stateRef.current = state;
  const resetNext = useRef(false);

  useEffect(() => { shell?.setBusy(state.busy); }, [state.busy, shell]);
  useEffect(() => () => abortRef.current?.abort(), []);

  /** Refetch cards that are still live — they may have been replaced or acted on elsewhere. */
  const refreshLive = useCallback(async () => {
    const ids = allCards(stateRef.current).filter(isLive).map((c) => c.id);
    if (!ids.length) return;
    try { dispatch({ type: 'cards_set', cards: await v2Api.cards(ids) }); } catch { /* next time */ }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refreshLive(); });
    return () => sub.remove();
  }, [refreshLive]);

  /** Loads history; resolves the "While you were away" range (Anakin-initiated turns since the user last spoke). */
  const hydrate = useCallback(async (): Promise<{ start: number; end: number; count: number } | null> => {
    try {
      const h = await v2Api.history();
      const msgs = (h?.messages ?? []).slice(-40);
      const turns: Turn[] = msgs.map((m, i) => ({
        id: `h${i}`, kind: m.role === 'user' ? 'user' : 'agent', text: m.content, receipts: [], done: true,
        ...(m.cardIds?.length ? { cardIds: m.cardIds } : {}),
        ...(m.origin === 'anakin' ? { origin: 'anakin' as const, unprompted: true } : {}),
        ...(m.at ? { at: Date.parse(m.at) } : {}),
      }));
      dispatch({ type: 'hydrate', turns });
      const ids = turns.flatMap((t) => t.cardIds ?? []);
      if (ids.length) dispatch({ type: 'cards_set', cards: await v2Api.cards(ids).catch(() => []) });
      const away = awayRange(turns);
      return away ? { start: away.start, end: turns.length, count: away.count } : null;
    } catch { return null; /* history is optional */ }
  }, []);

  /**
   * A stream that died mid-turn: the server keeps going and saves the reply.
   * Poll history (12 × 4 s, like classic's recovery) for a reply that comes
   * AFTER the exact message sent — never an older reply standing in for it.
   */
  const recover = useCallback(async (agentId: string, sentText: string, signal?: AbortSignal) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      if (signal?.aborted) return false;
      if (attempt) await new Promise((r) => setTimeout(r, 4000));
      try {
        const h = await v2Api.history();
        const msgs = h?.messages ?? [];
        const fromEnd = [...msgs].reverse().findIndex((m) => m.role === 'user' && m.content === sentText);
        if (fromEnd < 0) continue;
        const reply = msgs.slice(msgs.length - fromEnd).find((m) => m.role !== 'user');
        if (reply?.content) {
          dispatch({ type: 'event', agentId, event: { type: 'done', reply: reply.content, toolsUsed: [], iterations: 0 } });
          if (reply.cardIds?.length) {
            const cards = await v2Api.cards(reply.cardIds).catch(() => []);
            for (const card of cards) dispatch({ type: 'event', agentId, event: { type: 'card2', card } });
          }
          return true;
        }
      } catch { /* try again */ }
    }
    return false;
  }, []);

  // The last send that failed: shown under the thread with Try again (and Go Pro for the daily limit).
  const [failure, setFailure] = useState<{ text: string; limit: boolean } | null>(null);

  const send = useCallback(async (text: string) => {
    const m = text.trim();
    if (!m || !canSend(stateRef.current)) return false;
    const id = nextId('u'), agentId = nextId('a');
    dispatch({ type: 'send', id, agentId, text: m });
    setFailure(null);
    haptics.light();
    const ac = new AbortController();
    abortRef.current = ac;
    const reset = resetNext.current;
    resetNext.current = false;
    let toolsSeen: string[] = [];
    let wrote = false;
    let gotDone = false;
    let started = false;
    try {
      await v2Api.streamTurn(m, (e: StreamEvent) => {
        started = true;
        if (e.type === 'receipt') { toolsSeen.push(e.text); if (isWriteVerb(e.verb)) wrote = true; }
        if (e.type === 'card2' && e.card.state?.changeId) wrote = true;
        if (e.type === 'card_update' && e.patch.state?.changeId) wrote = true;
        if (e.type === 'done') { gotDone = true; toolsSeen = e.toolsUsed ?? toolsSeen; }
        dispatch({ type: 'event', agentId, event: e });
      }, { signal: ac.signal, resetConversation: reset });
    } catch (err: any) {
      if (ac.signal.aborted) return true;
      // The server refused the turn (daily limit, auth…): it never ran — say so, don't retry it.
      if (typeof err?.status === 'number') {
        const limit = err.status === 429;
        dispatch({ type: 'fail', agentId, error: limit ? 'That\'s today\'s limit for Anakin. Pro has no daily limit.' : (err.message || 'Anakin couldn\'t take that. Try again.') });
        setFailure({ text: m, limit });
        return true;
      }
      // The stream started and then broke: the turn is running server-side. Wait for its reply —
      // re-sending it would run the turn twice (two meals logged, two swaps).
      if (started) {
        const ok = await recover(agentId, m, ac.signal);
        if (!ok) { dispatch({ type: 'fail', agentId, error: 'Anakin didn\'t answer in time. Try again.' }); setFailure({ text: m, limit: false }); }
        else gotDone = true;
      } else try {
        // The stream never opened (older proxy, no SSE): the non-streaming turn instead.
        const r: any = await v2Api.sendTurn(m);
        const turn = turnFromResult(agentId, { reply: r.reply, toolsUsed: r.toolsUsed, proposal: r.proposal ?? null }, receiptForTool);
        dispatch({ type: 'event', agentId, event: { type: 'done', reply: turn.text, toolsUsed: r.toolsUsed ?? [], iterations: r.iterations ?? 1, proposal: r.proposal ?? null } });
        for (const rc of turn.receipts) dispatch({ type: 'event', agentId, event: { type: 'receipt', id: rc.id, verb: rc.verb, text: rc.text, final: true } });
        for (const card of (r.cards ?? []) as any[]) dispatch({ type: 'event', agentId, event: { type: 'card2', card } });
        toolsSeen = r.toolsUsed ?? [];
        gotDone = true;
      } catch (err2: any) {
        // The reply may still have been saved server-side.
        const ok = await recover(agentId, m, ac.signal);
        if (!ok) { dispatch({ type: 'fail', agentId, error: err2?.message ?? err?.message ?? 'Anakin didn\'t answer. Try again.' }); setFailure({ text: m, limit: err2?.status === 429 }); }
        else gotDone = true;
      }
    }
    if (gotDone && (wrote || toolsSeen.some((t) => MUTATING.has(t)))) void invalidate.all();
    else if (gotDone) void invalidate.afterSchedule();
    if (gotDone) void refreshLive();
    return true;
  }, [recover, invalidate, refreshLive]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  /** "New conversation" (ACC client action): clear the thread; the next send starts fresh server-side. */
  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    resetNext.current = true;
    dispatch({ type: 'hydrate', turns: [] });
  }, []);

  /** Append a receipt line to the turn that holds a card (inline edit, toggle). */
  const receiptOnCard = useCallback((cardId: string, verb: ReceiptVerb, text: string) => {
    const turn = stateRef.current.turns.find((t) => t.cards?.some((c) => c.id === cardId));
    if (!turn) return;
    dispatch({ type: 'event', agentId: turn.id, event: { type: 'receipt', id: nextId('r'), verb, text, final: true } });
  }, []);

  const retry = useCallback(() => { if (failure) void send(failure.text); }, [failure, send]);

  return { state, stateRef, dispatch, send, hydrate, cancel, refreshLive, newConversation, receiptOnCard, failure, retry };
}
