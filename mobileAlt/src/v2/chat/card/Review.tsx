// Log review digest (design "Log review 1a", Oct 2026). Rows list every
// suspect entry for the period; one row is open at a time and shows
// Before / After, why, confidence + impact, and Keep as is / Apply fix.
// Nothing changes without a tap; every resolved row offers Undo.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { Card, ReviewRow } from '@axiom/agent-ui-core';
import { Pressable } from '../../primitives/Pressable';
import { v2 } from '../../theme';
import { useCardHandlers } from './context';

// Visual tokens from the spec.
const C = {
  ink: '#09090b', muted: '#71717a', hairline: '#e4e4e7', divider: '#f4f4f5', block: '#fafafa',
  neutralBg: '#f4f4f5', neutralInk: '#09090b', warnBg: '#fef3c7', warnInk: '#b45309', success: '#15803d',
};
const WARN = new Set(['outlier', 'conflict', 'equipment']);

export function ReviewView({ card }: { card: Card }) {
  const h = useCardHandlers();
  const review = card.review!;
  const firstPending = review.rows.find((r) => r.status === 'pending')?.id ?? null;
  const [open, setOpen] = useState<string | null>(firstPending);
  const [busy, setBusy] = useState<string | null>(null);
  const resolved = review.rows.some((r) => r.status !== 'pending');

  // After a tap the next pending row opens on its own (spec: "Auto-opens the next pending row").
  useEffect(() => {
    setOpen((cur) => (cur && review.rows.find((r) => r.id === cur)?.status === 'pending' ? cur : firstPending));
  }, [firstPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const tap = async (op: 'apply' | 'keep' | 'undo' | 'apply_all' | 'expand', id: string) => {
    if (busy) return;
    setBusy(`${op}:${id}`);
    try { await h.review(card, op, id); } finally { setBusy(null); }
  };

  const header = review.pending ? `${review.pending} to review` : 'Reviewed';
  return (
    <View style={st.card} accessibilityLabel={`Log check ${review.period}, ${header}`}>
      <View style={st.head}>
        <Text style={st.period}>LOG CHECK{review.period ? ` · ${review.period.toUpperCase()}` : ''}</Text>
        <View style={[st.countPill, !review.pending && { backgroundColor: '#dcfce7' }]}>
          <Text style={[st.countText, !review.pending && { color: C.success }]}>{header}</Text>
        </View>
      </View>
      {review.rows.map((r, i) => (
        <Row key={r.id} row={r} first={i === 0} open={open === r.id} busy={busy}
          onToggle={() => setOpen((cur) => (cur === r.id ? null : r.id))}
          onApply={() => void tap('apply', r.id)} onKeep={() => void tap('keep', r.id)} onUndo={() => void tap('undo', r.id)} />
      ))}
      {review.hiddenCount ? (
        <Pressable style={st.more} onPress={() => void tap('expand', card.id)} accessibilityRole="button">
          <Text style={st.moreText}>Show {review.hiddenCount} more</Text>
        </Pressable>
      ) : null}
      {review.pending ? (
        <View style={st.footer}>
          <Btn primary label={busy === `apply_all:${card.id}` ? 'Applying…' : resolved ? `Apply remaining ${review.pending}` : `Apply all ${review.pending} suggestion${review.pending === 1 ? '' : 's'}`}
            onPress={() => void tap('apply_all', card.id)} disabled={!!busy} />
        </View>
      ) : null}
    </View>
  );
}

function Row({ row, first, open, busy, onToggle, onApply, onKeep, onUndo }: {
  row: ReviewRow; first: boolean; open: boolean; busy: string | null;
  onToggle: () => void; onApply: () => void; onKeep: () => void; onUndo: () => void;
}) {
  const pending = row.status === 'pending';
  const warn = WARN.has(row.type);
  const confidence = useMemo(() => `${row.confidence[0].toUpperCase()}${row.confidence.slice(1)} confidence${row.impact ? ` · ${row.impact}` : ''}`, [row.confidence, row.impact]);
  return (
    <View style={[st.row, !first && st.rowDivider]}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${row.typeLabel}, ${row.date}, ${row.title}${pending ? `. Suggested: ${row.fix}` : ''}`}>
        <View style={st.rowTop}>
          <View style={[st.pill, { backgroundColor: warn ? C.warnBg : C.neutralBg }]}>
            <Text style={[st.pillText, { color: warn ? C.warnInk : C.neutralInk }]}>{row.typeLabel}</Text>
          </View>
          <Text style={st.date}>{row.date}</Text>
          <View style={{ flex: 1 }} />
          {pending ? <Text style={st.chevron}>{open ? '–' : '+'}</Text> : null}
        </View>
        <Text style={st.title} numberOfLines={open ? undefined : 1}>{row.title}</Text>
        {pending ? <Text style={st.fix} numberOfLines={open ? undefined : 1}>→ {row.fix}</Text> : null}
      </Pressable>

      {!pending ? (
        <View style={st.resolved}>
          <Text style={st.resolvedText}>✓ {row.status === 'applied' ? row.doneLabel : 'Kept as is'}</Text>
          <Pressable onPress={onUndo} hitSlop={10} accessibilityRole="button" disabled={!!busy}>
            <Text style={st.undo}>{busy === `undo:${row.id}` ? 'Undoing…' : 'Undo'}</Text>
          </Pressable>
        </View>
      ) : open ? (
        <Animated.View entering={FadeIn.duration(200)} style={{ gap: 10, marginTop: 10 }}>
          <View style={st.block}>
            <View style={st.blockRow}><Text style={st.blockKey}>Before</Text><Text style={st.blockVal}>{row.before}</Text></View>
            <View style={st.blockRow}><Text style={st.blockKey}>After</Text><Text style={[st.blockVal, { fontFamily: v2.font.semibold }]}>{row.after}</Text></View>
          </View>
          <Text style={st.why}><Text style={{ fontFamily: v2.font.semibold }}>Why: </Text>{row.why}</Text>
          <Text style={st.confidence}>{confidence}</Text>
          <View style={st.buttons}>
            <Btn label={busy === `keep:${row.id}` ? 'Keeping…' : 'Keep as is'} onPress={onKeep} disabled={!!busy} />
            <Btn primary label={busy === `apply:${row.id}` ? 'Applying…' : 'Apply fix'} onPress={onApply} disabled={!!busy} />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Btn({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={[st.btn, primary ? st.btnPrimary : st.btnSecondary, disabled && { opacity: 0.6 }]}>
      <Text style={[st.btnText, { color: primary ? '#ffffff' : C.ink }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.hairline, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  period: { fontFamily: v2.font.semibold, fontSize: 11, letterSpacing: 0.8, color: C.muted },
  countPill: { backgroundColor: C.neutralBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  countText: { fontFamily: v2.font.bold, fontSize: 10, color: C.ink },
  row: { paddingHorizontal: 16, paddingVertical: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.divider },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pillText: { fontFamily: v2.font.bold, fontSize: 10 },
  date: { fontFamily: v2.font.regular, fontSize: 12, color: C.muted },
  chevron: { fontFamily: v2.font.semibold, fontSize: 18, color: C.muted, width: 18, textAlign: 'center' },
  title: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20, color: C.ink, marginTop: 6 },
  fix: { fontFamily: v2.font.regular, fontSize: 13, lineHeight: 18, color: C.muted, marginTop: 2 },
  block: { backgroundColor: C.block, borderRadius: 10, padding: 12, gap: 6 },
  blockRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  blockKey: { fontFamily: v2.font.regular, fontSize: 13, color: C.muted },
  blockVal: { flex: 1, textAlign: 'right', fontFamily: v2.font.medium, fontSize: 13, color: C.ink, fontVariant: ['tabular-nums'] },
  why: { fontFamily: v2.font.regular, fontSize: 13, lineHeight: 19, color: C.ink },
  confidence: { fontFamily: v2.font.regular, fontSize: 12, lineHeight: 16, color: C.muted },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 2 },
  btn: { flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  btnPrimary: { backgroundColor: C.ink },
  btnSecondary: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.hairline },
  btnText: { fontFamily: v2.font.semibold, fontSize: 14 },
  resolved: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  resolvedText: { fontFamily: v2.font.semibold, fontSize: 13, color: C.success },
  undo: { fontFamily: v2.font.semibold, fontSize: 13, color: C.ink, textDecorationLine: 'underline' },
  more: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.divider },
  moreText: { fontFamily: v2.font.semibold, fontSize: 13, color: C.ink },
  footer: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 14 },
});
