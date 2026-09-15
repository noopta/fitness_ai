import { firstRunTarget } from '@axiom/diagnostic-core';
import { listDiagnostics } from './api';
import { markDiagnosticFirstSeen } from '../onboarding/diagnosticFirst';

/** Sign-in shouldn't hang on this; a slow list falls back to a new thread. */
const LOOKUP_TIMEOUT_MS = 6000;

/**
 * The first-run destination for the conversational diagnostic. Every path that
 * used to hard-code '/diagnostic/conversation' (post-auth routing, the
 * fresh-install catch) asks this instead, so a relaunch after the phone died
 * reopens the saved thread rather than starting a second one beside it.
 */
export async function firstRunDiagnosticHref(): Promise<string> {
  try {
    const target = firstRunTarget(await listDiagnostics({ timeoutMs: LOOKUP_TIMEOUT_MS }));
    if (target.kind === 'new') return '/diagnostic/conversation';
    // Showing a finished verdict ends the first-run funnel, same as seeing it live.
    if (target.kind === 'review') void markDiagnosticFirstSeen();
    return `/diagnostic/conversation?sessionId=${encodeURIComponent(target.sessionId)}`;
  } catch {
    return '/diagnostic/conversation';
  }
}
