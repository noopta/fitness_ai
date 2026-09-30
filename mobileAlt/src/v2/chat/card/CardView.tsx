// One card, any function (CHAT_CARDS_RN_SPEC §5): a pattern is just which
// blocks a payload carries, so the renderer walks the blocks in the spec's
// top-to-bottom order. The card holds only local tap state (busy action,
// typed text, reveal timer, chosen option); everything durable comes back
// from the server as a new card.

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { isLive, type Card, type CardAction } from '@axiom/agent-ui-core';
import { K } from './tokens';
import { useCardHandlers } from './context';
import {
  MetaLine, Rows, ChangeValue, DiffRows, Why, Note, EmptyLine, AskBlock, Segmented, FlowProgress,
  DraftBody, LoseList, TypedConfirm, HandoffButton, Actions, StateLine,
} from './primitives';
import { Hero, Sparkline, Bars, WeekTiles, Media, Skeleton, CapturePlaceholder } from './charts';

const REVEAL_MS = 30_000;

export function CardView({ card }: { card: Card }) {
  const h = useCardHandlers();
  const live = isLive(card);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [choice, setChoice] = useState(card.choice?.value ?? 0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const shellRef = useRef<View>(null);
  useEffect(() => { if (!revealed) return; const t = setTimeout(() => setRevealed(false), REVEAL_MS); return () => clearTimeout(t); }, [revealed]);
  useEffect(() => { if (!live) setChosen(null); }, [live]);

  // Acted on / replaced → body dims over 300 ms; Pro previews sit at .40 while live.
  const target = !live ? K.actedOpacity : card.pro ? K.proOpacity : 1;
  const o = useSharedValue(target);
  useEffect(() => { o.value = withTiming(target, { duration: K.fade }); }, [target, o]);
  const body = useAnimatedStyle(() => ({ opacity: o.value }));

  const run = async (a: CardAction) => {
    setBusyId(a.id);
    try { await h.act(card, a, { typed: a.requiresTyped ? typed : undefined, choice: card.choice ? choice : undefined }); }
    finally { setBusyId(null); }
  };
  const pick = (i: number) => { setChosen(i); void h.answer(card, { option: i }).catch(() => setChosen(null)); };
  const masked = !!card.private && !revealed;
  const reveal = () => setRevealed(true);
  const open = card.meta?.open ? () => h.open(card, card.meta!.open!) : undefined;
  const videoAction = card.actions?.find((a) => a.client?.action === 'play_video');

  return (
    <View ref={shellRef} collapsable={false} style={st.shell} accessible={false}
      accessibilityRole="summary" accessibilityLabel={`${card.meta?.label ?? card.fn}, ${card.pattern}`}>
      <Animated.View style={[st.body, body]} pointerEvents={live ? 'auto' : 'box-none'}>
        {card.meta ? <MetaLine label={card.step ? `${card.meta.label} · ${card.step.i} of ${card.step.n}` : card.meta.label} onOpen={open} /> : null}
        {card.step?.done.length ? <FlowProgress done={card.step.done} /> : null}
        {card.hero ? (masked ? <Rows card={card} rows={[{ key: card.meta?.label ?? 'Value', value: card.hero.value }]} masked onReveal={reveal} /> : <Hero cardId={card.id} hero={card.hero} />) : null}
        {card.line?.length ? <Sparkline cardId={card.id} data={card.line} /> : null}
        {card.bars?.v.length ? <Bars cardId={card.id} bars={card.bars} /> : null}
        {card.tiles?.length ? (
          <WeekTiles tiles={card.tiles} disabled={!live}
            onSwap={(a, b) => h.say(`Swap ${card.tiles![a].n ?? 'the session'} on ${card.tiles![a].date ?? card.tiles![a].d} with ${card.tiles![b].date ?? card.tiles![b].d}`)} />
        ) : null}
        {card.media ? <Media media={card.media} onPress={videoAction ? () => void run(videoAction) : undefined} /> : null}
        {card.pattern === 'capture' && live ? <CapturePlaceholder /> : null}
        {card.change ? (masked ? <Rows card={card} rows={[{ key: card.change.key, value: card.change.to }]} masked onReveal={reveal} /> : <ChangeValue change={card.change} />) : null}
        {card.diff?.length ? <DiffRows diff={card.diff} /> : null}
        {card.rows?.length ? <Rows card={card} rows={card.rows} masked={masked} onReveal={reveal} disabled={!live && card.pattern !== 'setting'} /> : null}
        {card.ask && live ? <AskBlock q={card.ask.q} options={card.ask.options} typeInstead={card.ask.typeInstead} onPick={pick} onType={() => h.typeInstead(card)} chosen={chosen} /> : null}
        {!card.ask && card.options?.length && live ? <AskBlock options={card.options} onPick={pick} chosen={chosen} /> : null}
        {card.choice ? <Segmented options={card.choice.options} value={choice} onChange={setChoice} disabled={!live} /> : null}
        {card.draft ? <DraftBody draft={card.draft} /> : null}
        {card.lose ? <LoseList items={card.lose.items} keep={card.lose.keep} /> : null}
        {card.lose?.typed && live ? (
          <TypedConfirm word={card.lose.typed} value={typed} onChange={setTyped}
            onFocusField={(on) => { h.setTypedFocus(on); if (on) setTimeout(() => h.reveal(shellRef.current), 60); }} />
        ) : null}
        {card.why ? <Why text={card.why} /> : null}
        {card.note ? <Note text={card.note} /> : null}
        {card.empty ? <EmptyLine text={card.empty} /> : null}
        {card.skeleton ? <Skeleton rows={card.skeleton} /> : null}
        {card.handoff && live ? <HandoffButton label={card.handoff.label} onPress={() => void run({ id: 'handoff', label: card.handoff!.label, kind: 'primary', client: { action: card.handoff!.action, args: card.handoff!.args } })} /> : null}
      </Animated.View>

      {/* Actions stay at full opacity on a Pro preview ("Unlock with Pro →"); they unmount once acted on. */}
      {live && card.actions?.length ? (
        <Actions actions={card.actions.filter((a) => a.client?.action !== 'play_video' || !card.media)} onPress={(a) => void run(a)} busyId={busyId} typed={typed} />
      ) : null}
      {!live && card.state?.line ? (
        <StateLine card={card} line={card.state.line} onUndo={() => void h.undo(card)} onOpen={open} onReplaced={h.scrollToLatest} />
      ) : null}
    </View>
  );
}

/** Loading slot while a tool runs longer than 400 ms (spec §6.4). */
export function CardSkeleton({ rows = 2 }: { rows?: number }) {
  return <View style={st.shell}><Skeleton rows={rows} /></View>;
}

const st = StyleSheet.create({
  shell: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: K.hairline, paddingTop: 14, paddingBottom: 16, gap: 14 },
  body: { gap: 14 },
});
