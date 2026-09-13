import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DiagnosticController, type DiagnosticApi, type DiagnosticEvent, type WeightUnit } from '@axiom/diagnostic-core';
import { diagnosticApi } from '@/lib/diagnosticApi';
import { WebAnalytics, posthog } from '@/lib/analytics';

function track(e: DiagnosticEvent) {
  if (e.name === 'diagnostic_started') WebAnalytics.diagnosticStarted(e.props.lift);
  else if (e.name === 'diagnostic_completed') {
    WebAnalytics.diagnosticCompleted(e.props.lift);
    posthog.capture('diagnostic_verdict_graded', { ...e.props, platform: 'web' });
  } else posthog.capture(e.name, { ...e.props, platform: 'web' });
}

/** One controller per mounted conversation; `sessionId` resumes a saved thread. */
export function useDiagnostic(sessionId: string | undefined, unit: WeightUnit, api: DiagnosticApi = diagnosticApi) {
  const controller = useMemo(
    () => new DiagnosticController(api, { sessionId, unit, onEvent: track }),
    // A new thread takes the unit at creation; a resumed one keeps its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, api],
  );
  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { controller, state };
}
