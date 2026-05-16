# Athlete Model — Design Handoff

**For:** the design pass (Claude Design / claude.ai/design)
**From:** engineering — the Athlete Model backend + first-pass UI are built and shipping
**Goal:** make the Strength Profile screen *visually stunning* and *digestible*. The data, logic, and component scaffolding exist. This document is the data contract + current state + the polish brief.

---

## 1. What the Athlete Model is

As a user logs workouts, the backend dissects every set into per-muscle stimulus and accumulates a continuously-reinforced model of the athlete — strength per muscle, training volume, intensity-zone mix, trends, and confidence. It then runs derived metrics (strength ratios, relative strength, balance) and a proactive insight engine over that model.

It exists to deliver **two payoffs**:

1. **Insight** — show the user the strong points and weak points in their build they'd never spot themselves. Science-backed metrics, visualized — *not* walls of text.
2. **Proactive coaching** — catch stagnation, imbalances, and neglected muscles automatically and tell the user what to fix. They should never have to self-diagnose.

The screen this lives on: the **Strength tab** (`app/(tabs)/strength-profile.tsx`).

> **Design north star:** an elite-trainer's read of an athlete, made visual. Lots of information, zero cognitive overload. If a section needs a paragraph to explain itself, it's wrong.

---

## 2. Where it lives — current section order on the Strength tab

```
┌─ Header (My Profile)
├─ Tab switcher (Strength | Nutrition)
├─ Tier hero card               ← existing
├─ Movement balance radar       ← existing, has drill-down (tap a movement → muscles)
├─ Anakin's Read   ★ NEW        ← the proactive insight feed
├─ Strength Balance ★ NEW       ← the ratio scoreboard
├─ Working e1RMs (lift list)    ← existing
├─ 1RM Trends chart             ← existing
└─ AI Insights (legacy text)    ← existing — likely SUPERSEDED by Anakin's Read; flag for removal
```

The two ★ NEW sections are the Athlete Model's first surfaces. **`relativeStrength` and `patternCoverage` data is returned by the API but not yet rendered** — designing surfaces for them is in scope (see §6).

Everything Athlete-Model is **feature-flagged** — only allowlisted accounts see it. Non-flagged users get the existing screen unchanged. The design pass should assume the flag is ON.

---

## 3. The data contract — `athleteModel`

`GET /api/strength/profile` returns an `athleteModel` object (only when the viewer's flag is on). Full shape:

```ts
interface AthleteModel {
  confidence: number;              // 0-1 — overall completeness of the model
  ledger: MuscleLedger;            // per-muscle accumulated record
  ratios: RatioResult[];           // strength-ratio diagnostics
  relativeStrength: RelStrengthResult[];  // e1RM ÷ bodyweight, tiered
  balance: BalanceResult[];        // antagonist muscle-pair balance
  patternCoverage: PatternCoverage[];     // movement-pattern coverage
  insights: Insight[];             // ranked proactive insight feed
  recoveryFactors: RecoveryFactor[];      // diet/sleep factors suppressing progress
  computedAt: string;              // ISO timestamp
}

interface MuscleLedger {
  entries: Record<string, MuscleLedgerEntry>;  // keyed by muscle name
  windowWeeks: number;             // trailing window the volume stats cover (4)
  computedAt: string;
}

interface MuscleLedgerEntry {
  muscle: string;                  // "Chest", "Lats", "Rear Delt", ... (~18-21 muscles)
  strengthScore: number;           // 0-100, user-relative (their strongest muscle = 100)
  weeklyTonnageKg: number;         // avg tonnage/week over the window
  weeklyHardSets: number;          // avg fractional hard-set count/week
  zoneDistribution: {              // fractions, sum ≈ 1
    strength: number; hypertrophy: number; endurance: number; power: number;
  };
  trend: 'improving' | 'plateau' | 'declining' | 'insufficient-data';
  trendSlopePerWeekKg: number;     // e1RM change per week (can be negative)
  confidence: number;              // 0-1 — data backing THIS muscle
  lastTrainedDaysAgo: number | null;
}

interface RatioResult {
  id: string;                      // "bench-row", "squat-deadlift", ...
  name: string;                    // "Bench : Row"
  value: number | null;            // null when a contributing lift is missing
  band: [number, number];          // healthy range, e.g. [1.0, 1.1]
  status: 'in-band' | 'high' | 'low' | 'no-data';
  severity: number;                // 0-1 — how far outside the band
  note: string;                    // plain-English meaning + fix
}

interface RelStrengthResult {
  lift: string;                    // "Bench Press", "Squat", "Deadlift", "Overhead Press"
  ratioToBw: number | null;        // e1RM ÷ bodyweight
  tier: 'untested' | 'novice' | 'intermediate' | 'advanced' | 'elite';
}

interface BalanceResult {
  id: string;
  name: string;                    // "Front vs Rear Delt", "Quads vs Hamstrings"
  ratio: number | null;
  band: [number, number];
  status: 'in-band' | 'high' | 'low' | 'no-data';
  severity: number;                // 0-1
}

interface PatternCoverage {
  pattern: string;                 // "horizontal-push", "vertical-pull", ...
  label: string;                   // "Horizontal Push"
  trailingSets: number;            // hard sets in the trailing window
  status: 'covered' | 'light' | 'neglected';
}

interface Insight {
  id: string;
  kind: 'stagnation' | 'imbalance' | 'neglect' | 'win';
  priority: 'high' | 'medium' | 'low';
  title: string;                   // short headline
  detail: string;                  // one-to-two sentence explanation
  metric?: string;                 // optional numeric callout, e.g. "0.45"
  ctaHint?: string;                // optional suggested action
}

interface RecoveryFactor {
  id: string;                      // "low-protein", "calorie-deficit", "poor-sleep", ...
  severity: number;                // 0-1
  note: string;                    // plain-English line
}
```

### Field notes that matter for design

- **`confidence` (model + per-muscle)** — this is a first-class concept, not a footnote. The model openly tells the user how complete its picture is. Design a confidence treatment that turns "incomplete" into "log more to sharpen this" — an incentive, not an apology.
- **`strengthScore` is user-relative** — 100 = the user's own strongest muscle, not a population percentile. Don't label it "percentile" or "rank." It answers "which of *my* muscles are strong/weak."
- **`trend` can be `insufficient-data`** — design that state; it's common for new users.
- **`zoneDistribution`** — the training-mix split. This is the scientifically-correct "fiber" insight: it shows whether a muscle is trained for strength vs size vs endurance. Worth a beautiful treatment.
- **`status: 'no-data'`** appears on ratios/balance when a contributing lift hasn't been logged. The note tells the user which lift unlocks it — design this as a gentle "unlock" prompt, not an error.
- **`insights` is already priority-ranked** — render in array order. `high` priority deserves visual weight.
- **`recoveryFactors`** — these get folded into stagnation insight `detail` text by the backend already, but the raw array is also returned in case design wants a dedicated "what's working against you" surface.

---

## 4. Sample payload (real data, trimmed)

This is an actual response from a test account — use it to mock against realistic shapes and values.

```json
{
  "confidence": 0.85,
  "ledger": {
    "windowWeeks": 4,
    "entries": {
      "Chest": {
        "muscle": "Chest", "strengthScore": 46,
        "weeklyTonnageKg": 1992, "weeklyHardSets": 3.5,
        "zoneDistribution": { "strength": 0.33, "hypertrophy": 0.35, "endurance": 0.32, "power": 0 },
        "trend": "plateau", "trendSlopePerWeekKg": -0.21,
        "confidence": 1, "lastTrainedDaysAgo": 5
      },
      "Front Delt": {
        "muscle": "Front Delt", "strengthScore": 44,
        "weeklyTonnageKg": 1372, "weeklyHardSets": 3.7,
        "zoneDistribution": { "strength": 0.47, "hypertrophy": 0.42, "endurance": 0.10, "power": 0 },
        "trend": "declining", "trendSlopePerWeekKg": -2.65,
        "confidence": 1, "lastTrainedDaysAgo": 5
      }
    }
  },
  "ratios": [
    {
      "id": "bench-row", "name": "Bench : Row", "value": null,
      "band": [1, 1.1], "status": "no-data", "severity": 0,
      "note": "Log Barbell Row to unlock this ratio."
    },
    {
      "id": "bench-ohp", "name": "Bench : Overhead Press", "value": 1.67,
      "band": [1.45, 1.55], "status": "high", "severity": 0.08,
      "note": "Horizontal press has outpaced vertical — add overhead work; likely upper-back / mobility limited."
    }
  ],
  "relativeStrength": [
    { "lift": "Bench Press", "ratioToBw": 1.34, "tier": "intermediate" },
    { "lift": "Squat", "ratioToBw": 1.67, "tier": "intermediate" }
  ],
  "balance": [
    { "id": "push-pull-delt", "name": "Front vs Rear Delt", "ratio": 2.32, "band": [0.85, 1.3], "status": "high", "severity": 0.78 },
    { "id": "quad-ham", "name": "Quads vs Hamstrings", "ratio": 1.4, "band": [1, 1.4], "status": "in-band", "severity": 0 }
  ],
  "patternCoverage": [
    { "pattern": "horizontal-push", "label": "Horizontal Push", "trailingSets": 19, "status": "covered" },
    { "pattern": "vertical-pull", "label": "Vertical Pull", "trailingSets": 0, "status": "neglected" }
  ],
  "insights": [
    {
      "id": "stall-face-pull", "kind": "stagnation", "priority": "high",
      "title": "Face Pull is sliding backward",
      "detail": "4 weeks without progress. The likely lock is your rear delt — it's the weakest link feeding this lift. Contributing factor: Average protein (76g/day) is below your ~141g target — muscle repair is under-fueled.",
      "ctaHint": "Add direct rear delt work"
    },
    {
      "id": "ratio-rdl-deadlift", "kind": "imbalance", "priority": "high",
      "title": "Romanian DL : Deadlift is out of balance",
      "detail": "You're a hinge avoider — hamstring strength lags. Add RDLs twice a week.",
      "metric": "0.45", "ctaHint": "Adjust your accessory split"
    },
    {
      "id": "win-quads", "kind": "win", "priority": "low",
      "title": "Your quads are climbing",
      "detail": "Steady upward trend over the last few weeks — keep the current stimulus, it's working."
    }
  ],
  "recoveryFactors": [
    { "id": "low-protein", "severity": 0.46, "note": "Average protein (76g/day) is below your ~141g target — muscle repair is under-fueled." },
    { "id": "calorie-deficit", "severity": 0.34, "note": "Bodyweight is down 4.2 lb — you've been in a calorie deficit." }
  ]
}
```

---

## 5. Current components — first-pass inventory

These exist, they work, they're wired to live data. The design pass replaces/refines their visuals — the data plumbing stays.

| Component | File | Renders | First-pass state |
|---|---|---|---|
| `RadarChart` | `src/components/strength/RadarChart.tsx` | Movement/muscle radar, 2-level drill | Has gradient fill, glow, lagging dots, morph animation. Functional + decent. |
| `RadarAxisDrillSheet` | `src/components/strength/RadarAxisDrillSheet.tsx` | Bottom sheet on axis tap — muscle ledger block + feeding lifts | Functional; ledger block is a plain stat row + stacked bar. |
| `TierHeroCard` | `src/components/strength/TierHeroCard.tsx` | Dark tier card + ladder | Already polished (prior handoff). |
| `InsightCard` | `src/components/strength/InsightCard.tsx` | One insight in "Anakin's Read" | **Plain first pass — prime candidate for redesign.** Kind-colored stripe + icon + text. |
| `RatioRow` | `src/components/strength/RatioRow.tsx` | One ratio in "Strength Balance" | **Plain first pass.** Name + value + mini band track. |
| `LiftRow` | `src/components/strength/LiftRow.tsx` | One lift in the e1RM list | Existing, fine. |

---

## 6. States to design

Each section needs these states mocked:

**Anakin's Read (insight feed)**
- Populated, mixed priorities (the common case — see sample)
- All-clear — zero insights, or only a `win`. The "nothing's wrong, here's a high-five" state.
- New user — `insufficient-data` everywhere; the feed should encourage logging.

**Strength Balance (ratios)**
- Mix of in-band + drifted + no-data rows (see sample)
- All no-data — brand-new user. Should read as "unlock these by logging X" not "empty."

**Per-muscle drill (RadarAxisDrillSheet ledger block)**
- `trend: improving / plateau / declining / insufficient-data` — four visual states
- High vs low per-muscle `confidence`
- A muscle with zero recent volume (neglected)

**Model confidence**
- Low (~0.3), medium (~0.6), high (~0.9). A single treatment that scales.

**Not-yet-rendered data needing brand-new surfaces:**
- `relativeStrength` — 4 lifts, each with a BW-multiple and a novice→elite tier. Wants a tiered/standards visualization.
- `patternCoverage` — 8 movement patterns, each `covered / light / neglected`. Wants an at-a-glance "are you training everything" view (a grid? a body-pattern map?).
- `recoveryFactors` — possibly its own "headwinds" surface, or kept folded into insight text.

---

## 7. Design opportunities — the polish brief

Ranked by impact. The first pass is deliberately plain; here's where the visual investment pays off.

1. **`InsightCard` — make it the hero.** This is the differentiating feature. A stagnation card should *feel* like a coach flagging something — a flat-lining sparkline, the lagging muscle named visually, a clear single CTA. Minimal text. Currently it's an icon + two lines of prose.
2. **The radar — combine with an anatomical body.** From earlier exploration (Concept D): ghost a body silhouette behind the radar so axis positions are anatomically grounded. Adds the "stunning" + makes it self-explanatory.
3. **`zoneDistribution` — the training-mix visualization.** Currently a thin stacked bar in the drill sheet. This is a genuinely novel insight ("your chest is built for size, never trained for max strength") — it deserves a distinctive treatment.
4. **`RatioRow` band track.** First pass is a dot on a 96px bar. Could be far more expressive — show the drift direction, the magnitude, the "you are here vs healthy."
5. **Model confidence as an incentive loop.** A ring? A "profile completeness" meter? It should make the user *want* to log more, not feel judged.
6. **`patternCoverage`** — a fresh surface. A movement-pattern coverage map. Neglected patterns should jump out.
7. **`relativeStrength`** — strength-standards visualization. Bodyweight multiples against novice→elite bands.
8. **Animated lagging-axis pulse** on the radar (deferred from the radar build — red dots are static).
9. **Tier-up / win micro-celebrations** — a `win` insight or a muscle crossing a threshold deserves a small moment.

---

## 8. Constraints

- **Platform:** React Native (Expo SDK 54, RN 0.81, React 19). Reanimated 4 + react-native-svg are available and already used. No web-only CSS.
- **Tokens:** reuse the existing Axiom design tokens — zinc palette, the `colors` / `radius` / `spacing` / `fontSize` objects in `src/constants/theme.ts`. Semantic accents already in use: success `#22C55E` / `#15803D`, destructive `#EF4444` / `#DC2626`, warning `#B45309` / `#FEF3C7`. Don't invent new colors without reason.
- **Performance:** the Strength tab is a `ScrollView` of cards. SVG is fine for charts; avoid SVG filters (slow on older Android — the radar fakes its glow with a wide translucent stroke for this reason).
- **Accessibility:** every metric needs a spoken label (the first-pass components already set `accessibilityLabel`). Color is never the only signal — drift status is always paired with a word. Honor reduced-motion.
- **Sizing:** designed for iPhone 13/14/15 (390 × 844 logical px). `SafeAreaView` top inset assumed.
- **Feature flag:** all of this is gated. Mockups assume the flag is on; no need to design the flag-off path (it's the existing screen).

---

## 9. What's intentionally NOT in scope for the design pass

- The data/logic — the backend Athlete Model is complete and correct. Design against the contract in §3; don't redesign the data.
- Bilateral (left/right) asymmetry — needs per-side workout logging that doesn't exist yet. Future phase.
- LLM-narrated insights — the `Insight` objects are deterministic and fully renderable as-is. Narration is a later, separate decision.

---

*Questions on the data contract or current behavior → engineering. Everything in §3-4 is the live API today.*
