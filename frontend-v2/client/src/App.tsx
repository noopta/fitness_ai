import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Signup} />
      <Route path="/signup" component={Signup} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/analysis/:sessionId" component={AnalysisPage} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/mvp" component={() => <ProtectedRoute component={Onboarding} />} />
      <Route path="/onboarding" component={() => <ProtectedRoute component={Onboarding} />} />
      <Route path="/snapshot" component={() => <ProtectedRoute component={Snapshot} />} />
      <Route path="/diagnostic" component={() => <ProtectedRoute component={Diagnostic} />} />
      <Route path="/plan" component={() => <ProtectedRoute component={Plan} />} />
      <Route path="/history" component={() => <ProtectedRoute component={HistoryPage} />} />
      <Route path="/coach" component={() => <ProtectedRoute component={CoachPage} />} />
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
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
