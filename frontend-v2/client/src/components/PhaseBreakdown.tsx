import { PhaseScore } from "@/lib/api";

interface Props {
  phaseScores: PhaseScore[];
  primaryPhase: string;
  primaryPhaseConfidence: number;
  liftId?: string;
}

// All phases per lift in order, with descriptions of what happens there
const LIFT_PHASES: Record<string, Array<{ id: string; label: string; description: string }>> = {
  flat_bench_press: [
    { id: "setup",   label: "Setup",   description: "Bar position, arch, shoulder blade retraction, unrack" },
    { id: "descent", label: "Descent", description: "Controlled lowering to the chest" },
    { id: "bottom",  label: "Off Chest", description: "Initial drive from chest — the hardest reversal point" },
    { id: "ascent",  label: "Mid Range", description: "Drive from chest to midpoint — pec & shoulder power" },
    { id: "lockout", label: "Lockout",  description: "Final extension — triceps finish the rep" },
  ],
  incline_bench_press: [
    { id: "setup",   label: "Setup",   description: "Incline position, shoulder blade retraction, unrack" },
    { id: "descent", label: "Descent", description: "Controlled lowering to upper chest" },
    { id: "bottom",  label: "Off Chest", description: "Initial drive from upper chest" },
    { id: "ascent",  label: "Mid Range", description: "Drive through midpoint — anterior delt dominant" },
    { id: "lockout", label: "Lockout",  description: "Triceps extension to finish" },
  ],
  deadlift: [
    { id: "setup",        label: "Setup",     description: "Bar over mid-foot, lat tension, hinge position" },
    { id: "initial_pull", label: "Off Floor", description: "Breaking the bar from the ground — quad & back driven" },
    { id: "knee_level",   label: "Mid Pull",  description: "Bar passing the knees — transition to hip hinge" },
    { id: "lockout",      label: "Lockout",   description: "Hip extension to standing — glute & hamstring driven" },
  ],
  barbell_back_squat: [
    { id: "setup",   label: "Setup",   description: "Bar placement, stance, walkout, bracing" },
    { id: "descent", label: "Descent", description: "Controlled descent to depth" },
    { id: "bottom",  label: "Out of Hole", description: "Reversal from depth — hardest point of the squat" },
    { id: "ascent",  label: "Ascent",  description: "Drive to standing — quad & hip extension" },
  ],
  barbell_front_squat: [
    { id: "setup",   label: "Setup",   description: "Front rack, upright torso, stance" },
    { id: "descent", label: "Descent", description: "Controlled descent while maintaining upright torso" },
    { id: "bottom",  label: "Out of Hole", description: "Reversal from depth — quad dominant" },
    { id: "ascent",  label: "Ascent",  description: "Drive to standing — quad & core stability" },
  ],
};

// Fallback for unknown lifts
const DEFAULT_PHASES = [
  { id: "setup",   label: "Setup",   description: "Starting position and preparation" },
  { id: "descent", label: "Descent", description: "Eccentric / lowering phase" },
  { id: "bottom",  label: "Bottom",  description: "Bottom position and reversal" },
  { id: "ascent",  label: "Ascent",  description: "Concentric / lifting phase" },
  { id: "lockout", label: "Lockout", description: "Final lockout and completion" },
];

// What a high signal score in this phase actually means in plain English
const PHASE_WEAK_MEANING: Record<string, string> = {
  setup:        "Issues in setup mechanics — bracing, positioning, or bar placement may be contributing.",
  descent:      "Eccentric control or position during the lowering phase needs attention.",
  bottom:       "Weakest at the bottom / reversal point — common for pec or off-chest strength issues.",
  ascent:       "Sticking point in the mid-range drive — may indicate anterior chain or pressing weakness.",
  lockout:      "Failing near the top — triceps or hip extension weakness is the primary suspect.",
  initial_pull: "Hard off the floor — quads aren't driving well or back position breaks early.",
  knee_level:   "Bar slows or stalls as it passes the knees — lat tension or hip mechanics are suspect.",
};

function phaseBarColor(hasSignal: boolean, isPrimary: boolean): string {
  if (isPrimary) return "#ef4444";
  if (hasSignal) return "#f97316";
  return "hsl(var(--muted))";
}

export function PhaseBreakdown({ phaseScores, primaryPhase, primaryPhaseConfidence, liftId }: Props) {
  const liftKey = liftId ?? "";
  const allPhases = LIFT_PHASES[liftKey] ?? LIFT_PHASES[liftKey.replace("barbell_", "")] ?? DEFAULT_PHASES;

  // Build a score map from whatever fired
  const scoreMap: Record<string, number> = {};
  for (const ps of phaseScores ?? []) {
    scoreMap[ps.phase_id] = ps.points;
  }
  const maxPoints = Math.max(...Object.values(scoreMap), 1);

  const primaryLabel = allPhases.find(p => p.id === primaryPhase)?.label ?? primaryPhase;
  const confidencePct = Math.round(primaryPhaseConfidence * 100);
  const hasAnySignal = Object.keys(scoreMap).length > 0;

  return (
    <div className="space-y-4">

      {/* What is this section — always shown */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        Each lift has distinct phases. Based on your snapshot data and diagnostic answers, the engine estimates
        which phase is most likely your weak point. <strong className="text-foreground">Higher evidence weight = more data pointing to a weakness there.</strong>
      </p>

      {/* Primary phase callout */}
      {hasAnySignal ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900 dark:bg-red-950/30">
          <div className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0 mt-1" />
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">
              Suspected weak point: <strong>{primaryLabel}</strong>
              {" "}
              <span className="font-normal opacity-80">({confidencePct}% confidence)</span>
            </p>
            {PHASE_WEAK_MEANING[primaryPhase] && (
              <p className="text-xs text-red-600/80 dark:text-red-400/70 leading-relaxed">
                {PHASE_WEAK_MEANING[primaryPhase]}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          No phase signal yet — answer more diagnostic questions to help the engine identify your sticking point.
        </div>
      )}

      {/* All phases shown in lift order */}
      <div className="space-y-3">
        {allPhases.map((phase) => {
          const points = scoreMap[phase.id] ?? 0;
          const hasSignal = points > 0;
          const isPrimary = phase.id === primaryPhase && hasSignal;
          const widthPct = hasSignal ? Math.round((points / maxPoints) * 100) : 0;

          return (
            <div key={phase.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${isPrimary ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                    {phase.label}
                  </span>
                  {isPrimary && (
                    <span className="rounded-full bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                      Primary
                    </span>
                  )}
                </div>
                {hasSignal ? (
                  <span className={`text-[11px] font-mono font-bold ${isPrimary ? "text-red-500" : "text-orange-500"}`}>
                    {points} pts
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">No signal</span>
                )}
              </div>

              {/* Phase bar */}
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: hasSignal ? `${widthPct}%` : "0%",
                    backgroundColor: phaseBarColor(hasSignal, isPrimary),
                    minWidth: hasSignal ? "4px" : "0",
                  }}
                />
              </div>

              {/* Phase description */}
              <p className="text-[11px] text-muted-foreground leading-relaxed">{phase.description}</p>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3 leading-relaxed">
        Phases with "No signal" haven't fired any diagnostic rules yet — either because the data doesn't implicate them,
        or because the interview didn't probe those areas. More proxy lifts and detailed answers increase confidence.
      </p>
    </div>
  );
}
