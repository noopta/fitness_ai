import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/Navbar';
import { Loader2, Shield, CheckCircle2, Target, Sparkles, ArrowRight } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

function formatLiftName(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function AnalysisPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [plan, setPlan] = useState<any>(null);
  const [selectedLift, setSelectedLift] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!sessionId) { setNotFound(true); setLoading(false); return; }
    fetch(`${API_BASE}/sessions/${sessionId}/public`)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json();
      })
      .then(data => {
        if (data?.plan) {
          setPlan(data.plan);
          setSelectedLift(data.selectedLift || '');
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !plan) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <Shield className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Analysis Not Found</h2>
        <p className="text-muted-foreground text-sm max-w-sm">This analysis is either private or no longer available.</p>
        <Button asChild>
          <Link href="/register">Create Your Own Analysis</Link>
        </Button>
      </div>
    );
  }

  const primaryDiagnosis = plan.diagnosis?.[0];
  const primary = plan.bench_day_plan?.primary_lift;
  const accessories = plan.bench_day_plan?.accessories || [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary">
      <Navbar variant="full" rightSlot={
        <Button size="sm" asChild>
          <Link href="/register">
            Get Your Own Analysis
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      } />

      <main className="mx-auto max-w-4xl px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-6"
        >
          <Card className="p-6 border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl border bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground font-semibold">Shared Analysis</div>
                <h1 className="text-2xl font-bold mt-0.5">{formatLiftName(selectedLift || plan.selected_lift || '')}</h1>
                {primaryDiagnosis && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Limiting factor: <span className="font-medium text-foreground">{primaryDiagnosis.limiterName}</span>
                    {primaryDiagnosis.confidence && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        {Math.round(primaryDiagnosis.confidence * 100)}% confidence
                      </Badge>
                    )}
                  </p>
                )}
              </div>
            </div>
          </Card>

          {plan.diagnosis && (
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Target className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Diagnosis</h2>
              </div>
              <div className="space-y-3">
                {plan.diagnosis.map((d: any, idx: number) => (
                  <div key={idx} className="rounded-xl border bg-muted/30 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold">{d.limiterName}</span>
                      <Badge variant="outline" className="text-xs">{Math.round(d.confidence * 100)}%</Badge>
                    </div>
                    <ul className="space-y-1.5">
                      {d.evidence?.map((e: string, eIdx: number) => (
                        <li key={eIdx} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
                          <span>{e}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {primary && (
            <Card className="p-6">
              <h2 className="font-semibold mb-3">Primary Lift</h2>
              <div className="rounded-xl border bg-muted/30 p-4 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{primary.exercise_name}</span>
                <div className="flex gap-2">
                  <Badge variant="secondary">{primary.sets} x {primary.reps}</Badge>
                  <Badge variant="outline">{primary.intensity}</Badge>
                  <Badge variant="outline">Rest {primary.rest_minutes} min</Badge>
                </div>
              </div>
            </Card>
          )}

          {accessories.length > 0 && (
            <Card className="p-6">
              <h2 className="font-semibold mb-3">Accessories</h2>
              <div className="space-y-3">
                {[...accessories]
                  .sort((a: any, b: any) => (a.priority ?? 99) - (b.priority ?? 99))
                  .map((a: any, idx: number) => (
                    <div key={a.exercise_id || idx} className="rounded-xl border bg-muted/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <span className="font-medium">{a.exercise_name}</span>
                        <div className="flex gap-2">
                          <Badge variant="secondary">{a.sets} x {a.reps}</Badge>
                          <Badge variant="outline" className="capitalize">{a.category}</Badge>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">{a.why}</p>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          <Card className="p-6 text-center border-primary/20 bg-primary/5">
            <h3 className="font-semibold text-lg mb-2">Want your own analysis?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              LiftOff diagnoses your exact weak points and prescribes targeted accessories. Free to try.
            </p>
            <Button asChild>
              <Link href="/register">
                Create Free Account
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
