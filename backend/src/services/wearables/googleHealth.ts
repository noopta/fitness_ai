// Fitbit (and Pixel Watch) through the Google Health API — the replacement for
// the Fitbit Web API, which shuts off on 2026-10-30.
//
// The user signs in with Google once (OAuth, offline access); we keep their
// refresh token encrypted, pull daily data, and Google's webhook tells us when
// something changed. Everything is mapped into the same DayInput / WorkoutInput
// as Apple Health and the simulator.
//
// Some value field names aren't spelled out in Google's reference yet (the
// daily roll-up sums, VO2 max, respiratory rate), so those mappers take the
// first number in the value object rather than guessing a key. Verified
// against fixtures here; confirm against a live account (phase 1).

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaClient } from '@prisma/client';
import type { DayInput, WorkoutInput } from './types.js';
import { ingest } from './ingest.js';

const prisma = new PrismaClient();
const API = 'https://health.googleapis.com/v4';
const SCOPE = 'https://www.googleapis.com/auth/googlehealth';
export const GOOGLE_HEALTH_SCOPES = [
  `${SCOPE}.activity_and_fitness.readonly`,
  `${SCOPE}.health_metrics_and_measurements.readonly`,
  `${SCOPE}.sleep.readonly`,
  `${SCOPE}.profile.readonly`, // users/me/identity → healthUserId, which webhooks use
];

export const googleHealthConfigured = () => !!(process.env.GOOGLE_HEALTH_CLIENT_ID && process.env.GOOGLE_HEALTH_CLIENT_SECRET && process.env.GOOGLE_HEALTH_REDIRECT_URI);

// ── Secrets at rest and in the OAuth round trip ─────────────────────────────

function key(purpose: string): Buffer {
  const secret = process.env.WEARABLE_TOKEN_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('WEARABLE_TOKEN_KEY or JWT_SECRET must be set');
  return createHash('sha256').update(`wearables:${purpose}:${secret}`).digest();
}
export function sealTokens(t: GoogleTokens): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key('tokens'), iv);
  const body = Buffer.concat([c.update(JSON.stringify(t), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}
export function openTokens(sealed: string | null | undefined): GoogleTokens | null {
  if (!sealed) return null;
  try {
    const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', key('tokens'), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
  } catch { return null; }
}

const STATE_TTL_MS = 10 * 60_000;
/** userId + expiry, HMAC-signed: the callback can trust who started the flow. */
export function signState(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: now, n: randomBytes(8).toString('hex') })).toString('base64url');
  return `${payload}.${createHmac('sha256', key('state')).update(payload).digest('base64url')}`;
}
export function readState(state: string | undefined, now = Date.now()): string | null {
  const [payload, mac] = String(state ?? '').split('.');
  if (!payload || !mac) return null;
  const want = createHmac('sha256', key('state')).update(payload).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof u === 'string' && typeof t === 'number' && now - t <= STATE_TTL_MS ? u : null;
  } catch { return null; }
}

// ── OAuth ───────────────────────────────────────────────────────────────────

export interface GoogleTokens { access_token: string; refresh_token?: string; expires_at: number; scope?: string }

export function authUrl(userId: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_HEALTH_REDIRECT_URI!,
    response_type: 'code',
    scope: GOOGLE_HEALTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // always hand back a refresh token
    include_granted_scopes: 'true',
    state: signState(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!, client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET!, ...body }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google token exchange failed: ${j.error_description ?? j.error ?? r.status}`);
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000, scope: j.scope };
}
export const exchangeCode = (code: string) => tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: process.env.GOOGLE_HEALTH_REDIRECT_URI! });

/** A fresh access token for the user's Google Health connection (refreshing and re-sealing when needed). */
async function accessToken(userId: string): Promise<string> {
  const conn = await prisma.wearableConnection.findUnique({ where: { userId_provider: { userId, provider: 'google_health' } } });
  const t = openTokens(conn?.tokensEnc);
  if (!conn || conn.status !== 'connected' || !t) throw new Error('Fitbit isn’t connected.');
  if (t.expires_at - 60_000 > Date.now()) return t.access_token;
  if (!t.refresh_token) throw new Error('Fitbit access expired — reconnect it.');
  try {
    const fresh = await tokenRequest({ refresh_token: t.refresh_token, grant_type: 'refresh_token' });
    await prisma.wearableConnection.update({ where: { id: conn.id }, data: { tokensEnc: sealTokens({ ...fresh, refresh_token: fresh.refresh_token ?? t.refresh_token }) } });
    return fresh.access_token;
  } catch (e: any) {
    // invalid_grant = the user revoked access in their Google account.
    await prisma.wearableConnection.update({ where: { id: conn.id }, data: { status: 'error', lastError: String(e?.message ?? e).slice(0, 200) } });
    throw e;
  }
}

async function api(token: string, path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${API}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (r.status === 404) return {};
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Health ${path.split('?')[0]}: ${j?.error?.message ?? r.status}`);
  return j;
}

/** Every page of a dataPoints.list call. */
async function listAll(token: string, dataType: string, filter: string, max = 2000): Promise<any[]> {
  const out: any[] = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ filter, ...(pageToken ? { pageToken } : {}) });
    const j = await api(token, `users/me/dataTypes/${dataType}/dataPoints?${q}`);
    out.push(...(j.dataPoints ?? []));
    pageToken = j.nextPageToken ?? '';
  } while (pageToken && out.length < max);
  return out;
}

// ── Mapping Google's shapes (pure, tested) ──────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
/** {year, month, day} → YYYY-MM-DD. */
export const civilDate = (d: any): string | null => (d?.year && d?.month && d?.day ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : null);
const num = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) ? n : null; };
/** The first number in a value object — for roll-up and daily fields Google hasn't documented by name yet. */
export function firstNumber(o: any, prefer: string[] = []): number | null {
  if (!o || typeof o !== 'object') return null;
  for (const k of prefer) { const v = num(o[k]); if (v != null) return v; }
  for (const v of Object.values(o)) { const n = num(v); if (n != null) return n; }
  return null;
}
const dayOf = (days: Map<string, DayInput>, date: string) => { let d = days.get(date); if (!d) { d = { date }; days.set(date, d); } return d; };

/** dailyRollUp responses for steps / active-energy-burned → per-day totals. */
export function mapRollups(points: any[], field: 'steps' | 'activeEnergyBurned', into: Map<string, DayInput>, key: 'steps' | 'activeKcal') {
  for (const p of points) {
    const date = civilDate(p?.civilStartTime?.date);
    const v = firstNumber(p?.[field], field === 'steps' ? ['countSum', 'count_sum'] : ['kcalSum', 'energyKcalSum', 'kilocaloriesSum']);
    if (date && v != null) (dayOf(into, date) as any)[key] = v;
  }
}

/** daily-* list results (resting HR, HRV, VO2 max, respiratory rate, sleep temperature) → day fields. */
export function mapDaily(points: any[], into: Map<string, DayInput>) {
  for (const p of points) {
    if (p.dailyRestingHeartRate) { const date = civilDate(p.dailyRestingHeartRate.date); const v = num(p.dailyRestingHeartRate.beatsPerMinute); if (date && v != null) dayOf(into, date).restingHr = v; }
    if (p.dailyHeartRateVariability) {
      const h = p.dailyHeartRateVariability; const date = civilDate(h.date);
      const v = num(h.averageHeartRateVariabilityMilliseconds) ?? num(h.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds);
      if (date && v != null) Object.assign(dayOf(into, date), { hrvMs: v, hrvMethod: 'rmssd' as const }); // Fitbit HRV is RMSSD
    }
    if (p.dailyVo2Max) { const date = civilDate(p.dailyVo2Max.date); const v = firstNumber(p.dailyVo2Max, ['vo2Max', 'vo2MaxMillilitersPerMinuteKilogram']); if (date && v != null && v > 10) dayOf(into, date).vo2max = v; }
    if (p.dailyRespiratoryRate) { const date = civilDate(p.dailyRespiratoryRate.date); const v = firstNumber(p.dailyRespiratoryRate, ['breathsPerMinute', 'fullSleepBreathsPerMinute']); if (date && v != null && v < 60) dayOf(into, date).respiratoryRate = v; }
    if (p.dailySleepTemperatureDerivations) {
      const t = p.dailySleepTemperatureDerivations; const date = civilDate(t.date);
      const nightly = num(t.nightlyTemperatureCelsius), base = num(t.baselineTemperatureCelsius);
      if (date && nightly != null && base != null) dayOf(into, date).wristTempDeltaC = Math.round((nightly - base) * 100) / 100;
    }
  }
}

/** sleep sessions → nights (main sleep only), credited to the wake day. */
export function mapSleep(points: any[], into: Map<string, DayInput>) {
  for (const p of points) {
    const s = p.sleep;
    if (!s || s.metadata?.nap === true || s.metadata?.mainSleep === false) continue;
    const end = s.interval?.endTime, start = s.interval?.startTime;
    const date = civilDate(s.interval?.civilEndTime?.date) ?? (end ? String(end).slice(0, 10) : null);
    if (!date) continue;
    const stage = (t: string) => num((s.summary?.stagesSummary ?? []).find((x: any) => x.type === t)?.minutes) ?? 0;
    const asleep = num(s.summary?.minutesAsleep);
    if (!asleep) continue;
    dayOf(into, date).sleep = {
      minutes: asleep,
      deep: stage('DEEP'), rem: stage('REM'), core: stage('LIGHT') + stage('ASLEEP'),
      awake: num(s.summary?.minutesAwake) ?? stage('AWAKE'),
      start: start ?? null, end: end ?? null,
    };
  }
}

/** exercise sessions → workouts. */
export function mapExercise(points: any[]): WorkoutInput[] {
  return points.filter((p) => p.exercise?.interval?.startTime && p.exercise?.interval?.endTime).map((p) => {
    const e = p.exercise, m = e.metricsSummary ?? {};
    const mm = num(m.distanceMillimeters);
    return {
      id: String(p.name ?? `${e.interval.startTime}`),
      start: e.interval.startTime,
      end: e.interval.endTime,
      activityType: String(e.exerciseType ?? e.displayName ?? 'OTHER').toLowerCase(),
      activeKcal: num(m.caloriesKcal),
      avgHr: num(m.averageHeartRateBeatsPerMinute),
      distanceM: mm == null ? null : mm / 1000,
      sourceName: e.displayName ?? 'Fitbit',
    };
  });
}

const shift = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const civil = (d: string) => { const [year, month, day] = d.split('-').map(Number); return { date: { year, month, day } }; };

/** Pull [from, to] (local dates, inclusive) for a user and store it. */
export async function pullGoogleHealth(userId: string, from: string, to: string) {
  const token = await accessToken(userId);
  const days = new Map<string, DayInput>();
  const end = shift(to, 1); // ranges are closed-open
  const rollup = (type: string) => api(token, `users/me/dataTypes/${type}/dataPoints:dailyRollUp`, { method: 'POST', body: JSON.stringify({ range: { start: civil(from), end: civil(end) }, windowSizeDays: 1 }) }).then((j) => j.rollupDataPoints ?? []);
  const daily = (type: string, field: string) => listAll(token, type, `${field}.date >= "${from}" AND ${field}.date < "${end}"`);
  const safe = <T>(p: Promise<T>, empty: T) => p.catch((e) => { console.warn('[googleHealth]', e?.message ?? e); return empty; });

  const [steps, kcal, rhr, hrv, vo2, resp, temp, sleep, exercise] = await Promise.all([
    safe(rollup('steps'), []),
    safe(rollup('active-energy-burned'), []),
    safe(daily('daily-resting-heart-rate', 'dailyRestingHeartRate'), []),
    safe(daily('daily-heart-rate-variability', 'dailyHeartRateVariability'), []),
    safe(daily('daily-vo2-max', 'dailyVo2Max'), []),
    safe(daily('daily-respiratory-rate', 'dailyRespiratoryRate'), []),
    safe(daily('daily-sleep-temperature-derivations', 'dailySleepTemperatureDerivations'), []),
    safe(listAll(token, 'sleep', `sleep.interval.civil_end_time >= "${from}" AND sleep.interval.civil_end_time < "${end}"`), []),
    safe(listAll(token, 'exercise', `exercise.interval.civil_start_time >= "${from}" AND exercise.interval.civil_start_time < "${end}"`), []),
  ]);
  mapRollups(steps, 'steps', days, 'steps');
  mapRollups(kcal, 'activeEnergyBurned', days, 'activeKcal');
  mapDaily([...rhr, ...hrv, ...vo2, ...resp, ...temp], days);
  mapSleep(sleep, days);
  return ingest(userId, 'google_health', { days: [...days.values()], workouts: mapExercise(exercise) });
}

/** OAuth callback: store the connection and the healthUserId, then pull 30 days. */
export async function completeConnection(userId: string, code: string, today: string) {
  const tokens = await exchangeCode(code);
  const identity = await api(tokens.access_token, 'users/me/identity').catch(() => ({}));
  await prisma.wearableConnection.upsert({
    where: { userId_provider: { userId, provider: 'google_health' } },
    create: { userId, provider: 'google_health', status: 'connected', tokensEnc: sealTokens(tokens), externalUserId: identity?.healthUserId ?? null, scopes: tokens.scope ?? null },
    update: { status: 'connected', tokensEnc: sealTokens(tokens), externalUserId: identity?.healthUserId ?? undefined, scopes: tokens.scope ?? null, lastError: null },
  });
  return pullGoogleHealth(userId, shift(today, -29), today);
}

/** Pull the last few days if the Google source hasn't synced recently — cheap freshness for recovery reads. */
export async function refreshIfStale(userId: string, today: string, maxAgeMs = 3 * 3600_000) {
  const conn = await prisma.wearableConnection.findUnique({ where: { userId_provider: { userId, provider: 'google_health' } } });
  if (!conn || conn.status !== 'connected' || (conn.lastSyncAt && Date.now() - conn.lastSyncAt.getTime() < maxAgeMs)) return null;
  return pullGoogleHealth(userId, shift(today, -2), today);
}

/** Pull stale Fitbit data first, but never make a read wait more than a few seconds for it. */
export async function freshen(userId: string, today: string) {
  await Promise.race([refreshIfStale(userId, today).catch(() => null), new Promise((r) => setTimeout(r, 6000))]);
}

// ── Webhook ─────────────────────────────────────────────────────────────────

/** The Authorization header Google sends matches our subscriber secret (constant-time). */
export function webhookAuthorized(header: string | undefined): boolean {
  const want = process.env.GOOGLE_HEALTH_WEBHOOK_SECRET;
  if (!want || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(want.startsWith('Bearer ') ? want : `Bearer ${want}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Notifications (one object or an array) → per Google user, the local date range that changed. */
export function changedRanges(body: any): Map<string, { from: string; to: string }> {
  const list = Array.isArray(body) ? body : [body];
  const out = new Map<string, { from: string; to: string }>();
  for (const n of list) {
    const d = n?.data ?? n;
    const user = d?.healthUserId;
    if (!user || d?.type === 'verification') continue;
    for (const i of d.intervals ?? []) {
      const a = String(i?.civilIso8601TimeInterval?.startTime ?? i?.physicalTimeInterval?.startTime ?? '').slice(0, 10);
      const b = String(i?.civilIso8601TimeInterval?.endTime ?? i?.physicalTimeInterval?.endTime ?? a).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) continue;
      const cur = out.get(user);
      out.set(user, { from: cur && cur.from < a ? cur.from : a, to: cur && cur.to > b ? cur.to : (/^\d{4}-\d{2}-\d{2}$/.test(b) ? b : a) });
    }
  }
  return out;
}

/** Pull what a webhook says changed, for every connected user it names. */
export async function handleNotifications(body: any) {
  for (const [healthUserId, range] of changedRanges(body)) {
    const conn = await prisma.wearableConnection.findFirst({ where: { provider: 'google_health', externalUserId: healthUserId, status: 'connected' } });
    if (!conn) continue;
    // A notification can name a long range; cap it so one message can't trigger a 90-day pull.
    const from = range.from < shift(range.to, -6) ? shift(range.to, -6) : range.from;
    await pullGoogleHealth(conn.userId, from, range.to).catch((e) => console.warn('[googleHealth] webhook pull failed:', e?.message ?? e));
  }
}
