import type {
  DiagnosticApi,
  DiagnosticListRow,
  LoadResponse,
  TurnInput,
  TurnResult,
  Verdict,
} from '@axiom/diagnostic-core';
import { apiFetch, apiUpload, LONG_TIMEOUT_MS } from '../lib/api';

/** A clip picked with expo-image-picker. */
export interface PickedClip {
  uri: string;
  mimeType: string;
  durationSec: number | null;
  /** The user's stills preference from Form Analysis — stills stay opt-in. */
  saveFrames: boolean;
  /** In-app trim window (Android); iOS trims natively before we ever see the file. */
  trim?: { startSec: number; endSec: number };
}

const base = (id: string) => `/lift-diagnostics/${id}`;

/** Transport for the shared DiagnosticController, over the app's fetch helpers. */
export const diagnosticApi: DiagnosticApi = {
  load: (sessionId) => apiFetch(base(sessionId)) as Promise<LoadResponse>,

  async sendTurn(sessionId: string, clientTurnId: string, input: TurnInput): Promise<TurnResult> {
    // Verdicts (and re-scores) wait on plan generation; everything else is quick,
    // so a dead connection surfaces as "Didn't send" in 30s rather than 3 minutes.
    const slow = input.type === 'verdict' || input.type === 'accessory';
    const res = await apiFetch(`${base(sessionId)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ clientTurnId, input }),
      ...(slow ? { timeoutMs: LONG_TIMEOUT_MS } : {}),
    });
    return res?.result ?? {};
  },

  async uploadVideo(sessionId, clientTurnId, file, durationSec, signal) {
    const clip = file as PickedClip;
    const form = new FormData();
    const ext = clip.mimeType.split('/')[1]?.replace('quicktime', 'mov') ?? 'mp4';
    form.append('video', { uri: clip.uri, name: `set.${ext}`, type: clip.mimeType } as any);
    form.append('clientTurnId', clientTurnId);
    if (durationSec != null) form.append('durationSec', String(durationSec));
    form.append('saveFrames', clip.saveFrames ? '1' : '0');
    if (clip.trim) {
      form.append('trimStart', clip.trim.startSec.toFixed(2));
      form.append('trimEnd', clip.trim.endSec.toFixed(2));
    }
    const res = await apiUpload(`${base(sessionId)}/video`, form, undefined, signal);
    return res?.result ?? { video: { status: 'pending' } };
  },

  videoStatus: (sessionId, clientTurnId) => apiFetch(`${base(sessionId)}/video/${clientTurnId}`),

  async getReport(sessionId): Promise<Verdict> {
    const res = await apiFetch(`${base(sessionId)}/report`);
    return res.verdict;
  },
};

export async function listDiagnostics(opts: { timeoutMs?: number } = {}): Promise<DiagnosticListRow[]> {
  const res = await apiFetch('/lift-diagnostics', opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : undefined);
  return res?.diagnostics ?? [];
}

export async function shareDiagnostic(sessionId: string): Promise<string> {
  const res = await apiFetch(`${base(sessionId)}/share`, { method: 'POST' });
  return res.shareUrl;
}
