import { describe, it, expect, vi } from 'vitest';
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) {}) }));
import { AppleExportReader } from '../services/wearables/appleExport.js';
import { dayColumns, workoutColumns } from '../services/wearables/ingest.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_CA">
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Anupta’s iPhone" unit="count" startDate="2026-10-01 08:00:00 -0400" endDate="2026-10-01 08:10:00 -0400" value="4000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Anupta’s Apple Watch" unit="count" startDate="2026-10-01 08:00:00 -0400" endDate="2026-10-01 08:10:00 -0400" value="4200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Anupta’s Apple Watch" unit="count" startDate="2026-10-01 18:00:00 -0400" endDate="2026-10-01 18:10:00 -0400" value="3000"/>
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Anupta’s Apple Watch" unit="kcal" startDate="2026-10-01 18:00:00 -0400" endDate="2026-10-01 19:00:00 -0400" value="410.5"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Anupta’s Apple Watch" unit="count/min" startDate="2026-10-01 07:00:00 -0400" endDate="2026-10-01 23:00:00 -0400" value="56"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Anupta’s Apple Watch" unit="ms" startDate="2026-10-01 03:00:00 -0400" endDate="2026-10-01 03:01:00 -0400" value="48"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Anupta’s Apple Watch" unit="ms" startDate="2026-10-01 05:00:00 -0400" endDate="2026-10-01 05:01:00 -0400" value="52"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Anupta’s Apple Watch" startDate="2026-09-30 23:10:00 -0400" endDate="2026-10-01 06:50:00 -0400" value="HKCategoryValueSleepAnalysisInBed"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Anupta’s Apple Watch" startDate="2026-09-30 23:20:00 -0400" endDate="2026-10-01 01:20:00 -0400" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Anupta’s Apple Watch" startDate="2026-10-01 01:20:00 -0400" endDate="2026-10-01 02:20:00 -0400" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Anupta’s Apple Watch" startDate="2026-10-01 02:20:00 -0400" endDate="2026-10-01 02:35:00 -0400" value="HKCategoryValueSleepAnalysisAwake"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Anupta’s Apple Watch" startDate="2026-10-01 02:35:00 -0400" endDate="2026-10-01 06:35:00 -0400" value="HKCategoryValueSleepAnalysisAsleepREM"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="62" durationUnit="min" sourceName="Anupta’s Apple Watch" startDate="2026-10-01 18:00:00 -0400" endDate="2026-10-01 19:02:00 -0400">
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2026-10-01 18:00:00 -0400" endDate="2026-10-01 19:02:00 -0400" sum="388.2" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-10-01 18:00:00 -0400" endDate="2026-10-01 19:02:00 -0400" average="121" minimum="80" maximum="164" unit="count/min"/>
 </Workout>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Anupta’s iPhone" unit="count" startDate="2026-01-01 08:00:00 -0500" endDate="2026-01-01 08:10:00 -0500" value="999"/>
</HealthData>`;

describe('Apple Health export', () => {
  const read = (since?: string) => { const r = new AppleExportReader(since); XML.split('\n').forEach((l) => r.line(l)); return r.result(); };

  it('takes the largest single source for steps (no double count), averages HRV, credits sleep to the wake day', () => {
    const { days } = read('2026-06-01');
    expect(days.map((d) => d.date)).toEqual(['2026-10-01']);
    const d = days[0];
    expect(d.steps).toBe(7200); // Watch 4200+3000, not + iPhone 4000
    expect(d.activeKcal).toBe(411);
    expect(d.restingHr).toBe(56);
    expect(d.hrvMs).toBe(50);
    expect(d.hrvMethod).toBe('sdnn');
    expect(d.sleep).toMatchObject({ minutes: 420, deep: 60, rem: 240, core: 120, awake: 15 }); // in-bed time not counted
    expect(() => dayColumns(d)).not.toThrow();
  });

  it('reads workouts with their energy and heart rate', () => {
    const { workouts } = read('2026-06-01');
    expect(workouts).toHaveLength(1);
    expect(workouts[0]).toMatchObject({ activityType: 'TraditionalStrengthTraining', activeKcal: 388, avgHr: 121, maxHr: 164, start: '2026-10-01T18:00:00-04:00' });
    expect(workoutColumns(workouts[0])).toMatchObject({ activityType: 'strength', durationMin: 62 });
  });

  it('skips records before `since`', () => {
    expect(read().days.map((d) => d.date)).toEqual(['2026-01-01', '2026-10-01']);
  });
});
