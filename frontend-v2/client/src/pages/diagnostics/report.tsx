import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import type { Verdict } from '@axiom/diagnostic-core';
import { useAuth } from '@/context/AuthContext';
import { diagnosticApi, getPublicReport } from '@/lib/diagnosticApi';
import { WebAnalytics } from '@/lib/analytics';
import { ReportView } from '@/components/diagnostic/ReportView';
import { DiagnosticPaywall } from '@/components/diagnostic/Paywall';
import { InkButton } from '@/components/diagnostic/primitives';

/**
 * /diagnostics/:id — deep-linkable, shareable report. The owner gets their
 * own (tier-gated) report with share + upgrade; anyone else holding the link
 * gets the read-only public view.
 */
export default function DiagnosticReportPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user, loading, refreshUser } = useAuth();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paywall, setPaywall] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      if (user) {
        try {
          const v = await diagnosticApi.getReport(id);
          setVerdict(v);
          setReadOnly(false);
          WebAnalytics.diagnosticVerdictViewed(v.fix.locked);
          return;
        } catch (err: any) {
          if (err?.status !== 404) throw err;
        }
      }
      setVerdict(await getPublicReport(id));
      setReadOnly(true);
    } catch {
      setFailed(true);
    }
  }, [id, user]);

  useEffect(() => {
    if (loading) return;
    void load();
  }, [loading, load]);

  // Back from Checkout: refresh the user, then the report — the fix swaps in place.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') !== 'success') return;
    window.history.replaceState(null, '', window.location.pathname);
    void refreshUser().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!verdict) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3.5 bg-white">
        {failed ? (
          <>
            <p className="text-[15px] text-zinc-500">Couldn't open this report.</p>
            <InkButton onClick={() => void load()}>Retry</InkButton>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Loading…</p>
        )}
      </div>
    );
  }

  return (
    <div className="dx-fade-in">
      <ReportView
        verdict={verdict}
        readOnly={readOnly}
        onClose={() => setLocation(user ? '/diagnostics' : '/')}
        onUpgrade={() => setPaywall(true)}
        onAddNumbers={!readOnly && verdict.missingLifts.length ? () => setLocation(`/diagnostics/chat/${id}?add=1`) : undefined}
      />
      <DiagnosticPaywall open={paywall} source="diagnostic_report" onClose={() => setPaywall(false)} />
    </div>
  );
}
