import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts";

interface Deduction {
  key: string;
  points: number;
  reason: string;
}

interface Props {
  score: number;           // 40–95
  explanation: string;
  deductions: Deduction[];
}

function gaugeColor(score: number): string {
  if (score >= 80) return "#22c55e"; // green
  if (score >= 65) return "#f59e0b"; // amber
  return "#ef4444";                   // red
}

function scoreGrade(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 65) return "Fair";
  if (score >= 50) return "Developing";
  return "Needs Work";
}

export function EfficiencyGauge({ score, explanation, deductions }: Props) {
  const color = gaugeColor(score);
  const grade = scoreGrade(score);

  const data = [{ name: "Efficiency", value: score, fill: color }];

  return (
    <div className="space-y-4">
      {/* Radial gauge */}
      <div className="relative flex items-center justify-center">
        <ResponsiveContainer width="100%" height={180}>
          <RadialBarChart
            cx="50%"
            cy="70%"
            innerRadius="60%"
            outerRadius="90%"
            startAngle={180}
            endAngle={0}
            data={data}
            barSize={18}
          >
            {/* Background track */}
            <RadialBar
              dataKey="value"
              cornerRadius={8}
              background={{ fill: "hsl(var(--muted))" }}
            />
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          </RadialBarChart>
        </ResponsiveContainer>

        {/* Center label overlay */}
        <div className="absolute bottom-8 flex flex-col items-center">
          <span className="font-serif text-4xl font-bold" style={{ color }}>
            {score}
          </span>
          <span className="text-xs font-medium text-muted-foreground mt-0.5">{grade}</span>
        </div>
      </div>

      {/* Explanation */}
      <p className="text-sm text-muted-foreground leading-relaxed">{explanation}</p>

      {/* Deductions */}
      {deductions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Score deductions
          </div>
          {deductions.map((d) => (
            <div
              key={d.key}
              className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
            >
              <span className="flex-shrink-0 text-xs font-bold text-red-500 mt-0.5">
                −{d.points}
              </span>
              <span className="text-xs text-muted-foreground leading-relaxed">{d.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
