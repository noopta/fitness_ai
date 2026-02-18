import { DiagnosticSignalsSubset } from "@/lib/api";

interface Props {
  signals: DiagnosticSignalsSubset;
  liftId: string;
}

// Which indices are relevant for each lift, in display order
const LIFT_INDEX_MAP: Record<string, Array<keyof DiagnosticSignalsSubset["indices"]>> = {
  flat_bench_press:    ["triceps_index", "shoulder_index", "back_tension_index"],
  incline_bench_press: ["triceps_index", "shoulder_index", "back_tension_index"],
  deadlift:            ["posterior_index", "quad_index", "back_tension_index"],
  barbell_back_squat:  ["quad_index", "posterior_index", "back_tension_index"],
  barbell_front_squat: ["quad_index", "posterior_index", "back_tension_index"],
  back_squat:          ["quad_index", "posterior_index", "back_tension_index"],
  front_squat:         ["quad_index", "posterior_index", "back_tension_index"],
};

const INDEX_LABELS: Record<string, string> = {
  quad_index:         "Quads",
  posterior_index:    "Posterior Chain",
  back_tension_index: "Back / Lats",
  triceps_index:      "Triceps",
  shoulder_index:     "Shoulders",
};

// What does this muscle group do for this lift?
const INDEX_LIFT_ROLE: Record<string, Record<string, string>> = {
  quad_index: {
    deadlift:            "Drives the floor away in the initial pull — weak quads cause hips to shoot up.",
    barbell_back_squat:  "Primary driver out of the hole — the main engine of your squat.",
    barbell_front_squat: "Dominant muscle in the front squat — essential for upright torso and drive.",
    default:             "Contributes to knee extension and drive through the lift.",
  },
  posterior_index: {
    deadlift:            "Glutes & hamstrings lock out the hip at the top — weakness shows as slow lockout.",
    barbell_back_squat:  "Assists out of the hole and drives hip extension in the upper half of the squat.",
    barbell_front_squat: "Hip extension support in the upper phase of the lift.",
    default:             "Glutes & hamstrings for hip extension and lockout.",
  },
  back_tension_index: {
    deadlift:            "Lats keep the bar close and prevent rounding — a weak back causes the bar to drift forward.",
    barbell_back_squat:  "Upper back holds bar position and prevents forward collapse under load.",
    barbell_front_squat: "Upper back and lats are critical for maintaining the upright front rack position.",
    flat_bench_press:    "Scapular stability — lats and rhomboids keep your shoulder blades retracted.",
    incline_bench_press: "Upper back stability — keeps shoulder blades pinched during the press.",
    default:             "Lat & upper back tension for stability and bar path control.",
  },
  triceps_index: {
    flat_bench_press:    "Responsible for locking out the rep — weakness shows as the bar stalling 2–4 inches from the top.",
    incline_bench_press: "Critical for lockout on the incline — often the primary limiter.",
    default:             "Elbow extension and lockout strength.",
  },
  shoulder_index: {
    flat_bench_press:    "Anterior delts drive the mid-range of the press — weakness shows between chest and lockout.",
    incline_bench_press: "More shoulder-dominant than flat bench — anterior delts are heavily involved throughout.",
    default:             "Shoulder strength for mid-range pressing power.",
  },
};

function getRole(indexKey: string, liftId: string): string {
  const roles = INDEX_LIFT_ROLE[indexKey];
  if (!roles) return "";
  return roles[liftId] ?? roles["default"] ?? "";
}

function scoreLabel(value: number): { label: string; color: string } {
  if (value >= 90) return { label: "Very Strong", color: "text-green-600 dark:text-green-400" };
  if (value >= 75) return { label: "Strong", color: "text-green-500 dark:text-green-400" };
  if (value >= 60) return { label: "Adequate", color: "text-amber-500" };
  if (value >= 45) return { label: "Weak", color: "text-orange-500" };
  return { label: "Deficient", color: "text-red-500" };
}

function barBg(value: number): string {
  if (value >= 75) return "#22c55e";
  if (value >= 60) return "#f59e0b";
  if (value >= 45) return "#f97316";
  return "#ef4444";
}

function interpretation(indexKey: string, value: number): string {
  const name = INDEX_LABELS[indexKey] ?? indexKey;
  if (value >= 90) return `${name} is a clear strength — not a limiting factor here.`;
  if (value >= 75) return `${name} is solid and unlikely to be holding you back.`;
  if (value >= 60) return `${name} is adequate but has room to grow.`;
  if (value >= 45) return `${name} appears underdeveloped relative to your primary lift — likely contributing to your plateau.`;
  return `${name} is significantly weak relative to your lift — a strong candidate for your primary limiter.`;
}

export function StrengthRadar({ signals, liftId }: Props) {
  const relevantKeys = LIFT_INDEX_MAP[liftId] ?? (Object.keys(INDEX_LABELS) as Array<keyof DiagnosticSignalsSubset["indices"]>);

  const data = relevantKeys
    .map((key) => {
      const idx = signals.indices[key];
      if (!idx) return null;
      return {
        key,
        label: INDEX_LABELS[key] ?? key,
        value: Math.round(idx.value),
        confidence: idx.confidence,
        role: getRole(key, liftId),
        sources: idx.sources,
      };
    })
    .filter(Boolean) as Array<{
      key: string;
      label: string;
      value: number;
      confidence: number;
      role: string;
      sources: string[];
    }>;

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground text-center px-4">
        Add proxy lift data in the snapshot step (e.g. RDL, front squat, close-grip bench) to see muscle group indices.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Scale legend */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
        <span>Index scale: 100 = expected for your lift level</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" />≥75 Strong</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-500" />60–74 Adequate</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" />&lt;60 Weak</span>
        </div>
      </div>

      {/* Bars */}
      <div className="space-y-4">
        {data.map((d) => {
          const { label, color } = scoreLabel(d.value);
          return (
            <div key={d.key} className="space-y-1.5">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{d.label}</span>
                  <span className={`text-xs font-medium ${color}`}>{label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold">{d.value}</span>
                  <span className="text-xs text-muted-foreground">/ 100</span>
                </div>
              </div>

              {/* Bar with benchmark marker at 70 */}
              <div className="relative h-3 w-full rounded-full bg-muted overflow-visible">
                {/* Filled bar */}
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${d.value}%`, backgroundColor: barBg(d.value) }}
                />
                {/* Benchmark line at 70 */}
                <div
                  className="absolute top-[-3px] bottom-[-3px] w-px bg-foreground/40"
                  style={{ left: "70%" }}
                  title="Adequate threshold (70)"
                />
                {/* Benchmark label */}
                <span
                  className="absolute top-[-18px] text-[9px] text-muted-foreground"
                  style={{ left: "70%", transform: "translateX(-50%)" }}
                >
                  min
                </span>
              </div>

              {/* Role + interpretation */}
              <div className="space-y-0.5 pl-0.5">
                {d.role && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{d.role}</p>
                )}
                <p className={`text-[11px] font-medium leading-relaxed ${color}`}>
                  {interpretation(d.key, d.value)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3 leading-relaxed">
        Indices compare your proxy lift performance to what's expected given your primary lift strength.
        A score of 100 means you're exactly as strong as expected in that muscle group.
        Scores below 70 suggest a relative weakness that may be limiting your primary lift.
      </p>
    </div>
  );
}
