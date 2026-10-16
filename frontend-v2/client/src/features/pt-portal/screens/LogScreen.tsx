// Weigh-ins and body measurements, in the client's own units.

import { useState } from 'react';
import { Ruler, Scale as ScaleIcon } from 'lucide-react';
import type { MeasurementKind } from '@axiom/personal-training-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '../api';
import { Card, EmptyState, Eyebrow, InlineError, ListSkeleton, LoadFailed, PortalButton, ScreenTitle, Select } from '../components';
import { formatDay, formatValue, localDateISO, MEASUREMENT_LABEL, unitFor } from '../helpers';
import { useAddMeasurement, useMeasurements } from '../hooks';
import { NutritionSection } from './NutritionSection';

const OTHER_KINDS: MeasurementKind[] = ['waist', 'hips', 'chest', 'arm', 'thigh', 'body_fat', 'resting_hr'];

function EntryForm({
  idPrefix, kinds, weightUnit, title, icon,
}: { idPrefix: string; kinds: MeasurementKind[]; weightUnit: 'kg' | 'lb'; title: string; icon: React.ReactNode }) {
  const add = useAddMeasurement();
  const [kind, setKind] = useState<MeasurementKind>(kinds[0]);
  const [value, setValue] = useState('');
  const [date, setDate] = useState(localDateISO());
  const [saved, setSaved] = useState(false);
  const unit = unitFor(kind, weightUnit);
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(n) && n > 0;
  const today = localDateISO();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || add.isPending) return;
    setSaved(false);
    add.mutate({ kind, value: n, unit, date }, { onSuccess: () => { setValue(''); setSaved(true); } });
  };

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate aria-labelledby={`${idPrefix}-h`}>
        <div className="mb-3 flex items-center gap-2">
          <span aria-hidden className="text-axiom-zinc-500 [&_svg]:size-4">{icon}</span>
          <h2 id={`${idPrefix}-h`} className="text-[15px] font-semibold">{title}</h2>
        </div>
        {kinds.length > 1 && (
          <div className="mb-3">
            <Label htmlFor={`${idPrefix}-kind`} className="mb-1.5 block text-xs text-axiom-zinc-600">Measurement</Label>
            <Select id={`${idPrefix}-kind`} value={kind} onChange={(e) => { setKind(e.target.value as MeasurementKind); setSaved(false); }}>
              {kinds.map((k) => <option key={k} value={k}>{MEASUREMENT_LABEL[k]}</option>)}
            </Select>
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div className="min-w-0">
            <Label htmlFor={`${idPrefix}-value`} className="mb-1.5 block text-xs text-axiom-zinc-600">
              {MEASUREMENT_LABEL[kind]} ({unit})
            </Label>
            <div className="relative">
              <Input
                id={`${idPrefix}-value`} type="number" inputMode="decimal" step="any" min={0} value={value}
                onChange={(e) => { setValue(e.target.value); setSaved(false); }}
                className="h-11 rounded-xl pr-12 text-base tabular-nums md:text-sm"
              />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-axiom-zinc-500">{unit}</span>
            </div>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-date`} className="mb-1.5 block text-xs text-axiom-zinc-600">Date</Label>
            <Input id={`${idPrefix}-date`} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value || today)} className="h-11 w-[9.5rem] rounded-xl text-base md:text-sm" />
          </div>
        </div>
        {add.isError && <div className="mt-3"><InlineError>{errorMessage(add.error)}</InlineError></div>}
        <div className="mt-3 flex items-center gap-3">
          <PortalButton type="submit" disabled={!valid || add.isPending} className="flex-1">{add.isPending ? 'Saving…' : 'Save'}</PortalButton>
        </div>
        <p aria-live="polite" className="mt-2 min-h-4 text-xs text-axiom-success-ink">{saved ? 'Saved. Your trainer can see it.' : ''}</p>
      </form>
    </Card>
  );
}

export function LogScreen({ weightUnit }: { weightUnit: 'kg' | 'lb' }) {
  const history = useMeasurements();
  return (
    <div className="space-y-4">
      <ScreenTitle sub="Your trainer sees these as soon as you save.">Log</ScreenTitle>
      <EntryForm idPrefix="bw" kinds={['bodyweight']} weightUnit={weightUnit} title="Weigh-in" icon={<ScaleIcon />} />
      <EntryForm idPrefix="m" kinds={OTHER_KINDS} weightUnit={weightUnit} title="Body measurement" icon={<Ruler />} />
      <NutritionSection />

      <section aria-labelledby="hist-h">
        <Eyebrow className="mb-2 mt-6"><span id="hist-h">Measurement history</span></Eyebrow>
        {history.isPending ? <ListSkeleton /> : history.isError ? <LoadFailed onRetry={() => history.refetch()} /> : history.data.measurements.length === 0 ? (
          <EmptyState title="Nothing logged yet">Your first weigh-in starts the trend line.</EmptyState>
        ) : (
          <Card as="div" className="p-0">
            <ul className="divide-y divide-border">
              {history.data.measurements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.label || MEASUREMENT_LABEL[m.kind] || m.kind}</p>
                    <p className="text-xs text-axiom-zinc-500">{formatDay(m.date)}{m.source === 'trainer' ? ' · added by your trainer' : ''}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">{formatValue(m.value)}{m.unit ? ` ${m.unit}` : ''}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
