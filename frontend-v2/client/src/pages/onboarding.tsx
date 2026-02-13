import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { ChevronRight, Dumbbell, Target, TrendingUp, Activity, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { liftCoachApi } from "@/lib/api";
import { LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const lifts: Array<{ id: string; label: string; hint: string; icon: LucideIcon }> = [
  { id: "flat_bench_press", label: "Flat Bench Press", hint: "Chest, triceps, shoulders", icon: Dumbbell },
  { id: "incline_bench_press", label: "Incline Bench Press", hint: "Upper chest focus", icon: TrendingUp },
  { id: "deadlift", label: "Deadlift", hint: "Full posterior chain", icon: Zap },
  { id: "barbell_back_squat", label: "Back Squat", hint: "Legs & glutes", icon: Activity },
  { id: "barbell_front_squat", label: "Front Squat", hint: "Quad dominant", icon: Target },
];

// Conversion utilities
function feetInToCm(ft: number, inch: number) {
  return (ft * 12 + inch) * 2.54;
}

function lbToKg(lb: number) {
  return lb * 0.453592;
}

function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/">
          <a className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
            <BrandLogo height={36} className="h-9 w-auto" />
            <div>
              <div className="text-sm font-semibold">LiftOff</div>
              <div className="text-xs text-muted-foreground">AI-Powered Lift Diagnostics</div>
            </div>
          </a>
        </Link>
        <div className="hidden text-xs text-muted-foreground sm:block">Step 1 of 3</div>
      </div>
    </header>
  );
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const [selectedLift, setSelectedLift] = useState<string>("flat_bench_press");
  const [loading, setLoading] = useState(false);

  // Current lift stats
  const [currentWeight, setCurrentWeight] = useState<number | undefined>();
  const [currentSets, setCurrentSets] = useState<number | undefined>();
  const [currentReps, setCurrentReps] = useState<number | undefined>();

  // Profile data - Canadian metric defaults (imperial input)
  const [heightFeet, setHeightFeet] = useState<number | undefined>();
  const [heightInches, setHeightInches] = useState<number | undefined>();
  const [weightLbs, setWeightLbs] = useState<number | undefined>();
  const [constraints, setConstraints] = useState<string>("");

  // Load cached data on mount
  useEffect(() => {
    const cachedLift = localStorage.getItem("liftoff_cached_lift");
    const cachedCurrentWeight = localStorage.getItem("liftoff_cached_current_weight");
    const cachedCurrentSets = localStorage.getItem("liftoff_cached_current_sets");
    const cachedCurrentReps = localStorage.getItem("liftoff_cached_current_reps");
    const cachedHeightFeet = localStorage.getItem("liftoff_cached_height_feet");
    const cachedHeightInches = localStorage.getItem("liftoff_cached_height_inches");
    const cachedWeightLbs = localStorage.getItem("liftoff_cached_weight_lbs");
    const cachedConstraints = localStorage.getItem("liftoff_cached_constraints");

    if (cachedLift) setSelectedLift(cachedLift);
    if (cachedCurrentWeight) setCurrentWeight(parseFloat(cachedCurrentWeight));
    if (cachedCurrentSets) setCurrentSets(parseFloat(cachedCurrentSets));
    if (cachedCurrentReps) setCurrentReps(parseFloat(cachedCurrentReps));
    if (cachedHeightFeet) setHeightFeet(parseFloat(cachedHeightFeet));
    if (cachedHeightInches) setHeightInches(parseFloat(cachedHeightInches));
    if (cachedWeightLbs) setWeightLbs(parseFloat(cachedWeightLbs));
    if (cachedConstraints) setConstraints(cachedConstraints);
  }, []);

  // Save data to cache whenever it changes
  useEffect(() => {
    localStorage.setItem("liftoff_cached_lift", selectedLift);
  }, [selectedLift]);

  useEffect(() => {
    if (currentWeight !== undefined) localStorage.setItem("liftoff_cached_current_weight", currentWeight.toString());
  }, [currentWeight]);

  useEffect(() => {
    if (currentSets !== undefined) localStorage.setItem("liftoff_cached_current_sets", currentSets.toString());
  }, [currentSets]);

  useEffect(() => {
    if (currentReps !== undefined) localStorage.setItem("liftoff_cached_current_reps", currentReps.toString());
  }, [currentReps]);

  useEffect(() => {
    if (heightFeet !== undefined) localStorage.setItem("liftoff_cached_height_feet", heightFeet.toString());
  }, [heightFeet]);

  useEffect(() => {
    if (heightInches !== undefined) localStorage.setItem("liftoff_cached_height_inches", heightInches.toString());
  }, [heightInches]);

  useEffect(() => {
    if (weightLbs !== undefined) localStorage.setItem("liftoff_cached_weight_lbs", weightLbs.toString());
  }, [weightLbs]);

  useEffect(() => {
    localStorage.setItem("liftoff_cached_constraints", constraints);
  }, [constraints]);

  const handleContinue = async () => {
    if (!selectedLift) return;

    setLoading(true);
    try {
      // Convert imperial to metric
      const profile: any = {
        constraintsText: constraints || undefined,
      };

      if (heightFeet !== undefined) {
        profile.heightCm = feetInToCm(heightFeet, heightInches || 0);
      }

      if (weightLbs !== undefined) {
        profile.weightKg = lbToKg(weightLbs);
      }

      // Store current lift stats for context
      if (currentWeight && currentSets && currentReps) {
        localStorage.setItem("liftoff_target_lift_weight", currentWeight.toString());
        localStorage.setItem("liftoff_target_lift_sets", currentSets.toString());
        localStorage.setItem("liftoff_target_lift_reps", currentReps.toString());
      }

      const response = await liftCoachApi.createSession({
        selectedLift,
        goal: "strength_peak", // Default to strength as per user requirement
        profile,
      });

      localStorage.setItem("liftoff_session_id", response.session.id);
      localStorage.setItem("liftoff_selected_lift", selectedLift);
      
      setLocation("/snapshot");
    } catch (error) {
      console.error("Failed to create session:", error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary">
      <TopBar />

      <main className="mx-auto max-w-5xl px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-8"
        >
          {/* Hero Message */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
              Diagnose Your Weak Points
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Using your current working weights and lift mechanics, our AI identifies exactly where you're struggling and prescribes targeted accessories to break through plateaus.
            </p>
          </div>

          {/* Lift Selection Cards */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Target className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Select Your Target Lift</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {lifts.map((lift) => {
                const Icon = lift.icon;
                return (
                  <motion.button
                    key={lift.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedLift(lift.id)}
                    className={`p-4 rounded-lg border-2 text-left transition-all cursor-pointer ${
                      selectedLift === lift.id
                        ? "border-primary bg-primary/5 shadow-md"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${
                        selectedLift === lift.id 
                          ? "bg-primary/10" 
                          : "bg-muted"
                      }`}>
                        <Icon className={`h-6 w-6 ${
                          selectedLift === lift.id 
                            ? "text-primary" 
                            : "text-muted-foreground"
                        }`} />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">{lift.label}</h3>
                        <p className="text-xs text-muted-foreground">{lift.hint}</p>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </Card>

          {/* Current Lift Stats */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Your Current {lifts.find(l => l.id === selectedLift)?.label}</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Enter your current working weight, sets, and reps for this lift. This helps our AI understand your baseline.
            </p>
            
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Working Weight (lbs)</Label>
                <Input
                  type="number"
                  placeholder="185"
                  value={currentWeight || ""}
                  onChange={(e) => setCurrentWeight(Number(e.target.value))}
                />
                <span className="text-xs text-muted-foreground">Your typical working weight</span>
              </div>

              <div className="space-y-2">
                <Label>Sets</Label>
                <Input
                  type="number"
                  placeholder="3"
                  value={currentSets || ""}
                  onChange={(e) => setCurrentSets(Number(e.target.value))}
                />
                <span className="text-xs text-muted-foreground">Working sets per session</span>
              </div>

              <div className="space-y-2">
                <Label>Reps</Label>
                <Input
                  type="number"
                  placeholder="8"
                  value={currentReps || ""}
                  onChange={(e) => setCurrentReps(Number(e.target.value))}
                />
                <span className="text-xs text-muted-foreground">Reps per set</span>
              </div>
            </div>
          </Card>

          {/* Profile (Optional) */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Your Profile</h2>
            <p className="text-sm text-muted-foreground mb-4">Optional but recommended for better recommendations</p>
            
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Height</Label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        type="number"
                        placeholder="5"
                        value={heightFeet || ""}
                        onChange={(e) => setHeightFeet(Number(e.target.value))}
                      />
                      <span className="text-xs text-muted-foreground mt-1 block">feet</span>
                    </div>
                    <div className="flex-1">
                      <Input
                        type="number"
                        placeholder="10"
                        value={heightInches || ""}
                        onChange={(e) => setHeightInches(Number(e.target.value))}
                      />
                      <span className="text-xs text-muted-foreground mt-1 block">inches</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Weight (lbs)</Label>
                  <Input
                    type="number"
                    placeholder="175"
                    value={weightLbs || ""}
                    onChange={(e) => setWeightLbs(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Injuries or Constraints (Optional)</Label>
                <Textarea
                  placeholder="e.g., shoulder impingement, lower back sensitivity..."
                  value={constraints}
                  onChange={(e) => setConstraints(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          </Card>

          {/* Continue Button */}
          <div className="flex justify-end">
            <Button
              size="lg"
              onClick={handleContinue}
              disabled={!selectedLift || !currentWeight || !currentSets || !currentReps || loading}
              className="min-w-[200px]"
            >
              {loading ? "Creating Session..." : "Continue to Snapshot"}
              <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
