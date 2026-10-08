// A server card outside the chat thread (handoff H-02, H-03, T-05, T-06, T-10):
// a native screen asks for a proposal and shows the same card chat would.
// Taps go to the same card endpoints; there's no thread, so "say" hands the
// message to chat and a client action runs here.

import React, { useMemo, useState } from 'react';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import type { Card, CardRoute } from '@axiom/agent-ui-core';
import { CardView } from './card/CardView';
import { CardHandlersProvider, type CardHandlers, type EditSession } from './card/context';
import { destinationFor } from './cardRoutes';
import { v2Api } from '../api';
import { useInvalidate } from '../data';
import { useShellOptional } from '../shell/ShellContext';
import { haptics } from '../haptics';

const errText = (e: any) => String(e?.message ?? 'Couldn’t do that — try again').slice(0, 140);

export function StandaloneCard({ card: initial, onChange }: { card: Card; onChange?: (card: Card) => void }) {
  const router = useRouter();
  const shell = useShellOptional();
  const invalidate = useInvalidate();
  const [card, setCardState] = useState(initial);
  const [editing, setEditing] = useState<EditSession | null>(null);
  const setCard = (c: Card) => { setCardState(c); onChange?.(c); };

  const handlers = useMemo<CardHandlers>(() => {
    const toChat = (text: string) => { shell?.ask(text); router.replace('/(v2)' as any); };
    const open = (_c: Card | null, route: CardRoute) => {
      if (route.page === 'programreview' && _c && !route.params?.id) route = { page: 'programreview', params: { id: _c.id } };
      const d = destinationFor(route);
      if (!d) { router.push({ pathname: '/(v2)/p/[key]', params: { key: route.page } } as any); return; }
      if (d.kind === 'tab') { shell?.goTo(d.index); router.replace('/(v2)' as any); return; }
      router.push({ pathname: d.pathname, params: d.params } as any);
    };
    return {
      act: async (c, a, extra) => {
        if (a.kind === 'undo' || a.id === 'undo') { try { setCard((await v2Api.cardUndo(c.id)).card); void invalidate.all(); } catch (e) { setCard({ ...c, note: errText(e) }); } return; }
        if (a.client) {
          const args = (a.client.args ?? {}) as Record<string, any>;
          switch (a.client.action) {
            case 'start_session': router.push('/(v2)/session' as any); return;
            case 'send_message': if (args.text) toChat(String(args.text)); return;
            case 'purchase': router.push({ pathname: '/(v2)/paywall', params: { gate: '1' } } as any); return;
            case 'open_page': { const { page, ...rest } = args; open(c, { page: String(page), params: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v)])) }); return; }
            case 'open_url': if (args.url) void Linking.openURL(String(args.url)); return;
            default: return;
          }
        }
        try {
          const r = await v2Api.cardAction(c.id, a.id, extra ?? {});
          setCard(r.card);
          if (r.card.state?.status === 'applied') { haptics.success(); void invalidate.all(); }
        } catch (e) { setCard({ ...c, note: errText(e) }); haptics.warning?.(); }
      },
      undo: async (c) => { try { setCard((await v2Api.cardUndo(c.id)).card); haptics.light(); void invalidate.all(); } catch (e) { setCard({ ...c, note: errText(e) }); } },
      edit: async (c, field, value) => { try { setCard((await v2Api.cardEdit(c.id, field, value)).card); void invalidate.all(); return true; } catch { setCard({ ...c, note: 'Couldn’t save — try again' }); return false; } },
      toggle: async (c, field, on) => { try { setCard((await v2Api.cardToggle(c.id, field, on)).card); void invalidate.all(); } catch (e) { setCard({ ...c, note: errText(e) }); } },
      answer: async (c, ans) => { try { const r = await v2Api.cardAnswer(c.id, ans); setCard(r.card); if (r.sendAsMessage) toChat(r.sendAsMessage); void invalidate.all(); } catch (e) { setCard({ ...c, note: errText(e) }); } },
      open,
      typeInstead: () => {},
      editDraft: () => {},
      say: toChat,
      reveal: () => {},
      scrollToLatest: () => {},
      setTypedFocus: () => {},
      editing,
      beginEdit: (x) => setEditing({ ...x, value: x.value ?? x.initial }),
      setEditValue: (v) => setEditing((e) => (e ? { ...e, value: v } : e)),
      endEdit: () => setEditing(null),
    };
  }, [router, shell, invalidate, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <CardHandlersProvider value={handlers}>
      <CardView card={card} />
    </CardHandlersProvider>
  );
}
