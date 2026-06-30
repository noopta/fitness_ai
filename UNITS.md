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
| `BodyWeightLog.weightLbs` | **lbs** | Consistent. Display layer converts lbs→preference. Left lbs-canonical (no migration needed); could move to kg later. |
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

## Deferred / out of scope (documented, low traffic)

- Legacy web `snapshot.tsx` + diagnostic `onboarding.tsx` weight inputs.
- Social/shared-workout display unit (shows the poster's unit, not the viewer's).
- `messages.tsx`, `institution-athlete-detail.tsx` display labels.
- Weight-progress notification milestone *cadence* is still lbs-based (5/10/15…);
  the displayed number is unit-correct, only the thresholds are imperial.
- Deeper diagnostic/plan-generation LLM prompts (structured data the client renders).
- Marketing pages (illustrative example weights — intentionally left).
