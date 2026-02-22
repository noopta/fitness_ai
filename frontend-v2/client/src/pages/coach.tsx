import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { Loader2, Sparkles, Lock, ChevronRight, TrendingUp, Dumbbell, Apple, MessageCircle, BarChart3, RotateCcw } from 'lucide-react';

import { CoachOnboarding } from '@/components/coach/CoachOnboarding';
import { OverviewTab } from '@/components/coach/OverviewTab';
import { AnalyticsTab } from '@/components/coach/AnalyticsTab';
import { NutritionTab } from '@/components/coach/NutritionTab';
import { ProgramTab } from '@/components/coach/ProgramTab';
import { ChatTab } from '@/components/coach/ChatTab';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface SessionSummary {
  id: string;
  selectedLift: string;
  createdAt: string;
  primaryLimiter: string | null;
  confidence: number | null;
  archetype: string | null;
  efficiencyScore: number | null;
  accessories?: string[];
  plan?: any;
}

interface CoachData {
  hasThread: boolean;
  messages: Array<{ role: string; content: string }>;
  sessionSummaries: SessionSummary[];
  tier: string;
}

const TABS = [
  { value: 'overview', label: 'Overview', icon: Sparkles },
  { value: 'analytics', label: 'Analytics', icon: BarChart3 },
  { value: 'nutrition', label: 'Nutrition', icon: Apple },
  { value: 'program', label: 'Program', icon: Dumbbell },
  { value: 'chat', label: 'Coach Chat', icon: MessageCircle },
];

export default function CoachPage() {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [coachData, setCoachData] = useState<CoachData | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  // Local override so user can re-do onboarding without refreshing
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';
  // Use local state if set, otherwise fall back to user profile
  const showDashboard = onboardingDone ?? (user?.coachOnboardingDone ?? false);

  useEffect(() => {
    if (!isPro) { setLoading(false); return; }
    fetch(`${API_BASE}/coach/messages`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setCoachData(data))
      .catch(() => toast.error('Failed to load coach'))
      .finally(() => setLoading(false));
  }, [isPro]);

  async function handleOnboardingComplete() {
    await refreshUser();
    setOnboardingDone(true);
  }

  function handleRestartOnboarding() {
    setOnboardingDone(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sessions = coachData?.sessionSummaries || [];
  const latestSession = sessions[0] || null;
  const latestPlan = latestSession?.plan || null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="container max-w-7xl mx-auto px-4 flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-2">
              <BrandLogo height={28} className="h-7 w-auto" />
              <span className="text-sm font-semibold hidden sm:block">LiftOff</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">AI Coach</span>
              <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wide">Pro</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/history">
              <Button variant="ghost" size="sm" className="rounded-xl text-xs">My Analyses</Button>
            </Link>
            {isPro && showDashboard && (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl text-xs text-muted-foreground"
                onClick={handleRestartOnboarding}
                title="Update my goals"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Update Goals
              </Button>
            )}
          </div>
        </div>
      </header>

      {!isPro ? (
        /* Upgrade wall */
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md w-full p-8 text-center space-y-5">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 mx-auto">
              <Lock className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">AI Coach is a Pro feature</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Upgrade to Pro to unlock your personal AI strength coach with personalized programs, nutrition tracking, and unlimited coaching conversations.
              </p>
            </div>
            <div className="space-y-2 text-left text-sm text-muted-foreground">
              {[
                'Guided coaching intake — tell us your goals',
                'Personalized program design from your data',
                'Nutrition tracking & AI macro recommendations',
                'Progress analytics & trend charts',
                'Unlimited coaching conversations',
              ].map(f => (
                <div key={f} className="flex items-center gap-2">
                  <span className="text-primary">✓</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
            <Link href="/pricing">
              <Button className="w-full rounded-xl bg-gradient-to-r from-primary to-blue-600 font-semibold">
                Upgrade to Pro
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </Card>
        </div>
      ) : !showDashboard ? (
        /* Onboarding interview */
        <CoachOnboarding
          userName={user?.name || null}
          userEmail={user?.email || null}
          existingAnswers={
            user?.coachProfile
              ? JSON.parse(user.coachProfile)
              : {
                  trainingAge: user?.trainingAge || '',
                  equipment: user?.equipment || '',
                  injuries: user?.constraintsText || '',
                  budget: user?.coachBudget || '',
                  primaryGoal: user?.coachGoal || '',
                }
          }
          onComplete={handleOnboardingComplete}
        />
      ) : (
        /* Main tabbed dashboard */
        <div className="flex-1 flex flex-col min-h-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            {/* Tab bar */}
            <div className="border-b bg-background/80 backdrop-blur sticky top-[57px] z-30">
              <div className="container max-w-7xl mx-auto px-4">
                <TabsList className="h-auto bg-transparent rounded-none p-0 gap-0 w-full justify-start overflow-x-auto">
                  {TABS.map(tab => {
                    const Icon = tab.icon;
                    return (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary px-4 py-3 text-xs font-medium flex items-center gap-1.5 shrink-0"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              <TabsContent value="overview" className="mt-0 h-full">
                <OverviewTab
                  sessions={sessions}
                  user={{
                    name: user?.name || null,
                    trainingAge: user?.trainingAge || null,
                    equipment: user?.equipment || null,
                    tier: user?.tier || 'free',
                    coachGoal: user?.coachGoal || null,
                  }}
                  onTabChange={setActiveTab}
                />
              </TabsContent>

              <TabsContent value="analytics" className="mt-0 h-full">
                <AnalyticsTab />
              </TabsContent>

              <TabsContent value="nutrition" className="mt-0 h-full">
                <NutritionTab
                  latestSession={latestSession ? {
                    selectedLift: latestSession.selectedLift,
                    primaryLimiter: latestSession.primaryLimiter,
                    plan: latestPlan,
                  } : null}
                  weightKg={user?.weightKg || null}
                  trainingAge={user?.trainingAge || null}
                  coachGoal={user?.coachGoal || null}
                  coachBudget={user?.coachBudget || null}
                  isPro={isPro}
                />
              </TabsContent>

              <TabsContent value="program" className="mt-0 h-full">
                <ProgramTab latestPlan={latestPlan} isPro={isPro} />
              </TabsContent>

              <TabsContent value="chat" className="mt-0" style={{ height: 'calc(100vh - 120px)' }}>
                <div className="h-full flex flex-col">
                  <ChatTab
                    initialMessages={(coachData?.messages || []).map(m => ({
                      role: m.role as 'user' | 'assistant',
                      content: m.content,
                    }))}
                    sessionCount={sessions.length}
                  />
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}
    </div>
  );
}
