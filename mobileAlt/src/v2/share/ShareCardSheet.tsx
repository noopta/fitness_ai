// A share card in a sheet (handoff N-10, S-04): a light or dark card, no
// photo needed. Share opens the system sheet; Save image puts it in Photos.
// The card is rendered by the caller for each theme; this owns the toggle,
// the capture and the two exports (the same targets as the workout cards).

import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { v2, T } from '../theme';
import { Sheet } from '../primitives/Sheet';
import { TextAction } from '../primitives/TextAction';
import { Pressable } from '../primitives/Pressable';
import { runTarget, resultMessage } from '../../components/share/workout/shareTargets';
import { haptics } from '../haptics';

export type CardTheme = 'dark' | 'light';
export const CARD_INK = { dark: { bg: '#09090b', ink: '#fafafa', muted: '#a1a1aa', line: '#27272a' }, light: { bg: '#ffffff', ink: '#09090b', muted: '#71717a', line: '#e4e4e7' } } as const;

export function ShareCardSheet({ visible, onClose, title, card, extra }: {
  visible: boolean; onClose: () => void; title: string;
  card: (theme: CardTheme) => React.ReactNode;
  /** Rows above the exports (S-04: Post to Friends). */
  extra?: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  const [theme, setTheme] = useState<CardTheme>('dark');
  const [busy, setBusy] = useState<null | 'more' | 'save'>(null);
  const run = async (id: 'more' | 'save') => {
    if (!ref.current) return;
    setBusy(id);
    try {
      const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
      const r = await runTarget(id, { uri } as any);
      const msg = resultMessage(id, r);
      if (r === 'ok') haptics.success();
      if (msg && id === 'save') Alert.alert(msg.title, msg.body);
    } catch { Alert.alert('Couldn’t make the image', 'Try again.'); }
    setBusy(null);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View ref={ref} collapsable={false} style={[styles.card, { backgroundColor: CARD_INK[theme].bg, borderColor: CARD_INK[theme].line }]}>
        {card(theme)}
      </View>
      <View style={styles.toggle}>
        {(['dark', 'light'] as const).map((t) => (
          <Pressable key={t} onPress={() => { haptics.select(); setTheme(t); }} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: theme === t }}>
            <Text style={[styles.toggleText, theme === t && styles.toggleOn]}>{t === 'dark' ? 'Dark' : 'Light'}</Text>
          </Pressable>
        ))}
      </View>
      {extra}
      <View style={styles.actions}>
        <TextAction primary onPress={() => void run('more')} loading={busy === 'more'}>Share</TextAction>
        <TextAction muted arrow={false} size={15} onPress={() => void run('save')} loading={busy === 'save'}>Save image</TextAction>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 22, minHeight: 220, justifyContent: 'space-between' },
  toggle: { flexDirection: 'row', gap: 20, marginTop: 14 },
  toggleText: { fontFamily: v2.font.medium, fontSize: 14, color: v2.color.muted, paddingBottom: 3 },
  toggleOn: { color: v2.color.ink, borderBottomWidth: 1.5, borderBottomColor: v2.color.ink },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 20 },
});

/** The card's frame: eyebrow, the number, its line, then date and the wordmark. */
export function CardBody({ theme, eyebrow, value, line, date }: { theme: CardTheme; eyebrow: string; value: string; line: string; date: string }) {
  const c = CARD_INK[theme];
  return (
    <>
      <View>
        <Text style={[T.eyebrow, { color: c.muted }]}>{eyebrow}</Text>
        <Text style={{ fontFamily: v2.font.bold, fontSize: 56, lineHeight: 60, letterSpacing: -2, color: c.ink, marginTop: 18, fontVariant: ['tabular-nums'] }}>{value}</Text>
        <Text style={[T.caption, { color: c.muted, marginTop: 6 }]}>{line}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 }}>
        <Text style={[T.caption, { color: c.muted }]}>{date}</Text>
        <Text style={[T.captionStrong, { color: c.ink }]}>Axiom</Text>
      </View>
    </>
  );
}
