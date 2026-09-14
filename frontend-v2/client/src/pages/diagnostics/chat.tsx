import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { X } from 'lucide-react';
import { COPY, composerView, headerView, type ThreadItem } from '@axiom/diagnostic-core';
import { useAuth } from '@/context/AuthContext';
import { useUnits } from '@/lib/units';
import { WebAnalytics, trackPageTime } from '@/lib/analytics';
import { useDiagnostic } from '@/hooks/useDiagnostic';
import { waitForPro } from '@/lib/diagnosticApi';
import { Composer } from '@/components/diagnostic/Composer';
import { ReportView } from '@/components/diagnostic/ReportView';
import { DiagnosticPaywall } from '@/components/diagnostic/Paywall';
import { InkButton, Monogram } from '@/components/diagnostic/primitives';
import { AnakinBubble, LimitCard, TypingBubble, UserBubble, VerdictCard, VideoCard } from '@/components/diagnostic/ThreadItems';

/**
 * Lift diagnostic — one message thread with Anakin (handoff §1).
 *
 *   /diagnostics/chat                 new diagnostic
 *   /diagnostics/chat/:id             resume (also where Stripe Checkout returns)
 *   /diagnostics/chat/:id?add=1       "Add the missing numbers" from a report
 */
export default function DiagnosticChatPage() {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { refreshUser } = useAuth();
  const { isMetric, setUnit: setUnitPref } = useUnits();
  // The id in the URL changes once a new thread gets its session; the thread
  // itself must not remount when it does.
  const [initialId] = useState(params.id);
  const { controller, state } = useDiagnostic(initialId, isMetric ? 'kg' : 'lb');
  const [reportOpen, setReportOpen] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [animateFrom, setAnimateFrom] = useState<number | null>(initialId ? null : 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const addDone = useRef(false);

  useEffect(() => trackPageTime('lift_diagnostic'), []);

  // Returning from Checkout (opened from the daily-limit card). If the webhook
  // beat the reload the replay is already unblocked; otherwise wait for it,
  // then clear the block in place.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') !== 'success') return;
    window.history.replaceState(null, '', window.location.pathname);
    void waitForPro().then(async (pro) => {
      await refreshUser();
      if (pro) controller.unblock();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL resumable once the lift chip has created the session.
  useEffect(() => {
    if (!initialId && state.lift && !window.location.pathname.endsWith(state.sessionId)) {
      window.history.replaceState(null, '', `/diagnostics/chat/${state.sessionId}`);
    }
  }, [initialId, state.lift, state.sessionId]);

  useEffect(() => {
    if (animateFrom === null && state.loadStatus === 'ready') setAnimateFrom(state.thread.length);
  }, [animateFrom, state.loadStatus, state.thread.length]);

  useEffect(() => {
    const wantsAdd = new URLSearchParams(window.location.search).get('add') === '1';
    if (wantsAdd && !addDone.current && state.stage === 'verdict' && state.loadStatus === 'ready') {
      addDone.current = true;
      // One-shot: a reload must not re-open the thread for numbers again.
      window.history.replaceState(null, '', window.location.pathname);
      controller.act({ type: 'addNumbers' });
    }
  }, [state.stage, state.loadStatus, controller]);

  // Auto-scroll to the end on every new message.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: animateFrom === null ? 'auto' : 'smooth' });
  }, [state.thread.length, state.pending?.status, animateFrom]);

  const exit = useCallback(() => setLocation('/diagnostics'), [setLocation]);
  const openReport = useCallback(() => {
    if (!state.verdict) return;
    WebAnalytics.diagnosticVerdictViewed(false);
    setReportOpen(true);
  }, [state.verdict]);

  const view = composerView(state);
  const header = headerView(state);

  const renderItem = (item: ThreadItem, index: number) => {
    const animate = animateFrom !== null && index >= animateFrom;
    switch (item.kind) {
      case 'anakin':
        return <AnakinBubble key={item.id} text={item.text} animate={animate} />;
      case 'user':
        return <UserBubble key={item.id} item={item} animate={animate} onRetry={() => controller.retry()} />;
      case 'video':
        return <VideoCard key={item.id} result={item.result} animate={animate} />;
      case 'verdict':
        return <VerdictCard key={item.id} verdict={item.verdict} animate={animate} onOpen={openReport} />;
      case 'limit':
        return <LimitCard key={item.id} animate={animate} onUpgrade={() => setPaywall(true)} onLater={exit} />;
    }
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-white">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-zinc-200 px-4 py-2.5">
        <button type="button" onClick={exit} aria-label="Exit to Home" className="-ml-1 flex h-9 w-9 items-center justify-center text-zinc-950">
          <X size={22} />
        </button>
        <Monogram size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-zinc-950">{COPY.anakin}</div>
          <div className="text-xs font-medium text-zinc-500">{header.typing ? COPY.statusTyping : COPY.statusOnline}</div>
        </div>
        <div className="rounded-full bg-zinc-100 px-2.5 py-[5px] text-xs font-semibold text-zinc-600" aria-label={`Progress ${header.progress}`}>
          {header.progress}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {state.loadStatus === 'loading' ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading…</div>
        ) : state.loadStatus === 'failed' ? (
          <div className="flex h-full flex-col items-center justify-center gap-3.5">
            <p className="text-[15px] text-zinc-500">Couldn't open this diagnostic.</p>
            <InkButton onClick={() => window.location.reload()}>{COPY.retry}</InkButton>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5 px-4 py-4" aria-live="polite">
            {state.thread.map(renderItem)}
            {header.typing && view.mode !== 'waiting' ? <TypingBubble /> : null}
          </div>
        )}
      </div>

      {state.loadStatus === 'ready' ? (
        <Composer
          view={view}
          stage={state.stage}
          controller={controller}
          onOpenReport={openReport}
          onDone={exit}
          onUnitChange={(u) => void setUnitPref(u === 'kg' ? 'metric' : 'imperial').catch(() => {})}
        />
      ) : null}

      {reportOpen && state.verdict ? (
        <div className="dx-fade-in fixed inset-0 z-40 overflow-y-auto bg-white">
          <ReportView
            verdict={state.verdict}
            onClose={() => setReportOpen(false)}
            onAddNumbers={
              controller.canAct({ type: 'addNumbers' })
                ? () => {
                    setReportOpen(false);
                    controller.act({ type: 'addNumbers' });
                  }
                : undefined
            }
          />
        </div>
      ) : null}

      {/* The only paywall in the flow: the daily limit (never on onboarding). */}
      <DiagnosticPaywall open={paywall} source="diagnostic_limit" onClose={() => setPaywall(false)} />
    </div>
  );
}
