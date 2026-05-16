// Frontend types for the Athlete Model payload returned by /strength/profile
// when the muscle-drilldown feature flag is on. Mirrors the backend shapes
// in athleteModelService.ts / insightEngine.ts / etc. Kept as a standalone
// type module so the strength components stay strictly typed against the
// API contract.

export type MuscleTrend = 'improving' | 'plateau' | 'declining' | 'insufficient-data';
export type IntensityZone = 'strength' | 'hypertrophy' | 'endurance' | 'power';

export interface MuscleLedgerEntry {
  muscle: string;
  strengthScore: number;        // 0-100
  weeklyTonnageKg: number;
  weeklyHardSets: number;
  zoneDistribution: Record<IntensityZone, number>; // fractions, ~sum to 1
  trend: MuscleTrend;
  trendSlopePerWeekKg: number;
  confidence: number;           // 0-1
  lastTrainedDaysAgo: number | null;
}

export interface MuscleLedger {
  entries: Record<string, MuscleLedgerEntry>;
  windowWeeks: number;
  computedAt: string;
}

export type RatioStatus = 'in-band' | 'high' | 'low' | 'no-data';

export interface RatioResult {
  id: string;
  name: string;
  value: number | null;
  band: [number, number];
  status: RatioStatus;
  severity: number;             // 0-1
  note: string;
}

export type RelStrengthTier = 'untested' | 'novice' | 'intermediate' | 'advanced' | 'elite';

export interface RelStrengthResult {
  lift: string;
  ratioToBw: number | null;
  tier: RelStrengthTier;
}

export interface BalanceResult {
  id: string;
  name: string;
  ratio: number | null;
  band: [number, number];
  status: RatioStatus;
  severity: number;
}

export interface PatternCoverage {
  pattern: string;
  label: string;
  trailingSets: number;
  status: 'covered' | 'light' | 'neglected';
}

export type InsightKind = 'stagnation' | 'imbalance' | 'neglect' | 'win';
export type InsightPriority = 'high' | 'medium' | 'low';

export interface Insight {
  id: string;
  kind: InsightKind;
  priority: InsightPriority;
  title: string;
  detail: string;
  metric?: string;
  ctaHint?: string;
}

export interface RecoveryFactor {
  id: string;
  severity: number;
  note: string;
}

export interface AthleteModel {
  ledger: MuscleLedger;
  confidence: number;           // 0-1 overall
  ratios: RatioResult[];
  relativeStrength: RelStrengthResult[];
  balance: BalanceResult[];
  patternCoverage: PatternCoverage[];
  insights: Insight[];
  recoveryFactors: RecoveryFactor[];
  computedAt: string;
}
