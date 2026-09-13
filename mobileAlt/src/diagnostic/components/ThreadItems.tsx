import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated as RNAnimated } from 'react-native';
import {
  COPY,
  DX,
  verdictHeadline,
  videoMeasurements,
  type ThreadItem,
  type Verdict,
  type VideoResult,
} from '@axiom/diagnostic-core';
import { AnimatedView, Eyebrow, InkButton, QuietButton, RichText, riseIn } from './primitives';

const C = DX.color;
const bubbleIn = riseIn(DX.motion.bubbleMs);
const cardIn = riseIn(DX.motion.cardMs);

export function AnakinBubble({ text, animate }: { text: string; animate: boolean }) {
  return (
    <AnimatedView entering={animate ? bubbleIn : undefined} style={styles.anakinRow}>
      <View style={styles.anakinBubble}>
        <RichText text={text} style={styles.anakinText} />
      </View>
    </AnimatedView>
  );
}

export function UserBubble({
  item, animate, onRetry,
}: { item: Extract<ThreadItem, { kind: 'user' }>; animate: boolean; onRetry: () => void }) {
  const failed = item.status === 'failed';
  return (
    <AnimatedView entering={animate ? bubbleIn : undefined} style={styles.userRow}>
      <View style={[styles.userBubble, failed && styles.userBubbleFailed]}>
        <Text style={[styles.userText, failed && { color: C.muted }]}>{item.text}</Text>
      </View>
      {failed ? (
        <View style={styles.failedRow}>
          <Text style={styles.didntSend}>{COPY.didntSend}</Text>
          <Text style={styles.failedDot}> · </Text>
          <TouchableOpacity onPress={onRetry} hitSlop={10} accessibilityRole="button">
            <Text style={styles.retry}>{COPY.retry}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </AnimatedView>
  );
}

/** Three dots, 1.2s blink, offsets 0 / .2 / .4s. */
export function TypingBubble() {
  const dots = useRef([0, 1, 2].map(() => new RNAnimated.Value(0.3))).current;
  useEffect(() => {
    const loops = dots.map((v, i) =>
      RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.delay(DX.motion.typingOffsets[i]),
          RNAnimated.timing(v, { toValue: 1, duration: DX.motion.typingMs / 2, useNativeDriver: true }),
          RNAnimated.timing(v, { toValue: 0.3, duration: DX.motion.typingMs / 2, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots]);
  return (
    <View style={styles.anakinRow} accessibilityLabel={COPY.statusTyping}>
      <View style={[styles.anakinBubble, styles.typingBubble]}>
        {dots.map((v, i) => (
          <RNAnimated.View key={i} style={[styles.dot, { opacity: v }]} />
        ))}
      </View>
    </View>
  );
}

export function VideoCard({ result, animate }: { result: VideoResult; animate: boolean }) {
  const rows = videoMeasurements(result);
  return (
    <AnimatedView entering={animate ? cardIn : undefined} style={styles.card}>
      <Eyebrow>{COPY.videoCardTitle}</Eyebrow>
      <View style={styles.measureRow}>
        {rows.map((r) => (
          <View key={r.label} style={styles.measure}>
            <Text style={styles.measureValue}>{r.value}</Text>
            <Text style={styles.measureLabel}>{r.label}</Text>
          </View>
        ))}
      </View>
      {result.frameUrl ? (
        <View style={styles.plate}>
          <Image source={{ uri: result.frameUrl }} style={styles.frame} resizeMode="cover" accessibilityLabel="Frame at the sticking point" />
        </View>
      ) : null}
    </AnimatedView>
  );
}

export function VerdictCard({ verdict, animate, onOpen }: { verdict: Verdict; animate: boolean; onOpen: () => void }) {
  const { eyebrow, headline } = verdictHeadline(verdict);
  return (
    <AnimatedView entering={animate ? cardIn : undefined}>
      <TouchableOpacity activeOpacity={0.9} onPress={onOpen} style={[styles.card, styles.verdictCard]} accessibilityRole="button">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Text style={styles.verdictHeadline}>{headline}</Text>
        <Text style={styles.verdictConfidence}>{COPY.confidence(verdict.confidence)}</Text>
        {verdict.evidence.slice(0, 2).map((e, i) => (
          <View key={i} style={styles.evidenceRow}>
            <Text style={styles.tag}>{e.tag}</Text>
            <Text style={styles.evidenceText}>{e.text}</Text>
          </View>
        ))}
      </TouchableOpacity>
    </AnimatedView>
  );
}

export function LimitCard({ animate, onUpgrade, onLater }: { animate: boolean; onUpgrade: () => void; onLater: () => void }) {
  return (
    <AnimatedView entering={animate ? cardIn : undefined} style={[styles.card, styles.limitCard]}>
      <Text style={styles.limitTitle}>{COPY.limitTitle}</Text>
      <Text style={styles.limitBody}>{COPY.limitBody}</Text>
      <View style={styles.limitActions}>
        <InkButton label={COPY.goUnlimited} onPress={onUpgrade} style={styles.limitCta} />
        <QuietButton label={COPY.later} onPress={onLater} />
      </View>
    </AnimatedView>
  );
}

/** RATIO / VIDEO / YOU / GAP tag — shared with the report. */
export const tagStyle = {
  fontSize: 10,
  fontWeight: '600' as const,
  letterSpacing: 0.6,
  color: C.body2,
  borderWidth: 1,
  borderColor: C.border,
  borderRadius: 6,
  paddingHorizontal: 6,
  paddingVertical: 2,
  overflow: 'hidden' as const,
  alignSelf: 'flex-start' as const,
  marginTop: 1,
};

const styles = StyleSheet.create({
  anakinRow: { alignItems: 'flex-start' },
  anakinBubble: {
    maxWidth: DX.anakinBubble.maxWidth,
    paddingVertical: DX.anakinBubble.padV,
    paddingHorizontal: DX.anakinBubble.padH,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.white,
  },
  anakinText: { fontSize: 14, lineHeight: 14 * 1.6, color: C.ink },
  typingBubble: { flexDirection: 'row', gap: 5, paddingVertical: 17 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.muted },

  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: DX.userBubble.maxWidth,
    paddingVertical: DX.userBubble.padV,
    paddingHorizontal: DX.userBubble.padH,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 16,
    backgroundColor: C.ink,
  },
  userBubbleFailed: { backgroundColor: C.surface },
  userText: { fontSize: 14, lineHeight: 14 * 1.5, fontWeight: '500', color: C.white },
  failedRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  didntSend: { fontSize: 12, fontWeight: '600', color: C.error },
  failedDot: { fontSize: 12, color: C.muted },
  retry: { fontSize: 12, fontWeight: '600', color: C.ink, textDecorationLine: 'underline' },

  card: {
    borderRadius: DX.card.radius,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.white,
    padding: DX.card.pad,
    gap: 10,
  },
  measureRow: { flexDirection: 'row', gap: 12 },
  measure: { flex: 1, gap: 2 },
  measureValue: { fontSize: 22, fontWeight: '700', letterSpacing: -0.77, color: C.ink },
  measureLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted },
  plate: { borderRadius: 12, backgroundColor: C.surface, overflow: 'hidden', aspectRatio: 16 / 9 },
  frame: { width: '100%', height: '100%' },

  verdictCard: {
    borderRadius: DX.card.radiusLarge,
    padding: DX.card.padLarge,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  verdictHeadline: { fontSize: 24, fontWeight: '700', letterSpacing: -0.84, color: C.ink, lineHeight: 29 },
  verdictConfidence: { fontSize: 13, fontWeight: '600', color: C.muted },
  evidenceRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  tag: tagStyle,
  evidenceText: { flex: 1, fontSize: 13, lineHeight: 19, color: C.body },

  limitCard: { backgroundColor: C.surface, borderColor: C.surface },
  limitTitle: { fontSize: 15, fontWeight: '600', color: C.ink },
  limitBody: { fontSize: 13, color: C.muted, lineHeight: 19 },
  limitActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  limitCta: { minHeight: 40, paddingHorizontal: 16 },
});
