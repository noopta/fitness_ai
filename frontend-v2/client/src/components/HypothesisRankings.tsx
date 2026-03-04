import { HypothesisSignal } from "@/lib/api";

interface Props {
  hypotheses: HypothesisSignal[];
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  muscle:      { bg: "bg-red-100 dark:bg-red-950/40",     text: "text-red-600 dark:text-red-400",     label: "Muscle" },
  mechanical:  { bg: "bg-orange-100 dark:bg-orange-950/40", text: "text-orange-600 dark:text-orange-400", label: "Mechanical" },
  stability:   { bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-600 dark:text-amber-400", label: "Stability" },
  mobility:    { bg: "bg-blue-100 dark:bg-blue-950/40",   text: "text-blue-600 dark:text-blue-400",   label: "Mobility" },
  technique:   { bg: "bg-purple-100 dark:bg-purple-950/40", text: "text-purple-600 dark:text-purple-400", label: "Technique" },
  programming: { bg: "bg-slate-100 dark:bg-slate-800/60", text: "text-slate-600 dark:text-slate-400", label: "Programming" },
};

function barColor(score: number): string {
  if (score >= 75) return "#ef4444"; // red — high confidence
  if (score >= 50) return "#f97316"; // orange — moderate
  if (score >= 30) return "#f59e0b"; // amber — mild signal
  return "#94a3b8";                   // slate — low
}

export function HypothesisRankings({ hypotheses }: Props) {
  if (!hypotheses || hypotheses.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        No hypothesis data available.
      </div>
    );
  }

  const sorted = [...hypotheses].sort((a, b) => b.score - a.score);
  const max = Math.max(...sorted.map(h => h.score), 1);

  return (
    <div className="space-y-3">
      {sorted.map((h, idx) => {
        const style = CATEGORY_STYLES[h.category] ?? CATEGORY_STYLES.technique;
        const widthPct = Math.round((h.score / max) * 100);

        return (
          <div key={h.key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {/* Rank badge */}
                <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                  {idx + 1}
                </span>
                <span className="text-xs font-medium truncate">{h.label}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.bg} ${style.text}`}
                >
                  {style.label}
                </span>
                <span className="font-mono text-xs font-bold w-8 text-right">
                  {h.score}
                </span>
              </div>
            </div>

            {/* Score bar */}
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: barColor(h.score),
                }}
              />
            </div>

            {/* Top evidence bullet */}
            {h.evidence[0] && (
              <p className="text-[11px] text-muted-foreground leading-relaxed pl-7">
                {h.evidence[0]}
              </p>
            )}
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground pt-1">
        Scores (0–100) reflect how strongly each factor is implicated based on your lift data and interview answers.
      </p>
    </div>
  );
}
