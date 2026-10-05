# Freestyle release — Oct 2026

Branch `feature/freestyle-logging-2026-10` (worktree `/home/ubuntu/fitness_ai_freestyle`).
Origin: user feedback (log workouts as you go with no rigid schedule; AI adapts
from the logs; meal photos miss items and drift between retakes).

**No DB migration.** New proposal kinds use `AdaptationProposal.kind` (free
string) and JSON `proposal`; the confirmed training phase lives in
`User.coachProfile` JSON under `trainingPhase`.

**Flags** (`backend/src/services/featureFlags.ts`, exposed on `/auth/me` →
`features`): `freestyle`, `logAdaptation`, `phaseInference`, `mealPhotoV2`.
Each = `X_ENABLED=1` globally or `X_USERS=<ids/emails>`. Every new behavior
must be a no-op when its flag is off — today's behavior is the fallback.

**Product rules (non-negotiable)**
- Confirm-first: no silent auto-apply. Every adaptation is a proposal card:
  what we noticed (numbers) → why (reasoning) → proposed change → Apply /
  Adjust / Decline, with undo. (Founder rule.)
- Gemini 3 vision calls keep the default temperature (Google: lowering it on
  Gemini 3 causes looping/degraded reasoning). Consistency comes from schema +
  DB-computed calories + image-hash cache.
- Descriptive enums never gate a request (e.g. `visibility`, `preparation`):
  unknown values are tolerated, never 400.
- Backdated logs (>2 days old) feed trends but never trigger pushes.

---

## Contracts

### 1. `GET /api/workouts/last` (existing, `routes/workouts.ts`) — additive
`ExerciseLast` gains:
```ts
suggestion: {
  weightKg: number | null;      // canonical kg; null = bodyweight / unknown
  reps: string;                 // "8" or "6-8"
  sets: number;
  rpe: number | null;
  action: 'add_load' | 'add_rep' | 'add_set' | 'hold' | 'reset' | 'resume' | 'deload' | 'drop_set' | 'repeat';
  basis: 'applied_target' | 'program_target' | 'trend';
  note: string;                 // one line, e.g. "Last two sessions felt easier at 80 kg × 8 — try 82.5 kg"
  proposalId: string | null;    // pending proposal backing it, if any
} | null;
```
Computed with or without a program (program target wins when present; then the
latest applied `next_session` target; then a trend-derived suggestion).
`suggestion` is `null` when the `logAdaptation` flag is off or there are < 2 exposures.

### 2. Exercise picker — `GET /api/workouts/exercise-names?q=<text>&limit=20`
```ts
{ names: Array<{ name: string; canonical: string; source: 'history' | 'library'; lastDate: string | null; count: number }> }
```
History first (user's canonicalized logged names, most recent), then the seed
library. Works regardless of flags.

### 3. Freestyle home — `GET /api/training/freestyle`
```ts
{
  enabled: boolean;               // freestyle flag
  hasProgram: boolean;
  recentSessions: Array<{ id: string; date: string; title: string | null; exerciseCount: number; setCount: number; topLifts: string[] }>; // last 10
  liftTrends: Array<{ key: string; name: string; trend: 'progressing' | 'plateau' | 'declining' | 'insufficient'; pctPerWeek: number; spark: number[]; lastTop: { weightKg: number | null; reps: number; rpe: number | null } | null; lastDate: string }>; // top 6 by recency × frequency
  phase: PhaseResult | null;      // contract 6
  pendingProposals: number;
  weeklySessions: number[];       // last 8 ISO weeks, oldest → newest
}
```

### 4. Program ↔ freestyle
- `POST /api/coach/program/freestyle` → archives `savedProgram` into
  `CompletedProgram` (reason `'freestyle'`), clears `savedProgram` /
  `programStartDate` / `splitLabel`. Returns `{ ok: true, archivedId }`.
- `POST /api/coach/program/restore` → restores the most recent `'freestyle'`
  archive. Returns `{ ok: true }` or 404.

### 5. New proposal kinds (`AdaptationProposal.kind` + payload)
```ts
| { kind: 'next_session'; key: string; exercise: string; action: SuggestionAction;
    fromWeightKg: number | null; toWeightKg: number | null; reps: string; sets: number; rpe: number | null }
| { kind: 'deload'; keys: string[]; exercises: string[]; volumeCutPct: number; weeks: 1; reason: 'systemic_fatigue' | 'plateau_high_volume' }
| { kind: 'volume_balance'; muscle: string; currentSets: number; suggestedSets: number; direction: 'add' | 'reduce' | 'rebalance'; note: string }
| { kind: 'phase_confirm'; phase: TrainingPhase; previous: TrainingPhase | null; evidence: EvidenceLine[] }
| { kind: 'calorie_adjust'; fromKcal: number; toKcal: number; reason: 'cut_too_aggressive' | 'surplus_too_large' }
```
Apply semantics:
- `next_session` with a program → same as `load_change` (patch program target).
  Without a program → no program write; the latest applied `next_session`
  per `key` IS that lift's target (feeds contract 1, `basis: 'applied_target'`).
  `edits` may override `toWeightKg`/`reps`/`sets` (the "Adjust" path).
- `deload` → without a program: next-session suggestions for the listed keys
  carry `action:'deload'` for 7 days. With a program: existing deload path if
  present, else same as without.
- `phase_confirm` → writes `coachProfile.trainingPhase = { phase, confirmedAt, source: 'confirmed' }`.
- `calorie_adjust` → updates `User.dailyCalorieTarget` (inverse restores it).
- `volume_balance` → advisory; apply records acceptance (affects suggestions
  that add/remove a set for that muscle's lifts).
- Undo restores the inverse for every kind.

The mobile `AdaptationCard` must render all five kinds (title/evidence/
reasoning are generic; the "proposed change" block is kind-specific).

### 6. Phase — `GET /api/training/phase`, `POST /api/training/phase`
```ts
type TrainingPhase = 'building_strength' | 'cutting' | 'cut_too_aggressive' | 'building_muscle' | 'recomp' | 'plateau' | 'rebuilding_consistency' | 'unknown';
interface PhaseResult {
  inferred: TrainingPhase; confidence: number;           // 0..1
  evidence: Array<{ label: string; value: string }>;
  since: string | null;                                   // ISO date the pattern started
  confirmed: { phase: TrainingPhase; confirmedAt: string; source: 'confirmed' | 'user_set' } | null;
  effective: TrainingPhase;                               // confirmed ?? (confidence ≥ 0.6 ? inferred : 'unknown')
  maintenanceKcal: number | null; maintenanceSource: 'adaptive' | 'formula' | null;
  statedGoalMismatch: string | null;                      // e.g. "You said bulk, but bodyweight has fallen for 3 weeks"
}
```
`POST { phase: TrainingPhase | 'auto' }` sets/clears `coachProfile.trainingPhase` (`source:'user_set'`).
Backend module: `backend/src/services/phaseInference.ts` exporting
`inferPhase(userId: string, now?: Date): Promise<PhaseResult>` (pure core
`classifyPhase(input)` exported separately for tests).

### 7. Training summary for the agent — `backend/src/services/trainingSummary.ts`
`buildTrainingSummary(userId: string): Promise<string | null>` — compact text
block (≤ ~1,200 chars) injected into agent context: last 14 days of sessions,
per-lift trends, strength-profile highlights (wins / imbalances / neglected /
stalled), effective phase, pending suggestions. Imports `inferPhase` (contract 6)
and `listPending` (existing).

### 8. Meal photo — `POST /api/nutrition/analyze-photo` (additive; v2 behind `mealPhotoV2`)
Request:
```ts
{ imageBase64?: string; mimeType?: string;                     // legacy single photo
  images?: Array<{ base64: string; mimeType: string }>;        // 1–3 photos of ONE meal
  existingItems?: MealItem[];                                  // "add photo": return only NEW items
  regionHint?: string }
```
Response = all legacy fields (name, calories, proteinG, carbsG, fatG,
confidence, notes, ingredients, nutrients, …; totals = sum of items) plus:
```ts
items: MealItem[];
framingWarning: string | null;   // e.g. "A bowl looks cut off on the left — add a photo?"
noFoodDetected: boolean;
analysisId: string;              // log correlation
interface MealItem {
  id: string; name: string; preparation: string | null;
  grams: number | null; visibility: 'full' | 'partial' | 'inferred' | string;
  calories: number; proteinG: number; carbsG: number; fatG: number;
  per100g: { calories: number; proteinG: number; carbsG: number; fatG: number } | null; // client rescales on gram edit
  source: 'usda' | 'model';
}
```
**Amendment (food backend):** item `id`s are server-issued (`<10-hex>-<n>`) —
clients MUST send back the ids they were given in `existingItems`. An add-photo
call is free only if one of its ids was issued to the same user within 2h,
max 3 free add-photos per original scan; otherwise it counts as a scan (still
works). With the `mealPhotoV2` flag OFF the server ignores `existingItems` and
uses only `images[0]` — clients must only offer add-photo / multi-photo when
`features.mealPhotoV2` is true.

With `existingItems`, `items` contains only newly found items; legacy totals
cover only those new items too (client merges). Multi-photo or add-photo calls
count as ONE scan against the free quota (add-photo calls with
`existingItems` don't count). Flag off → today's behavior, but `items` still
returned as a single meal-level item so the v2 capture screen stops breaking.

---

## Workstreams & file ownership

| WS | Owner | Files |
|---|---|---|
| E + D5 food backend + generator | agent `backend-food` | `services/llmService.ts` (analyzeMealPhoto, program generator prompt), new `services/food/mealPhoto*.ts`, `services/nutritionEnrichmentService.ts`, `routes/nutrition.ts` (analyze-photo only), `routes/nutritionShared.ts` |
| B + C + A-backend | agent `backend-adaptation` | `adaptation/**`, new `services/phaseInference.ts`, `routes/adaptation.ts`, `routes/workouts.ts`, `routes/training.ts`, `routes/coach.ts` (freestyle/restore endpoints only), `services/workoutLogService.ts` |
| D1–D4 strength + agent | agent `backend-coach` | `routes/strength.ts`, `services/progressService.ts`, `services/athleteModelService.ts`/`muscleLedgerService.ts`, new `services/trainingSummary.ts`, `agent/**` |
| A + F mobile | agent `mobile` | `mobileAlt/**` |

Shared files: `featureFlags.ts` / `auth.ts` already done — don't edit. If you
must touch another workstream's file, keep the change minimal and say so in
your report.

## Verification gates (before release)
- Unit tests per workstream (synthetic histories for every rule & phase).
- Full backend vitest green (run once at the end, serialized).
- Food benchmark: item recall ≥ 96%, same-photo variance 0%, retake spread ≤ 5%.
- Aggregate prod dry run of rules (counts only) — needs founder approval.
- Manual pass on the onboarding test account.

## Release
Merge → backend build + rsync dist + restart (no db push) → OTA 3.2.0 from
main (verify with `eas update:list`) → backport OTA to 3.1.0 → flags on for
founders + requesting user → global after ~48h clean.
