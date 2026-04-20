import { Component, ReactNode, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { posthog, identifyUser, resetUser, trackPageView } from "./lib/analytics";
import { useAuth } from "@/context/AuthContext";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { FloatingCoachChat } from "@/components/FloatingCoachChat";
import NotFound from "@/pages/not-found";
import Signup from "./pages/signup";
import Onboarding from "./pages/onboarding";
import Snapshot from "./pages/snapshot";
import Diagnostic from "./pages/diagnostic";
import Plan from "./pages/plan";
import Login from "./pages/login";
import Register from "./pages/register";
import HistoryPage from "./pages/history";
import AnalysisPage from "./pages/analysis";
import Pricing from "./pages/pricing";
import Privacy from "./pages/privacy";
import Terms from "./pages/terms";
import CoachPage from "./pages/coach";
import SettingsPage from "./pages/settings";
import WorkoutsPage from "./pages/workouts";
import StrengthProfilePage from "./pages/strength-profile";
import AdminAffiliatesPage from "./pages/admin-affiliates";
import FriendsPage from "./pages/friends";
import MessagesPage from "./pages/messages";
import SocialFeedPage from "./pages/social-feed";
import InstitutionJoinPage from "./pages/institution-join";
import InstitutionAthletePage from "./pages/institution-athlete";
import InstitutionCoachPage from "./pages/institution-coach";
import InstitutionAthleteDetailPage from "./pages/institution-athlete-detail";
import NavDemoPage from "./pages/nav-demo";
import ProfilePage from "./pages/profile";
import FeaturesPage from "./pages/features";
import FeaturesV2Page from "./pages/features-v2";

// Tool pages
import E1RMCalculatorPage from "./pages/tools/e1rm-calculator";
import StrengthStandardsPage from "./pages/tools/strength-standards";
import WilksCalculatorPage from "./pages/tools/wilks-calculator";
import MacroCalculatorPage from "./pages/tools/macro-calculator";

// Fix pages
import FixBenchPressStuck from "./pages/fix/bench-press-stuck";
import FixBenchPressPlateau from "./pages/fix/bench-press-plateau";
import FixBenchPressLockout from "./pages/fix/bench-press-lockout";
import FixBenchPressOffChest from "./pages/fix/bench-press-off-chest";
import FixSquatStuck from "./pages/fix/squat-stuck";
import FixSquatPlateau from "./pages/fix/squat-plateau";
import FixSquatDepth from "./pages/fix/squat-depth";
import FixSquatKneeCave from "./pages/fix/squat-knee-cave";
import FixDeadliftStuck from "./pages/fix/deadlift-stuck";
import FixDeadliftPlateau from "./pages/fix/deadlift-plateau";
import FixDeadliftLowerBack from "./pages/fix/deadlift-lower-back";
import FixDeadliftOffFloor from "./pages/fix/deadlift-off-floor";
import FixWeakTricepsBench from "./pages/fix/weak-triceps-bench";
import FixWeakHamstringsDeadlift from "./pages/fix/weak-hamstrings-deadlift";
import FixWeakQuadsSquat from "./pages/fix/weak-quads-squat";

// Blog pages
import BlogIndexPage from "./pages/blog/index";
import BlogBenchPressPlateau from "./pages/blog/how-to-break-a-bench-press-plateau";
import BlogProgressiveOverload from "./pages/blog/progressive-overload-guide";
import BlogBeginners from "./pages/blog/strength-training-for-beginners";
import BlogProtein from "./pages/blog/how-much-protein-strength-athletes";
import BlogSquatAccessories from "./pages/blog/best-accessories-squat";
import BlogDeadliftForm from "./pages/blog/deadlift-form-guide";
import BlogSquatDepth from "./pages/blog/squat-depth-guide";
import BlogIncreaseDeadlift from "./pages/blog/how-to-increase-deadlift";
import BlogPowerliftingVsBodybuilding from "./pages/blog/powerlifting-vs-bodybuilding";

// Vs pages
import VsPersonalTrainer from "./pages/vs/personal-trainer";
import VsStrongLifts from "./pages/vs/stronglifts-5x5";
import VsFitbod from "./pages/vs/fitbod";
import VsDrMuscle from "./pages/vs/dr-muscle";

// Error boundary — catches render crashes and shows a recovery UI instead of
// a blank screen. Particularly important for catching hook-order errors and
// unexpected exceptions during auth state transitions.
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, error: err.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 bg-background text-center">
          <div className="text-4xl">⚠️</div>
          <div>
            <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              The page crashed unexpectedly. This is usually a temporary issue.
            </p>
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, error: '' }); window.location.href = '/'; }}
            className="rounded-xl bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Go to Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Stable wrapper components — defined at module level so the function reference
// never changes between renders. Inline arrows like () => <ProtectedRoute .../>
// inside Router() recreate a new component type on every render, causing React
// error #310 (hook count mismatch) when auth state updates after OAuth redirects.
const ProtectedOnboarding = () => <ProtectedRoute component={Onboarding} />;
const ProtectedSnapshot   = () => <ProtectedRoute component={Snapshot} />;
const ProtectedDiagnostic = () => <ProtectedRoute component={Diagnostic} />;
const ProtectedPlan       = () => <ProtectedRoute component={Plan} />;
const ProtectedHistory    = () => <ProtectedRoute component={HistoryPage} />;
const ProtectedCoach      = () => <ProtectedRoute component={CoachPage} />;
const ProtectedSettings   = () => <ProtectedRoute component={SettingsPage} />;
const ProtectedWorkouts        = () => <ProtectedRoute component={WorkoutsPage} />;
const ProtectedStrengthProfile = () => <ProtectedRoute component={StrengthProfilePage} />;
const ProtectedAdminAffiliates        = () => <ProtectedRoute component={AdminAffiliatesPage} />;
const ProtectedFriends                = () => <ProtectedRoute component={FriendsPage} />;
const ProtectedMessages               = () => <ProtectedRoute component={MessagesPage} />;
const ProtectedSocialFeed             = () => <ProtectedRoute component={SocialFeedPage} />;
const ProtectedInstitutionJoin        = () => <ProtectedRoute component={InstitutionJoinPage} />;
const ProtectedInstitutionAthlete     = () => <ProtectedRoute component={InstitutionAthletePage} />;
const ProtectedInstitutionCoach       = () => <ProtectedRoute component={InstitutionCoachPage} />;
const ProtectedInstitutionAthleteDetail = () => <ProtectedRoute component={InstitutionAthleteDetailPage} />;
const ProtectedProfile                  = () => <ProtectedRoute component={ProfilePage} />;

// Tracks page views on every Wouter route change and syncs PostHog identity
function AnalyticsProvider() {
  const [location] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    trackPageView(location);
  }, [location]);

  useEffect(() => {
    if (user) {
      identifyUser(user.id, { name: user.name, email: user.email, tier: user.tier });
    } else {
      resetUser();
    }
  }, [user?.id]);

  return null;
}

function Router() {
  return (
    <>
    <AnalyticsProvider />
    <Switch>
      <Route path="/" component={FeaturesPage} />
      <Route path="/prevlanding" component={Signup} />
      <Route path="/signup" component={Signup} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/analysis/:sessionId" component={AnalysisPage} />
      <Route path="/features-v2" component={FeaturesV2Page} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/mvp" component={ProtectedOnboarding} />
      <Route path="/onboarding" component={ProtectedOnboarding} />
      <Route path="/snapshot" component={ProtectedSnapshot} />
      <Route path="/diagnostic" component={ProtectedDiagnostic} />
      <Route path="/plan" component={ProtectedPlan} />
      <Route path="/history" component={ProtectedHistory} />
      <Route path="/coach" component={ProtectedCoach} />
      <Route path="/workouts" component={ProtectedWorkouts} />
      <Route path="/strength-profile" component={ProtectedStrengthProfile} />
      <Route path="/settings" component={ProtectedSettings} />
      <Route path="/admin/affiliates" component={ProtectedAdminAffiliates} />
      <Route path="/friends" component={ProtectedFriends} />
      <Route path="/messages" component={ProtectedMessages} />
      <Route path="/social" component={ProtectedSocialFeed} />
      <Route path="/institution/join/:token" component={ProtectedInstitutionJoin} />
      <Route path="/institution/:slug/coach" component={ProtectedInstitutionCoach} />
      <Route path="/institution/:slug/athlete/:userId" component={ProtectedInstitutionAthleteDetail} />
      <Route path="/institution/:slug" component={ProtectedInstitutionAthlete} />
      <Route path="/profile/:userId" component={ProtectedProfile} />
      <Route path="/nav-demo" component={NavDemoPage} />

      {/* Tool pages */}
      <Route path="/tools/e1rm-calculator" component={E1RMCalculatorPage} />
      <Route path="/tools/strength-standards" component={StrengthStandardsPage} />
      <Route path="/tools/wilks-calculator" component={WilksCalculatorPage} />
      <Route path="/tools/macro-calculator" component={MacroCalculatorPage} />

      {/* Fix pages */}
      <Route path="/fix/bench-press-stuck" component={FixBenchPressStuck} />
      <Route path="/fix/bench-press-plateau" component={FixBenchPressPlateau} />
      <Route path="/fix/bench-press-lockout" component={FixBenchPressLockout} />
      <Route path="/fix/bench-press-off-chest" component={FixBenchPressOffChest} />
      <Route path="/fix/squat-stuck" component={FixSquatStuck} />
      <Route path="/fix/squat-plateau" component={FixSquatPlateau} />
      <Route path="/fix/squat-depth" component={FixSquatDepth} />
      <Route path="/fix/squat-knee-cave" component={FixSquatKneeCave} />
      <Route path="/fix/deadlift-stuck" component={FixDeadliftStuck} />
      <Route path="/fix/deadlift-plateau" component={FixDeadliftPlateau} />
      <Route path="/fix/deadlift-lower-back" component={FixDeadliftLowerBack} />
      <Route path="/fix/deadlift-off-floor" component={FixDeadliftOffFloor} />
      <Route path="/fix/weak-triceps-bench" component={FixWeakTricepsBench} />
      <Route path="/fix/weak-hamstrings-deadlift" component={FixWeakHamstringsDeadlift} />
      <Route path="/fix/weak-quads-squat" component={FixWeakQuadsSquat} />

      {/* Blog pages */}
      <Route path="/blog" component={BlogIndexPage} />
      <Route path="/blog/how-to-break-a-bench-press-plateau" component={BlogBenchPressPlateau} />
      <Route path="/blog/progressive-overload-guide" component={BlogProgressiveOverload} />
      <Route path="/blog/strength-training-for-beginners" component={BlogBeginners} />
      <Route path="/blog/how-much-protein-strength-athletes" component={BlogProtein} />
      <Route path="/blog/best-accessories-squat" component={BlogSquatAccessories} />
      <Route path="/blog/deadlift-form-guide" component={BlogDeadliftForm} />
      <Route path="/blog/squat-depth-guide" component={BlogSquatDepth} />
      <Route path="/blog/how-to-increase-deadlift" component={BlogIncreaseDeadlift} />
      <Route path="/blog/powerlifting-vs-bodybuilding" component={BlogPowerliftingVsBodybuilding} />

      {/* Vs pages */}
      <Route path="/vs/personal-trainer" component={VsPersonalTrainer} />
      <Route path="/vs/stronglifts-5x5" component={VsStrongLifts} />
      <Route path="/vs/fitbod" component={VsFitbod} />
      <Route path="/vs/dr-muscle" component={VsDrMuscle} />

      <Route component={NotFound} />
    </Switch>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <SonnerToaster position="top-center" richColors />
            <Router />
            <FloatingCoachChat />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
