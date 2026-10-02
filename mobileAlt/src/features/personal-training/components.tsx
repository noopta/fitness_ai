// Building blocks of the personal-training screens (design handoff §5), with
// the same prop shapes as the web versions. Colours come from theme.ts; red,
// amber and green appear only as status dots, pills and sparkline strokes.

import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polyline, Rect } from 'react-native-svg';
import { ClipboardCheck, LineChart, MessageCircle, Sunrise, Users, type LucideIcon } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COPY, STATUS_LABEL, engagementAltText, sparklinePoints,
  type ClientStatus, type EngagementTrend, type Tone,
} from '@axiom/personal-training-core';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { MOBILE_COPY } from './mobileCopy';

/** Type scaling is honoured up to 1.3× (handoff §10); past that, rows stop fitting a phone. */
export const MAX_FONT_SCALE = 1.3;

const TONE: Record<Tone, { soft: string; ink: string; dot: string }> = {
  red: { soft: colors.destructiveSoft, ink: colors.destructiveInk, dot: colors.destructive },
  amber: { soft: colors.warningSoft, ink: colors.warningInk, dot: colors.warning },
  green: { soft: colors.successSoft, ink: colors.successInk, dot: colors.success },
  zinc: { soft: colors.muted, ink: colors.zinc600, dot: colors.zinc400 },
};

/** "Might need support" is amber — worth a look — not the red of an urgent item. */
export const STATUS_TONE: Record<ClientStatus, Tone> = { support: 'amber', new: 'zinc', onPlan: 'green', paused: 'zinc' };

/** 6px dot + 11/600 label on a soft fill. The label means status is never colour-only. */
export function Pill({ tone, children }: { tone: Tone; children: string }) {
  const t = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.soft }]}>
      <View style={[styles.pillDot, { backgroundColor: t.dot }]} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: t.ink }]}>{children}</Text>
    </View>
  );
}

export function StatusPill({ status }: { status: ClientStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

export function Avatar({ initials, size = 36, status }: { initials: string; size?: 28 | 32 | 36 | 44 | 56; status?: ClientStatus }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text allowFontScaling={false} style={[styles.avatarText, { fontSize: Math.round(size / 3) }]}>{initials}</Text>
      {status && (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={STATUS_LABEL[status]}
          style={[styles.avatarDot, { backgroundColor: TONE[STATUS_TONE[status]].dot }]}
        />
      )}
    </View>
  );
}

/**
 * Polyline only — no axes, no fill. Colour is status, never decoration: red
 * for a falling or regressing line, amber for a plateau, ink otherwise.
 * `domain` rescales for real measurements; `band` shades the plateau zone.
 */
export function Sparkline({
  series, trend, width = 72, height = 24, label, domain, tone, band,
}: {
  series: number[];
  trend?: EngagementTrend;
  width?: number;
  height?: number;
  /** Text alternative; defaults to the engagement description. */
  label?: string;
  domain?: [number, number];
  tone?: 'red' | 'amber' | 'ink';
  band?: boolean;
}) {
  const colour = tone ?? (trend === 'falling' ? 'red' : 'ink');
  const [min, max] = domain ?? [0, 10];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label ?? engagementAltText(trend ?? 'steady', series.length)}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {band && <Rect x={0} y={height * 0.25} width={width} height={height * 0.5} rx={4} fill={colors.warningSoft} />}
        <Polyline
          points={sparklinePoints(series, width, height, max, 2, min)}
          fill="none"
          stroke={colour === 'red' ? colors.destructive : colour === 'amber' ? colors.warning : colors.foreground}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/** Height 32 with a 44pt touch target, full radius, hairline. Active = black fill, white text. */
export function FilterChip({ active, onPress, label, count }: { active: boolean; onPress: () => void; label: string; count?: number }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      {count !== undefined && (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipCount, active && styles.chipCountActive]}>{count}</Text>
      )}
    </Pressable>
  );
}

export function Eyebrow({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.eyebrow}>{children.toUpperCase()}</Text>
    </View>
  );
}

/** "→"-prefixed reasons, then a "Sources: …" caption. Shared by briefing cards, check-ins and the dossier. */
export function EvidenceList({ reasons, sources }: { reasons: string[]; sources: { label: string }[] }) {
  return (
    <View style={styles.evidence}>
      {reasons.map((r) => (
        <View key={r} style={styles.evidenceRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.evidenceArrow} accessibilityElementsHidden importantForAccessibility="no">→</Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.evidenceText}>{r}</Text>
        </View>
      ))}
      {sources.length > 0 && (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.evidenceSources}>
          {MOBILE_COPY.sources(sources.map((x) => x.label).join(' · '))}
        </Text>
      )}
    </View>
  );
}

/** A centred message with an optional action: the empty and error state of every list. */
export function Notice({ title, children, action, alert }: { title?: string; children?: string; action?: React.ReactNode; alert?: boolean }) {
  return (
    <View style={styles.notice} accessibilityRole={alert ? 'alert' : undefined}>
      {title ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeTitle}>{title}</Text> : null}
      {children ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeBody}>{children}</Text> : null}
      {action}
    </View>
  );
}

export type TabKey = 'briefing' | 'clients' | 'checkIns' | 'progress' | 'anakin';

export const TAB_PATH: Record<TabKey, string> = {
  briefing: '/personal-training',
  clients: '/personal-training/clients',
  checkIns: '/personal-training/check-ins',
  progress: '/personal-training/progress',
  anakin: '/personal-training/anakin',
};

export const clientPath = (id: string) => `/personal-training/client/${encodeURIComponent(id)}`;

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'briefing', label: COPY.nav.briefing, icon: Sunrise },
  { key: 'clients', label: COPY.nav.clients, icon: Users },
  { key: 'checkIns', label: COPY.nav.checkIns, icon: ClipboardCheck },
  { key: 'progress', label: COPY.nav.progress, icon: LineChart },
  { key: 'anakin', label: 'Anakin', icon: MessageCircle },
];

/**
 * The five-tab bar from the handoff (§6). `active` is null on screens pushed
 * from a tab (a client, settings), where no tab is the current one.
 */
export function TabBar({ active }: { active: TabKey | null }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]} accessibilityRole="tablist">
      {TABS.map(({ key, label, icon: Icon }) => {
        const selected = key === active;
        return (
          <Pressable
            key={key}
            onPress={() => { if (!selected) router.navigate(TAB_PATH[key] as any); }}
            accessibilityRole="tab"
            accessibilityLabel={key === 'anakin' ? COPY.nav.anakin : label}
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Icon size={20} color={selected ? colors.foreground : colors.mutedForeground} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.tabText, selected && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  avatar: { backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.foreground, fontWeight: fontWeight.semibold },
  avatarDot: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.background },
  chip: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, backgroundColor: colors.background },
  chipActive: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.zinc600 },
  chipTextActive: { color: colors.background },
  chipCount: { fontSize: fontSize.sm, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  chipCountActive: { color: colors.border },
  eyebrow: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: 1.3, color: colors.mutedForeground },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border, backgroundColor: colors.background, paddingTop: spacing.sm },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2 },
  evidence: { gap: 4 },
  evidenceRow: { flexDirection: 'row', gap: spacing.sm },
  evidenceArrow: { fontSize: fontSize.base, lineHeight: 22, color: colors.zinc400 },
  evidenceText: { flex: 1, fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600 },
  evidenceSources: { marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  notice: { padding: spacing.xl, gap: spacing.sm + 4, alignItems: 'center' },
  noticeTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground, textAlign: 'center' },
  noticeBody: { fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600, textAlign: 'center' },
  tabText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.mutedForeground },
  tabTextActive: { color: colors.foreground },
});
