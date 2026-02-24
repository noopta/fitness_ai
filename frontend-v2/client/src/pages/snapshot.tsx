import { useMemo, useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, ChevronRight, Dumbbell, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { liftCoachApi } from "@/lib/api";
import { toast } from "sonner";
import { Navbar } from "@/components/Navbar";

type SnapshotRow = {
  id: string;
  exercise: string;
  weight: string;
  sets: string;
  reps: string;
  rpe: string;
};

type ExerciseCache = Record<string, { weight: string; sets: string; reps: string; rpe: string }>;

const EXERCISE_CACHE_KEY = "liftoff_exercise_cache";

function getExerciseCache(): ExerciseCache {
  try {
    const raw = localStorage.getItem(EXERCISE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveExerciseCache(cache: ExerciseCache) {
  localStorage.setItem(EXERCISE_CACHE_KEY, JSON.stringify(cache));
}

function updateExerciseCacheFromRows(rows: SnapshotRow[]) {
  const cache = getExerciseCache();
  for (const row of rows) {
    if (row.exercise && (row.weight || row.sets || row.reps || row.rpe)) {
      cache[row.exercise] = {
        weight: row.weight,
        sets: row.sets,
        reps: row.reps,
        rpe: row.rpe,
      };
    }
  }
  saveExerciseCache(cache);
}

// Lift-specific exercise recommendations based on target muscles
const liftExerciseMap: Record<string, string[]> = {
  flat_bench_press: [
    "Flat Bench Press",
    "Close-Grip Bench Press",
    "Incline Bench Press",
    "Dumbbell Bench Press",
    "Dumbbell Incline Press",
    "Overhead Press",
    "Dips",
    "Rope Pressdown",
    "Overhead Triceps Extension",
    "JM Press",
    "Chest-Supported Row",
    "Dumbbell Row",
    "Barbell Row",
    "Cable Row",
    "T-Bar Row",
    "Face Pull",
    "Band Pull Apart",
    "Lateral Raise",
  ],
  incline_bench_press: [
    "Incline Bench Press",
    "Flat Bench Press",
    "Dumbbell Incline Press",
    "Dumbbell Bench Press",
    "Overhead Press",
    "Close-Grip Bench Press",
    "Dips",
    "Rope Pressdown",
    "Lateral Raise",
    "Face Pull",
    "Chest-Supported Row",
    "Barbell Row",
    "Band Pull Apart",
  ],
  deadlift: [
    "Deadlift",
    "Romanian Deadlift",
    "Rack Pull",
    "Deficit Deadlift",
    "Barbell Row",
    "T-Bar Row",
    "Cable Row",
    "Lat Pulldown",
    "Pull-Up",
    "Leg Curl",
    "Hip Thrust",
    "Good Morning",
    "Back Extension",
    "Farmer's Walk",
    "Paused Deadlift",
  ],
  barbell_back_squat: [
    "Barbell Back Squat",
    "Pause Squat",
    "Front Squat",
    "Leg Press",
    "Bulgarian Split Squat",
    "Leg Extension",
    "Leg Curl",
    "Romanian Deadlift",
    "Hip Thrust",
    "Good Morning",
    "Goblet Squat",
    "Hack Squat",
  ],
  barbell_front_squat: [
    "Barbell Front Squat",
    "Barbell Back Squat",
    "Pause Squat",
    "Leg Press",
    "Bulgarian Split Squat",
    "Leg Extension",
    "Goblet Squat",
    "Zercher Squat",
    "Hack Squat",
    "Leg Curl",
  ],
};

const defaultExercises = [
  "Flat Bench Press",
  "Incline Bench Press",
  "Deadlift",
  "Barbell Back Squat",
  "Overhead Press",
];


export default function Snapshot() {
  const [, setLocation] = useLocation();
  const [selectedLift, setSelectedLift] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SnapshotRow[]>([
    { id: "row-1", exercise: "", weight: "", sets: "", reps: "", rpe: "" },
    { id: "row-2", exercise: "", weight: "", sets: "", reps: "", rpe: "" },
  ]);

  useEffect(() => {
    const lift = localStorage.getItem("liftoff_selected_lift");
    const targetWeight = localStorage.getItem("liftoff_target_lift_weight");
    const targetSets = localStorage.getItem("liftoff_target_lift_sets");
    const targetReps = localStorage.getItem("liftoff_target_lift_reps");

    if (lift) {
      setSelectedLift(lift);
    }

    const cache = getExerciseCache();
    const liftName = lift
      ? lift.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      : "";

    const mainRow: SnapshotRow = {
      id: "row-1",
      exercise: liftName,
      weight: cache[liftName]?.weight || targetWeight || "",
      sets: cache[liftName]?.sets || targetSets || "",
      reps: cache[liftName]?.reps || targetReps || "",
      rpe: cache[liftName]?.rpe || "",
    };

    const initialRows: SnapshotRow[] = liftName ? [mainRow] : [];

    const exercises = lift && liftExerciseMap[lift] ? liftExerciseMap[lift] : defaultExercises;
    exercises.forEach((exerciseName, idx) => {
      if (exerciseName === liftName) return;
      const cached = cache[exerciseName];
      if (cached && (cached.weight || cached.sets || cached.reps)) {
        initialRows.push({
          id: `row-cached-${idx}-${Math.random().toString(16).slice(2)}`,
          exercise: exerciseName,
          weight: cached.weight,
          sets: cached.sets,
          reps: cached.reps,
          rpe: cached.rpe,
        });
      }
    });

    if (initialRows.length < 2) {
      while (initialRows.length < 2) {
        initialRows.push({
          id: `row-empty-${initialRows.length}-${Math.random().toString(16).slice(2)}`,
          exercise: "",
          weight: "",
          sets: "",
          reps: "",
          rpe: "",
        });
      }
    }

    setRows(initialRows);
  }, []);

  useEffect(() => {
    if (rows.length > 0) {
      updateExerciseCacheFromRows(rows);
    }
  }, [rows]);

  const exerciseOptions = useMemo(() => {
    if (selectedLift && liftExerciseMap[selectedLift]) {
      return liftExerciseMap[selectedLift];
    }
    return defaultExercises;
  }, [selectedLift]);

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        id: `row-${prev.length + 1}-${Math.random().toString(16).slice(2)}`,
        exercise: "",
        weight: "",
        sets: "",
        reps: "",
        rpe: "",
      },
    ]);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleContinue() {
    const sessionId = localStorage.getItem("liftoff_session_id");
    if (!sessionId) {
      toast.error("No session found. Please start from the beginning.");
      setLocation("/onboarding");
      return;
    }

    // Filter out empty rows
    const validRows = rows.filter(
      (row) => row.exercise && row.weight && row.sets && row.reps
    );

    if (validRows.length === 0) {
      toast.error("Please enter at least one exercise with weight, sets, and reps.");
      return;
    }

    setLoading(true);
    try {
      // Normalize numeric strings for mobile locale safety:
      // some Android keyboards use comma as decimal separator (e.g. "225,5")
      const toNum = (s: string) => parseFloat(s.replace(',', '.'));
      const toInt = (s: string) => parseInt(s.replace(',', '.'), 10);

      // Extract the numeric part from RPE/RIR strings like "RPE 8", "RIR 2", "8", "8.5"
      const parseRpe = (s: string): number | undefined => {
        if (!s.trim()) return undefined;
        const match = s.match(/[\d.]+/);
        if (!match) return undefined;
        const n = parseFloat(match[0]);
        return isNaN(n) ? undefined : n;
      };

      const snapshots = validRows.map(row => ({
        exerciseId: row.exercise.toLowerCase().replace(/\s+/g, "_"),
        weight: toNum(row.weight),
        weightUnit: "lbs" as const,
        sets: toInt(row.sets),
        reps: toInt(row.reps),
        rpe: parseRpe(row.rpe),
        date: new Date().toISOString().split('T')[0],
      }));

      // Guard: if any numeric field is NaN, reject before hitting the backend
      const invalid = snapshots.find(s => isNaN(s.weight) || isNaN(s.reps) || isNaN(s.sets));
      if (invalid) {
        toast.error("Please enter valid numbers for weight, sets, and reps.");
        setLoading(false);
        return;
      }

      await liftCoachApi.addSnapshots(sessionId, snapshots);

      toast.success("Snapshot saved successfully!");
      setLocation("/diagnostic");
    } catch (error) {
      console.error("Failed to save snapshots:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      if (msg.includes("Session not found") || msg.includes("not found")) {
        toast.error("Your session expired. Redirecting to start over...");
        localStorage.removeItem("liftoff_session_id");
        setTimeout(() => setLocation("/onboarding"), 1500);
      } else {
        toast.error(`Failed to save snapshot: ${msg}`);
      }
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid-fade">
      <Navbar variant="step" title="Strength snapshot" subtitle="Enter your current working weights" stepLabel="Step 2 of 4" />

      <main className="mx-auto max-w-6xl px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]"
        >
          <Card className="glass relative overflow-hidden p-6">
            <div className="pointer-events-none absolute inset-0 noise" />
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                    <Dumbbell className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground" data-testid="text-snapshot-eyebrow">
                      Snapshot
                    </div>
                    <div className="mt-1 font-serif text-2xl" data-testid="text-snapshot-heading">
                      Your Relevant Lifts
                    </div>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  className="shadow-xs"
                  onClick={addRow}
                  data-testid="button-add-exercise"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add exercise
                </Button>
              </div>

              <div className="mt-6 grid gap-3">
                <div className="grid gap-2 sm:grid-cols-[1.4fr_0.55fr_0.45fr_0.55fr_0.5fr_44px]">
                  <div className="text-xs font-semibold text-muted-foreground" data-testid="label-exercise">
                    Exercise
                  </div>
                  <div className="text-xs font-semibold text-muted-foreground" data-testid="label-weight">
                    Weight (lbs)
                  </div>
                  <div className="text-xs font-semibold text-muted-foreground" data-testid="label-sets">
                    Sets
                  </div>
                  <div className="text-xs font-semibold text-muted-foreground" data-testid="label-reps">
                    Reps
                  </div>
                  <div className="text-xs font-semibold text-muted-foreground" data-testid="label-rpe">
                    RPE/RIR
                  </div>
                  <div />
                </div>

                <AnimatePresence initial={false}>
                  {rows.map((row, idx) => (
                    <motion.div
                      key={row.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="grid items-center gap-2 rounded-2xl border bg-white/55 p-3 shadow-xs backdrop-blur dark:bg-white/5 sm:grid-cols-[1.4fr_0.55fr_0.45fr_0.55fr_0.5fr_44px]"
                      data-testid={`row-snapshot-${idx}`}
                    >
                      <div className="min-w-0">
                        <Select 
                          value={row.exercise || undefined}
                          onValueChange={(value) => {
                            const cache = getExerciseCache();
                            const cached = cache[value];
                            const newRows = [...rows];
                            newRows[idx].exercise = value;
                            if (cached) {
                              newRows[idx].weight = cached.weight || newRows[idx].weight;
                              newRows[idx].sets = cached.sets || newRows[idx].sets;
                              newRows[idx].reps = cached.reps || newRows[idx].reps;
                              newRows[idx].rpe = cached.rpe || newRows[idx].rpe;
                            }
                            setRows(newRows);
                          }}
                        >
                          <SelectTrigger
                            className="h-11"
                            data-testid={`select-exercise-${row.id}`}
                          >
                            <SelectValue placeholder="Choose exercise" />
                          </SelectTrigger>
                          <SelectContent>
                            {exerciseOptions.map((opt) => (
                              <SelectItem
                                key={opt}
                                value={opt}
                                data-testid={`option-exercise-${row.id}-${opt.replace(/\s+/g, "-").toLowerCase()}`}
                              >
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Input
                        className="h-11"
                        placeholder="lbs"
                        inputMode="decimal"
                        value={row.weight}
                        onChange={(e) => {
                          const newRows = [...rows];
                          newRows[idx].weight = e.target.value;
                          setRows(newRows);
                        }}
                        data-testid={`input-weight-${row.id}`}
                      />
                      <Input
                        className="h-11"
                        placeholder="sets"
                        inputMode="numeric"
                        value={row.sets}
                        onChange={(e) => {
                          const newRows = [...rows];
                          newRows[idx].sets = e.target.value;
                          setRows(newRows);
                        }}
                        data-testid={`input-sets-${row.id}`}
                      />
                      <Input
                        className="h-11"
                        placeholder="reps"
                        inputMode="numeric"
                        value={row.reps}
                        onChange={(e) => {
                          const newRows = [...rows];
                          newRows[idx].reps = e.target.value;
                          setRows(newRows);
                        }}
                        data-testid={`input-reps-${row.id}`}
                      />
                      <Input
                        className="h-11"
                        placeholder="e.g. RIR 2"
                        value={row.rpe}
                        onChange={(e) => {
                          const newRows = [...rows];
                          newRows[idx].rpe = e.target.value;
                          setRows(newRows);
                        }}
                        data-testid={`input-rpe-${row.id}`}
                      />

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 rounded-xl"
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length <= 1}
                        data-testid={`button-remove-${row.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  ))}
                </AnimatePresence>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" data-testid="badge-tip">
                      Tip
                    </Badge>
                    <div className="text-sm text-muted-foreground" data-testid="text-tip">
                      If you’re unsure, just enter your top set for each movement.
                    </div>
                  </div>

                  <Button
                    size="lg"
                    className="shadow-sm"
                    onClick={handleContinue}
                    disabled={loading}
                    data-testid="button-continue-diagnostic"
                  >
                    {loading ? "Saving..." : "Continue"}
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-4">
            <Card className="glass p-6">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                  <Gauge className="h-4 w-4 text-primary" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground" data-testid="text-quality-eyebrow">
                    Quality
                  </div>
                  <div className="mt-1 font-serif text-2xl" data-testid="text-quality-title">
                    Make the diagnosis easier
                  </div>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-sm text-muted-foreground">
                {[
                  "We've curated a list of exercises related to your selected lift",
                  "Fill in as many as possible with your current working weight, sets, and reps",
                  "This gives our AI context about your strengths in different muscle groups and movement patterns",
                  "Add RPE/RIR when you can for better accuracy"
                ].map(
                  (x, idx) => (
                    <div className="flex items-start gap-3" key={x} data-testid={`row-quality-${idx}`}>
                      <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full border bg-white/60 text-xs font-semibold shadow-xs dark:bg-white/5">
                        {idx + 1}
                      </span>
                      <p>{x}</p>
                    </div>
                  ),
                )}
              </div>
            </Card>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
