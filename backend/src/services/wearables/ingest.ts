// Writing wearable data. A source sends whatever it has for a day — the phone
// may send steps now and sleep an hour later — so a sync only fills the fields
// it carries and never blanks one it left out.

import { PrismaClient } from '@prisma/client';
import { dayInputSchema, workoutInputSchema, normaliseActivity, type Provider, type DayInput, type WorkoutInput } from './types.js';

const prisma = new PrismaClient();

/** A day input as WearableDay columns; keys absent from the input are absent here too. */
export function dayColumns(input: DayInput): Record<string, unknown> {
  const d = dayInputSchema.parse(input);
  const s = d.sleep ?? undefined;
  const cols: Record<string, unknown> = {
    steps: d.steps == null ? undefined : Math.round(d.steps),
    activeKcal: d.activeKcal == null ? undefined : Math.round(d.activeKcal),
    restingHr: d.restingHr ?? undefined,
    hrvMs: d.hrvMs ?? undefined,
    hrvMethod: d.hrvMs != null ? (d.hrvMethod ?? undefined) : undefined,
    sleepMinutes: s?.minutes == null ? undefined : Math.round(s.minutes),
    sleepDeepMin: s?.deep == null ? undefined : Math.round(s.deep),
    sleepRemMin: s?.rem == null ? undefined : Math.round(s.rem),
    sleepCoreMin: s?.core == null ? undefined : Math.round(s.core),
    sleepAwakeMin: s?.awake == null ? undefined : Math.round(s.awake),
    sleepStart: s?.start ? new Date(s.start) : undefined,
    sleepEnd: s?.end ? new Date(s.end) : undefined,
    vo2max: d.vo2max ?? undefined,
    respiratoryRate: d.respiratoryRate ?? undefined,
    wristTempDeltaC: d.wristTempDeltaC ?? undefined,
    wornMinutes: d.wornMinutes == null ? undefined : Math.round(d.wornMinutes),
  };
  return Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined));
}

export function workoutColumns(input: WorkoutInput) {
  const w = workoutInputSchema.parse(input);
  const startAt = new Date(w.start);
  const endAt = new Date(w.end);
  return {
    externalId: w.id,
    startAt,
    endAt,
    activityType: normaliseActivity(w.activityType),
    durationMin: Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60_000)),
    activeKcal: w.activeKcal == null ? null : Math.round(w.activeKcal),
    avgHr: w.avgHr ?? null,
    maxHr: w.maxHr ?? null,
    distanceM: w.distanceM ?? null,
    sourceName: w.sourceName ?? null,
  };
}

export interface IngestResult { days: number; workouts: number; skipped: number }

/** Upsert a batch from one source and mark the connection synced. */
export async function ingest(userId: string, provider: Provider, batch: { days?: DayInput[]; workouts?: WorkoutInput[] }): Promise<IngestResult> {
  let days = 0, workouts = 0, skipped = 0;
  for (const raw of batch.days ?? []) {
    let cols: Record<string, unknown>;
    try { cols = dayColumns(raw); } catch { skipped++; continue; }
    if (!Object.keys(cols).length) continue;
    const date = String(raw.date);
    await prisma.wearableDay.upsert({
      where: { userId_provider_date: { userId, provider, date } },
      create: { userId, provider, date, ...cols },
      update: cols,
    });
    days++;
  }
  for (const raw of batch.workouts ?? []) {
    let w: ReturnType<typeof workoutColumns>;
    try { w = workoutColumns(raw); } catch { skipped++; continue; }
    if (w.endAt <= w.startAt) { skipped++; continue; }
    const { externalId, ...rest } = w;
    await prisma.wearableWorkout.upsert({
      where: { userId_provider_externalId: { userId, provider, externalId } },
      create: { userId, provider, externalId, ...rest },
      update: rest,
    });
    workouts++;
  }
  await prisma.wearableConnection.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, status: 'connected', lastSyncAt: new Date() },
    update: { status: 'connected', lastSyncAt: new Date(), lastError: null },
  });
  return { days, workouts, skipped };
}

/** Disconnect a source; optionally delete everything it sent. */
export async function disconnect(userId: string, provider: Provider, deleteData: boolean) {
  await prisma.wearableConnection.updateMany({ where: { userId, provider }, data: { status: 'revoked', tokensEnc: null } });
  if (!deleteData) return { deleted: 0 };
  const [d, w] = await Promise.all([
    prisma.wearableDay.deleteMany({ where: { userId, provider } }),
    prisma.wearableWorkout.deleteMany({ where: { userId, provider } }),
  ]);
  return { deleted: d.count + w.count };
}
