// Page scaffolds.
//
// `TabPage` — a page on the track: scroll view, header clearance at the top,
// tab-bar clearance at the bottom, 28pt gutters.
//
// `PushedPage` — a pushed detail page: `← Parent` back label, meta, title,
// Anakin's read, one visual, hairline rows, optional Proposed + CTA. One
// template for every detail page in the app (Remaining Flows 4a–4d).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from '../primitives/Pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { v2, T } from '../theme';
import { Mark } from '../primitives/Mark';
import { Enter } from '../primitives/Enter';
import { TextAction } from '../primitives/TextAction';
import { Receipt } from '../primitives/Receipt';
import { HEADER_HEIGHT, headerClearance } from './Header';
import { haptics } from '../haptics';

/**
 * Pull-to-refresh that only spins after a real pull (feedback 8 Oct). Passing a
 * query's isFetching straight to RefreshControl turned the spinner on during
 * background refetches (tab focus), and iOS left it frozen at the top until
 * the next pull. Spins at least 500 ms, at most 10 s.
 */
export function usePullRefresh(refreshing: boolean | undefined, onRefresh: (() => void) | undefined) {
  const [pulled, setPulled] = useState(false);
  const since = useRef(0);
  const seen = useRef(false);
  useEffect(() => { if (pulled && refreshing) seen.current = true; }, [pulled, refreshing]);
  useEffect(() => {
    if (!pulled) return;
    const left = Math.max(0, 500 - (Date.now() - since.current));
    const done = !refreshing && (seen.current || Date.now() - since.current > 1500);
    const t = setTimeout(() => { if (done) setPulled(false); }, done ? left : 1600);
    const cap = setTimeout(() => setPulled(false), 10_000);
    return () => { clearTimeout(t); clearTimeout(cap); };
  }, [pulled, refreshing]);
  const onPull = useCallback(() => { since.current = Date.now(); seen.current = false; setPulled(true); onRefresh?.(); }, [onRefresh]);
  return { pulled, onPull };
}

export function TabPage({ children, style, refreshing, onRefresh, dark, contentStyle, scrollEnabled = true }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; refreshing?: boolean; onRefresh?: () => void; dark?: boolean; contentStyle?: StyleProp<ViewStyle>; scrollEnabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const pull = usePullRefresh(refreshing, onRefresh);
  return (
    // The header is fixed at the safe-area top with a white ground; content lives below it and can never scroll under it.
    <View style={[styles.flex, { paddingTop: headerClearance(insets.top) }, style]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[{ paddingTop: 12, paddingBottom: v2.space.tabBarClearance + insets.bottom, paddingHorizontal: v2.space.gutter }, contentStyle]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        refreshControl={onRefresh ? <RefreshControl refreshing={pull.pulled} onRefresh={pull.onPull} tintColor={dark ? v2.color.darkMuted : v2.color.muted} /> : undefined}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** Headline + one caption, the top of every tab page. */
export function PageTitle({ title, caption, meta, dark, right }: { title?: string | null; caption?: string | null; meta?: string | null; dark?: boolean; right?: React.ReactNode }) {
  return (
    <Enter exit={false}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          {meta ? <Text style={[T.caption, { marginBottom: 8 }, dark && { color: v2.color.darkMuted }]} numberOfLines={1}>{meta}</Text> : null}
          {title ? <Text style={[T.headlineSm, dark && { color: v2.color.darkInk }]}>{title}</Text> : null}
          {caption ? <Text style={[T.caption, { marginTop: 8 }, dark && { color: v2.color.darkMuted }]} numberOfLines={2}>{caption}</Text> : null}
        </View>
        {right}
      </View>
    </Enter>
  );
}

/** Anakin's read: 18pt mark + 15pt muted text. Leads every page. */
export function AnakinRead({ text, size = 'body', working, dark }: { text: string; size?: 'body' | 'read'; working?: boolean; dark?: boolean }) {
  return (
    <Enter index={1} exit={false}>
      <View style={styles.read}>
        <View style={{ paddingTop: size === 'read' ? 4 : 2 }}><Mark size={18} working={working} tone={dark ? 'light' : 'ink'} /></View>
        <Text style={[size === 'read' ? T.readSm : T.bodyMuted, { flex: 1 }, dark && { color: dark ? v2.color.darkMuted : undefined }]}>{text}</Text>
      </View>
    </Enter>
  );
}

interface PushedProps {
  back: string;
  meta?: string | null;
  /** In place of meta: a header action on the right (Messages → "New"). */
  right?: React.ReactNode;
  eyebrow?: string | null;
  title: string;
  /** Hero number line (64pt) rendered above the read when present. */
  hero?: { value: string; unit?: string; delta?: string } | null;
  lead?: string | null;
  children?: React.ReactNode;
  visual?: React.ReactNode;
  proposed?: { text: string } | null;
  cta?: { label: string; onPress: () => void; loading?: boolean } | null;
  foot?: { label: string; onPress: () => void; muted?: boolean }[];
  onBack?: () => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function PushedPage({ back, meta, right, eyebrow, title, hero, lead, children, visual, proposed, cta, foot, onBack, loading, error, onRetry, refreshing, onRefresh }: PushedProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pull = usePullRefresh(refreshing, onRefresh);
  const goBack = () => { haptics.select(); if (onBack) onBack(); else if (router.canGoBack()) router.back(); else router.replace('/(v2)' as any); };
  return (
    <View style={[styles.flex, { backgroundColor: v2.color.white }]}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 56 + insets.bottom, paddingHorizontal: v2.space.gutter }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={pull.pulled} onRefresh={pull.onPull} tintColor={v2.color.muted} /> : undefined}
      >
        <View style={styles.topRow}>
          <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Back to ${back}`}>
            <Text style={[T.body, { color: v2.color.muted }]}>← {back}</Text>
          </Pressable>
          {right ?? (meta ? <Text style={[T.caption]}>{meta}</Text> : null)}
        </View>
        <View style={{ height: 28 }} />
        {eyebrow ? <Enter exit={false}><Text style={[T.eyebrow, { marginBottom: 10 }]}>{eyebrow}</Text></Enter> : null}
        {hero ? (
          <Enter exit={false}>
            <View style={styles.heroRow}>
              <Text style={T.hero}>{hero.value}</Text>
              {hero.unit ? <Text style={[T.read, { color: v2.color.muted, marginLeft: 8 }]}>{hero.unit}</Text> : null}
              {hero.delta ? <Text style={[T.captionStrong, { color: v2.color.muted, marginLeft: 12 }]}>{hero.delta}</Text> : null}
            </View>
          </Enter>
        ) : null}
        <Enter exit={false} index={hero ? 1 : 0}><Text style={[T.headlineSm, hero && { ...T.readSm, fontFamily: v2.font.semibold, marginTop: 6 }]}>{title}</Text></Enter>
        {lead ? <View style={{ marginTop: 14 }}><AnakinRead text={lead} /></View> : null}
        {visual ? <Enter index={2} exit={false}><View style={{ marginTop: 26 }}>{visual}</View></Enter> : null}
        {loading ? <Text style={[T.caption, { marginTop: 32 }]}>Reading…</Text> : null}
        {error ? (
          <View style={{ marginTop: 32 }}>
            <Text style={T.bodyMuted}>{error}</Text>
            {onRetry ? <TextAction onPress={onRetry} style={{ marginTop: 8 }}>Try again</TextAction> : null}
          </View>
        ) : null}
        {children ? <View style={{ marginTop: 28 }}>{children}</View> : null}
        {proposed ? (
          <Enter index={3} exit={false}>
            <View style={{ marginTop: 32 }}>
              <Receipt verb="Proposed" text={proposed.text} animate={false} />
            </View>
          </Enter>
        ) : null}
        {cta ? (
          <Enter index={4} exit={false}>
            <View style={{ marginTop: 26 }}>
              <TextAction primary onPress={cta.onPress} loading={cta.loading}>{cta.label}</TextAction>
            </View>
          </Enter>
        ) : null}
        {foot?.length ? (
          <View style={styles.foot}>
            {foot.map((f) => <TextAction key={f.label} muted={f.muted ?? true} arrow={false} onPress={f.onPress} size={15}>{f.label}</TextAction>)}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  read: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  foot: { flexDirection: 'row', gap: 28, marginTop: 40, paddingTop: 20, borderTopWidth: 1, borderTopColor: v2.color.hairline },
});
