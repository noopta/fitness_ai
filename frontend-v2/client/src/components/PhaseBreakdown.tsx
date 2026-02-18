import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { PhaseScore } from "@/lib/api";

interface Props {
  phaseScores: PhaseScore[];
  primaryPhase: string;
  primaryPhaseConfidence: number;
}

// Human-readable phase labels
const PHASE_LABELS: Record<string, string> = {
  setup:        "Setup",
  descent:      "Descent",
  bottom:       "Bottom",
  ascent:       "Ascent",
  lockout:      "Lockout",
  initial_pull: "Off Floor",
  knee_level:   "Mid Pull",
};

// Higher points = higher suspected weakness concentration there
// Color by contribution: highest = red, mid = amber, low = muted
function barColor(points: number, max: number, isPrimary: boolean): string {
  if (isPrimary) return "#ef4444"; // red — primary suspected weakness phase
  const ratio = max > 0 ? points / max : 0;
  if (ratio >= 0.75) return "#f97316"; // orange
  if (ratio >= 0.4)  return "#f59e0b"; // amber
  return "#94a3b8";                     // slate — minimal signal
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { phase: string; points: number; isPrimary: boolean } }>;
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const { phase, points, isPrimary } = payload[0].payload;
  return (
    <div className="rounded-xl border bg-background/95 p-3 shadow-lg text-xs max-w-[180px]">
      <div className="font-semibold mb-1">{phase}</div>
      <div className="text-muted-foreground mb-2">
        {isPrimary
          ? "Primary suspected weak point"
          : "Secondary diagnostic signal"}
      </div>
      <div className="font-mono font-bold">{points} signal pts</div>
    </div>
  );
}

export function PhaseBreakdown({ phaseScores, primaryPhase, primaryPhaseConfidence }: Props) {
  if (!phaseScores || phaseScores.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        No phase data — answers from the diagnostic interview are used to compute phase scores.
      </div>
    );
  }

  const max = Math.max(...phaseScores.map(p => p.points), 1);

  const data = phaseScores
    .filter(p => p.points > 0)
    .sort((a, b) => b.points - a.points)
    .map(p => ({
      phase: PHASE_LABELS[p.phase_id] ?? p.phase_id,
      phase_id: p.phase_id,
      points: p.points,
      isPrimary: p.phase_id === primaryPhase,
    }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        No phase signal detected yet. More diagnostic questions needed.
      </div>
    );
  }

  const primaryLabel = PHASE_LABELS[primaryPhase] ?? primaryPhase;
  const confidencePct = Math.round(primaryPhaseConfidence * 100);

  return (
    <div className="space-y-4">
      {/* Primary phase callout */}
      <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/30">
        <div className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
        <span className="text-xs font-medium text-red-700 dark:text-red-400">
          Weak point: <strong>{primaryLabel}</strong>
          {" "}
          <span className="font-normal opacity-70">({confidencePct}% confidence)</span>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="30%"
        >
          <XAxis type="number" hide domain={[0, max * 1.1]} />
          <YAxis
            type="category"
            dataKey="phase"
            width={68}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
          <Bar dataKey="points" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.phase_id}
                fill={barColor(entry.points, max, entry.isPrimary)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Signal points indicate how strongly each phase is implicated as a limiting factor.
        Higher = more evidence pointing to a weakness there.
      </p>
    </div>
  );
}
