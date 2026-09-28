// The chat thread: streaming turns, the busy lock, history, and the recovery
// path for replies that finish after the connection died.
//
// Send → open the SSE stream → feed events to threadReducer. If the stream
// can't open (older binary, proxy, network) fall back to the non-streaming
// turn and synthesise receipts from toolsUsed. If a stream dies mid-turn the
// server still persists the reply, so we poll history once and take the last
// assistant message — the same recovery ChatTab shipped for the 499s.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { threadReducer, emptyThread, canSend, turnFromResult, type Turn, type ThreadState, type StreamEvent } from '@axiom/agent-ui-core';
import { v2Api, receiptForTool } from '../api';
import { useShellOptional } from '../shell/ShellContext';
import { useInvalidate } from '../data';
import { haptics } from '../haptics';

const MUTATING = new Set(['log_meal', 'log_workout', 'log_body_weight', 'log_wellness', 'adjust_macros', 'apply_program_update', 'swap_exercise_in_program']);

let idSeq = 0;
const nextId = (p: string) => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}`;

export function useThread() {
  const [state, dispatch] = useReducer(threadReducer, undefined, emptyThread);
  const shell = useShellOptional();
  const invalidate = useInvalidate();
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<ThreadState>(state);
  stateRef.current = state;

  useEffect(() => { shell?.setBusy(state.busy); }, [state.busy, shell]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const hydrate = useCallback(async () => {
    try {
      const h: any = await v2Api.history();
      const msgs: { role: string; content: string }[] = h?.messages ?? [];
      const turns: Turn[] = msgs.slice(-40).map((m, i) => ({
        id: `h${i}`, kind: m.role === 'user' ? 'user' : 'agent', text: m.content, receipts: [], done: true,
      }));
      dispatch({ type: 'hydrate', turns });
    } catch { /* history is optional */ }
  }, []);

  const recover = useCallback(async (agentId: string, sentText: string) => {
    try {
      const h: any = await v2Api.history();
      const msgs: { role: string; content: string }[] = h?.messages ?? [];
      const lastUser = [...msgs].reverse().findIndex((m) => m.role === 'user' && m.content === sentText);
      const tail = lastUser >= 0 ? msgs.slice(msgs.length - lastUser) : msgs.slice(-1);
      const reply = tail.find((m) => m.role !== 'user');
      if (reply?.content) {
        dispatch({ type: 'event', agentId, event: { type: 'done', reply: reply.content, toolsUsed: [], iterations: 0 } });
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
    let toolsSeen: string[] = [];
    let gotDone = false;
    try {
      await v2Api.streamTurn(m, (e: StreamEvent) => {
        if (e.type === 'receipt') toolsSeen.push(e.text);
        if (e.type === 'done') { gotDone = true; toolsSeen = e.toolsUsed ?? toolsSeen; }
        dispatch({ type: 'event', agentId, event: e });
      }, { signal: ac.signal });
    } catch (err: any) {
      if (ac.signal.aborted) return true;
      // Fallback 1: the non-streaming turn (older binaries / proxies without SSE).
      try {
        const r: any = await v2Api.sendTurn(m);
        const turn = turnFromResult(agentId, { reply: r.reply, toolsUsed: r.toolsUsed, proposal: r.proposal ?? null }, receiptForTool);
        dispatch({ type: 'event', agentId, event: { type: 'done', reply: turn.text, toolsUsed: r.toolsUsed ?? [], iterations: r.iterations ?? 1, proposal: r.proposal ?? null } });
        for (const rc of turn.receipts) dispatch({ type: 'event', agentId, event: { type: 'receipt', id: rc.id, verb: rc.verb, text: rc.text, final: true } });
        toolsSeen = r.toolsUsed ?? [];
        gotDone = true;
      } catch (err2: any) {
        // Fallback 2: the reply may have been persisted server-side.
        const ok = await recover(agentId, m);
        if (!ok) dispatch({ type: 'fail', agentId, error: err2?.message ?? err?.message ?? 'Anakin didn\'t answer. Try again.' });
      }
    }
    if (gotDone && toolsSeen.some((t) => MUTATING.has(t))) void invalidate.all();
    else if (gotDone) void invalidate.afterSchedule();
    return true;
  }, [recover, invalidate]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  return { state, dispatch, send, hydrate, cancel };
}
