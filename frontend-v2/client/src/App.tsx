import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Signup from "./pages/signup";
import Onboarding from "./pages/onboarding";
import Snapshot from "./pages/snapshot";
import Diagnostic from "./pages/diagnostic";
import Plan from "./pages/plan";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Signup} />
      <Route path="/signup" component={Signup} />
      <Route path="/mvp" component={Onboarding} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/snapshot" component={Snapshot} />
      <Route path="/diagnostic" component={Diagnostic} />
      <Route path="/plan" component={Plan} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <SonnerToaster position="top-center" richColors />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
