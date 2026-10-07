// Feed pieces shared by the tab, Messages, Search and Saved (bug fixes 5 Oct
// 2026, 3a–3d): avatar, stroke icons, text-link filters, the input-as-header
// for search pages, and the Ask line.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Image, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from '../../primitives/Pressable';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { v2, T } from '../../theme';
import { haptics } from '../../haptics';
import { useShellOptional } from '../../shell/ShellContext';

const C = v2.color;

/** "2 h", "14 min", "Yesterday", "3 d". */
export function ago(iso?: string | Date | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} d`;
}

export const displayName = (u: any): string => u?.name || (u?.username ? `@${u.username}` : 'Someone');

/** Round avatar: the photo when there is one, otherwise initials on surface grey. */
export function Avatar({ user, size }: { user: any; size: number }) {
  const uri = user?.avatarBase64 ? (String(user.avatarBase64).startsWith('data:') ? user.avatarBase64 : `data:image/jpeg;base64,${user.avatarBase64}`) : user?.avatarUrl ?? null;
  const initials = displayName(user).replace(/^@/, '').split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={[box, { backgroundColor: C.surface }]} />;
  return (
    <View style={[box, { backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontFamily: v2.font.semibold, fontSize: size * 0.38, color: C.muted }}>{initials}</Text>
    </View>
  );
}

// ─── Stroke icons (22 pt, 1.75 stroke — the tab bar's weight) ────────────────

type IconKind = 'search' | 'messages' | 'saved';
export function StrokeIcon({ kind, size = 22, color = C.ink, filled }: { kind: IconKind; size?: number; color?: string; filled?: boolean }) {
  const common = { stroke: color, strokeWidth: v2.tabBar.stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 'search' ? <><Circle cx={11} cy={11} r={7.5} {...common} /><Path d="M21 21l-4.6-4.6" {...common} /></> : null}
      {kind === 'messages' ? <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" {...common} /> : null}
      {kind === 'saved' ? <Path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" {...common} fill={filled ? color : 'none'} /> : null}
    </Svg>
  );
}

/** Feed header right: Search · Messages (crimson dot when unread) · Saved, gap 20. Each pushes its page. */
export function FeedHeaderActions({ unread }: { unread: boolean }) {
  const router = useRouter();
  const go = (key: string) => { haptics.select(); router.push({ pathname: '/(v2)/p/[key]', params: { key } } as any); };
  return (
    <View style={styles.actions}>
      <Pressable onPress={() => go('feedsearch')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Search"><StrokeIcon kind="search" /></Pressable>
      <Pressable onPress={() => go('messages')} hitSlop={10} accessibilityRole="button" accessibilityLabel={unread ? 'Messages, unread' : 'Messages'}>
        <StrokeIcon kind="messages" />
        {unread ? <View style={styles.dot} /> : null}
      </Pressable>
      <Pressable onPress={() => go('saved')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Saved"><StrokeIcon kind="saved" /></Pressable>
    </View>
  );
}

// ─── Text-link filters (13 / 600; the active one ink with a 1.5 pt underline) ─

export function LinkTabs<K extends string>({ items, value, onChange, style }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.links, style]} accessibilityRole="tablist">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} onPress={() => { if (!on) { haptics.select(); onChange(it.key); } }} hitSlop={8} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <Text style={[styles.link, { color: on ? C.ink : C.muted }]}>{it.label}</Text>
            <View style={[styles.underline, { backgroundColor: on ? C.ink : 'transparent' }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Search pages: the input is the header ───────────────────────────────────

/** 20/600 input with an ink underline and Cancel. Debounced `onQuery` (250 ms); `onChange` is immediate. */
export function SearchHeader({ placeholder, value, onChange, onQuery, size = 20, autoFocus = true }: {
  placeholder: string; value: string; onChange: (s: string) => void; onQuery?: (s: string) => void; size?: number; autoFocus?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const change = (s: string) => {
    onChange(s);
    if (!onQuery) return;
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => onQuery(s.trim()), 250);
  };
  return (
    <View style={[styles.searchHead, { paddingTop: insets.top + 12 }]}>
      <TextInput
        value={value} onChangeText={change} placeholder={placeholder} placeholderTextColor={C.placeholder}
        autoFocus={autoFocus} autoCorrect={false} autoCapitalize="none" returnKeyType="search"
        onSubmitEditing={() => onQuery?.(value.trim())}
        style={[styles.searchInput, { fontSize: size, lineHeight: size + 6 }]} accessibilityLabel={placeholder} />
      <Pressable onPress={() => { haptics.select(); if (router.canGoBack()) router.back(); else router.replace('/(v2)' as any); }} hitSlop={10} accessibilityRole="button">
        <Text style={[T.body, { color: C.muted }]}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/** "Ask Anakin — …" at the foot of a page: opens the composer on home. */
export function AskLine({ hint, style }: { hint: string; style?: StyleProp<ViewStyle> }) {
  const shell = useShellOptional();
  const router = useRouter();
  return (
    <Pressable onPress={() => { haptics.select(); shell?.prefill(''); router.replace('/(v2)' as any); }} accessibilityRole="button" style={style}>
      <Text style={T.bodyMuted}>Ask Anakin — {hint}</Text>
    </Pressable>
  );
}

/** Crimson text action for the one primary act in a row (Add, Accept). */
export function RowAction({ label, onPress, primary, busy }: { label: string; onPress: () => void; primary?: boolean; busy?: boolean }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable onPress={() => { if (busy) return; haptics.light(); onPress(); }} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} hitSlop={10} accessibilityRole="button">
      <Text style={[styles.rowAction, { color: primary ? C.crimson : C.ink, opacity: pressed || busy ? 0.5 : 1 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  dot: { position: 'absolute', top: -1, right: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: C.crimson, borderWidth: 1.5, borderColor: C.white },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8 },
  link: { fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 18 },
  underline: { height: 1.5, marginTop: 3 },
  searchHead: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: v2.space.gutter, paddingBottom: 6, backgroundColor: C.white },
  searchInput: { flex: 1, fontFamily: v2.font.semibold, color: C.ink, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.ink },
  rowAction: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20 },
});
