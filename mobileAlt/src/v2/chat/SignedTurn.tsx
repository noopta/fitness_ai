// Signed turns (chat spec "Signed turns", 3 Oct — Chat Styles 1c, 2a, 2b).
//
// No bubbles. Anakin signs his turns: the petal mark (20 × 20) in a 22 pt
// gutter, "Anakin" beside it, and everything he says — receipts, text,
// cards — in the column to the right. The gutter stays reserved when the
// signature is hidden, so text never jumps left. You: a small "You" label
// above right-aligned 17 / 500 text, max 80 % wide. The weight difference
// (500 vs 400) is a second cue beside alignment.
//
// While Anakin works the mark is crimson and pulses, and the label says what
// he is doing ("Anakin is reading your logs…"); when the turn is done it goes
// back to "Anakin" in ink. The rules for labels, grouping and time stamps are
// in @axiom/agent-ui-core (signed.ts); this file only draws them.
//
// Each turn is memoised and turns are immutable once done, so while Anakin
// streams only the streaming turn re-renders.

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, AccessibilityInfo } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { receiptSummary, workingLabel, turnA11yLabel, type Turn } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { Mark } from '../primitives/Mark';
import { Enter } from '../primitives/Enter';
import { ReceiptList, Caret } from '../primitives/Receipt';
import { Ask } from '../primitives/Ask';
import { MarkdownText } from '../../components/ui/MarkdownText';
import { CardView, CardSkeleton } from './card/CardView';
import { TurnCard } from './Cards';
import type { Thread } from './useThread';

const C = v2.color;
/** Anakin's gutter and the gap after it (spec §2). */
export const GUTTER = 22;
export const GUTTER_GAP = 12;
/** Space between turns, and between lines grouped under one label. */
export const TURN_GAP = 30;
export const GROUP_GAP = 6;

interface Props {
  turn: Turn;
  showSignature: boolean;
  dispatch: Thread['dispatch'];
  ask: (m: string) => void;
  onAsk: (turn: Turn, o: string) => void;
}

/**
 * One turn with its time stamp and spacing. The layout comes in as plain
 * values (from signedLayout), so the memo holds while another turn streams.
 * The first turn in the thread takes no top gap.
 */
export const SignedTurn = React.memo(function SignedTurn({ turn, stamp, showLabel, grouped, first, ...rest }: Props & { stamp: string | null; showLabel: boolean; grouped: boolean; first: boolean }) {
  return (
    <View style={{ marginTop: first ? 0 : grouped ? GROUP_GAP : TURN_GAP }}>
      {stamp ? <TimeStamp label={stamp} /> : null}
      {turn.kind === 'user' ? <UserTurn turn={turn} showLabel={showLabel} /> : <AnakinTurn turn={turn} {...rest} />}
    </View>
  );
});

function TimeStamp({ label }: { label: string }) {
  return <Text style={styles.stamp} accessibilityRole="text">{label}</Text>;
}

function UserTurn({ turn, showLabel }: { turn: Turn; showLabel: boolean }) {
  return (
    <Enter exit={false}>
      <View style={styles.user} accessible accessibilityLabel={turnA11yLabel(turn)}>
        {showLabel ? <Text style={styles.youLabel}>You</Text> : null}
        <Text style={styles.userText}>{turn.text}</Text>
      </View>
    </Enter>
  );
}

function AnakinTurn({ turn, showSignature, dispatch, ask, onAsk }: Props) {
  const working = workingLabel(turn);
  const streaming = !turn.done;
  const live = streaming && turn.receipts.length && !turn.text ? turn.receipts.length - 1 : -1;
  const summary = receiptSummary(turn);
  const showList = turn.open || (streaming && !turn.text);
  const toggle = () => dispatch({ type: 'toggle', id: turn.id });
  const patch = (pch: Record<string, any>) => dispatch({ type: 'card_state', agentId: turn.id, patch: pch });
  const resolve = (line: string) => dispatch({ type: 'resolve', agentId: turn.id, resolution: line });

  // Announce what he's doing once per state, never per streamed chunk.
  useEffect(() => { if (working) AccessibilityInfo.announceForAccessibility(working); }, [working]);

  return (
    <Enter exit={false}>
      <View style={styles.anakinRow}>
        <View style={styles.gutter} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {showSignature ? <Mark size={20} working={!!working} /> : null}
        </View>
        <View style={styles.column}>
          {showSignature ? <SignatureLabel working={working} /> : null}
          <View style={[styles.content, showSignature && { marginTop: 8 }]}>
            {summary ? (
              <View>
                <Pressable onPress={toggle} hitSlop={6} disabled={streaming && !turn.text} accessibilityRole="button" accessibilityLabel={`${summary}. ${turn.open ? 'Hide' : 'Show'} what Anakin checked`}>
                  <Text style={T.caption}>{summary}{turn.done && turn.receipts.length && !turn.open ? ' →' : ''}</Text>
                </Pressable>
                {showList && turn.receipts.length ? <View style={{ marginTop: 8 }}><ReceiptList items={turn.receipts} liveIndex={live} animate={streaming} /></View> : null}
              </View>
            ) : null}
            {turn.ask && !turn.resolution ? <Ask question={turn.ask.question} reason={turn.ask.reason} options={turn.ask.options} size="read" onPick={(o) => onAsk(turn, o)} /> : null}
            {turn.text ? (
              <View style={styles.textRow} accessible accessibilityLabel={turnA11yLabel(turn)}>
                <View style={{ flex: 1 }}><MarkdownText text={turn.text} style={styles.anakinText} /></View>
                {streaming ? <Caret height={18} /> : null}
              </View>
            ) : null}
            {/* Cards sit in the content column, their hairlines starting at its left edge. */}
            {turn.cards?.length ? (
              <View style={{ gap: 28, marginTop: 6 }}>
                {turn.cards.map((c, i) => <Enter key={c.id} index={i} exit={false}><CardView card={c} /></Enter>)}
              </View>
            ) : turn.done ? <TurnCard turn={turn} patch={patch} resolve={resolve} ask={ask} /> : <PendingCard turn={turn} />}
            {turn.resolution ? <Text style={[T.caption, { color: /^(Adjusted|Logged)/.test(turn.resolution) ? C.crimson : C.muted }]}>{turn.resolution}</Text> : null}
          </View>
        </View>
      </View>
    </Enter>
  );
}

/** "Anakin" in ink, or what he's doing in muted while he works — cross-faded over 200 ms. */
function SignatureLabel({ working }: { working: string | null }) {
  const label = working ?? 'Anakin';
  return (
    <View style={styles.labelRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.Text key={label} entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} numberOfLines={1}
        style={[styles.anakinLabel, working ? { color: C.muted } : null]}>{label}</Animated.Text>
    </View>
  );
}

/** Skeleton in the card slot while a tool runs longer than 400 ms (§6.4) — never for fast results. */
function PendingCard({ turn }: { turn: Turn }) {
  const [show, setShow] = useState(false);
  const running = !turn.done && turn.receipts.length > 0 && !turn.text;
  useEffect(() => {
    if (!running) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, [running, turn.receipts.length]);
  if (!running || !show) return null;
  return <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)}><CardSkeleton /></Animated.View>;
}

const styles = StyleSheet.create({
  stamp: { fontFamily: v2.font.semibold, fontSize: 11, lineHeight: 14, color: C.placeholder, textAlign: 'center', marginBottom: 22 },
  user: { alignSelf: 'flex-end', maxWidth: '80%', alignItems: 'flex-end' },
  youLabel: { fontFamily: v2.font.semibold, fontSize: 12, lineHeight: 16, color: C.placeholder, marginBottom: 6 },
  userText: { fontFamily: v2.font.medium, fontSize: 17, lineHeight: 24.65, color: C.ink, textAlign: 'right' },
  anakinRow: { flexDirection: 'row' },
  gutter: { width: GUTTER, marginRight: GUTTER_GAP },
  column: { flex: 1, minWidth: 0 },
  labelRow: { height: 20, justifyContent: 'center' },
  anakinLabel: { fontFamily: v2.font.semibold, fontSize: 12, lineHeight: 16, color: C.ink },
  content: { gap: 12 },
  textRow: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  anakinText: { fontFamily: v2.font.regular, fontSize: 17, lineHeight: 25.5, color: C.ink },
});
