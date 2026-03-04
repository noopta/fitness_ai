import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, Plus, Trash2, ArrowRight } from 'lucide-react';
import { apiRequest } from '@/lib/utils';
import type { Exercise, ExerciseSnapshot } from '@/types';

// Conversion utilities
const lbsToKg = (lbs: number) => lbs * 0.453592;
const kgToLbs = (kg: number) => kg / 0.453592;

export default function SnapshotEntry() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [snapshots, setSnapshots] = useState<ExerciseSnapshot[]>([]);
  const [currentSnapshot, setCurrentSnapshot] = useState<Partial<ExerciseSnapshot>>({});
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lbs'>('kg');
  const [weightInput, setWeightInput] = useState<number | undefined>();

  useEffect(() => {
    if (sessionId) {
      loadSessionAndExercises();
    }
  }, [sessionId]);

  const loadSessionAndExercises = async () => {
    try {
      // Get session to find selected lift
      const sessionData = await apiRequest<{ session: { selectedLift: string } }>(
        `/sessions/${sessionId}`
      );
      const liftId = sessionData.session.selectedLift;

      // Load relevant exercises
      const exerciseData = await apiRequest<{ exercises: Exercise[] }>(
        `/lifts/${liftId}/exercises`
      );
      setExercises(exerciseData.exercises);
    } catch (error) {
      console.error('Failed to load exercises:', error);
    }
  };

  const addSnapshot = async () => {
    if (!currentSnapshot.exerciseId || !weightInput || !currentSnapshot.sets) {
      return;
    }

    // Convert weight to kg if needed
    const weightKg = weightUnit === 'lbs' ? lbsToKg(weightInput) : weightInput;
    const finalSnapshot = { ...currentSnapshot, weight: weightKg };

    try {
      await apiRequest(`/sessions/${sessionId}/snapshots`, {
        method: 'POST',
        body: JSON.stringify(finalSnapshot)
      });

      setSnapshots([...snapshots, finalSnapshot as ExerciseSnapshot]);
      setCurrentSnapshot({});
      setWeightInput(undefined);
    } catch (error) {
      console.error('Failed to add snapshot:', error);
    }
  };

  const removeSnapshot = (index: number) => {
    setSnapshots(snapshots.filter((_, i) => i !== index));
  };

  const handleContinue = () => {
    if (!sessionId) return;
    navigate(`/diagnostic/${sessionId}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary py-8">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-4"
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          <h1 className="text-3xl font-bold mb-2">Current Strength Snapshot</h1>
          <p className="text-muted-foreground">
            Enter your recent performance on relevant exercises (optional but recommended).
          </p>
        </motion.div>

        {/* Add Snapshot Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Add Exercise</CardTitle>
              <CardDescription>
                Share recent sets from your training to help with diagnosis
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="exercise">Exercise</Label>
                <Select
                  value={currentSnapshot.exerciseId}
                  onValueChange={(value) =>
                    setCurrentSnapshot({ ...currentSnapshot, exerciseId: value })
                  }
                >
                  <SelectTrigger id="exercise">
                    <SelectValue placeholder="Select exercise" />
                  </SelectTrigger>
                  <SelectContent>
                    {exercises.map((ex) => (
                      <SelectItem key={ex.id} value={ex.id}>
                        {ex.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <Label htmlFor="weight">Weight</Label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setWeightUnit('kg')}
                        className={`text-xs px-2 py-0.5 rounded ${
                          weightUnit === 'kg'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        kg
                      </button>
                      <button
                        type="button"
                        onClick={() => setWeightUnit('lbs')}
                        className={`text-xs px-2 py-0.5 rounded ${
                          weightUnit === 'lbs'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        lbs
                      </button>
                    </div>
                  </div>
                  <Input
                    id="weight"
                    type="number"
                    placeholder={weightUnit === 'kg' ? '100' : '225'}
                    value={weightInput || ''}
                    onChange={(e) => setWeightInput(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sets">Sets</Label>
                  <Input
                    id="sets"
                    type="number"
                    placeholder="3"
                    value={currentSnapshot.sets || ''}
                    onChange={(e) =>
                      setCurrentSnapshot({
                        ...currentSnapshot,
                        sets: Number(e.target.value)
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reps">Reps</Label>
                  <Input
                    id="reps"
                    placeholder="8 or 6-8"
                    value={currentSnapshot.repsSchema || ''}
                    onChange={(e) =>
                      setCurrentSnapshot({
                        ...currentSnapshot,
                        repsSchema: e.target.value
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rpe">RPE/RIR</Label>
                  <Input
                    id="rpe"
                    placeholder="RPE 8"
                    value={currentSnapshot.rpeOrRir || ''}
                    onChange={(e) =>
                      setCurrentSnapshot({
                        ...currentSnapshot,
                        rpeOrRir: e.target.value
                      })
                    }
                  />
                </div>
              </div>

              <Button
                onClick={addSnapshot}
                disabled={
                  !currentSnapshot.exerciseId ||
                  !weightInput ||
                  !currentSnapshot.sets ||
                  !currentSnapshot.repsSchema
                }
                className="w-full"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add to Snapshot
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Snapshot List */}
        <AnimatePresence>
          {snapshots.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Card className="mb-8">
                <CardHeader>
                  <CardTitle>Your Snapshot ({snapshots.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {snapshots.map((snapshot, index) => {
                      const exercise = exercises.find(
                        (ex) => ex.id === snapshot.exerciseId
                      );
                      return (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          className="flex items-center justify-between p-4 border rounded-lg"
                        >
                          <div>
                            <div className="font-semibold">{exercise?.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {snapshot.weight.toFixed(1)}kg ({Math.round(kgToLbs(snapshot.weight))}lbs) × {snapshot.sets} sets × {snapshot.repsSchema} reps
                              {snapshot.rpeOrRir && ` @ ${snapshot.rpeOrRir}`}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeSnapshot(index)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </motion.div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex justify-between items-center"
        >
          <p className="text-sm text-muted-foreground">
            {snapshots.length === 0
              ? 'You can skip this step and proceed directly to the diagnostic.'
              : 'Add more exercises or continue to the diagnostic interview.'}
          </p>
          <Button size="lg" onClick={handleContinue}>
            Continue to Diagnostic
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
