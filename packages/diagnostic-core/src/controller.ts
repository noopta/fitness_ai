import type { LoadResponse, TurnInput, TurnResult, Verdict, VideoResult, WeightUnit } from './types';
import { canSubmit, diagnosticReducer, initialState, type DiagnosticAction, type DiagnosticState } from './reducer';
import { loggedCount } from './accessories';

/** Transport the apps implement over their own fetch helpers. */
export interface DiagnosticApi {
  load(sessionId: string): Promise<LoadResponse>;
  sendTurn(sessionId: string, clientTurnId: string, input: TurnInput): Promise<TurnResult>;
  /** Multipart upload of the clip; resolves once the server has accepted the job. */
  uploadVideo(sessionId: string, clientTurnId: string, file: unknown, durationSec: number | null): Promise<TurnResult>;
  videoStatus(sessionId: string, clientTurnId: string): Promise<{ status: 'pending' | 'complete' | 'failed'; result?: VideoResult | null }>;
  getReport(sessionId: string): Promise<Verdict>;
}

export type DiagnosticEvent =
  | { name: 'diagnostic_started'; props: { lift: string; session_id: string } }
  | { name: 'diagnostic_turn'; props: { type: string; stage: string } }
  | { name: 'diagnostic_turn_failed'; props: { type: string; status: number | null } }
  | { name: 'diagnostic_video_result'; props: { ok: boolean } }
  | { name: 'diagnostic_limit_reached'; props: { stage: string } }
  | { name: 'diagnostic_completed'; props: { lift: string; grade: number; confidence: number; ratios: number; rescore: boolean } };

export interface ControllerOptions {
  sessionId?: string;
  unit?: WeightUnit;
  onEvent?: (e: DiagnosticEvent) => void;
  videoPollMs?: number;
  videoTimeoutMs?: number;
}

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Framework-free store around the reducer. Holds the ONE send path every turn
 * goes through — lift chip, numbers, Skip, Move on, video, verdict — so a
 * failed send behaves identically on every turn (§8), and a retry re-runs the
 * original action with its original payload and turn id (idempotent server
 * side, so a set is never double-logged).
 */
export class DiagnosticController {
  private state: DiagnosticState;
  private listeners = new Set<() => void>();
  private disposed = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly resuming: boolean;

  constructor(private readonly api: DiagnosticApi, private readonly opts: ControllerOptions = {}) {
    this.resuming = !!opts.sessionId;
    this.state = initialState(opts.sessionId ?? uuid(), opts.unit ?? 'lb');
  }

  getState = (): DiagnosticState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get sessionId(): string {
    return this.state.sessionId;
  }

  private dispatch(action: DiagnosticAction) {
    if (this.disposed) return;
    const next = diagnosticReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  /** Load a saved thread (resume) — a fresh session needs no network. */
  async start(): Promise<void> {
    if (!this.resuming) return;
    this.dispatch({ type: 'loading' });
    try {
      const data = await this.api.load(this.state.sessionId);
      this.dispatch({ type: 'loaded', data });
      this.resumePolling();
    } catch {
      this.dispatch({ type: 'loadFailed' });
    }
  }

  canAct(input: TurnInput): boolean {
    return canSubmit(this.state, input);
  }

  /** The shared send path. Returns false if the action isn't legal right now. */
  act(input: TurnInput): boolean {
    if (!canSubmit(this.state, input)) return false;
    const turn = { id: uuid(), input };
    this.dispatch({ type: 'submit', turn });
    void this.send(turn.id, input);
    return true;
  }

  retry(): void {
    const pending = this.state.pending;
    if (!pending || pending.status !== 'failed') return;
    this.dispatch({ type: 'retry' });
    void this.send(pending.turn.id, pending.turn.input);
  }

  setTypeInstead(value: boolean): void {
    this.dispatch({ type: 'setTypeInstead', value });
  }

  /** After a purchase (or the next day): clear the block and resume at `ready`. */
  unblock(): void {
    this.dispatch({ type: 'unblock' });
  }

  /** After a purchase: swap the locked fix for the protocol in place. */
  async refreshVerdict(): Promise<void> {
    if (!this.state.verdict) return;
    try {
      const verdict = await this.api.getReport(this.state.sessionId);
      this.dispatch({ type: 'verdictRefreshed', verdict });
    } catch {
      /* the locked card stays; the report screen can refetch on focus */
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.listeners.clear();
  }

  private async send(turnId: string, input: TurnInput): Promise<void> {
    const before = this.state;
    const sessionId = before.sessionId;
    try {
      let result: TurnResult;
      if (input.type === 'video') {
        result = await this.api.uploadVideo(sessionId, turnId, input.file, input.durationSec);
      } else {
        result = await this.api.sendTurn(sessionId, turnId, stripLocal(input));
      }
      if ((input.type === 'verdict' || (input.type === 'accessory' && before.rescoring)) && !result.verdict && !result.limitReached) {
        throw Object.assign(new Error('Verdict missing from response'), { status: null });
      }
      this.dispatch({ type: 'succeeded', turnId, result });
      this.afterSuccess(before, input, result);
      if (input.type === 'video' && (!result.video || result.video.status === 'pending')) this.poll(turnId, Date.now());
    } catch (err) {
      const status = (err as { status?: number }).status ?? null;
      if (status === 429 && input.type === 'verdict') {
        this.dispatch({ type: 'succeeded', turnId, result: { limitReached: true } });
        this.emit({ name: 'diagnostic_limit_reached', props: { stage: before.stage } });
        return;
      }
      this.dispatch({ type: 'failed', turnId });
      this.emit({ name: 'diagnostic_turn_failed', props: { type: input.type, status } });
    }
  }

  private afterSuccess(before: DiagnosticState, input: TurnInput, result: TurnResult) {
    const s = this.state;
    this.emit({ name: 'diagnostic_turn', props: { type: input.type, stage: before.stage } });
    if (input.type === 'lift') {
      this.emit({ name: 'diagnostic_started', props: { lift: input.lift, session_id: s.sessionId } });
    }
    if (result.limitReached) this.emit({ name: 'diagnostic_limit_reached', props: { stage: before.stage } });
    if (result.verdict && s.lift) {
      this.emit({
        name: 'diagnostic_completed',
        props: {
          lift: s.lift,
          grade: result.verdict.grade,
          confidence: result.verdict.confidence,
          ratios: loggedCount(s.accessories),
          rescore: input.type === 'accessory',
        },
      });
    }
  }

  private resumePolling() {
    const v = this.state.video;
    if (this.state.stage === 'analyzing' && v.turnId) this.poll(v.turnId, Date.now());
  }

  private poll(turnId: string, startedAt: number) {
    const interval = this.opts.videoPollMs ?? 2500;
    const timeout = this.opts.videoTimeoutMs ?? 180_000;
    const tick = async () => {
      if (this.disposed) return;
      if (this.state.stage !== 'analyzing' || this.state.video.turnId !== turnId) return;
      try {
        const status = await this.api.videoStatus(this.state.sessionId, turnId);
        if (status.status === 'complete') return this.resolveVideo(turnId, status.result ?? null);
        if (status.status === 'failed') return this.resolveVideo(turnId, null);
      } catch {
        /* transient — keep polling until the timeout */
      }
      if (Date.now() - startedAt > timeout) return this.resolveVideo(turnId, null);
      this.pollTimer = setTimeout(tick, interval);
    };
    this.pollTimer = setTimeout(tick, interval);
  }

  private resolveVideo(turnId: string, result: VideoResult | null) {
    this.dispatch({ type: 'videoResolved', turnId, result });
    this.emit({ name: 'diagnostic_video_result', props: { ok: !!result } });
  }

  private emit(e: DiagnosticEvent) {
    try {
      this.opts.onEvent?.(e);
    } catch {
      /* analytics must never break the thread */
    }
  }
}

/** The clip itself never goes in a JSON body or the transcript. */
function stripLocal(input: TurnInput): TurnInput {
  if (input.type === 'video') {
    const { file: _file, ...rest } = input;
    return rest;
  }
  return input;
}
