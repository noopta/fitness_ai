// Swap an exercise (Oct 2026, flag swapV2). A swap keeps the job the exercise
// was doing — same movement, same target, as heavy for a main lift — and is
// never easier unless they say something hurts. Nothing here asks a model to
// choose: the list is ranked on the server from the exercise catalog, and
// whatever they pick or type is used exactly as is.
//
//   search            any exercise; "Use “…”" when nothing matches
//   Best matches      top 3 with a one-line why
//   Yours             lifts they've logged that do the same job
//   Same movement     variants
//   Ask Anakin        for what the list can't know ("easier on my elbow")
//
// After a pick: "Just today" (onToday) or "Every <day>" (a program swap card
// they apply here). Built like NumberSheet — an overlay that rides the
// keyboard, no Modal — so render it once at the screen root.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Keyboard, ActivityIndicator, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardController, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useQuery } from '@tanstack/react-query';
import type { Card } from '@axiom/agent-ui-core';
import { Pressable } from '../primitives/Pressable';
import { TextAction } from '../primitives/TextAction';
import { Row, Eyebrow } from '../primitives/Row';
import { StandaloneCard } from '../chat/StandaloneCard';
import { v2, T } from '../theme';
import { v2Api, type SwapRow } from '../api';
import { useInvalidate } from '../data';
import { haptics } from '../haptics';
import { KEYBOARD_DONE_ID } from '../../components/ui/KeyboardDoneBar';

export interface SwapSlot { sets?: number | string | null; reps?: number | string | null; notes?: string | null; index?: number | null; session?: string[] }

export interface SwapSheetProps {
  visible: boolean;
  /** The exercise being replaced. */
  name: string;
  slot?: SwapSlot;
  /** The program day ("Monday — Push"), for "Every Monday". None = today only (freestyle). */
  day?: string | null;
  /** Apply for today: the session swaps it in, the Today page shows it. */
  onToday: (to: string) => void | Promise<void>;
  /** "Every Monday" also swaps today's (an active session). */
  everyAlsoToday?: boolean;
  /** Hand off to chat with a prefilled ask. */
  onAsk?: (message: string) => void;
  onClose: () => void;
}

/** Pure: catalog names matching what they typed (name or alias, every word), best first. */
export function searchCatalog(q: string, list: { name: string; aka: string[] }[], limit = 8): string[] {
  const words = q.toLowerCase().replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = (s: string) => { const t = s.toLowerCase().replace(/[-_]/g, ' '); return words.every((w) => t.includes(w.replace(/s$/, ''))); };
  const scored = list
    .map((e) => ({ name: e.name, score: hit(e.name) ? (e.name.toLowerCase().startsWith(words[0]) ? 0 : 1) : e.aka.some(hit) ? 2 : 9 }))
    .filter((e) => e.score < 9)
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((e) => e.name);
}

/** "Monday — Push" → "Monday"; a bare weekday stays. */
export const dayWord = (day?: string | null) => String(day ?? '').split(/[—–-]/)[0].trim();

const ago = (d?: string | null) => {
  if (!d) return null;
  const days = Math.round((Date.now() - new Date(`${d}T12:00:00`).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`;
};

export function SwapSheet({ visible, name, slot, day, onToday, everyAlsoToday, onAsk, onClose }: SwapSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const kc = useKeyboardController();
  const { height: kb, progress } = useReanimatedKeyboardAnimation();
  const invalidate = useInvalidate();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState<'today' | 'every' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { kc.setEnabled(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible) { setQ(''); setPicked(null); setCard(null); setError(null); setBusy(null); } }, [visible, name]);

  const opts = useQuery({
    queryKey: ['v2', 'swap', name.toLowerCase(), slot?.reps ?? null, slot?.index ?? null, (slot?.session ?? []).join('|')],
    queryFn: () => v2Api.swapOptions({ name, sets: slot?.sets ?? null, reps: slot?.reps ?? null, notes: slot?.notes ?? null, index: slot?.index ?? null, session: slot?.session }),
    enabled: visible, staleTime: 5 * 60_000,
  });
  const catalog = useQuery({ queryKey: ['v2', 'exerciseCatalog'], queryFn: () => v2Api.exerciseCatalog(), enabled: visible, staleTime: Infinity });
  const matches = useMemo(() => searchCatalog(q, catalog.data?.exercises ?? []).filter((n) => n.toLowerCase() !== name.toLowerCase()), [q, catalog.data, name]);
  const typed = q.trim().replace(/\s+/g, ' ');
  const exact = matches.some((m) => m.toLowerCase() === typed.toLowerCase());

  const ride = useAnimatedStyle(() => ({ transform: [{ translateY: kb.value }], paddingBottom: Math.max(insets.bottom, 16) * (1 - progress.value) + 14 * progress.value }));
  const close = () => { Keyboard.dismiss(); onClose(); };

  const choose = (to: string, custom = false) => {
    Keyboard.dismiss();
    haptics.select();
    if (custom) void v2Api.swapLearn(to).catch(() => {});
    if (!dayWord(day)) { void today(to); return; }
    setPicked(to);
  };
  const today = async (to: string) => {
    setBusy('today'); setError(null);
    try { await onToday(to); close(); } catch (e: any) { setError(e?.message ?? 'Couldn’t swap that.'); }
    setBusy(null);
  };
  const every = async (to: string) => {
    setBusy('every'); setError(null);
    try {
      const why = [...(opts.data?.best ?? []), ...(opts.data?.yours ?? []), ...(opts.data?.variants ?? [])].find((r) => r.name === to)?.why;
      const r = await v2Api.runTool('propose_exercise_swap', { fromExerciseName: name, toExerciseName: to, scope: 'day', day: day ?? undefined, rationale: why ?? `You chose ${to}.` });
      if (!r.cards[0]) throw new Error('Nothing to change there.');
      setCard(r.cards[0]);
      if (everyAlsoToday) await onToday(to);
    } catch (e: any) { setError(e?.message ?? 'Couldn’t build that swap.'); }
    setBusy(null);
  };

  if (!visible) return null;
  const d = opts.data;
  const section = (title: string, rows: SwapRow[], showWhen = false) => rows.length ? (
    <View style={{ marginTop: 18 }}>
      <Eyebrow>{title}</Eyebrow>
      {rows.map((r, i) => <Row key={`${title}:${r.name}`} name={r.name} sub={showWhen && r.lastDone ? `${r.why.replace(/, you've done it before\.$|\.$/, '')} · ${ago(r.lastDone)}` : r.why} last={i === rows.length - 1} onPress={() => choose(r.name)} />)}
    </View>
  ) : null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={[styles.sheet, ride, { maxHeight: screenH * 0.86 }]} accessibilityViewIsModal>
        <View style={styles.grabber} />
        {card ? (
          <View>
            <StandaloneCard key={card.id} card={card} onChange={(c) => { setCard(c); if (c.state?.status === 'applied') void invalidate.afterProgram(); }} />
            <View style={styles.actions}>
              {card.state?.status === 'applied' ? <TextAction primary onPress={close}>Done</TextAction> : <TextAction muted arrow={false} onPress={close}>Not now</TextAction>}
            </View>
          </View>
        ) : picked ? (
          <View>
            <Text style={[T.headlineSm, { fontSize: 20, lineHeight: 26 }]}>{picked}</Text>
            <Text style={[T.caption, { marginTop: 4 }]}>Instead of {name}. Same sets and reps.</Text>
            <View style={{ marginTop: 14 }}>
              <Row name="Just today" sub={everyAlsoToday ? 'This session only' : 'Your program stays as it is'} value={busy === 'today' ? '…' : undefined} onPress={busy ? undefined : () => void today(picked)} />
              <Row name={`Every ${dayWord(day)}`} sub="Changes your program — you’ll see it before it’s made" value={busy === 'every' ? '…' : undefined} last onPress={busy ? undefined : () => void every(picked)} />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}><TextAction muted arrow={false} onPress={() => setPicked(null)}>← Back</TextAction></View>
          </View>
        ) : (
          <>
            <Text style={[T.headlineSm, { fontSize: 20, lineHeight: 26 }]}>Swap {name}</Text>
            <Text style={[T.caption, { marginTop: 4 }]}>Same job: same movement and muscles. Or pick anything.</Text>
            <View style={styles.field}>
              <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID} value={q} onChangeText={setQ} placeholder="Search or type any exercise" placeholderTextColor={v2.color.placeholder}
                autoCorrect={false} autoCapitalize="words" returnKeyType="done" style={styles.input} cursorColor={v2.color.crimson} selectionColor={v2.color.crimson}
                onSubmitEditing={() => { if (typed && !exact) choose(typed, true); else if (matches[0]) choose(matches[0]); }} accessibilityLabel="Search exercises" />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 4 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {typed ? (
                <View style={{ marginTop: 8 }}>
                  {matches.map((m, i) => <Row key={m} name={m} last={i === matches.length - 1 && exact} onPress={() => choose(m)} />)}
                  {!exact ? <Row name={`Use “${typed}”`} sub="Logged under exactly this name" last onPress={() => choose(typed, true)} /> : null}
                </View>
              ) : (
                <>
                  {opts.isLoading ? <ActivityIndicator color={v2.color.muted} style={{ marginVertical: 20 }} /> : null}
                  {d && !d.original.known ? <Text style={[T.bodyMuted, { marginTop: 14 }]}>I don’t know {name} well enough to rank swaps. Search above, or ask Anakin.</Text> : null}
                  {d?.lowConfidence && d.original.known ? <Text style={[T.caption, { marginTop: 14 }]}>No close match with your setup — these are the nearest.</Text> : null}
                  {d ? section('Best matches', d.best) : null}
                  {d ? section('You’ve done', d.yours, true) : null}
                  {d ? section('Same movement', d.variants) : null}
                  {opts.isError ? <Text style={styles.error}>Couldn’t load swaps. Search above, or ask Anakin.</Text> : null}
                </>
              )}
              {onAsk ? (
                <View style={styles.actions}>
                  <TextAction muted arrow={false} onPress={() => { close(); onAsk(`Find me a swap for ${name.toLowerCase()} that `); }}>Ask Anakin for something specific</TextAction>
                </View>
              ) : null}
            </ScrollView>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: v2.color.scrim },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: v2.color.white, borderTopLeftRadius: v2.radius.sheet, borderTopRightRadius: v2.radius.sheet, paddingHorizontal: v2.space.gutter, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: v2.color.hairline, marginBottom: 14 },
  field: { borderBottomWidth: 1, borderBottomColor: v2.color.ink, paddingBottom: 6, marginTop: 14 },
  input: { fontFamily: v2.font.regular, fontSize: 17, color: v2.color.ink, padding: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 18 },
  error: { ...T.caption, color: v2.color.crimson, marginTop: 10 },
});
