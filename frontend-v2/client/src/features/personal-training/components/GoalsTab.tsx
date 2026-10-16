// The dossier's Goals tab: goals with a number and a date, with progress read
// from the client's own data, and the body measurements underneath. Numbers
// are typed and shown in the trainer's unit; the server converts at the edge.

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { COPY, shortDate, type ClientGoal, type Measurement, type MeasurementKind } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { LIFT_GOAL_METRICS, PCOPY } from '../copyPlatform';
import { MEASUREMENT_KINDS, goalUnit, inferUnitPreference, localDate, unitOptions, type UnitPreference } from '../platform';
import { useGoalActions, useGoals, useMeasurementActions, useMeasurements } from '../platformHooks';
import { errorText, selectClass } from './ChipInput';
import { Eyebrow, Notice, Pill, SkeletonBlock } from './primitives';

const G = PCOPY.goals;
const M = PCOPY.measurements;

/** The signed-in trainer's preference, or null outside the auth provider (tests, embeds). */
function useAccountUnit(): UnitPreference | null {
  try {
    const pref = useAuth().user?.unitPreference;
    return pref === 'metric' ? 'metric' : pref === 'imperial' ? 'imperial' : null;
  } catch {
    return null;
  }
}

/**
 * The unit numbers are in: what the server already used for this client's
 * records first (it converted with the account's preference), then the
 * account, then lb/in as the app's default.
 */
export function useTrainerUnit(measurements: Measurement[] | undefined, goals: ClientGoal[] | undefined): UnitPreference {
  const account = useAccountUnit();
  return inferUnitPreference(measurements, goals) ?? account ?? 'imperial';
}

const fmt = (v: number | null, unit: string) => (v == null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)}${unit ? ` ${unit}` : ''}`);
const day = (iso: string) => shortDate(new Date(`${iso}T12:00:00`));

// ── Goals ────────────────────────────────────────────────────────────────────

const GOAL_METRICS = [
  'bodyweight', ...LIFT_GOAL_METRICS, 'sessions_per_week',
  ...MEASUREMENT_KINDS.filter((k) => k !== 'bodyweight' && k !== 'custom').map((k) => `measurement:${k}`),
  'custom',
];
const metricLabel = (m: string) => G.metrics[m] ?? (m.startsWith('measurement:') ? M.kinds[m.slice(12)] : m);

function GoalRow({ goal, clientId }: { goal: ClientGoal; clientId: string }) {
  const { update } = useGoalActions(clientId);
  const achieved = goal.status === 'achieved';
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 break-words text-[13px] font-semibold">{goal.label}</p>
        {achieved && <Pill tone="green">{G.achieved}</Pill>}
      </div>
      <p className="mt-0.5 text-xs tabular-nums text-axiom-zinc-600">
        {G.current} {goal.current == null ? G.noCurrent.toLowerCase() : fmt(goal.current, goal.unit)} · {G.targetShort} {fmt(goal.target, goal.unit)}
        {goal.deadline ? ` ${G.by(day(goal.deadline))}` : ''}
      </p>
      {goal.progress != null ? (
        <div className="mt-2 flex items-center gap-3">
          <div
            role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goal.progress} aria-label={G.progress(goal.label, goal.progress)}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-axiom-zinc-100"
          >
            <div className={cn('h-full rounded-full', achieved || goal.progress >= 100 ? 'bg-axiom-success' : 'bg-foreground')} style={{ width: `${goal.progress}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">{goal.progress}%</span>
        </div>
      ) : <p className="mt-1 text-xs text-axiom-zinc-500">{G.noProgress}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {goal.daysLeft != null && !achieved && (
          <span className={cn('mr-2 text-xs tabular-nums', goal.daysLeft < 0 ? 'text-axiom-warning-ink' : 'text-axiom-zinc-500')}>{G.daysLeft(goal.daysLeft)}</span>
        )}
        <Button variant="ghost" className="h-9 rounded-lg px-2 text-xs text-axiom-zinc-600" disabled={update.isPending}
          onClick={() => update.mutate({ gid: goal.id, input: { status: achieved ? 'active' : 'achieved' } })}>
          {achieved ? G.reopen : G.markAchieved}
        </Button>
        <Button variant="ghost" className="h-9 rounded-lg px-2 text-xs text-axiom-zinc-600" disabled={update.isPending}
          onClick={() => { if (window.confirm(G.dropConfirm)) update.mutate({ gid: goal.id, input: { status: 'dropped' } }); }}>
          {G.drop}
        </Button>
      </div>
      {update.isError && <p role="alert" className="mt-1 text-xs text-axiom-destructive-ink">{errorText(update.error, G.failed)}</p>}
    </li>
  );
}

function AddGoal({ clientId, unit }: { clientId: string; unit: UnitPreference }) {
  const empty = { metric: 'bodyweight', target: '', baseline: '', deadline: '', label: '', unit: '' };
  const [form, setForm] = useState(empty);
  const { add } = useGoalActions(clientId);
  const custom = form.metric === 'custom';
  const shownUnit = custom ? form.unit.trim() : goalUnit(form.metric, unit);
  const valid = custom ? !!form.label.trim() : form.target.trim() !== '' && Number.isFinite(Number(form.target));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      className="rounded-2xl border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        add.mutate({
          metric: form.metric,
          ...(form.target.trim() ? { target: Number(form.target) } : {}),
          ...(form.baseline.trim() ? { baseline: Number(form.baseline) } : {}),
          ...(form.deadline ? { deadline: form.deadline } : {}),
          ...(form.label.trim() ? { label: form.label.trim() } : {}),
          ...(custom && form.unit.trim() ? { unit: form.unit.trim() } : {}),
        }, { onSuccess: () => setForm(empty) });
      }}
    >
      <Eyebrow className="mb-3">{G.add}</Eyebrow>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pt-goal-metric">{G.metric}</Label>
          <select id="pt-goal-metric" className={selectClass} value={form.metric} onChange={set('metric')}>
            {GOAL_METRICS.map((m) => <option key={m} value={m}>{metricLabel(m)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-goal-label">{custom ? G.customLabel : G.label}</Label>
          <Input id="pt-goal-label" required={custom} maxLength={80} value={form.label} onChange={set('label')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-goal-target">{G.target}{shownUnit ? ` (${shownUnit})` : ''}</Label>
          <Input id="pt-goal-target" type="number" inputMode="decimal" step="any" required={!custom} value={form.target} onChange={set('target')} />
        </div>
        {custom ? (
          <div className="space-y-1.5">
            <Label htmlFor="pt-goal-unit">{G.unit}</Label>
            <Input id="pt-goal-unit" maxLength={20} value={form.unit} onChange={set('unit')} />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="pt-goal-baseline">{G.baseline}</Label>
            <Input id="pt-goal-baseline" type="number" inputMode="decimal" step="any" value={form.baseline} onChange={set('baseline')} aria-describedby="pt-goal-baseline-hint" />
            <p id="pt-goal-baseline-hint" className="text-xs text-axiom-zinc-500">{G.baselineHint}</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="pt-goal-deadline">{G.deadline}</Label>
          <Input id="pt-goal-deadline" type="date" min={localDate()} value={form.deadline} onChange={set('deadline')} />
        </div>
      </div>
      {add.isError && <p role="alert" className="mt-3 text-sm text-axiom-destructive-ink">{errorText(add.error, G.failed)}</p>}
      <Button type="submit" className="mt-4 h-10 rounded-xl" disabled={!valid || add.isPending}>{G.add}</Button>
    </form>
  );
}

// ── Measurements ─────────────────────────────────────────────────────────────

function AddMeasurement({ clientId, unit }: { clientId: string; unit: UnitPreference }) {
  const [kind, setKind] = useState<MeasurementKind>('bodyweight');
  const [value, setValue] = useState('');
  const [chosenUnit, setChosenUnit] = useState<string | null>(null);
  const [date, setDate] = useState(localDate());
  const [label, setLabel] = useState('');
  const { add } = useMeasurementActions(clientId);
  const options = unitOptions(kind, unit);
  const u = chosenUnit && options.includes(chosenUnit) ? chosenUnit : options[0];
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(n) && n > 0 && (kind !== 'custom' || !!label.trim());

  return (
    <form
      className="rounded-2xl border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        add.mutate({ kind, value: n, unit: u, date, ...(kind === 'custom' ? { label: label.trim() } : {}) }, { onSuccess: () => { setValue(''); setLabel(''); } });
      }}
    >
      <Eyebrow className="mb-3">{M.add}</Eyebrow>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="pt-m-kind">{M.kind}</Label>
          <select id="pt-m-kind" className={selectClass} value={kind} onChange={(e) => { setKind(e.target.value as MeasurementKind); setChosenUnit(null); }}>
            {MEASUREMENT_KINDS.map((k) => <option key={k} value={k}>{M.kinds[k]}</option>)}
          </select>
        </div>
        {kind === 'custom' && (
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="pt-m-label">{M.label}</Label>
            <Input id="pt-m-label" required maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="pt-m-value">{M.value}</Label>
          <Input id="pt-m-value" type="number" inputMode="decimal" step="any" min="0" required value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-m-unit">{M.unit}</Label>
          {options.length > 1 ? (
            <select id="pt-m-unit" className={selectClass} value={u} onChange={(e) => setChosenUnit(e.target.value)}>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : <p id="pt-m-unit" className="flex h-10 items-center text-sm text-axiom-zinc-600">{u || '—'}</p>}
        </div>
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="pt-m-date">{M.date}</Label>
          <Input id="pt-m-date" type="date" max={localDate()} required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      {add.isError && <p role="alert" className="mt-3 text-sm text-axiom-destructive-ink">{errorText(add.error, M.failed)}</p>}
      <Button type="submit" variant="secondary" className="mt-4 h-10 rounded-xl" disabled={!valid || add.isPending}>{M.add}</Button>
    </form>
  );
}

function MeasurementList({ measurements, clientId }: { measurements: Measurement[]; clientId: string }) {
  const { remove } = useMeasurementActions(clientId);
  const th = 'whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-500';
  const del = (m: Measurement) => (
    <Button variant="ghost" className="size-9 shrink-0 rounded-xl p-0 text-axiom-zinc-500" aria-label={`${M.remove}: ${m.label}, ${day(m.date)}`} disabled={remove.isPending}
      onClick={() => { if (window.confirm(M.removeConfirm)) remove.mutate(m.id); }}>
      <Trash2 aria-hidden />
    </Button>
  );
  return (
    <>
      {/* A table from 768px; a list of rows below, so nothing scrolls sideways on a phone. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border md:block">
        <table className="w-full border-collapse">
          <thead className="bg-axiom-zinc-50">
            <tr>
              <th scope="col" className={th}>{M.columns.date}</th>
              <th scope="col" className={th}>{M.columns.measurement}</th>
              <th scope="col" className={th}>{M.columns.value}</th>
              <th scope="col" className={th}>{M.columns.source}</th>
              <th scope="col" className={th}><span className="sr-only">{M.remove}</span></th>
            </tr>
          </thead>
          <tbody>
            {measurements.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="whitespace-nowrap px-4 py-2 text-[13px] tabular-nums text-axiom-zinc-600">{day(m.date)}</td>
                <td className="px-4 py-2 text-[13px] font-semibold">{m.label}</td>
                <td className="whitespace-nowrap px-4 py-2 text-[13px] tabular-nums">{fmt(m.value, m.unit)}</td>
                <td className="px-4 py-2 text-xs text-axiom-zinc-500">{m.source === 'client' ? M.clientEntry : M.trainerEntry}</td>
                <td className="w-12 px-2 py-1 text-right">{m.deletable && del(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border md:hidden">
        {measurements.map((m) => (
          <li key={m.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">{m.label} <span className="font-normal tabular-nums">{fmt(m.value, m.unit)}</span></p>
              <p className="text-xs text-axiom-zinc-500">{day(m.date)} · {m.source === 'client' ? M.clientEntry : M.trainerEntry}</p>
            </div>
            {m.deletable && del(m)}
          </li>
        ))}
      </ul>
      {remove.isError && <p role="alert" className="mt-2 text-xs text-axiom-destructive-ink">{errorText(remove.error, M.failed)}</p>}
    </>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function GoalsTab({ clientId }: { clientId: string }) {
  const goals = useGoals(clientId);
  const measurements = useMeasurements(clientId);
  const unit = useTrainerUnit(measurements.data?.measurements, goals.data?.goals);
  const loading = <div aria-busy="true" className="space-y-3"><SkeletonBlock className="h-20 w-full" /><SkeletonBlock className="h-20 w-full" /></div>;

  return (
    <div className="space-y-10">
      <section aria-labelledby="pt-goals-title" className="space-y-4">
        <h2 id="pt-goals-title" className="text-[15px] font-semibold tracking-[-0.01em]">{G.title}</h2>
        {goals.isPending ? loading
          : goals.isError ? <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => goals.refetch()}>{COPY.roster.retry}</Button>}>{G.loadFailed}</Notice>
          : goals.data.goals.length === 0 ? <p className="text-sm text-axiom-zinc-500">{G.empty}</p>
          : <ul className="divide-y divide-border rounded-2xl border border-border">{goals.data.goals.map((g) => <GoalRow key={g.id} goal={g} clientId={clientId} />)}</ul>}
        <AddGoal clientId={clientId} unit={unit} />
      </section>

      <section aria-labelledby="pt-measurements-title" className="space-y-4">
        <h2 id="pt-measurements-title" className="text-[15px] font-semibold tracking-[-0.01em]">{M.title}</h2>
        {measurements.isPending ? loading
          : measurements.isError ? <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => measurements.refetch()}>{COPY.roster.retry}</Button>}>{M.loadFailed}</Notice>
          : measurements.data.measurements.length === 0 ? <p className="text-sm text-axiom-zinc-500">{M.empty}</p>
          : <MeasurementList measurements={measurements.data.measurements} clientId={clientId} />}
        <AddMeasurement clientId={clientId} unit={unit} />
      </section>
    </div>
  );
}
