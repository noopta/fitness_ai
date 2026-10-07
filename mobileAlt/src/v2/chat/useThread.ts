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

import { useCallback, useEffect, useReducer, useRef } from 'react';
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

  const recover = useCallback(async (agentId: string, sentText: string) => {
    try {
      const h = await v2Api.history();
      const msgs = h?.messages ?? [];
      const lastUser = [...msgs].reverse().findIndex((m) => m.role === 'user' && m.content === sentText);
      const tail = lastUser >= 0 ? msgs.slice(msgs.length - lastUser) : msgs.slice(-1);
      const reply = tail.find((m) => m.role !== 'user');
      if (reply?.content) {
        dispatch({ type: 'event', agentId, event: { type: 'done', reply: reply.content, toolsUsed: [], iterations: 0 } });
        if (reply.cardIds?.length) {
          const cards = await v2Api.cards(reply.cardIds).catch(() => []);
          for (const card of cards) dispatch({ type: 'event', agentId, event: { type: 'card2', card } });
        }
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }, []);

  const send = useCallback(async (text: string) => {
    const m = text.trim();
    if (!m || !canSend(stateRef.current)) return false;
    const id = nextId('u'), agentId = nextId('a');
    dispatch({ type: 'send', id, agentId, text: m });
    haptics.light();
    const ac = new AbortController();
    abortRef.current = ac;
    const reset = resetNext.current;
    resetNext.current = false;
    let toolsSeen: string[] = [];
    let wrote = false;
    let gotDone = false;
    try {
      await v2Api.streamTurn(m, (e: StreamEvent) => {
        if (e.type === 'receipt') { toolsSeen.push(e.text); if (isWriteVerb(e.verb)) wrote = true; }
        if (e.type === 'card2' && e.card.state?.changeId) wrote = true;
        if (e.type === 'card_update' && e.patch.state?.changeId) wrote = true;
        if (e.type === 'done') { gotDone = true; toolsSeen = e.toolsUsed ?? toolsSeen; }
        dispatch({ type: 'event', agentId, event: e });
      }, { signal: ac.signal, resetConversation: reset });
    } catch (err: any) {
      if (ac.signal.aborted) return true;
      // Fallback 1: the non-streaming turn (older binaries / proxies without SSE).
      try {
        const r: any = await v2Api.sendTurn(m);
        const turn = turnFromResult(agentId, { reply: r.reply, toolsUsed: r.toolsUsed, proposal: r.proposal ?? null }, receiptForTool);
        dispatch({ type: 'event', agentId, event: { type: 'done', reply: turn.text, toolsUsed: r.toolsUsed ?? [], iterations: r.iterations ?? 1, proposal: r.proposal ?? null } });
        for (const rc of turn.receipts) dispatch({ type: 'event', agentId, event: { type: 'receipt', id: rc.id, verb: rc.verb, text: rc.text, final: true } });
        for (const card of (r.cards ?? []) as any[]) dispatch({ type: 'event', agentId, event: { type: 'card2', card } });
        toolsSeen = r.toolsUsed ?? [];
        gotDone = true;
      } catch (err2: any) {
        // Fallback 2: the reply may have been persisted server-side.
        const ok = await recover(agentId, m);
        if (!ok) dispatch({ type: 'fail', agentId, error: err2?.message ?? err?.message ?? 'Anakin didn\'t answer. Try again.' });
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

  return { state, stateRef, dispatch, send, hydrate, cancel, refreshLive, newConversation, receiptOnCard };
}
