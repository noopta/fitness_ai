// Nutrition pages outside chat (handoff Wave 3).
//
// Set my target (N-08): four questions, then real targets from the same
//   engine the coach uses. Until then Fuel shows what was eaten, no goal.
// Nutrition profile (N-09): Fuel → the ring. Today · 7 days · 30 days, a
//   trend for the range, the per-meal breakdown and coverage sorted by gap.
// Library (N-06): Recipes and Saved foods as a text toggle, not two pages.
//   A row (tap or long-press) offers Log, Edit (recipes) or Delete.
// Recipe builder (N-05): Library → New, or Save as recipe on a meal.
//   Ingredients are added the way food is logged (search or type); totals
//   per serving update live.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { perServing, ingredientFrom, rangeBars, type Ingredient } from '@axiom/agent-ui-core';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { Pressable } from '../../primitives/Pressable';
import { TextAction } from '../../primitives/TextAction';
import { Sheet, PromptSheet } from '../../primitives/Sheet';
import { WeekBars } from '../../charts';
import { LinkTabs } from '../feed/common';
import { useNutritionSummary, useRecipes, useSavedFoods, useMeals, useProgram, useInvalidate, qk } from '../../data';
import { useAuth } from '../../../context/AuthContext';
import { useUnits } from '../../../context/UnitsContext';
import { nutritionApi, nutritionProfileApi } from '../../../lib/api';
import { v2Api, type FoodResult } from '../../api';
import { todayStr } from '../../../lib/localDate';
import { haptics } from '../../haptics';

const C = v2.color;
const slotNow = (): 'breakfast' | 'lunch' | 'dinner' | 'snack' => { const h = new Date().getHours(); return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack'; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── N-08 Set my target ──────────────────────────────────────────────────────

type Goal = 'lose' | 'maintain' | 'gain' | 'strength';
const GOALS: { key: Goal; label: string; sub: string }[] = [
  { key: 'lose', label: 'Lose fat', sub: 'A steady deficit, protein high' },
  { key: 'maintain', label: 'Stay where I am', sub: 'Eat to maintain' },
  { key: 'gain', label: 'Build muscle', sub: 'A small surplus' },
  { key: 'strength', label: 'Get stronger', sub: 'Fuel the training' },
];

export function SetTargetsPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth() as any;
  const { unit, fromKg, toKg } = useUnits();
  const program = useProgram();
  const invalidate = useInvalidate();
  const age0 = user?.dateOfBirth ? Math.floor((Date.now() - new Date(user.dateOfBirth).getTime()) / (365.25 * 86_400_000)) : null;
  const [step, setStep] = useState(0);
  const [sex, setSex] = useState<'male' | 'female' | 'unknown' | null>(null);
  const [age, setAge] = useState(age0 ? String(age0) : '');
  const [height, setHeight] = useState(user?.heightCm ? String(Math.round(user.heightCm)) : '');
  const [weight, setWeight] = useState(user?.weightKg ? String(Math.round(fromKg(user.weightKg))) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = Number(program.data?.program?.daysPerWeek) || 3;
  const finish = async (goal: Goal) => {
    const a = Number(age), h = Number(height), w = Number(weight);
    if (!sex || !(a >= 13 && a <= 100) || !(h >= 120 && h <= 230) || !(w > 0)) { setError('Check your answers — something’s missing.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await v2Api.quickTargets({ sex, ageYears: Math.round(a), heightCm: h, weightKg: toKg(w), goal, trainingDaysPerWeek: days });
      await Promise.all([invalidate.afterMeal(), refreshUser?.()]);
      haptics.success();
      Alert.alert('Target set', `${r.targets.calories.toLocaleString()} kcal · ${r.targets.proteinG} g protein a day. Change it any time from Fuel.`);
      router.back();
    } catch (e: any) { setError(e?.message ?? 'Couldn’t set it — try again.'); }
    setBusy(false);
  };
  const next = () => { haptics.select(); setError(null); setStep((s) => s + 1); };
  const titles = ['Which body am I planning for?', 'How old are you?', 'Height and weight', 'What’s the goal?'];
  return (
    <PushedPage back="Fuel" meta={`${step + 1} of 4`} title={titles[step]} lead={step === 0 ? 'Four questions and I’ll set your calories and macros. Nothing is made up.' : null}>
      {step === 0 ? (
        <View>
          {([['male', 'Male'], ['female', 'Female'], ['unknown', 'Prefer not to say']] as const).map(([k, l], i) => (
            <Row key={k} name={l} value={sex === k ? '✓' : '→'} emphasis={sex === k} last={i === 2} onPress={() => { setSex(k); next(); }} />
          ))}
        </View>
      ) : step === 1 ? (
        <NumberField value={age} onChange={setAge} unit="years" onNext={next} />
      ) : step === 2 ? (
        <View>
          <NumberField value={height} onChange={setHeight} unit="cm" />
          <View style={{ height: 18 }} />
          <NumberField value={weight} onChange={setWeight} unit={unit === 'kg' ? 'kg' : 'lb'} onNext={next} />
        </View>
      ) : (
        <View>
          {GOALS.map((g, i) => <Row key={g.key} name={g.label} sub={g.sub} value={busy ? '…' : '→'} last={i === GOALS.length - 1} onPress={busy ? undefined : () => void finish(g.key)} />)}
          <Text style={[T.caption, { marginTop: 14 }]}>Planned around {days} training day{days === 1 ? '' : 's'} a week.</Text>
        </View>
      )}
      {error ? <Text style={[T.caption, { color: C.crimson, marginTop: 12 }]}>{error}</Text> : null}
      {step > 0 ? <TextAction muted arrow={false} size={15} style={{ marginTop: 24 }} onPress={() => setStep((s) => s - 1)}>← Back</TextAction> : null}
    </PushedPage>
  );
}

function NumberField({ value, onChange, unit, onNext }: { value: string; onChange: (v: string) => void; unit: string; onNext?: () => void }) {
  return (
    <View>
      <View style={styles.field}>
        <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.placeholder} style={styles.fieldInput} autoFocus={!value} accessibilityLabel={unit} />
        <Text style={[T.body, { color: C.muted }]}>{unit}</Text>
      </View>
      {onNext ? <TextAction primary style={{ marginTop: 20 }} onPress={onNext} disabled={!value.trim()}>Next</TextAction> : null}
    </View>
  );
}

// ─── N-09 Nutrition profile ──────────────────────────────────────────────────

const RANGES = [{ key: 'today' as const, label: 'Today' }, { key: '7d' as const, label: '7 days' }, { key: '30d' as const, label: '30 days' }];

export function NutritionProfilePage() {
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const date = todayStr();
  const summary = useNutritionSummary(range, date);
  const np = useQuery({ queryKey: ['v2', 'np', 'range', range, date], queryFn: () => nutritionProfileApi.getDay(date, range), staleTime: 60_000 });
  const s = summary.data;
  const bars = s ? rangeBars(s.days, range) : [];
  const kcal = range === 'today' ? s?.days[0]?.kcal ?? 0 : s?.avg?.kcal ?? 0;
  // Coverage: every tracked nutrient across the systems, worst first.
  const coverage = useMemo(() => {
    const seen = new Map<string, any>();
    for (const sys of (np.data?.systems ?? []) as any[]) for (const d of sys.drivers ?? []) if (d.tracked && !seen.has(d.key)) seen.set(d.key, d);
    return [...seen.values()].sort((a, b) => a.pct - b.pct).slice(0, 8);
  }, [np.data]);
  const meals = (s?.byMeal ?? []).filter((m) => m.avgKcal > 0);
  return (
    <PushedPage back="Fuel" title={range === 'today' ? 'Today' : `Last ${range === '7d' ? '7' : '30'} days`}
      hero={s ? { value: kcal.toLocaleString(), unit: range === 'today' ? 'kcal today' : 'kcal a day avg' } : null}
      lead={s && range !== 'today' ? (s.loggedDays ? `Averaged over the ${s.loggedDays} day${s.loggedDays === 1 ? '' : 's'} you logged.` : 'Nothing logged in this range.') : null}
      loading={summary.isLoading} error={summary.isError ? 'Couldn’t load your nutrition.' : null} onRetry={() => void summary.refetch()}
      visual={range !== 'today' && bars.length ? <WeekBars values={bars.map((b) => b.value)} max={Math.max(...bars.map((b) => b.value), 1)} labels={bars.map((b) => b.label)} todayIndex={bars.length - 1} /> : null}>
      <LinkTabs items={RANGES} value={range} onChange={(k) => { haptics.select(); setRange(k); }} style={{ marginBottom: 22 }} />
      {meals.length ? (
        <>
          <Eyebrow>By meal{range === 'today' ? '' : ' · daily average'}</Eyebrow>
          <View style={{ marginTop: 6 }}>
            {meals.map((m, i) => <Row key={m.mealType} name={cap(m.mealType === 'snack' ? 'snacks' : m.mealType)} sub={`${m.pct}%`} value={m.avgKcal.toLocaleString()} last={i === meals.length - 1} />)}
          </View>
        </>
      ) : null}
      {coverage.length ? (
        <>
          <Eyebrow style={{ marginTop: 26 }}>Coverage</Eyebrow>
          <View style={{ marginTop: 6 }}>
            {coverage.map((d, i) => <Row key={d.key} name={d.label} sub={`${d.pct}% of target`} value={`${Math.round(d.amount * 10) / 10} ${d.unit}`} emphasis={d.pct < 100} muted={d.pct >= 100} last={i === coverage.length - 1} />)}
          </View>
          <Text style={[T.caption, { marginTop: 12 }]}>Sorted by gap.</Text>
        </>
      ) : null}
    </PushedPage>
  );
}

// ─── N-06 Library ────────────────────────────────────────────────────────────

export function LibraryPage({ initial }: { initial?: string }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const recipes = useRecipes();
  const foods = useSavedFoods();
  const [tab, setTab] = useState<'recipes' | 'foods'>(initial === 'foods' ? 'foods' : 'recipes');
  const [picked, setPicked] = useState<{ kind: 'recipe' | 'food'; item: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const rl: any[] = recipes.data?.recipes ?? [];
  const fl: any[] = foods.data?.foods ?? [];
  const log = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      if (picked.kind === 'recipe') await nutritionApi.logRecipe(picked.item.id, { date: todayStr(), mealType: slotNow(), servings: 1 });
      else { const f = picked.item; await nutritionApi.logMeal({ date: todayStr(), name: f.name, mealType: slotNow(), calories: Math.round(f.calories ?? 0), proteinG: Math.round(f.proteinG ?? 0), carbsG: Math.round(f.carbsG ?? 0), fatG: Math.round(f.fatG ?? 0), source: 'saved' } as any); }
      await invalidate.afterMeal(); haptics.success(); setPicked(null);
    } catch (e: any) { Alert.alert('Couldn’t log it', e?.message ?? ''); }
    setBusy(false);
  };
  const remove = () => {
    if (!picked) return;
    const p = picked;
    Alert.alert(`Delete ${p.item.name}?`, p.kind === 'recipe' ? 'Meals you already logged from it stay.' : 'It comes off your saved foods. Logged meals stay.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { if (p.kind === 'recipe') await nutritionApi.deleteRecipe(p.item.id); else await nutritionApi.deleteSavedFood(p.item.id); await invalidate.afterMeal(); setPicked(null); }
        catch (e: any) { Alert.alert('Couldn’t delete', e?.message ?? ''); }
      } },
    ]);
  };
  return (
    <PushedPage back="Fuel" title="Library" right={<TextAction muted arrow={false} size={15} onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'recipe' } } as any)}>New</TextAction>}
      loading={(tab === 'recipes' ? recipes.isLoading : foods.isLoading)}>
      <LinkTabs items={[{ key: 'recipes' as const, label: `Recipes · ${rl.length}` }, { key: 'foods' as const, label: `Saved foods · ${fl.length}` }]} value={tab} onChange={(k) => { haptics.select(); setTab(k); }} style={{ marginBottom: 14 }} />
      {tab === 'recipes'
        ? rl.map((r, i) => <LongRow key={r.id} name={r.name} sub={`${r.servings} serving${r.servings === 1 ? '' : 's'}${r.useCount ? ` · made ${r.useCount}×` : ''}`} value={`${Math.round(r.calories)} →`} last={i === rl.length - 1} onPress={() => setPicked({ kind: 'recipe', item: r })} />)
        : fl.map((f, i) => <LongRow key={f.id} name={f.name} sub={`${Math.round(f.proteinG ?? 0)} g protein${f.useCount ? ` · logged ${f.useCount}×` : ''}`} value={`${Math.round(f.calories ?? 0)} →`} last={i === fl.length - 1} onPress={() => setPicked({ kind: 'food', item: f })} />)}
      {tab === 'recipes' && recipes.data && !rl.length ? <Text style={T.bodyMuted}>No recipes yet. Build one with New, or save a meal as a recipe.</Text> : null}
      {tab === 'foods' && foods.data && !fl.length ? <Text style={T.bodyMuted}>Foods you log show up here.</Text> : null}
      {tab === 'recipes' ? <TextAction primary style={{ marginTop: 24 }} onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'recipe' } } as any)}>Build a recipe</TextAction> : null}
      <Sheet visible={!!picked} onClose={() => setPicked(null)} title={picked?.item.name} sub={picked ? `${Math.round(picked.item.calories ?? 0)} kcal · ${Math.round(picked.item.proteinG ?? 0)} g protein${picked.kind === 'recipe' ? ' per serving' : ''}` : undefined}>
        <Row name={picked?.kind === 'recipe' ? 'Log a serving' : 'Log it'} sub={`As ${slotNow()}, today`} value={busy ? '…' : '→'} onPress={busy ? undefined : () => void log()} />
        {picked?.kind === 'recipe' ? <Row name="Edit" value="→" onPress={() => { const id = picked.item.id; setPicked(null); router.push({ pathname: '/(v2)/p/[key]', params: { key: `recipe:${id}` } } as any); }} /> : null}
        <Row name="Delete" muted last onPress={remove} />
      </Sheet>
    </PushedPage>
  );
}

/** A row that answers both a tap and a long-press (handoff: long-press for Log, Edit or Delete). */
function LongRow(p: React.ComponentProps<typeof Row>) {
  return <Pressable onLongPress={() => { haptics.light(); p.onPress?.(); }} delayLongPress={350}><Row {...p} /></Pressable>;
}

// ─── N-05 Recipe builder ─────────────────────────────────────────────────────

export function RecipeBuilderPage({ id, params }: { id?: string; params: Record<string, string> }) {
  const router = useRouter();
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const recipes = useRecipes();
  const meals = useMeals(params.date);
  const existing = id ? (recipes.data?.recipes ?? []).find((r: any) => r.id === id) : null;
  const [name, setName] = useState('');
  const [servings, setServings] = useState(1);
  const [items, setItems] = useState<Ingredient[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'log'>(null);
  // Seed once: an existing recipe, or the meal it's being saved from.
  useEffect(() => {
    if (seeded) return;
    if (existing) { setName(existing.name); setServings(existing.servings); setItems((existing.items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity ?? '', calories: i.calories, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG }))); setSeeded(true); return; }
    if (params.fromMeal) {
      const rows: any[] = meals.data?.meals ?? meals.data?.entries ?? [];
      const m = rows.find((x) => String(x.id) === params.fromMeal);
      if (m) { setName(m.name ?? 'Recipe'); setItems([{ name: m.name ?? 'Meal', quantity: '1 serving', calories: Math.round(m.calories ?? 0), proteinG: Math.round(m.proteinG ?? 0), carbsG: Math.round(m.carbsG ?? 0), fatG: Math.round(m.fatG ?? 0) }]); setSeeded(true); }
      return;
    }
    if (!id) setSeeded(true);
  }, [existing, meals.data, seeded]); // eslint-disable-line react-hooks/exhaustive-deps
  const per = perServing(items, servings);
  const valid = !!name.trim() && items.length > 0;
  const save = async (thenLog: boolean) => {
    if (!valid) { Alert.alert(name.trim() ? 'Add an ingredient first.' : 'Give it a name first.'); return; }
    setBusy(thenLog ? 'log' : 'save');
    try {
      const body = { name: name.trim(), servings, items: items.map((i) => ({ ...i })) };
      const r: any = existing ? await nutritionApi.updateRecipe(existing.id, body) : await nutritionApi.createRecipe(body);
      if (thenLog) await nutritionApi.logRecipe(r.id ?? existing?.id, { date: todayStr(), mealType: slotNow(), servings: 1 });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.recipes }), thenLog ? invalidate.afterMeal() : Promise.resolve()]);
      haptics.success();
      router.back();
    } catch (e: any) { Alert.alert('Couldn’t save it', e?.message ?? 'Try again.'); }
    setBusy(null);
  };
  return (
    <PushedPage back={params.fromMeal ? 'Meal' : 'Library'} meta={existing ? 'Edit recipe' : 'New recipe'} title="" loading={!!id && recipes.isLoading && !existing}>
      <Pressable onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel={`Name, ${name || 'not set'}. Edit`}>
        <Text style={[styles.name, !name && { color: C.placeholder }]} numberOfLines={2}>{name || 'Name the recipe'}</Text>
      </Pressable>
      <View style={styles.stepRow}>
        <Text style={[T.body, { flex: 1 }]}>Servings</Text>
        <Pressable onPress={() => setServings((s) => Math.max(1, s - 1))} hitSlop={10} accessibilityLabel="Fewer servings"><Text style={styles.step}>−</Text></Pressable>
        <Text style={styles.count}>{servings}</Text>
        <Pressable onPress={() => setServings((s) => Math.min(40, s + 1))} hitSlop={10} accessibilityLabel="More servings"><Text style={styles.step}>+</Text></Pressable>
      </View>
      <Eyebrow style={{ marginTop: 24 }}>Ingredients · {items.length}</Eyebrow>
      <View style={{ marginTop: 6 }}>
        {items.map((it, i) => (
          <Row key={`${it.name}${i}`} name={it.name} sub={`${it.quantity ? `${it.quantity} · ` : ''}${Math.round(it.calories)} kcal`} value="✕"
            onPress={() => Alert.alert(`Remove ${it.name}?`, undefined, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => setItems((x) => x.filter((_, k) => k !== i)) }])} />
        ))}
        <Row name="+ Add ingredient" muted last onPress={() => setAdding(true)} />
      </View>
      <Eyebrow style={{ marginTop: 24 }}>Per serving</Eyebrow>
      <View style={styles.macros}>
        {([['kcal', per.calories, C.ink], ['protein', per.proteinG, C.macro.protein], ['carbs', per.carbsG, C.macro.carbs], ['fat', per.fatG, C.macro.fat]] as const).map(([l, v, hue]) => (
          <View key={l} style={{ flex: 1 }}><Text style={[styles.macroValue, { color: hue }]}>{v}</Text><Text style={T.caption}>{l}</Text></View>
        ))}
      </View>
      <View style={styles.actions}>
        <TextAction primary onPress={() => void save(false)} loading={busy === 'save'} disabled={!valid}>Save recipe</TextAction>
        <TextAction muted arrow={false} onPress={() => void save(true)} loading={busy === 'log'} disabled={!valid}>Log a serving</TextAction>
      </View>
      <PromptSheet visible={editing} title="Name" initial={name} onSubmit={(v) => { setName(v.trim()); setEditing(false); }} onClose={() => setEditing(false)} />
      <AddIngredientSheet visible={adding} onClose={() => setAdding(false)} onAdd={(i) => { setItems((x) => [...x, i]); setAdding(false); haptics.select(); }} />
    </PushedPage>
  );
}

/** Add an ingredient: search (your foods first, then the database) or type it in. */
function AddIngredientSheet({ visible, onClose, onAdd }: { visible: boolean; onClose: () => void; onAdd: (i: Ingredient) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [food, setFood] = useState<FoodResult | null>(null);
  const [qty, setQty] = useState(1);
  const [typing, setTyping] = useState(false);
  const [manual, setManual] = useState({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '' });
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const res = useQuery({ queryKey: ['v2', 'ingredient-search', query], queryFn: () => v2Api.foodSearch(query, 'all'), enabled: visible && query.length >= 2, staleTime: 30_000 });
  const reset = () => { setQ(''); setQuery(''); setFood(null); setQty(1); setTyping(false); setManual({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '' }); };
  const close = () => { reset(); onClose(); };
  const addManual = () => {
    const n = (s: string) => Math.max(0, Number(s) || 0);
    if (!manual.name.trim()) return;
    onAdd({ name: manual.name.trim(), quantity: '', calories: n(manual.calories), proteinG: n(manual.proteinG), carbsG: n(manual.carbsG), fatG: n(manual.fatG) });
    reset();
  };
  return (
    <Sheet visible={visible} onClose={close} title={food ? food.name : typing ? 'Type it' : 'Add an ingredient'}>
      {food ? (
        <View>
          <View style={styles.stepRow}>
            <Text style={[T.body, { flex: 1 }]}>{food.portion.label || '1 serving'}</Text>
            <Pressable onPress={() => setQty((x) => Math.max(0.25, Math.round((x - (x > 1 ? 1 : 0.25)) * 4) / 4))} hitSlop={10}><Text style={styles.step}>−</Text></Pressable>
            <Text style={styles.count}>×{qty}</Text>
            <Pressable onPress={() => setQty((x) => Math.round((x + (x >= 1 ? 1 : 0.25)) * 4) / 4)} hitSlop={10}><Text style={styles.step}>+</Text></Pressable>
          </View>
          <Text style={[T.caption, { marginTop: 8 }]}>{Math.round(food.macros.calories * qty)} kcal · {Math.round(food.macros.proteinG * qty)} g protein</Text>
          <View style={styles.actions}>
            <TextAction primary onPress={() => { onAdd(ingredientFrom(food, qty)); reset(); }}>Add</TextAction>
            <TextAction muted arrow={false} size={15} onPress={() => setFood(null)}>← Back</TextAction>
          </View>
        </View>
      ) : typing ? (
        <View style={{ gap: 12 }}>
          <TextInput value={manual.name} onChangeText={(v) => setManual((m) => ({ ...m, name: v }))} placeholder="Name" placeholderTextColor={C.placeholder} style={styles.typeInput} autoFocus />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(['calories', 'proteinG', 'carbsG', 'fatG'] as const).map((k) => (
              <TextInput key={k} value={(manual as any)[k]} onChangeText={(v) => setManual((m) => ({ ...m, [k]: v }))} keyboardType="decimal-pad" placeholder={k === 'calories' ? 'kcal' : k.replace('G', ' g')} placeholderTextColor={C.placeholder} style={[styles.typeInput, { flex: 1 }]} />
            ))}
          </View>
          <View style={styles.actions}>
            <TextAction primary onPress={addManual} disabled={!manual.name.trim()}>Add</TextAction>
            <TextAction muted arrow={false} size={15} onPress={() => setTyping(false)}>← Search instead</TextAction>
          </View>
        </View>
      ) : (
        <View>
          <TextInput value={q} onChangeText={setQ} placeholder="Search foods" placeholderTextColor={C.placeholder} style={styles.typeInput} autoFocus returnKeyType="search" />
          <View style={{ marginTop: 8, maxHeight: 320 }}>
            {res.isFetching && !res.data ? <ActivityIndicator color={C.muted} style={{ marginVertical: 12 }} /> : null}
            {(res.data?.results ?? []).slice(0, 8).map((f, i, arr) => <Row key={`${f.kind}:${f.id}`} name={f.name} sub={f.caption} value={`${Math.round(f.kcal)}`} last={i === arr.length - 1} onPress={() => { haptics.select(); setFood(f); setQty(1); }} />)}
          </View>
          <TextAction muted arrow={false} size={15} style={{ marginTop: 14 }} onPress={() => setTyping(true)}>Type it instead</TextAction>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'baseline', gap: 10, borderBottomWidth: 1, borderBottomColor: C.ink, paddingBottom: 6 },
  fieldInput: { flex: 1, fontFamily: v2.font.semibold, fontSize: 32, color: C.ink, padding: 0 },
  name: { fontFamily: v2.font.bold, fontSize: 28, lineHeight: 33, letterSpacing: -0.6, color: C.ink, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: C.ink },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.hairline },
  step: { fontFamily: v2.font.semibold, fontSize: 22, color: C.ink, paddingHorizontal: 4 },
  count: { fontFamily: v2.font.semibold, fontSize: 17, color: C.ink, minWidth: 36, textAlign: 'center', fontVariant: ['tabular-nums'] },
  macros: { flexDirection: 'row', gap: 12, marginTop: 10 },
  macroValue: { fontFamily: v2.font.bold, fontSize: 24, lineHeight: 28, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 26 },
  typeInput: { fontFamily: v2.font.regular, fontSize: 17, color: C.ink, borderBottomWidth: 1, borderBottomColor: C.hairline, paddingVertical: 8 },
});
