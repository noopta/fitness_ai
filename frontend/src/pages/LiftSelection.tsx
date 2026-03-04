import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dumbbell, ArrowRight, ChevronLeft } from 'lucide-react';
import { apiRequest } from '@/lib/utils';
import type { Lift, ProfileData } from '@/types';

// Conversion utilities
const feetInchesToCm = (feet: number, inches: number) => {
  return (feet * 12 + inches) * 2.54;
};

const lbsToKg = (lbs: number) => lbs * 0.453592;

export default function LiftSelection() {
  const navigate = useNavigate();
  const [lifts, setLifts] = useState<Lift[]>([]);
  const [selectedLift, setSelectedLift] = useState<string>('');
  const [goal, setGoal] = useState<string>('balanced');
  const [profile, setProfile] = useState<ProfileData>({});
  const [loading, setLoading] = useState(false);

  // Imperial unit inputs
  const [heightFeet, setHeightFeet] = useState<number | undefined>();
  const [heightInches, setHeightInches] = useState<number | undefined>();
  const [weightLbs, setWeightLbs] = useState<number | undefined>();
  
  // Unit preference
  const [heightUnit, setHeightUnit] = useState<'metric' | 'imperial'>('metric');
  const [weightUnit, setWeightUnit] = useState<'metric' | 'imperial'>('metric');

  useEffect(() => {
    loadLifts();
  }, []);

  const loadLifts = async () => {
    try {
      const data = await apiRequest<{ lifts: Lift[] }>('/lifts');
      setLifts(data.lifts);
    } catch (error) {
      console.error('Failed to load lifts:', error);
    }
  };

  const handleSubmit = async () => {
    if (!selectedLift) return;

    setLoading(true);
    try {
      // Convert imperial to metric if needed
      const finalProfile = { ...profile };
      
      if (heightUnit === 'imperial' && heightFeet !== undefined) {
        finalProfile.heightCm = feetInchesToCm(heightFeet, heightInches || 0);
      }
      
      if (weightUnit === 'imperial' && weightLbs !== undefined) {
        finalProfile.weightKg = lbsToKg(weightLbs);
      }

      const response = await apiRequest<{ session: { id: string } }>('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          selectedLift,
          goal,
          profile: finalProfile
        })
      });

      navigate(`/snapshot/${response.session.id}`);
    } catch (error) {
      console.error('Failed to create session:', error);
      setLoading(false);
    }
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
            onClick={() => navigate('/')}
            className="mb-4"
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          
          <div className="flex items-center gap-3 mb-4">
            <Dumbbell className="w-10 h-10 text-primary" />
            <h1 className="text-3xl font-bold">Select Your Target Lift</h1>
          </div>
          <p className="text-muted-foreground">
            Choose the compound movement you want to improve and provide some context about yourself.
          </p>
        </motion.div>

        {/* Lift Selection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Target Lift</CardTitle>
              <CardDescription>Which lift are you working to improve?</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {lifts.map((lift) => (
                  <motion.div
                    key={lift.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <button
                      onClick={() => setSelectedLift(lift.id)}
                      className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                        selectedLift === lift.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <h3 className="font-semibold mb-1">{lift.name}</h3>
                      <p className="text-sm text-muted-foreground">{lift.description}</p>
                    </button>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Goal Selection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Training Goal</CardTitle>
              <CardDescription>What's your primary objective?</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup value={goal} onValueChange={setGoal}>
                <div className="flex items-center space-x-2 p-3 rounded border">
                  <RadioGroupItem value="strength_peak" id="strength" />
                  <Label htmlFor="strength" className="flex-1 cursor-pointer">
                    <div className="font-medium">Strength Peak</div>
                    <div className="text-sm text-muted-foreground">Maximize 1RM performance</div>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded border">
                  <RadioGroupItem value="balanced" id="balanced" />
                  <Label htmlFor="balanced" className="flex-1 cursor-pointer">
                    <div className="font-medium">Balanced</div>
                    <div className="text-sm text-muted-foreground">Strength and size gains</div>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded border">
                  <RadioGroupItem value="hypertrophy" id="hypertrophy" />
                  <Label htmlFor="hypertrophy" className="flex-1 cursor-pointer">
                    <div className="font-medium">Hypertrophy</div>
                    <div className="text-sm text-muted-foreground">Maximize muscle growth</div>
                  </Label>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>
        </motion.div>

        {/* Profile (Optional) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Your Profile (Optional)</CardTitle>
              <CardDescription>
                This helps personalize your program, but you can skip if you prefer.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <Label>Height</Label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setHeightUnit('metric')}
                        className={`text-xs px-2 py-1 rounded ${
                          heightUnit === 'metric'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        cm
                      </button>
                      <button
                        type="button"
                        onClick={() => setHeightUnit('imperial')}
                        className={`text-xs px-2 py-1 rounded ${
                          heightUnit === 'imperial'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        ft/in
                      </button>
                    </div>
                  </div>
                  
                  {heightUnit === 'metric' ? (
                    <Input
                      id="height"
                      type="number"
                      placeholder="175"
                      value={profile.heightCm || ''}
                      onChange={(e) =>
                        setProfile({ ...profile, heightCm: Number(e.target.value) })
                      }
                    />
                  ) : (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          type="number"
                          placeholder="5"
                          value={heightFeet || ''}
                          onChange={(e) => setHeightFeet(Number(e.target.value))}
                        />
                        <span className="text-xs text-muted-foreground mt-1 block">feet</span>
                      </div>
                      <div className="flex-1">
                        <Input
                          type="number"
                          placeholder="10"
                          value={heightInches || ''}
                          onChange={(e) => setHeightInches(Number(e.target.value))}
                        />
                        <span className="text-xs text-muted-foreground mt-1 block">inches</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <Label>Weight</Label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setWeightUnit('metric')}
                        className={`text-xs px-2 py-1 rounded ${
                          weightUnit === 'metric'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        kg
                      </button>
                      <button
                        type="button"
                        onClick={() => setWeightUnit('imperial')}
                        className={`text-xs px-2 py-1 rounded ${
                          weightUnit === 'imperial'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        lbs
                      </button>
                    </div>
                  </div>
                  
                  {weightUnit === 'metric' ? (
                    <Input
                      id="weight"
                      type="number"
                      placeholder="80"
                      value={profile.weightKg || ''}
                      onChange={(e) =>
                        setProfile({ ...profile, weightKg: Number(e.target.value) })
                      }
                    />
                  ) : (
                    <Input
                      type="number"
                      placeholder="175"
                      value={weightLbs || ''}
                      onChange={(e) => setWeightLbs(Number(e.target.value))}
                    />
                  )}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="training-age">Training Experience</Label>
                  <Select
                    value={profile.trainingAge}
                    onValueChange={(value) =>
                      setProfile({ ...profile, trainingAge: value })
                    }
                  >
                    <SelectTrigger id="training-age">
                      <SelectValue placeholder="Select experience level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner (&lt;1 year)</SelectItem>
                      <SelectItem value="intermediate">Intermediate (1-3 years)</SelectItem>
                      <SelectItem value="advanced">Advanced (3+ years)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="equipment">Equipment Access</Label>
                  <Select
                    value={profile.equipment}
                    onValueChange={(value) =>
                      setProfile({ ...profile, equipment: value })
                    }
                  >
                    <SelectTrigger id="equipment">
                      <SelectValue placeholder="Select equipment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="commercial">Commercial Gym</SelectItem>
                      <SelectItem value="home">Home Gym</SelectItem>
                      <SelectItem value="limited">Limited Equipment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="constraints">Injuries or Constraints (Optional)</Label>
                <Textarea
                  id="constraints"
                  placeholder="e.g., shoulder impingement, lower back sensitivity..."
                  value={profile.constraintsText || ''}
                  onChange={(e) =>
                    setProfile({ ...profile, constraintsText: e.target.value })
                  }
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Submit */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex justify-end"
        >
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={!selectedLift || loading}
            className="min-w-[200px]"
          >
            {loading ? (
              'Creating Session...'
            ) : (
              <>
                Continue to Snapshot
                <ArrowRight className="ml-2 h-5 w-5" />
              </>
            )}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
