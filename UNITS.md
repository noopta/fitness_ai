# Weight units — canonical model

_Supersedes the older `IMPERIAL_UNITS.md` (which described the deprecated `frontend/`)._

European/metric support ships as a per-user **display preference**; storage is one
canonical unit and clients convert at the edges.

## The rules

1. **Display preference** lives on `User.unitPreference` (`'imperial' | 'metric'`).
   - Default **imperial** (US-first). Set to **metric** at signup when the
     `Accept-Language` region is EU/EEA/metric (see
     `backend/src/services/weightUnits.ts › detectUnitPreferenceFromAcceptLanguage`),
     or when the client passes an explicit preference. User-overridable in Settings
     (web: Settings ▸ Preferences; mobile: Settings ▸ Weight Unit) — the toggle
     persists to the backend, so it syncs across web + mobile.
   - Exposed in `/auth/me` + `PUT /auth/profile`.

2. **Canonical storage = kilograms.** Clients convert display→kg on input and
   kg→display on render. Conversion lives in ONE place per surface:
   - backend: `backend/src/services/weightUnits.ts`
   - web: `frontend-v2/client/src/lib/units.ts` (`useUnits()`)
   - mobile: `mobileAlt/src/context/UnitsContext.tsx` (`useUnits()`)
   Single conversion constant everywhere: `KG_PER_LB = 0.45359237` (exact pound).

3. **Server-generated copy** (LLM coach replies, push notifications) reads
   `unitPreference` and renders in the user's unit — the frontend can't intercept it.
   Done: coach-chat system context (`routes/coach.ts`), PR + weight-progress
   notifications (`notificationService.ts` via `progressService.ts`/`workouts.ts`).

## Per-field canonical (IMPORTANT — not everything is kg yet)

| Field | Canonical | Notes |
|---|---|---|
| `User.weightKg` | **kg** | ✓ clean |
| workout exercise `weightKg` (WorkoutLog JSON) | **kg** | Backend e1RM assumes kg. Web now converts on send (was a bug — see below). Mobile always sent kg. |
| `BodyWeightLog.weightKg` | **kg** | ✓ Migrated (2026-07). Canonical kg; legacy `weightLbs` retained nullable until the prod backfill is confirmed, then droppable. Readers use `bodyWeightKg(row)` (weightKg ?? lb→kg fallback). See "BodyWeightLog migration" below. |
| coachProfile strength-table lift weights | **lbs** | Sent to the program LLM as lbs. Clients convert metric input→lbs. |
| `ExerciseSnapshot.weight` | **ambiguous** | Legacy diagnostic flow; `weightUnit` was accepted but ignored. Web historically sent lbs. |
| `CompletedProgram.stats.totalVolumeLb` | **lbs** | Display-time aggregate. |
| nutrition macros (g/kcal), e1RM ratios | unit-neutral | No change. |

## Known historical-data caveats (why there is no blanket auto-migration)

- **Web-logged workouts pre-fix** stored **lbs in the kg field**, so the backend's
  `weightKg * 2.20462` e1RM inflated those rows ~2.2×. Fixed going forward (web now
  converts to kg on save; new EU users are correct from day one). **Old rows cannot
  be safely auto-converted**: there is no platform marker, and mobile rows in the same
  field are already true kg — a blanket conversion would corrupt the mobile data.
  Use the read-only audit (`backend/scripts/auditWeightUnits.ts`) to size the impact;
  re-logging or a per-user, human-reviewed fix is the only safe correction.

## BodyWeightLog migration (weightLbs → weightKg), 2026-07

Body weight was the last lbs-canonical field. It is now canonical **kg**, matching
everything else. Because Prisma + SQLite treats a column rename as drop+add (data
loss), the migration is **additive + backfill**, not a rename:

1. Schema adds `weightKg Float?` and makes `weightLbs Float?` nullable (legacy).
2. **Deploy order on prod (do NOT split generate/push):**
   ```
   cd backend
   npx prisma generate && npx prisma db push        # adds weightKg column
   npx tsx scripts/backfillBodyWeightKg.ts           # DRY RUN — prints row count
   npx tsx scripts/backfillBodyWeightKg.ts --apply    # writes weightKg = weightLbs × 0.45359237
   npm run build && sudo systemctl restart fitness-ai.service
   ```
   The backfill is idempotent (skips rows that already have weightKg) and safe:
   body weight was unambiguously entered on a scale in pounds (unlike the workout
   ambiguity above), so ×0.45359237 is exact. Take a DB snapshot first regardless.
3. All readers use `bodyWeightKg(row)` (weightKg, else lb→kg fallback), so the app
   is correct **before** the backfill too — the backfill just clears the legacy column.
4. API responses emit `weightKg` (canonical) **and** a derived `weightLbs` so older
   mobile builds keep working; `POST /coach/body-weight` accepts either.
5. Once every client ships the weightKg-aware build and the backfill is confirmed,
   `weightLbs` can be dropped from the schema.

Milestone cadence is now **unit-native**: the same round numbers (5/10/15…) mean kg
for metric users and lbs for imperial (was: lbs-only thresholds rendered in kg).

## Deferred / out of scope (documented, low traffic)

- Legacy diagnostic `onboarding.tsx` bodyweight → engine still passes lbs (engine is
  unit-neutral internally; input converted at the boundary via `kgToLb`).
- Deeper diagnostic/plan-generation LLM prompts (structured data the client renders).
- Marketing pages, blog posts, and standalone SEO calculator tools (own unit toggles) —
  intentionally left.
