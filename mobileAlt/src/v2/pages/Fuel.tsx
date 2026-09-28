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
import { useMeals, useNpDay, useNpWeek, useInvalidate } from '../data';
import { useQuery } from '@tanstack/react-query';
import { nutritionApi } from '../../lib/api';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import { haptics } from '../haptics';
import type { ReceiptVerb } from '@axiom/agent-ui-core';

const TARGET_DEFAULT = { calories: 2400, proteinG: 150, carbsG: 260, fatG: 80 };

export function FuelPage() {
  const router = useRouter();
  const meals = useMeals();
  const np = useNpDay();
  const week = useNpWeek();
  const invalidate = useInvalidate();
  // "The usual": what was logged at this meal a week ago today, for one-tap logging.
  const usual = useQuery({ queryKey: ['v2', 'usual', new Date().getDay()], staleTime: 10 * 60_000, queryFn: async () => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    const r: any = await nutritionApi.getMeals(d.toISOString().slice(0, 10)).catch(() => null);
    const list: any[] = r?.meals ?? r?.entries ?? (Array.isArray(r) ? r : []);
    return list.find((m) => String(m.mealType ?? '').toLowerCase() === guessMealType()) ?? list[0] ?? null;
  } });
  const [dock, setDock] = useState<'idle' | 'typing' | 'busy'>('idle');
  const [text, setText] = useState('');
  const [log, setLog] = useState<{ verb: ReceiptVerb; text: string }[]>([]);

  const rows: any[] = meals.data?.meals ?? meals.data?.entries ?? (Array.isArray(meals.data) ? meals.data : []);
  const targets = meals.data?.targets ?? meals.data?.plan ?? TARGET_DEFAULT;
  const tot = (k: string) => rows.reduce((s, m) => s + (Number(m[k]) || 0), 0);
  const kcal = tot('calories'), p = tot('proteinG'), c = tot('carbsG'), f = tot('fatG');
  const systems: any[] = (np.data?.systems?.length ? np.data.systems : week.data?.systems) ?? [];
  const npWin: any = np.data?.systems?.length ? np.data : week.data;
  const worst = [...systems].sort((a, b) => a.score - b.score)[0];
  const read = np.data?.headline || (rows.length === 0
    ? 'Nothing logged yet today. Snap your first plate and I\'ll do the math.'
    : p >= (targets.proteinG ?? 134)
      ? `Protein's covered — ${Math.round(p)} g against ${targets.proteinG}. ${worst ? `${worst.name} is the system to watch.` : ''}`
      : `${Math.round((targets.proteinG ?? 134) - p)} g of protein still to go. ${worst ? `${worst.name} is below band.` : ''}`);

  const logUsual = async () => {
    const u = usual.data; if (!u) return;
    setDock('busy'); setLog([{ verb: 'Read', text: `Last ${new Date().toLocaleDateString('en-US', { weekday: 'long' })} — ${u.name ?? 'meal'}` }]);
    try {
      await nutritionApi.logMeal({ name: u.name ?? u.description ?? 'The usual', description: u.description, mealType: guessMealType(), calories: Math.round(u.calories ?? 0), proteinG: Math.round(u.proteinG ?? 0), carbsG: Math.round(u.carbsG ?? 0), fatG: Math.round(u.fatG ?? 0), source: 'usual' } as any);
      setLog((l) => [...l, { verb: 'Logged', text: `${u.name ?? 'The usual'} — ${Math.round(u.calories ?? 0)} kcal` }]);
      haptics.success(); await invalidate.afterMeal();
      setTimeout(() => { setDock('idle'); setLog([]); }, 1200);
    } catch (e: any) { setLog((l) => [...l, { verb: 'Noted', text: e?.message ?? 'Couldn\'t log that.' }]); setTimeout(() => setDock('idle'), 1200); }
  };
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
      <TabPage refreshing={meals.isFetching || np.isFetching} onRefresh={() => { void meals.refetch(); void np.refetch(); void week.refetch(); }}>
        <Enter index={1} exit={false}>
          <View style={[styles.ringRow, { marginTop: 4 }]}>
            <Ring kcal={kcal} target={targets.calories ?? 2400} macros={[{ key: 'protein', grams: p }, { key: 'carbs', grams: c }, { key: 'fat', grams: f }]}>
              <Text style={[T.hero, { fontSize: 30, lineHeight: 34, letterSpacing: -1 }]}>{Math.round(kcal).toLocaleString()}</Text>
              <Text style={T.caption}>of {Number(targets.calories ?? 2400).toLocaleString()}</Text>
            </Ring>
            <View style={styles.macroCol}>
              {[['Protein', p, targets.proteinG, v2.color.macro.protein], ['Carbs', c, targets.carbsG, v2.color.macro.carbs], ['Fat', f, targets.fatG, v2.color.macro.fat]].map(([k, now, tgt, hue]) => (
                <View key={String(k)} style={styles.macroLine}>
                  <Text style={T.caption}>{k}</Text>
                  <Text style={[T.rowStrong, T.num, { color: Number(now) > 0 ? String(hue) : v2.color.placeholder, textAlign: 'right' }]}>{Math.round(Number(now))}<Text style={[T.caption, { color: v2.color.placeholder }]}> of {tgt ?? '—'} g</Text></Text>
                </View>
              ))}
            </View>
          </View>
        </Enter>
        <View style={{ marginTop: 22 }}><AnakinRead text={read} working={dock === 'busy'} /></View>

        {systems.length ? (
          <View style={{ marginTop: 30 }}>
            <Row name="Body systems" sub={worst ? `${worst.name} ${worst.score} — the lowest · 7-day` : 'Five systems, 7-day average'} value={npWin?.profileScore != null ? String(npWin.profileScore) : undefined} bigValue onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'systems' } } as any)} />
            <Row name="Gaps" sub="Only what's under 100%" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'micros' } } as any)} last />
          </View>
        ) : null}

        <View style={{ marginTop: 30 }}>
          <Eyebrow>Today</Eyebrow>
          <View style={{ marginTop: 10 }}>
            {usual.data ? <Row name={`The usual — ${usual.data.name ?? usual.data.description ?? 'last week\'s meal'}`} sub="One tap, same as a week ago" value={`${Math.round(usual.data.calories ?? 0)}`} onPress={() => void logUsual()} /> : null}
            {rows.length === 0 && !meals.isLoading && !usual.data ? <Text style={T.bodyMuted}>No meals yet.</Text> : null}
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

      {/* Dock — three equal columns above the tab bar. Snap / Scan / Describe all open the capture surface. */}
      <View style={styles.dock} pointerEvents="box-none">
        <View style={styles.dockRow}>
          {([['Snap', 'photo'], ['Scan', 'barcode'], ['Describe', 'describe']] as const).map(([label, mode]) => (
            <Pressable key={label} onPress={() => { haptics.select(); router.push({ pathname: '/(v2)/capture', params: { mode } } as any); }} style={styles.dockItem} hitSlop={8} accessibilityRole="button">
              <Text style={[T.rowStrong, { fontSize: 15 }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
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
  dockRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: v2.color.hairline, backgroundColor: v2.color.white },
  dockItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  describe: { flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: v2.color.ink, paddingTop: 12, backgroundColor: v2.color.white },
  input: { flex: 1, ...T.body, fontSize: 17, padding: 0 },
});
