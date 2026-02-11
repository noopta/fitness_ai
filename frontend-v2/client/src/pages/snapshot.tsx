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
import { BrandLogo } from "@/components/BrandLogo";

type SnapshotRow = {
  id: string;
  exercise: string;
  weight: string;
  sets: string;
  reps: string;
  rpe: string;
};

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

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/">
          <a className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
            <BrandLogo height={36} className="h-9 w-auto" />
            <div>
              <div className="text-sm font-semibold" data-testid="text-snapshot-title">
                Strength snapshot
              </div>
              <div className="text-xs text-muted-foreground" data-testid="text-snapshot-subtitle">
                Enter your current working weights
              </div>
            </div>
          </a>
        </Link>
        <div className="hidden text-xs text-muted-foreground sm:block" data-testid="text-step">
          Step 2 of 4
        </div>
      </div>
    </header>
  );
}

export default function Snapshot() {
  const [, setLocation] = useLocation();
  const [selectedLift, setSelectedLift] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SnapshotRow[]>([
    { id: "row-1", exercise: "", weight: "", sets: "", reps: "", rpe: "" },
    { id: "row-2", exercise: "", weight: "", sets: "", reps: "", rpe: "" },
  ]);

  // Load selected lift, target lift stats, and cached rows from localStorage
  useEffect(() => {
    const lift = localStorage.getItem("liftoff_selected_lift");
    const targetWeight = localStorage.getItem("liftoff_target_lift_weight");
    const targetSets = localStorage.getItem("liftoff_target_lift_sets");
    const targetReps = localStorage.getItem("liftoff_target_lift_reps");
    const cachedRows = localStorage.getItem("liftoff_cached_snapshot_rows");
    
    if (lift) {
      setSelectedLift(lift);
    }

    // Load cached rows if they exist
    if (cachedRows) {
      try {
        const parsedRows = JSON.parse(cachedRows);
        setRows(parsedRows);
      } catch (error) {
        console.error("Failed to parse cached rows:", error);
        // Fallback to default behavior
        if (lift) {
          const liftName = lift.split('_').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ');
          setRows(prev => [
            { 
              ...prev[0], 
              exercise: liftName,
              weight: targetWeight || "",
              sets: targetSets || "",
              reps: targetReps || "",
            },
            ...prev.slice(1)
          ]);
        }
      }
    } else if (lift) {
      // Set first row to the main lift with pre-filled data
      const liftName = lift.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      setRows(prev => [
        { 
          ...prev[0], 
          exercise: liftName,
          weight: targetWeight || "",
          sets: targetSets || "",
          reps: targetReps || "",
        },
        ...prev.slice(1)
      ]);
    }
  }, []);

  // Save rows to cache whenever they change
  useEffect(() => {
    if (rows.length > 0) {
      localStorage.setItem("liftoff_cached_snapshot_rows", JSON.stringify(rows));
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
      // Save each snapshot to the backend
      for (const row of validRows) {
        await liftCoachApi.addSnapshot(sessionId, {
          exerciseId: row.exercise.toLowerCase().replace(/\s+/g, "_"),
          weight: parseFloat(row.weight),
          sets: parseInt(row.sets),
          repsSchema: row.reps,
          rpeOrRir: row.rpe || undefined,
        });
      }

      toast.success("Snapshot saved successfully!");
      setLocation("/diagnostic");
    } catch (error) {
      console.error("Failed to save snapshots:", error);
      toast.error("Failed to save snapshot data. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid-fade">
      <Header />

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
                            const newRows = [...rows];
                            newRows[idx].exercise = value;
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
