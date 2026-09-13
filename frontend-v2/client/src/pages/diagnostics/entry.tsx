import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { listDiagnostics } from '@/lib/diagnosticApi';

/**
 * First-run entry (/onboarding, /mvp): a brand-new user goes straight into the
 * conversation. Anyone who already has a thread goes Home instead, where the
 * hero offers Resume — exiting mid-flow must never strand a saved thread
 * behind a fresh one.
 */
export default function DiagnosticEntry() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    let live = true;
    listDiagnostics()
      .then((rows) => live && setLocation(rows.some((r) => r.flow === 'conversation') ? '/diagnostics' : '/diagnostics/chat', { replace: true }))
      .catch(() => live && setLocation('/diagnostics/chat', { replace: true }));
    return () => {
      live = false;
    };
  }, [setLocation]);
  return <div className="flex min-h-[100dvh] items-center justify-center text-sm text-zinc-500">Loading…</div>;
}
