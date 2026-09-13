import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DiagnosticController, type DiagnosticEvent, type WeightUnit } from '@axiom/diagnostic-core';
import { diagnosticApi } from './api';
import { Analytics, posthog } from '../lib/analytics';
import { markDiagnosticFirstSeen } from '../onboarding/diagnosticFirst';

function track(e: DiagnosticEvent) {
  switch (e.name) {
    case 'diagnostic_started':
      Analytics.diagnosticStarted(e.props.lift);
      break;
    case 'diagnostic_completed':
      Analytics.diagnosticCompleted(e.props.lift);
      // Reaching a verdict ends the first-run funnel: later cold starts go Home.
      void markDiagnosticFirstSeen();
      posthog.capture('diagnostic_verdict_graded', { ...e.props, platform: 'mobile' });
      break;
    default:
      posthog.capture(e.name, { ...e.props, platform: 'mobile' });
  }
}

/**
 * One controller per mounted conversation. `sessionId` resumes a saved thread;
 * omitted, a new session id is minted and nothing touches the network until
 * the first chip.
 */
export function useDiagnostic(sessionId: string | undefined, unit: WeightUnit) {
  // Keyed on sessionId only: the unit seeds a NEW thread; a resumed one takes
  // the unit its own sets were logged in.
  const controller = useMemo(
    () => new DiagnosticController(diagnosticApi, { sessionId, unit, onEvent: track }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );
  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { controller, state };
}
