import type {
  DiagnosticApi,
  DiagnosticListRow,
  LoadResponse,
  TurnInput,
  TurnResult,
  Verdict,
} from '@axiom/diagnostic-core';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';
const base = (id: string) => `${API_BASE}/lift-diagnostics/${id}`;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Transport for the shared DiagnosticController over authFetch (cookie + bearer). */
export const diagnosticApi: DiagnosticApi = {
  load: async (sessionId) => json<LoadResponse>(await authFetch(base(sessionId))),

  async sendTurn(sessionId: string, clientTurnId: string, input: TurnInput): Promise<TurnResult> {
    const res = await authFetch(`${base(sessionId)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ clientTurnId, input }),
    });
    return (await json<{ result?: TurnResult }>(res)).result ?? {};
  },

  async uploadVideo(sessionId, clientTurnId, file, durationSec) {
    const form = new FormData();
    form.append('video', file as File);
    form.append('clientTurnId', clientTurnId);
    if (durationSec != null) form.append('durationSec', String(durationSec));
    // authFetch forces JSON content-type, which breaks multipart — send it by hand.
    const token = sessionStorage.getItem('liftoff_bearer_token');
    const res = await fetch(`${base(sessionId)}/video`, {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return (await json<{ result?: TurnResult }>(res)).result ?? { video: { status: 'pending' } };
  },

  videoStatus: async (sessionId, clientTurnId) => json(await authFetch(`${base(sessionId)}/video/${clientTurnId}`)),

  async getReport(sessionId): Promise<Verdict> {
    return (await json<{ verdict: Verdict }>(await authFetch(`${base(sessionId)}/report`))).verdict;
  },
};

export async function listDiagnostics(): Promise<DiagnosticListRow[]> {
  return (await json<{ diagnostics: DiagnosticListRow[] }>(await authFetch(`${API_BASE}/lift-diagnostics`))).diagnostics;
}

export async function shareDiagnostic(sessionId: string): Promise<string> {
  return (await json<{ shareUrl: string }>(await authFetch(`${base(sessionId)}/share`, { method: 'POST' }))).shareUrl;
}

/** Read-only report behind a share link — no auth. */
export async function getPublicReport(sessionId: string): Promise<Verdict> {
  const res = await fetch(`${base(sessionId)}/public`);
  return (await json<{ verdict: Verdict }>(res)).verdict;
}

/** Video durations come from the file itself, so the 60s cap is checked before upload. */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}
