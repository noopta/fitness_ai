// Fuel (index 2): the calorie ring with macro-hue segments, Anakin's read,
// the nutrition Plan row, body systems and gaps rows, today's meals, and the
// dock — Snap · Scan · Search · Describe. Every log streams receipts and
// updates the ring.
//
// Search (bug fixes 5 Oct, 4a) is where the other ways to log now live:
// your foods and recipes, Enter macros manually, Voice and Order · receipt.

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Pressable } from '../primitives/Pressable';
import { useRouter } from 'expo-router';
import { v2, T } from '../theme';
import { TabPage, PageTitle, AnakinRead } from '../shell/Page';
import { Row, Eyebrow } from '../primitives/Row';
import { Enter } from '../primitives/Enter';
import { TextAction } from '../primitives/TextAction';
import { ReceiptList } from '../primitives/Receipt';
import { describeWithLookup, liveStep } from '../food/lookup';
import { Ring } from '../charts';
import { useMeals, useNpDay, useNpWeek, useNutritionPlan, useInvalidate, useDayTargets, useRecipes, useSavedFoods } from '../data';
import { targetLines, dayTotals, momentFor, lookupReceipt, mealSources, type MealSource } from '@axiom/agent-ui-core';
import { SourceLinks } from '../food/SourceLinks';
import { ShareCardSheet, CardBody } from '../share/ShareCardSheet';
import { useShell } from '../shell/ShellContext';
import { useRequirePro } from '../shell/proGate';
import { focusList } from './pushed/nutritionPlan';
import { useQuery } from '@tanstack/react-query';
import { nutritionApi } from '../../lib/api';
import { todayStr } from '../../lib/localDate';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import { haptics } from '../haptics';
import type { ReceiptVerb } from '@axiom/agent-ui-core';


export function FuelPage() {
  const router = useRouter();
  const requirePro = useRequirePro();
  const meals = useMeals();
  const np = useNpDay();
  const week = useNpWeek();
  const plan = useNutritionPlan();
  const shell = useShell();
  const invalidate = useInvalidate();
  // "The usual": what was logged at this meal a week ago today, for one-tap logging.
  const usual = useQuery({ queryKey: ['v2', 'usual', new Date().getDay()], staleTime: 10 * 60_000, queryFn: async () => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    const r: any = await nutritionApi.getMeals(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).catch(() => null);
    const list: any[] = r?.meals ?? r?.entries ?? (Array.isArray(r) ? r : []);
    return list.find((m) => String(m.mealType ?? '').toLowerCase() === guessMealType()) ?? list[0] ?? null;
  } });
  const [dock, setDock] = useState<'idle' | 'typing' | 'busy'>('idle');
  const [text, setText] = useState('');
  const [log, setLog] = useState<{ verb: ReceiptVerb; text: string }[]>([]);
  const [sources, setSources] = useState<MealSource[]>([]);
  // Plan row: open the plan, or — with none yet — start the gut check-in (NTP-04) in chat.
  const openPlan = () => {
    haptics.select();
    if (plan.data) router.push({ pathname: '/(v2)/p/[key]', params: { key: 'fuelplan' } } as any);
    else shell.ask('Start my gut and nutrition questions.');
  };

  const rows: any[] = meals.data?.meals ?? meals.data?.entries ?? (Array.isArray(meals.data) ? meals.data : []);
  // Real targets or none (N-08) — never an invented 2,400. A workout's burn is its own line (N-07).
  const dt = useDayTargets();
  const recipes = useRecipes();
  const saved = useSavedFoods();
  const tg = dt.data?.targets ?? null;
  const noTarget = !!dt.data && !tg;
  const lines = targetLines(tg, dt.data?.burn ?? null);
  const totals = dayTotals(rows);
  const kcal = totals.kcal, p = totals.proteinG, c = totals.carbsG, f = totals.fatG, fi = totals.fiberG;
  const moment = momentFor(totals, tg, todayStr());
  const [sharing, setSharing] = useState(false);
  const systems: any[] = (np.data?.systems?.length ? np.data.systems : week.data?.systems) ?? [];
  const npWin: any = np.data?.systems?.length ? np.data : week.data;
  const worst = [...systems].sort((a, b) => a.score - b.score)[0];
  const read = noTarget
    ? 'Eat as usual. I’ll set a target once I know you.'
    : np.data?.headline || (rows.length === 0
      ? 'Nothing logged yet today. Snap your first plate and I\'ll do the math.'
      : tg?.proteinG && p >= tg.proteinG
        ? `Protein's covered — ${Math.round(p)} g against ${tg.proteinG}. ${worst ? `${worst.name} is the system to watch.` : ''}`
        : tg?.proteinG
          ? `${Math.round(tg.proteinG - p)} g of protein still to go. ${worst ? `${worst.name} is below band.` : ''}`
          : `${Math.round(kcal)} kcal so far today. ${worst ? `${worst.name} is the system to watch.` : ''}`);
  const openNutrition = () => { haptics.select(); router.push({ pathname: '/(v2)/p/[key]', params: { key: 'nutrition' } } as any); };
  const macroRows: [string, number, number | null | undefined, string][] = [['Protein', p, tg?.proteinG, v2.color.macro.protein], ['Carbs', c, tg?.carbsG, v2.color.macro.carbs], ['Fat', f, tg?.fatG, v2.color.macro.fat], ['Fiber', fi, tg?.fiberG, v2.color.macro.fiber]];

  const logUsual = async () => {
    const u = usual.data; if (!u) return;
    if (requirePro() === false) return;
    setDock('busy'); setLog([{ verb: 'Read', text: `Last ${new Date().toLocaleDateString('en-US', { weekday: 'long' })} — ${u.name ?? 'meal'}` }]);
    try {
      await nutritionApi.logMeal({ date: todayStr(), name: u.name ?? u.description ?? 'The usual', description: u.description, mealType: guessMealType(), calories: Math.round(u.calories ?? 0), proteinG: Math.round(u.proteinG ?? 0), carbsG: Math.round(u.carbsG ?? 0), fatG: Math.round(u.fatG ?? 0), source: 'usual' } as any);
      setLog((l) => [...l, { verb: 'Logged', text: `${u.name ?? 'The usual'} — ${Math.round(u.calories ?? 0)} kcal` }]);
      haptics.success(); await invalidate.afterMeal();
      setTimeout(() => { setDock('idle'); setLog([]); }, 1200);
    } catch (e: any) { setLog((l) => [...l, { verb: 'Noted', text: e?.message ?? 'Couldn\'t log that.' }]); setTimeout(() => setDock('idle'), 1200); }
  };
  const describe = async () => {
    const t = text.trim(); if (!t) return;
    setDock('busy'); setLog([{ verb: 'Read', text: `“${t}”` }]);
    try {
      const read = { verb: 'Read' as const, text: `“${t}”` };
      const slow = setTimeout(() => setLog([read, { verb: 'Reading', text: 'Estimating' }]), 1500);
      // Branded items get looked up (your scans, food databases, the web when it's worth it).
      // Each check shows as it runs, and nothing is logged until they're done.
      const parsed: any = await describeWithLookup(t, ({ estimate, steps, pending }) => {
        clearTimeout(slow);
        const e = estimate?.meal ?? estimate;
        setLog([read, { verb: 'Computed', text: `Estimate ${Math.round(e?.calories ?? 0)} kcal${pending ? ' — checking before logging' : ''}` }, ...steps]);
      }).finally(() => clearTimeout(slow));
      const item = parsed?.meal ?? parsed?.items?.[0] ?? parsed;
      const rc = lookupReceipt(parsed, item?.name ?? null);
      // With a lookup, its steps already say where each number came from.
      setLog((l) => (parsed?.lookups?.length ? l.filter((x) => x.verb !== 'Reading') : [read, { verb: rc.verb, text: rc.text }]));
      const body = { date: todayStr(), name: item?.name ?? t, description: t, mealType: guessMealType(), calories: Math.round(item?.calories ?? parsed?.calories ?? 0), proteinG: Math.round(item?.proteinG ?? parsed?.proteinG ?? 0), carbsG: Math.round(item?.carbsG ?? parsed?.carbsG ?? 0), fatG: Math.round(item?.fatG ?? parsed?.fatG ?? 0), source: 'describe', ...(rc.found && parsed?.notes ? { notes: String(parsed.notes).slice(0, 480) } : {}) };
      await nutritionApi.logMeal(body as any);
      setLog((l) => [...l, { verb: 'Logged', text: `${body.name} — ${body.calories} kcal · ${body.proteinG} P · ${body.carbsG} C · ${body.fatG} F` }]);
      haptics.success();
      await invalidate.afterMeal();
      setText('');
      const src = mealSources(parsed);
      setSources(src);
      setTimeout(() => { setDock('idle'); setLog([]); setSources([]); }, src.length ? 4500 : 1400);
    } catch (e: any) {
      setLog((l) => [...l, { verb: 'Noted', text: e?.message ?? 'Couldn\'t log that — try again.' }]);
      setTimeout(() => setDock('typing'), 1200);
    }
  };

  return (
    <KeyboardAvoider style={{ flex: 1 }}>
      <TabPage refreshing={meals.isFetching || np.isFetching} onRefresh={() => { void meals.refetch(); void np.refetch(); void week.refetch(); void dt.refetch(); }}>
        {/* N-10: a goal hit shows once a day as a line at the top; tap to share it. */}
        {moment ? (
          <Pressable onPress={() => { haptics.select(); setSharing(true); }} accessibilityRole="button" accessibilityLabel={`${moment.line}. Share`} style={styles.moment}>
            <Text style={[T.captionStrong, { color: v2.color.ink, flex: 1 }]} numberOfLines={1}>Fuel · {moment.line}</Text>
            <Text style={[T.captionStrong, { color: v2.color.crimson }]}>Share →</Text>
          </Pressable>
        ) : null}
        {noTarget ? (
          <Enter index={1} exit={false}>
            {/* N-08: no target yet — what was eaten, without a goal, and two ways to get one. */}
            <Text style={[T.eyebrow, { marginTop: 4 }]}>No target yet</Text>
            <Pressable onPress={openNutrition} accessibilityRole="button" accessibilityLabel={`${Math.round(kcal)} kcal today. Open your nutrition`}>
              <View style={styles.heroRow}>
                <Text style={[T.hero, { fontSize: 44, lineHeight: 48 }]}>{Math.round(kcal).toLocaleString()}</Text>
                <Text style={[T.body, { color: v2.color.muted, marginLeft: 8 }]}>kcal today</Text>
              </View>
            </Pressable>
            <View style={styles.flatMacros}>
              {macroRows.map(([k, now, , hue]) => (
                <View key={k} style={{ flex: 1 }}>
                  <Text style={[T.rowStrong, T.num, { color: now > 0 ? hue : v2.color.placeholder }]}>{Math.round(now)}</Text>
                  <Text style={T.caption}>{k.toLowerCase()}</Text>
                </View>
              ))}
            </View>
            <Text style={[T.caption, { marginTop: 14 }]}>Log 3 days, or answer 4 questions now. Until then I show what you ate, not a made-up goal.</Text>
            <View style={styles.noTargetActions}>
              <TextAction primary size={15} onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'targets' } } as any)}>Set my target</TextAction>
              <TextAction muted arrow={false} size={15} onPress={() => router.push('/(v2)/food-search' as any)}>Log food</TextAction>
            </View>
          </Enter>
        ) : (
        <Enter index={1} exit={false}>
          <Pressable onPress={openNutrition} accessibilityRole="button" accessibilityLabel="Open your nutrition — today, 7 days, 30 days">
          <View style={[styles.ringRow, { marginTop: 4 }]}>
            <Ring kcal={kcal} target={lines?.today ?? Math.max(kcal, 1)} macros={[{ key: 'protein', grams: p }, { key: 'carbs', grams: c }, { key: 'fat', grams: f }]}>
              <Text style={[T.hero, { fontSize: 30, lineHeight: 34, letterSpacing: -1 }]}>{Math.round(kcal).toLocaleString()}</Text>
              <Text style={T.caption}>{lines ? `of ${lines.today.toLocaleString()}` : 'kcal'}</Text>
            </Ring>
            <View style={styles.macroCol}>
              {macroRows.map(([k, now, tgt, hue]) => (
                <View key={k} style={styles.macroLine}>
                  <Text style={T.caption}>{k}</Text>
                  <Text style={[T.rowStrong, T.num, { color: now > 0 ? hue : v2.color.placeholder, textAlign: 'right' }]}>{Math.round(now)}<Text style={[T.caption, { color: v2.color.placeholder }]}> of {tgt ?? '—'} g</Text></Text>
                </View>
              ))}
            </View>
          </View>
          </Pressable>
          {/* N-07: the workout's burn as its own line, so the bigger number explains itself. */}
          {lines && lines.burn ? (
            <View style={{ marginTop: 18 }}>
              <Eyebrow>Today's target</Eyebrow>
              <View style={{ marginTop: 4 }}>
                <Row name="Base" value={lines.base.toLocaleString()} />
                <Row name={lines.burnLabel ?? 'Workout'} value={`+ ${lines.burn.toLocaleString()}`} />
                <Row name="Today" value={`${lines.today.toLocaleString()} kcal`} last valueStyle={{ fontFamily: v2.font.semibold, color: v2.color.ink }} />
              </View>
            </View>
          ) : null}
        </Enter>
        )}
        <View style={{ marginTop: 22 }}><AnakinRead text={read} working={dock === 'busy'} /></View>

        <View style={{ marginTop: 30 }}>
          {plan.isLoading ? null : <PlanRow plan={plan.data ?? null} onPress={openPlan} />}
          {/* Change calories and macros here, not only in chat (feedback 8 Oct). */}
          {tg ? <Row name="Targets" sub={`${tg.calories.toLocaleString()} kcal${tg.proteinG ? ` · ${tg.proteinG} g protein` : ''}`} arrow onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'targets' } } as any)} /> : null}
        </View>

        {systems.length ? (
          <View>
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
            {/* N-06: recipes and saved foods, off chat. */}
            <Row name="Library" sub={`Recipes · ${recipes.data?.recipes?.length ?? 0} · Saved foods · ${saved.data?.foods?.length ?? 0}`} arrow last
              onPress={() => { haptics.select(); router.push({ pathname: '/(v2)/p/[key]', params: { key: 'library' } } as any); }} />
          </View>
        </View>

        {dock === 'busy' && log.length ? (
          <View style={{ marginTop: 26 }}>
            <ReceiptList items={log} liveIndex={liveStep(log) >= 0 ? liveStep(log) : log.length - 1} />
            <SourceLinks sources={sources} style={{ marginTop: 10 }} />
          </View>
        ) : null}
        <ShareCardSheet visible={sharing && !!moment} onClose={() => setSharing(false)} title="Share today"
          card={(theme) => moment ? <CardBody theme={theme} eyebrow={moment.eyebrow} value={moment.value} line={`${moment.of} · ${Math.round(kcal).toLocaleString()} kcal`} date={new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} /> : null} />
      </TabPage>

      {/* Dock — four equal columns above the tab bar. Snap / Scan / Describe open the capture surface; Search is the food search page. */}
      <View style={styles.dock} pointerEvents="box-none">
        <View style={styles.dockRow}>
          {DOCK.map(([label, mode]) => (
            <Pressable key={label} onPress={() => { haptics.select(); router.push(mode === 'search' ? '/(v2)/food-search' as any : { pathname: '/(v2)/capture', params: { mode } } as any); }} style={styles.dockItem} hitSlop={8} accessibilityRole="button">
              <Text style={[T.rowStrong, { fontSize: 15 }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </KeyboardAvoider>
  );
}

const DOCK = [['Snap', 'photo'], ['Scan', 'barcode'], ['Search', 'search'], ['Describe', 'describe']] as const;

/** Plan row (2a): "Plan" 17/600, "Gut + iron, vitamin D · week 2", and "4/6" (focus nutrients on track) + →. */
function PlanRow({ plan, onPress }: { plan: import('../api').NutritionPlanSummary | null; onPress: () => void }) {
  const caption = plan
    ? `Gut + ${focusList(plan.focus.slice(0, 2).map((f) => f.nutrient)).replace(/^./, (c) => c.toLowerCase())} · week ${plan.week}`
    : 'Build one from your gut check-in';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      accessibilityLabel={plan ? `Plan. ${caption}. ${plan.onTrack} of ${plan.total} targets on track.` : `Plan. ${caption}.`}>
      <View style={styles.planRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.planTitle}>Plan</Text>
          <Text style={[T.caption, { marginTop: 3 }]} numberOfLines={1}>{caption}</Text>
        </View>
        {plan ? <Text style={styles.planValue}>{plan.onTrack}/{plan.total}</Text> : null}
        <Text style={[T.row, { color: v2.color.placeholder }]}>→</Text>
      </View>
    </Pressable>
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
  moment: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: v2.color.hairline },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 10 },
  flatMacros: { flexDirection: 'row', gap: 12, marginTop: 18 },
  noTargetActions: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 18 },
  macroCol: { flex: 1, gap: 10 },
  macroLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  dock: { position: 'absolute', left: 0, right: 0, bottom: v2.space.tabBarClearance - 8, paddingHorizontal: v2.space.gutter },
  dockRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: v2.color.hairline, backgroundColor: v2.color.white },
  dockItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: v2.space.rowH, paddingVertical: v2.space.rowY, borderTopWidth: 1, borderTopColor: v2.color.hairline },
  planTitle: { fontFamily: v2.font.semibold, fontSize: 17, lineHeight: 22, color: v2.color.ink },
  planValue: { fontFamily: v2.font.bold, fontSize: 22, lineHeight: 26, letterSpacing: -0.4, color: v2.color.ink, fontVariant: ['tabular-nums'] },
  describe: { flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: v2.color.ink, paddingTop: 12, backgroundColor: v2.color.white },
  input: { flex: 1, ...T.body, fontSize: 17, padding: 0 },
});
