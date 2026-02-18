import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { DiagnosticSignalsSubset } from "@/lib/api";

interface Props {
  signals: DiagnosticSignalsSubset;
  liftId: string;
}

// Which indices are relevant for each lift
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

const INDEX_DESCRIPTIONS: Record<string, string> = {
  quad_index:         "Quad strength relative to your primary lift",
  posterior_index:    "Glute & hamstring strength relative to your primary lift",
  back_tension_index: "Lat & upper back stability contribution",
  triceps_index:      "Triceps lockout strength relative to your primary lift",
  shoulder_index:     "Shoulder / anterior delt contribution",
};

// Color the fill based on average score
function radarColor(avg: number) {
  if (avg >= 80) return { stroke: "#22c55e", fill: "#22c55e" }; // green
  if (avg >= 60) return { stroke: "#f59e0b", fill: "#f59e0b" }; // amber
  return { stroke: "#ef4444", fill: "#ef4444" };                  // red
}

function scoreLabel(value: number) {
  if (value >= 85) return "Strong";
  if (value >= 70) return "Adequate";
  if (value >= 50) return "Weak";
  return "Deficient";
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { subject: string; description: string } }>;
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const { value, payload: inner } = payload[0];
  return (
    <div className="rounded-xl border bg-background/95 p-3 shadow-lg text-xs max-w-[180px]">
      <div className="font-semibold mb-1">{inner.subject}</div>
      <div className="text-muted-foreground mb-2">{inner.description}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm font-bold">{value}/100</span>
        <span
          className={
            value >= 85 ? "text-green-500" :
            value >= 70 ? "text-amber-500" : "text-red-500"
          }
        >
          {scoreLabel(value)}
        </span>
      </div>
    </div>
  );
}

export function StrengthRadar({ signals, liftId }: Props) {
  const relevantKeys = LIFT_INDEX_MAP[liftId] ?? Object.keys(INDEX_LABELS) as Array<keyof DiagnosticSignalsSubset["indices"]>;

  const data = relevantKeys
    .map((key) => {
      const idx = signals.indices[key];
      return idx
        ? {
            subject: INDEX_LABELS[key] ?? key,
            value: Math.round(idx.value),
            confidence: idx.confidence,
            description: INDEX_DESCRIPTIONS[key] ?? "",
            fullMark: 100,
          }
        : null;
    })
    .filter(Boolean) as Array<{
      subject: string;
      value: number;
      confidence: number;
      description: string;
      fullMark: number;
    }>;

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        Not enough snapshot data to compute strength indices.
      </div>
    );
  }

  const avg = Math.round(data.reduce((s, d) => s + d.value, 0) / data.length);
  const { stroke, fill } = radarColor(avg);

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={240}>
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <Radar
            name="Strength Index"
            dataKey="value"
            stroke={stroke}
            fill={fill}
            fillOpacity={0.2}
            strokeWidth={2}
          />
          <Tooltip content={<CustomTooltip />} />
        </RadarChart>
      </ResponsiveContainer>

      {/* Legend row */}
      <div className="grid gap-2">
        {data.map((d) => (
          <div key={d.subject} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{d.subject}</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${d.value}%`,
                    backgroundColor:
                      d.value >= 85 ? "#22c55e" :
                      d.value >= 70 ? "#f59e0b" : "#ef4444",
                  }}
                />
              </div>
              <span
                className={`font-mono font-semibold w-8 text-right ${
                  d.value >= 85 ? "text-green-500" :
                  d.value >= 70 ? "text-amber-500" : "text-red-500"
                }`}
              >
                {d.value}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
