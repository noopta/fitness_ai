// Card taps → the server, and client actions → the phone (spec §2, §6, §8).
//
// Server taps (Apply, Keep, Send, Delete, Undo, inline edits, toggles,
// answers) post the card id + action id; the server runs the stored op and
// returns the new card, which replaces the old one in the thread. Client
// actions (camera, share, purchase, settings…) run here and never touch the
// server; each dismisses the keyboard first.

import { useCallback, useEffect, useMemo } from 'react';
import { Alert, Keyboard, Linking, Platform, Share } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Updates from 'expo-updates';
import type { Card, CardAction, CardRoute, ClientAction } from '@axiom/agent-ui-core';
import { v2Api, type CardActionExtra } from '../api';
import { useShellOptional } from '../shell/ShellContext';
import { useInvalidate } from '../data';
import { useAuth } from '../../context/AuthContext';
import { haptics } from '../haptics';
import { manageSubscription, managedViaLabel } from '../billing';
import { destinationFor } from './cardRoutes';
import { captureBus } from './captureBus';
import type { Thread } from './useThread';

const errText = (e: any) => (e?.message && !/^HTTP \d/.test(e.message) ? e.message : 'Couldn’t do that — try again.');

async function dismissKeyboard() {
  if (!Keyboard.isVisible()) return;
  Keyboard.dismiss();
  await new Promise((r) => setTimeout(r, 250));
}

/** "Fiber target 30 g → 38 g; Vitamin D3 dropped" — the first two rows of a proposal's diff. */
export function diffLine(diff: NonNullable<Card['diff']>): string {
  const parts = diff.slice(0, 2).map((d) => (d.removed ? `${d.key} dropped` : d.from ? `${d.key} ${d.from} → ${d.to}` : `${d.key} ${d.to}`));
  return diff.length > 2 ? `${parts.join('; ')} +${diff.length - 2}` : parts.join('; ');
}

/** How many sessions a batch card's state line says it logged ("Logged 8 workouts" → 8). */
const batchCount = (c: Card) => Number(c.state?.line?.match(/\d+/)?.[0] ?? c.batch?.sessions.length ?? 0);
/** " · 15 Jul – 5 Aug" from the meta line ("Past workouts · 15 Jul – 5 Aug"). */
const batchRange = (c: Card) => { const m = c.meta?.label.match(/·\s*(.+)$/); return m ? ` · ${m[1]}` : ''; };

export function useCardActions(thread: Thread) {
  const router = useRouter();
  const shell = useShellOptional();
  const invalidate = useInvalidate();
  const auth = useAuth();
  const { dispatch, stateRef, send, receiptOnCard } = thread;

  const find = (id: string) => stateRef.current.turns.flatMap((t) => t.cards ?? []).find((c) => c.id === id);
  const setCard = (card: Card) => dispatch({ type: 'card_set', card });
  /** Errors land in the card's note slot, never a toast (spec §6.5). */
  const noteError = (card: Card, e: any) => { setCard({ ...card, note: errText(e) }); haptics.warning?.(); };
  /** A native sheet's outcome as the card's StateLine ("Opened App Store"). */
  const stateLine = (card: Card, line: string) => setCard({ ...card, state: { ...(card.state ?? { status: 'live' }), status: 'applied', line, at: new Date().toISOString() } });

  const open = useCallback((_card: Card | null, route: CardRoute) => {
    // A new program's Open → reviews that card's program before it's saved (T-07).
    if (route.page === 'programreview' && _card && !route.params?.id) route = { page: 'programreview', params: { id: _card.id } };
    const d = destinationFor(route);
    if (!d) { router.push({ pathname: '/(v2)/p/[key]', params: { key: route.page } } as any); return; }
    if (d.kind === 'tab') { shell?.goTo(d.index); return; }
    router.push({ pathname: d.pathname, params: d.params } as any);
  }, [router, shell]);

  const undo = useCallback(async (card: Card) => {
    try {
      const r = await v2Api.cardUndo(card.id); setCard(r.card); haptics.light(); void invalidate.all();
      // Past workouts: one Undo takes the whole batch back (spec F, "REMOVED 8 past workouts").
      if (card.batch) receiptOnCard(card.id, 'Removed', `${batchCount(card)} past workouts`);
    }
    catch (e) { noteError(find(card.id) ?? card, e); }
  }, [invalidate, receiptOnCard]); // eslint-disable-line react-hooks/exhaustive-deps

  const runClient = useCallback(async (card: Card, action: ClientAction, args: Record<string, any> = {}) => {
    await dismissKeyboard();
    switch (action) {
      case 'send_message': if (args.text) void send(String(args.text)); return;
      case 'open_page': { const { page, ...rest } = args; open(card, { page: String(page), params: Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) }); return; }
      case 'start_session': router.push('/(v2)/session' as any); return;
      case 'purchase': router.push('/(v2)/paywall' as any); return;
      case 'new_conversation': thread.newConversation(); return;
      case 'open_os_settings': void Linking.openSettings(); return;
      case 'reset_password': router.push({ pathname: '/(auth)/reset-password', params: args.email ? { email: String(args.email) } : {} } as any); return;
      case 'open_picker': open(card, { page: 'profile' }); return;
      case 'open_camera': {
        if (args.mode === 'video') { router.push({ pathname: '/form-analysis', params: args.exercise ? { exercise: String(args.exercise) } : {} } as any); return; }
        // The capture camera has no order mode; food search hosts the order / receipt scan.
        if (args.mode === 'order') { router.push({ pathname: '/(v2)/food-search', params: { open: 'order', from: 'chat' } } as any); return; }
        router.push({ pathname: '/(v2)/capture', params: { mode: String(args.mode ?? 'photo'), ...(card.pattern === 'capture' ? { cardId: card.id } : {}) } } as any);
        return;
      }
      case 'play_video': {
        const url = args.url ?? (args.videoId ? `https://www.youtube.com/watch?v=${args.videoId}` : null);
        if (url) await WebBrowser.openBrowserAsync(String(url));
        return;
      }
      case 'open_url':
      case 'download': {
        const url = String(args.url ?? '');
        if (!url) return;
        if (/^(mailto|tel):/.test(url)) void Linking.openURL(url);
        else await WebBrowser.openBrowserAsync(url);
        return;
      }
      case 'share': {
        const message = String(args.text ?? card.meta?.label ?? 'Axiom');
        try { const r = await Share.share({ message }); if (r.action === Share.sharedAction) stateLine(card, 'Shared'); } catch { /* dismissed */ }
        return;
      }
      case 'manage_subscription': {
        // Stripe subscribers get the portal, store subscribers their store page.
        stateLine(card, managedViaLabel(await manageSubscription()));
        return;
      }
      case 'restore_purchases': {
        try {
          const mod: any = Platform.OS === 'ios' ? await import('../../lib/iap') : await import('../../lib/googleIap');
          const ok = await mod.restorePurchases();
          await auth.refreshUser?.();
          stateLine(card, ok ? 'Restored · Pro active' : 'Nothing to restore on this account');
        } catch (e) { noteError(card, e); }
        return;
      }
      case 'check_updates': {
        try {
          if (__DEV__) { stateLine(card, 'Updates are off in development'); return; }
          const r = await Updates.checkForUpdateAsync();
          if (!r.isAvailable) { stateLine(card, 'You’re on the latest version'); return; }
          await Updates.fetchUpdateAsync();
          stateLine(card, 'Update ready — restarting');
          setTimeout(() => { void Updates.reloadAsync(); }, 600);
        } catch (e) { noteError(card, e); }
        return;
      }
      case 'sign_out':
        Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void auth.logout(); } }]);
        return;
      default: return;
    }
  }, [send, open, router, thread, auth]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (card: Card, action: CardAction, extra: CardActionExtra = {}) => {
    if (action.kind === 'undo' || action.id === 'undo') return undo(card);
    if (action.client) return runClient(card, action.client.action, action.client.args as Record<string, any>);
    try {
      const r = await v2Api.cardAction(card.id, action.id, extra);
      setCard(r.card);
      // Proposal (P-04) applied: an `Adjusted —` receipt names what changed; the card itself freezes to "Applied · Undo".
      if (card.pattern === 'proposal' && r.card.state?.status === 'applied' && card.diff?.length) receiptOnCard(card.id, 'Adjusted', diffLine(card.diff));
      // Past workouts logged (or redone): "LOGGED 8 past workouts · 15 Jul – 5 Aug".
      if (card.batch && r.card.state?.status === 'applied') receiptOnCard(card.id, 'Logged', `${batchCount(r.card)} past workouts${batchRange(r.card)}`);
      if (r.card.state?.status !== 'live' && r.card.state?.status !== 'cancelled' && r.card.state?.status !== 'kept') { haptics.success(); void invalidate.all(); }
      void thread.refreshLive();
    } catch (e) { noteError(find(card.id) ?? card, e); }
  }, [undo, runClient, invalidate, thread, receiptOnCard]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = useCallback(async (card: Card, field: string, value: string) => {
    const current = find(card.id) ?? card;
    const row = current.rows?.find((r) => r.editable?.field === field);
    const before = row?.value ?? '';
    // Optimistic: the new value shows at once, the old one struck through beside it.
    setCard({ ...current, rows: current.rows?.map((r) => (r === row ? { ...r, value, was: before } : r)) });
    try {
      const r = await v2Api.cardEdit(card.id, field, value);
      setCard(r.card);
      receiptOnCard(card.id, 'Corrected', `${before} → ${r.card.rows?.find((x) => x.editable?.field === field)?.value ?? value}`);
      void invalidate.all();
      return true;
    } catch {
      setCard({ ...current, note: 'Couldn’t save — try again' });
      return false;
    }
  }, [invalidate, receiptOnCard]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(async (card: Card, field: string, on: boolean) => {
    const r = await v2Api.cardToggle(card.id, field, on);
    setCard(r.card);
    const key = r.card.rows?.find((x) => x.toggle?.field === field)?.key ?? field;
    receiptOnCard(card.id, 'Adjusted', `${key} · ${on ? 'on' : 'off'}`);
    void invalidate.all();
  }, [invalidate, receiptOnCard]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = useCallback(async (card: Card, a: { option?: number; text?: string }) => {
    try {
      const r = await v2Api.cardAnswer(card.id, a);
      setCard(r.card);
      if (r.next) dispatch({ type: 'card_after', afterId: card.id, card: r.next });
      if (r.sendAsMessage) void send(r.sendAsMessage);
      if (r.card.state?.changeId || r.next) void invalidate.all();
    } catch (e) { noteError(find(card.id) ?? card, e); throw e; }
  }, [dispatch, send, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  // A capture that logged something answers its card; the Logged card lands in place.
  useEffect(() => captureBus.on((cardId, ids) => {
    const card = find(cardId);
    if (card) void answer(card, { text: ids.join(',') }).catch(() => {});
  }), [answer]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => ({ act, undo, edit, toggle, answer, open, runClient }), [act, undo, edit, toggle, answer, open, runClient]);
}
