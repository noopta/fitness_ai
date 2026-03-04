import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Home, Download, Target, Dumbbell, TrendingUp, ClipboardCheck } from 'lucide-react';
import { apiRequest } from '@/lib/utils';
import type { WorkoutPlan } from '@/types';

export default function PlanOutput() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionId) {
      loadPlan();
    }
  }, [sessionId]);

  const loadPlan = async () => {
    try {
      const data = await apiRequest<{
        session: { plans: Array<{ planJson: string }> };
      }>(`/sessions/${sessionId}`);

      if (data.session.plans && data.session.plans.length > 0) {
        const latestPlan = JSON.parse(data.session.plans[0].planJson);
        setPlan(latestPlan);
      }
    } catch (error) {
      console.error('Failed to load plan:', error);
    } finally {
      setLoading(false);
    }
  };

  const downloadPlan = () => {
    if (!plan) return;

    const text = formatPlanAsText(plan);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lift-coach-plan-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatPlanAsText = (p: WorkoutPlan): string => {
    let text = `LIFT COACH - PERSONALIZED TRAINING PLAN\n`;
    text += `Generated: ${new Date().toLocaleDateString()}\n`;
    text += `\n${'='.repeat(50)}\n\n`;

    text += `DIAGNOSIS\n${'-'.repeat(50)}\n`;
    p.diagnosis.forEach((d) => {
      text += `\n${d.limiterName} (${Math.round(d.confidence * 100)}% confidence)\n`;
      d.evidence.forEach((e) => text += `  • ${e}\n`);
    });

    text += `\n${'='.repeat(50)}\n\n`;
    text += `PRIMARY LIFT\n${'-'.repeat(50)}\n`;
    const pl = p.bench_day_plan.primary_lift;
    text += `${pl.exercise_name}\n`;
    text += `  ${pl.sets} sets × ${pl.reps} reps @ ${pl.intensity}\n`;
    text += `  Rest: ${pl.rest_minutes} minutes\n`;

    text += `\n${'='.repeat(50)}\n\n`;
    text += `ACCESSORIES\n${'-'.repeat(50)}\n`;
    p.bench_day_plan.accessories.forEach((acc, i) => {
      text += `\n${i + 1}. ${acc.exercise_name}\n`;
      text += `   ${acc.sets} sets × ${acc.reps} reps\n`;
      text += `   Purpose: ${acc.why}\n`;
    });

    text += `\n${'='.repeat(50)}\n\n`;
    text += `PROGRESSION RULES\n${'-'.repeat(50)}\n`;
    p.progression_rules.forEach((rule) => text += `• ${rule}\n`);

    text += `\n${'='.repeat(50)}\n\n`;
    text += `TRACK NEXT TIME\n${'-'.repeat(50)}\n`;
    p.track_next_time.forEach((item) => text += `• ${item}\n`);

    return text;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center">
        <div className="text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          >
            <Dumbbell className="w-16 h-16 text-primary mx-auto mb-4" />
          </motion.div>
          <p className="text-muted-foreground">Loading your plan...</p>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Plan Not Found</CardTitle>
            <CardDescription>Unable to load your training plan.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/')}>Return Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="inline-block mb-4"
          >
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <ClipboardCheck className="w-10 h-10 text-primary" />
            </div>
          </motion.div>

          <h1 className="text-4xl font-bold mb-2">Your Personalized Plan</h1>
          <p className="text-muted-foreground mb-6">
            Based on your diagnostic interview and strength profile
          </p>

          <div className="flex gap-3 justify-center">
            <Button onClick={downloadPlan} variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Download Plan
            </Button>
            <Button onClick={() => navigate('/')}>
              <Home className="mr-2 h-4 w-4" />
              Start New Session
            </Button>
          </div>
        </motion.div>

        {/* Diagnosis */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Target className="w-6 h-6 text-primary" />
                <CardTitle>Diagnosis</CardTitle>
              </div>
              <CardDescription>Identified limiting factors</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {plan.diagnosis.map((diagnosis, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + index * 0.1 }}
                  className="border rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-lg">{diagnosis.limiterName}</h4>
                    <span className="text-sm font-medium px-2 py-1 rounded bg-primary/10 text-primary">
                      {Math.round(diagnosis.confidence * 100)}% confidence
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground mb-2">Evidence:</p>
                    {diagnosis.evidence.map((evidence, i) => (
                      <p key={i} className="text-sm pl-4 border-l-2 border-primary/30">
                        {evidence}
                      </p>
                    ))}
                  </div>
                </motion.div>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        {/* Primary Lift */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Dumbbell className="w-6 h-6 text-primary" />
                <CardTitle>Primary Lift</CardTitle>
              </div>
              <CardDescription>Your main working sets</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-primary/5 rounded-lg p-6 border-2 border-primary/20">
                <h3 className="text-2xl font-bold mb-4">
                  {plan.bench_day_plan.primary_lift.exercise_name}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Sets</p>
                    <p className="text-2xl font-bold">{plan.bench_day_plan.primary_lift.sets}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Reps</p>
                    <p className="text-2xl font-bold">{plan.bench_day_plan.primary_lift.reps}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Intensity</p>
                    <p className="text-lg font-bold">{plan.bench_day_plan.primary_lift.intensity}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Rest</p>
                    <p className="text-lg font-bold">
                      {plan.bench_day_plan.primary_lift.rest_minutes}min
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Accessories */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-primary" />
                <CardTitle>Accessory Exercises</CardTitle>
              </div>
              <CardDescription>Targeted work to address your limiters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {plan.bench_day_plan.accessories.map((accessory, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + index * 0.1 }}
                  className="border rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-lg">{accessory.exercise_name}</h4>
                    <span className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground capitalize">
                      {accessory.category}
                    </span>
                  </div>
                  <p className="text-muted-foreground mb-3">
                    {accessory.sets} sets × {accessory.reps} reps
                  </p>
                  <div className="bg-muted/50 rounded p-3">
                    <p className="text-sm">
                      <span className="font-medium">Why: </span>
                      {accessory.why}
                    </p>
                  </div>
                </motion.div>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        {/* Progression & Tracking */}
        <div className="grid md:grid-cols-2 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Progression Rules</CardTitle>
                <CardDescription>When and how to add weight</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {plan.progression_rules.map((rule, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-primary mt-1">•</span>
                      <span className="text-sm">{rule}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Track Next Time</CardTitle>
                <CardDescription>Key metrics to monitor</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {plan.track_next_time.map((item, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-primary mt-1">•</span>
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
