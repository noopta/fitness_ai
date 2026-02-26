import { Component, ReactNode } from "react";
import { Switch, Route } from "wouter";
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
import CoachPage from "./pages/coach";

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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Signup} />
      <Route path="/signup" component={Signup} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/analysis/:sessionId" component={AnalysisPage} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/mvp" component={ProtectedOnboarding} />
      <Route path="/onboarding" component={ProtectedOnboarding} />
      <Route path="/snapshot" component={ProtectedSnapshot} />
      <Route path="/diagnostic" component={ProtectedDiagnostic} />
      <Route path="/plan" component={ProtectedPlan} />
      <Route path="/history" component={ProtectedHistory} />
      <Route path="/coach" component={ProtectedCoach} />
      <Route component={NotFound} />
    </Switch>
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
