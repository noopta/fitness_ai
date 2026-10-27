// "While you were away" (design 3b, Oct 2026): one dark card per absence at
// the bottom of the thread, replacing the "While you were away · N" divider.
// Collapsed by default; the header expands it into one-line updates; a row
// opens to one sentence and one action, which unfolds the original message.

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { Easing, FadeIn, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Sparkles, ChevronDown, SquareCheck, Dumbbell, TrendingUp } from 'lucide-react-native';
import type { AwayItem, Card } from '@axiom/agent-ui-core';
import { Pressable } from '../../primitives/Pressable';
import { v2 } from '../../theme';
import { useCardHandlers } from './context';

// Visual tokens from the spec. The crimson accent is scoped to this card (open question 1).
const C = { card: '#09090b', crimson: '#a51c30', dot: '#e0566b', muted: '#a1a1aa', divider: 'rgba(255,255,255,0.12)', open: 'rgba(255,255,255,0.06)' };
const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const ICON = { needs_you: SquareCheck, program_change: Dumbbell, insight: TrendingUp, announcement: Sparkles } as const;

export function AwayView({ card }: { card: Card }) {
  const h = useCardHandlers();
  const away = card.away!;
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const rot = useSharedValue(0);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value * 180}deg` }] }));
  const layout = reduced ? undefined : LinearTransition.duration(400).easing(EASE);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (!next) setOpenRow(null); // collapsing closes any open row
    rot.value = reduced ? (next ? 1 : 0) : withTiming(next ? 1 : 0, { duration: 220 });
  };
  const openItem = (it: AwayItem) => {
    const next = openRow === it.id ? null : it.id;
    setOpenRow(next);
    if (next && !it.openedAt) void h.awayOpened(card, it.id);
  };
  const rows = all ? away.items : away.items.slice(0, away.shown);
  const more = away.items.length - rows.length;
  const needs = away.items.filter((i) => i.kind === 'needs_you' && !i.resolvedAt).length;

  return (
    <Animated.View layout={layout} style={[st.card, expanded && st.cardOpen]}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded }}
        accessibilityLabel={`While you were away, ${away.items.length} update${away.items.length === 1 ? '' : 's'}${needs ? `, ${needs} needs you` : ''}`}
        style={st.header}>
        <View style={st.tile}>
          <Sparkles size={18} color="#ffffff" strokeWidth={1.8} />
          {away.unopened ? <View style={st.badge}><Text style={st.badgeText}>{away.unopened}</Text></View> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>While you were away</Text>
          <Text style={st.summary}>{expanded ? `${away.since} · tap a row for detail` : away.summary}</Text>
        </View>
        <Animated.View style={[st.chevron, chevron]}><ChevronDown size={14} color="#ffffff" strokeWidth={2.2} /></Animated.View>
      </Pressable>

      {expanded ? (
        <Animated.View entering={reduced ? undefined : FadeIn.duration(300)} style={st.list}>
          {rows.map((it) => {
            const Icon = ICON[it.kind];
            const isOpen = openRow === it.id;
            const needsYou = it.kind === 'needs_you' && !it.resolvedAt;
            return (
              <Animated.View key={it.id} layout={layout} style={[st.row, isOpen && { backgroundColor: C.open }]}>
                <Pressable onPress={() => openItem(it)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={`${it.title}${needsYou ? ', needs you' : ''}, ${it.day}`} style={st.rowHead}>
                  <Icon size={16} color={C.muted} strokeWidth={1.8} />
                  <Text style={st.rowTitle} numberOfLines={1}>{it.title}</Text>
                  {needsYou ? <View style={st.dot} /> : null}
                  <Text style={st.day}>{it.day}</Text>
                </Pressable>
                {isOpen ? (
                  <Animated.View entering={reduced ? undefined : FadeIn.duration(200)} style={st.detailWrap}>
                    <Text style={st.detail}>{it.detail}</Text>
                    <Pressable onPress={() => h.unfold(it.cta.turnAt)} accessibilityRole="button" style={st.cta}>
                      <Text style={st.ctaText} numberOfLines={1}>{it.cta.label}</Text>
                    </Pressable>
                  </Animated.View>
                ) : null}
              </Animated.View>
            );
          })}
          {more > 0 ? (
            <Pressable onPress={() => setAll(true)} accessibilityRole="button" style={st.row}>
              <Text style={[st.rowTitle, { color: C.muted }]}>+{more} more</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  cardOpen: { shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  tile: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.crimson, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontFamily: v2.font.bold, fontSize: 10, color: C.crimson },
  title: { fontFamily: v2.font.semibold, fontSize: 14, letterSpacing: -0.14, color: '#ffffff' },
  summary: { fontFamily: v2.font.regular, fontSize: 12, color: C.muted, marginTop: 2 },
  chevron: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.crimson, alignItems: 'center', justifyContent: 'center' },
  list: { marginTop: 12, borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 6, gap: 2 },
  row: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTitle: { flex: 1, fontFamily: v2.font.medium, fontSize: 13, color: '#ffffff' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.dot },
  day: { fontFamily: v2.font.regular, fontSize: 11, color: C.muted },
  detailWrap: { marginTop: 8, marginLeft: 26, gap: 10 },
  detail: { fontFamily: v2.font.regular, fontSize: 12, lineHeight: 17, color: C.muted },
  cta: { alignSelf: 'flex-start', height: 30, borderRadius: 10, backgroundColor: C.crimson, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontFamily: v2.font.semibold, fontSize: 12, color: '#ffffff' },
});
