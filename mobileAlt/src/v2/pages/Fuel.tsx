// Fuel (index 2): the calorie ring with macro-hue segments, Anakin's read,
// body systems and gaps rows, today's meals, and the dock — Snap · Scan ·
// Describe. Every log streams receipts and updates the ring.

import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { v2, T } from '../theme';
import { TabPage, PageTitle, AnakinRead } from '../shell/Page';
import { Row, Eyebrow } from '../primitives/Row';
import { Enter } from '../primitives/Enter';
import { TextAction } from '../primitives/TextAction';
import { ReceiptList } from '../primitives/Receipt';
import { Ring } from '../charts';
import { useMeals, useNpDay, useInvalidate } from '../data';
import { nutritionApi } from '../../lib/api';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import { haptics } from '../haptics';
import type { ReceiptVerb } from '@axiom/agent-ui-core';

const TARGET_DEFAULT = { calories: 2400, proteinG: 150, carbsG: 260, fatG: 80 };

export function FuelPage() {
  const router = useRouter();
  const meals = useMeals();
  const np = useNpDay();
  const invalidate = useInvalidate();
  const [dock, setDock] = useState<'idle' | 'typing' | 'busy'>('idle');
  const [text, setText] = useState('');
  const [log, setLog] = useState<{ verb: ReceiptVerb; text: string }[]>([]);

  const rows: any[] = meals.data?.meals ?? meals.data?.entries ?? (Array.isArray(meals.data) ? meals.data : []);
  const targets = meals.data?.targets ?? meals.data?.plan ?? TARGET_DEFAULT;
  const tot = (k: string) => rows.reduce((s, m) => s + (Number(m[k]) || 0), 0);
  const kcal = tot('calories'), p = tot('proteinG'), c = tot('carbsG'), f = tot('fatG');
  const systems: any[] = np.data?.systems ?? [];
  const worst = [...systems].sort((a, b) => a.score - b.score)[0];
  const read = np.data?.headline || (rows.length === 0
    ? 'Nothing logged yet today. Snap your first plate and I\'ll do the math.'
    : p >= (targets.proteinG ?? 134)
      ? `Protein's covered — ${Math.round(p)} g against ${targets.proteinG}. ${worst ? `${worst.name} is the system to watch.` : ''}`
      : `${Math.round((targets.proteinG ?? 134) - p)} g of protein still to go. ${worst ? `${worst.name} is below band.` : ''}`);

  const describe = async () => {
    const t = text.trim(); if (!t) return;
    setDock('busy'); setLog([{ verb: 'Read', text: `“${t}”` }]);
    try {
      const parsed: any = await nutritionApi.parseMeal(t);
      const item = parsed?.meal ?? parsed?.items?.[0] ?? parsed;
      setLog((l) => [...l, { verb: 'Searched', text: item?.name ? `${item.name} — matched` : 'Matched' }]);
      const body = { name: item?.name ?? t, description: t, mealType: guessMealType(), calories: Math.round(item?.calories ?? parsed?.calories ?? 0), proteinG: Math.round(item?.proteinG ?? parsed?.proteinG ?? 0), carbsG: Math.round(item?.carbsG ?? parsed?.carbsG ?? 0), fatG: Math.round(item?.fatG ?? parsed?.fatG ?? 0), source: 'describe' };
      await nutritionApi.logMeal(body as any);
      setLog((l) => [...l, { verb: 'Logged', text: `${body.name} — ${body.calories} kcal · ${body.proteinG} P · ${body.carbsG} C · ${body.fatG} F` }]);
      haptics.success();
      await invalidate.afterMeal();
      setText('');
      setTimeout(() => { setDock('idle'); setLog([]); }, 1400);
    } catch (e: any) {
      setLog((l) => [...l, { verb: 'Noted', text: e?.message ?? 'Couldn\'t log that — try again.' }]);
      setTimeout(() => setDock('typing'), 1200);
    }
  };

  return (
    <KeyboardAvoider style={{ flex: 1 }}>
      <TabPage refreshing={meals.isFetching || np.isFetching} onRefresh={() => { void meals.refetch(); void np.refetch(); }}>
        <PageTitle title="Fuel" caption={np.data?.profileScore != null ? `Profile ${np.data.profileScore} · coverage ${np.data.microCoveragePct ?? '—'}%` : 'Today'} />
        <Enter index={1} exit={false}>
          <View style={styles.ringRow}>
            <Ring kcal={kcal} target={targets.calories ?? 2400} macros={[{ key: 'protein', grams: p }, { key: 'carbs', grams: c }, { key: 'fat', grams: f }]}>
              <Text style={[T.hero, { fontSize: 30, lineHeight: 34, letterSpacing: -1 }]}>{Math.round(kcal).toLocaleString()}</Text>
              <Text style={T.caption}>of {Number(targets.calories ?? 2400).toLocaleString()}</Text>
            </Ring>
            <View style={styles.macroCol}>
              {[['Protein', p, targets.proteinG, v2.color.macro.protein], ['Carbs', c, targets.carbsG, v2.color.macro.carbs], ['Fat', f, targets.fatG, v2.color.macro.fat]].map(([k, now, tgt, hue]) => (
                <View key={String(k)} style={styles.macroLine}>
                  <Text style={T.caption}>{k}</Text>
                  <Text style={[T.rowStrong, T.num, { color: String(hue) }]}>{Math.round(Number(now))}<Text style={[T.caption, { color: v2.color.placeholder }]}> / {tgt ?? '—'} g</Text></Text>
                </View>
              ))}
            </View>
          </View>
        </Enter>
        <View style={{ marginTop: 22 }}><AnakinRead text={read} working={dock === 'busy'} /></View>

        {systems.length ? (
          <View style={{ marginTop: 30 }}>
            <Row name="Body systems" sub={worst ? `${worst.name} ${worst.score} — the lowest` : 'Five systems, scored from today\'s food'} value={np.data?.profileScore != null ? String(np.data.profileScore) : undefined} bigValue onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'systems' } } as any)} />
            <Row name="Gaps" sub="Only what's under 100%" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'micros' } } as any)} last />
          </View>
        ) : null}

        <View style={{ marginTop: 30 }}>
          <Eyebrow>Today</Eyebrow>
          <View style={{ marginTop: 10 }}>
            {rows.length === 0 && !meals.isLoading ? <Text style={T.bodyMuted}>No meals yet.</Text> : null}
            {rows.map((m, i) => (
              <Enter key={m.id ?? i} index={i + 2} exit={false}>
                <Row name={m.name || m.description || 'Meal'} sub={[timeOf(m), viaOf(m)].filter(Boolean).join(' · ')} value={`${Math.round(m.calories ?? 0)}`} last={i === rows.length - 1}
                  onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `meal:${m.id}` } } as any)} />
              </Enter>
            ))}
          </View>
        </View>

        {dock === 'busy' && log.length ? (
          <View style={{ marginTop: 26 }}><ReceiptList items={log} liveIndex={log.length - 1} /></View>
        ) : null}
      </TabPage>

      {/* Dock — sits above the tab bar clearance. */}
      <View style={styles.dock} pointerEvents="box-none">
        {dock === 'typing' ? (
          <View style={styles.describe}>
            <TextInput value={text} onChangeText={setText} placeholder="What did you eat?" placeholderTextColor={v2.color.placeholder} style={styles.input} autoFocus returnKeyType="send" onSubmitEditing={() => void describe()} cursorColor={v2.color.crimson} />
            <Pressable onPress={() => void describe()} hitSlop={8}><Text style={[T.rowStrong, { color: text.trim() ? v2.color.crimson : v2.color.placeholder }]}>↑</Text></Pressable>
            <Pressable onPress={() => { setDock('idle'); setText(''); }} hitSlop={8}><Text style={[T.body, { color: v2.color.muted }]}>Cancel</Text></Pressable>
          </View>
        ) : dock === 'idle' ? (
          <View style={styles.dockRow}>
            <TextAction arrow={false} size={15} onPress={() => router.push({ pathname: '/(v2)/capture', params: { mode: 'photo' } } as any)}>Snap</TextAction>
            <TextAction arrow={false} size={15} onPress={() => router.push({ pathname: '/(v2)/capture', params: { mode: 'barcode' } } as any)}>Scan</TextAction>
            <TextAction arrow={false} size={15} onPress={() => setDock('typing')}>Describe</TextAction>
          </View>
        ) : null}
      </View>
    </KeyboardAvoider>
  );
}

function timeOf(m: any): string {
  const iso = m.loggedAt ?? m.createdAt ?? m.time;
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function viaOf(m: any): string {
  const s = String(m.source ?? m.via ?? '').toLowerCase();
  if (/photo|snap|image/.test(s)) return 'photo';
  if (/barcode|scan/.test(s)) return 'barcode';
  if (/voice|describe|text|parse/.test(s)) return 'describe';
  if (/manual/.test(s)) return 'manual';
  return s;
}
function guessMealType(): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

const styles = StyleSheet.create({
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 22 },
  macroCol: { flex: 1, gap: 10 },
  macroLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  dock: { position: 'absolute', left: 0, right: 0, bottom: v2.space.tabBarClearance - 8, paddingHorizontal: v2.space.gutter },
  dockRow: { flexDirection: 'row', gap: 28, alignItems: 'center', borderTopWidth: 1, borderTopColor: v2.color.hairline, paddingTop: 12, backgroundColor: v2.color.white },
  describe: { flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: v2.color.ink, paddingTop: 12, backgroundColor: v2.color.white },
  input: { flex: 1, ...T.body, fontSize: 17, padding: 0 },
});
