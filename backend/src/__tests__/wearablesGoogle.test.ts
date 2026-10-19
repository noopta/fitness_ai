import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_HEALTH_WEBHOOK_SECRET = 'Bearer hook-secret';
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.wearableConnection = { findFirst: vi.fn(async () => null) }; }) }));

import { mapRollups, mapDaily, mapSleep, mapExercise, civilDate, firstNumber, signState, readState, sealTokens, openTokens, webhookAuthorized, changedRanges } from '../services/wearables/googleHealth.js';
import { dayColumns, workoutColumns } from '../services/wearables/ingest.js';

const D = (y: number, m: number, d: number) => ({ year: y, month: m, day: d });

describe('mapping Google Health data', () => {
  it('daily roll-ups for steps and active energy', () => {
    const days = new Map();
    mapRollups([{ civilStartTime: { date: D(2026, 10, 18) }, steps: { countSum: '9123' } }, { civilStartTime: { date: D(2026, 10, 19) }, steps: { count_sum: 4100 } }], 'steps', days, 'steps');
    mapRollups([{ civilStartTime: { date: D(2026, 10, 18) }, activeEnergyBurned: { someSum: 512.4 } }], 'activeEnergyBurned', days, 'activeKcal');
    expect(days.get('2026-10-18')).toMatchObject({ steps: 9123, activeKcal: 512.4 });
    expect(days.get('2026-10-19')).toMatchObject({ steps: 4100 });
  });

  it('daily resting HR, HRV (as RMSSD), VO2 max, respiratory rate, sleep temperature', () => {
    const days = new Map();
    mapDaily([
      { dailyRestingHeartRate: { date: D(2026, 10, 18), beatsPerMinute: '57' } },
      { dailyHeartRateVariability: { date: D(2026, 10, 18), averageHeartRateVariabilityMilliseconds: 38.5 } },
      { dailyVo2Max: { date: D(2026, 10, 18), vo2Max: 46.2 } },
      { dailyRespiratoryRate: { date: D(2026, 10, 18), breathsPerMinute: 14.8 } },
      { dailySleepTemperatureDerivations: { date: D(2026, 10, 18), nightlyTemperatureCelsius: 34.1, baselineTemperatureCelsius: 33.6 } },
    ], days);
    const d = days.get('2026-10-18');
    expect(d).toMatchObject({ restingHr: 57, hrvMs: 38.5, hrvMethod: 'rmssd', vo2max: 46.2, respiratoryRate: 14.8, wristTempDeltaC: 0.5 });
    expect(() => dayColumns(d)).not.toThrow();
  });

  it('main sleep only, credited to the wake day, with stages', () => {
    const days = new Map();
    mapSleep([
      { sleep: { interval: { startTime: '2026-10-18T03:10:00Z', endTime: '2026-10-18T10:40:00Z', civilEndTime: { date: D(2026, 10, 18) } }, metadata: { mainSleep: true },
        summary: { minutesAsleep: '421', minutesAwake: '29', stagesSummary: [{ type: 'DEEP', minutes: '68' }, { type: 'REM', minutes: '95' }, { type: 'LIGHT', minutes: '258' }, { type: 'AWAKE', minutes: '29' }] } } },
      { sleep: { interval: { startTime: '2026-10-18T19:00:00Z', endTime: '2026-10-18T19:40:00Z' }, metadata: { nap: true }, summary: { minutesAsleep: '38' } } },
    ], days);
    expect(days.size).toBe(1);
    expect(days.get('2026-10-18').sleep).toMatchObject({ minutes: 421, deep: 68, rem: 95, core: 258, awake: 29 });
  });

  it('exercise sessions become workouts', () => {
    const [w] = mapExercise([{ name: 'users/me/dataTypes/exercise/dataPoints/abc', exercise: { interval: { startTime: '2026-10-18T22:00:00Z', endTime: '2026-10-18T23:05:00Z' }, exerciseType: 'WEIGHTLIFTING', metricsSummary: { caloriesKcal: 402, averageHeartRateBeatsPerMinute: '118', distanceMillimeters: '0' } } }]);
    expect(w).toMatchObject({ id: 'users/me/dataTypes/exercise/dataPoints/abc', activeKcal: 402, avgHr: 118, distanceM: 0 });
    expect(workoutColumns(w)).toMatchObject({ activityType: 'strength', durationMin: 65 });
  });

  it('helpers', () => {
    expect(civilDate(D(2026, 1, 5))).toBe('2026-01-05');
    expect(civilDate({})).toBeNull();
    expect(firstNumber({ a: 'x', b: '7' })).toBe(7);
    expect(firstNumber({ a: 1, want: 2 }, ['want'])).toBe(2);
  });
});

describe('OAuth state and stored tokens', () => {
  it('state carries the user, rejects tampering and expiry', () => {
    const s = signState('user-1');
    expect(readState(s)).toBe('user-1');
    expect(readState(s.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))).toBeNull();
    expect(readState(signState('user-1', Date.now() - 11 * 60_000))).toBeNull();
    expect(readState(undefined)).toBeNull();
  });

  it('tokens are encrypted at rest and round-trip', () => {
    const t = { access_token: 'at', refresh_token: 'rt', expires_at: 123 };
    const sealed = sealTokens(t);
    expect(sealed).not.toContain('rt');
    expect(openTokens(sealed)).toEqual(t);
    expect(openTokens('garbage')).toBeNull();
  });
});

describe('webhook', () => {
  it('accepts only our secret, constant-time', () => {
    expect(webhookAuthorized('Bearer hook-secret')).toBe(true);
    expect(webhookAuthorized('Bearer nope')).toBe(false);
    expect(webhookAuthorized(undefined)).toBe(false);
  });

  it('reads the changed local dates per Google user from one or many notifications', () => {
    const one = { data: { healthUserId: 'h1', operation: 'UPSERT', dataType: 'steps', intervals: [{ civilIso8601TimeInterval: { startTime: '2026-10-18T00:00:00', endTime: '2026-10-19T00:00:00' } }] } };
    expect(changedRanges(one).get('h1')).toEqual({ from: '2026-10-18', to: '2026-10-19' });
    const many = [one, { data: { healthUserId: 'h1', intervals: [{ physicalTimeInterval: { startTime: '2026-10-15T08:00:00Z', endTime: '2026-10-15T09:00:00Z' } }] } }, { type: 'verification' }];
    expect(changedRanges(many).get('h1')).toEqual({ from: '2026-10-15', to: '2026-10-19' });
    expect(changedRanges({ type: 'verification' }).size).toBe(0);
  });

  describe('route handshake', () => {
    let app: express.Express;
    beforeAll(async () => {
      const { default: routes } = await import('../routes/wearablesGoogle.js');
      app = express(); app.use(express.json()); app.use('/api', routes);
    });
    it('verification: 200 with the secret, 401 without; notifications get 204', async () => {
      expect((await request(app).post('/api/wearables/google/webhook').set('Authorization', 'Bearer hook-secret').send({ type: 'verification' })).status).toBe(200);
      expect((await request(app).post('/api/wearables/google/webhook').send({ type: 'verification' })).status).toBe(401);
      expect((await request(app).post('/api/wearables/google/webhook').set('Authorization', 'Bearer hook-secret').send({ data: { healthUserId: 'h9', intervals: [] } })).status).toBe(204);
    });
    it('callback refuses a missing or forged state', async () => {
      expect((await request(app).get('/api/wearables/google/callback?code=x&state=forged.sig')).status).toBe(400);
    });
  });
});
