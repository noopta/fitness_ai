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
  );
}

export default App;
