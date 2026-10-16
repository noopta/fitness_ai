// Food logging on the Log tab: a quick meal form and the last seven days.
// The client sees their own numbers and the targets their trainer set —
// described plainly, never graded.

import { useRef, useState } from 'react';
import { Camera, Loader2, Sparkles, Utensils } from 'lucide-react';
import type { PortalNutrition } from '@axiom/personal-training-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '../api';
import { Card, EmptyState, Eyebrow, InlineError, ListSkeleton, LoadFailed, PortalButton, ProgressBar, Select } from '../components';
import { formatDay, localDateISO } from '../helpers';
import { useEstimateMeal, useLogMeal, useNutrition, type MealInput } from '../hooks';
import { downscalePhoto } from '../media';

const MEAL_TYPES = [
  { value: 'breakfast', label: 'Breakfast' }, { value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' }, { value: 'meal', label: 'Other' },
];

type MacroKey = 'calories' | 'proteinG' | 'carbsG' | 'fatG';
const MACROS: { key: MacroKey; label: string; unit: string; avg: keyof PortalNutrition['week'] }[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal', avg: 'avgCalories' },
  { key: 'proteinG', label: 'Protein', unit: 'g', avg: 'avgProteinG' },
  { key: 'carbsG', label: 'Carbs', unit: 'g', avg: 'avgCarbsG' },
  { key: 'fatG', label: 'Fat', unit: 'g', avg: 'avgFatG' },
];

/** A default meal type from the time of day. */
function mealTypeNow(d = new Date()): string {
  const h = d.getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}

/** '' stays absent; anything else must be a non-negative number. */
export function parseOptionalNumber(v: string): number | undefined | null {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

/** "low", "Low confidence", or a 0–1 number under one half all read as low. */
export function isLowConfidence(confidence: string | null | undefined): boolean {
  if (!confidence) return false;
  const n = Number(confidence);
  if (Number.isFinite(n)) return n <= 1 ? n < 0.5 : n < 50;
  return /low|unsure|uncertain/i.test(confidence);
}

function MealForm() {
  const log = useLogMeal();
  const [name, setName] = useState('');
  const [nums, setNums] = useState<Record<MacroKey, string>>({ calories: '', proteinG: '', carbsG: '', fatG: '' });
  const [mealType, setMealType] = useState(mealTypeNow);
  const [date, setDate] = useState(localDateISO());
  const [saved, setSaved] = useState(false);
  const today = localDateISO();
  const parsed = MACROS.map((m) => [m.key, parseOptionalNumber(nums[m.key])] as const);
  const badNumber = parsed.some(([, v]) => v === null);
  const valid = name.trim() !== '' && !badNumber;
  const estimate = useEstimateMeal();
  const fileRef = useRef<HTMLInputElement>(null);
  const [estimated, setEstimated] = useState<{ low: boolean } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  /** A photo pre-fills the form; the client checks it and presses Save themselves. */
  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoError(null);
    setEstimated(null);
    setSaved(false);
    estimate.reset();
    setPreparing(true);
    let base64: string;
    try {
      base64 = (await downscalePhoto(file)).base64;
    } catch (err) {
      setPreparing(false);
      return setPhotoError(err instanceof Error ? err.message : 'That photo could not be read. Try another.');
    }
    setPreparing(false);
    estimate.mutate(base64, {
      onSuccess: ({ estimate: m }) => {
        setName(m.name);
        setNums({ calories: String(m.calories), proteinG: String(m.proteinG), carbsG: String(m.carbsG), fatG: String(m.fatG) });
        if (MEAL_TYPES.some((t) => t.value === m.mealType)) setMealType(m.mealType);
        setEstimated({ low: isLowConfidence(m.confidence) });
      },
      onError: (err) => setPhotoError(errorMessage(err, 'Could not read that photo. Try another, or type the meal in.')),
    });
  };
  const reading = preparing || estimate.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || log.isPending) return;
    const input: MealInput = { name: name.trim(), mealType, date };
    for (const [k, v] of parsed) if (typeof v === 'number') input[k] = v;
    setSaved(false);
    log.mutate(input, {
      onSuccess: () => { setName(''); setNums({ calories: '', proteinG: '', carbsG: '', fatG: '' }); setSaved(true); setEstimated(null); },
    });
  };

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate aria-labelledby="meal-h">
        <div className="mb-3 flex items-center gap-2">
          <Utensils aria-hidden className="size-4 text-axiom-zinc-500" />
          <h2 id="meal-h" className="text-[15px] font-semibold">Log a meal</h2>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPhoto} />
        <PortalButton variant="secondary" className="mb-3 w-full" onClick={() => fileRef.current?.click()} disabled={reading}>
          {reading ? <Loader2 className="motion-safe:animate-spin" /> : <Camera />} {reading ? 'Reading your photo…' : 'Estimate from a photo'}
        </PortalButton>
        <div aria-live="polite">
          {estimated && (
            <p className="mb-3 flex items-start gap-2 rounded-xl bg-axiom-zinc-100 px-3 py-2 text-sm">
              <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-axiom-zinc-600" />
              <span>
                Estimated from your photo. Check the numbers and change anything that's off, then save.
                {estimated.low && <strong className="mt-1 block font-semibold text-axiom-warning-ink">This one was hard to read, so the numbers may be well off.</strong>}
              </span>
            </p>
          )}
        </div>
        {photoError && <div className="mb-3"><InlineError>{photoError}</InlineError></div>}
        <Label htmlFor="meal-name" className="mb-1.5 block text-xs text-axiom-zinc-600">What did you eat?</Label>
        <Input id="meal-name" maxLength={120} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="Chicken, rice and greens" className="h-11 rounded-xl text-base md:text-sm" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          {MACROS.map((m) => (
            <div key={m.key} className="min-w-0">
              <Label htmlFor={`meal-${m.key}`} className="mb-1.5 block text-xs text-axiom-zinc-600">{m.label} ({m.unit}) <span className="text-axiom-zinc-400">optional</span></Label>
              <Input
                id={`meal-${m.key}`} type="number" inputMode="decimal" min={0} step="any" value={nums[m.key]}
                onChange={(e) => { setNums((s) => ({ ...s, [m.key]: e.target.value })); setSaved(false); }}
                className="h-11 rounded-xl text-base tabular-nums md:text-sm"
              />
            </div>
          ))}
          <div className="min-w-0">
            <Label htmlFor="meal-type" className="mb-1.5 block text-xs text-axiom-zinc-600">Meal</Label>
            <Select id="meal-type" value={mealType} onChange={(e) => setMealType(e.target.value)}>
              {MEAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
          <div className="min-w-0">
            <Label htmlFor="meal-date" className="mb-1.5 block text-xs text-axiom-zinc-600">Date</Label>
            <Input id="meal-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value || today)} className="h-11 rounded-xl text-base md:text-sm" />
          </div>
        </div>
        {badNumber && <p className="mt-2 text-xs text-axiom-destructive-ink">Numbers need to be zero or more.</p>}
        {log.isError && <div className="mt-3"><InlineError>{errorMessage(log.error)}</InlineError></div>}
        <PortalButton type="submit" className="mt-3 w-full" disabled={!valid || log.isPending}>{log.isPending ? 'Saving…' : 'Save meal'}</PortalButton>
        <p aria-live="polite" className="mt-2 min-h-4 text-xs text-axiom-success-ink">{saved ? 'Saved. Your trainer can see it.' : ''}</p>
      </form>
    </Card>
  );
}

function WeekSummary({ nutrition }: { nutrition: PortalNutrition }) {
  const { week, targets, days } = nutrition;
  if (week.daysLogged === 0 && days.length === 0) {
    return <EmptyState title="No meals logged this week">Log what you eat and your weekly averages show up here.</EmptyState>;
  }
  return (
    <Card aria-labelledby="week-h">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 id="week-h" className="text-[15px] font-semibold">Last {week.windowDays} days</h3>
        <p className="text-xs text-axiom-zinc-600 tabular-nums">{week.daysLogged} of {week.windowDays} days logged</p>
      </div>
      <ul className="space-y-3">
        {MACROS.map((m) => {
          const avg = week[m.avg] as number | null;
          const target = targets?.[m.key] ?? null;
          return (
            <li key={m.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{m.label}</span>
                <span className="tabular-nums text-axiom-zinc-600">
                  {avg === null ? '—' : <>{fmt(avg)} {m.unit} a day</>}
                  {target !== null && <> · target {fmt(target)} {m.unit}</>}
                </span>
              </div>
              {target !== null && target > 0 && avg !== null && (
                <div className="mt-1.5"><ProgressBar value={(avg / target) * 100} label={`${m.label}: average against target`} /></div>
              )}
            </li>
          );
        })}
      </ul>
      {days.length > 0 && (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {[...days].reverse().map((d) => (
            <li key={d.date} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="shrink-0">{formatDay(d.date)}</span>
              <span className="min-w-0 text-right text-xs tabular-nums text-axiom-zinc-600">{fmt(d.calories)} kcal · P {fmt(d.proteinG)} · C {fmt(d.carbsG)} · F {fmt(d.fatG)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function NutritionSection() {
  const q = useNutrition();
  return (
    <section aria-labelledby="food-h" className="space-y-3">
      <Eyebrow className="mt-6"><span id="food-h">Food</span></Eyebrow>
      <MealForm />
      {q.isPending ? <ListSkeleton rows={2} /> : q.isError ? <LoadFailed onRetry={() => q.refetch()} /> : <WeekSummary nutrition={q.data.nutrition} />}
    </section>
  );
}
