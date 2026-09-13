import type {
  AccessoryRecord,
  Answer,
  LiftId,
  LoadResponse,
  QuestionId,
  SetEntry,
  Stage,
  ThreadItem,
  Turn,
  TurnInput,
  TurnResult,
  Verdict,
  VideoResult,
  WeightUnit,
} from './types';
import { COPY } from './copy';
import { liftFamily, liftInfo } from './lifts';
import { canMoveOn, changeOffer, loggedCount, nextOffer, TARGET_RATIOS } from './accessories';
import { questionFor, phaseOption } from './questions';
import { formatSet } from './format';
import { isQuestionStage, progressIndex } from './stages';

export interface PendingTurn {
  turn: Turn;
  status: 'sending' | 'failed';
  bubbleId: string;
  /** State before the turn was submitted, for rolling back a failed send. */
  before: DiagnosticState;
}

export interface DiagnosticState {
  sessionId: string;
  loadStatus: 'ready' | 'loading' | 'failed';
  stage: Stage;
  /** Highest progress index reached, so the pill never moves backwards. */
  maxProgress: number;
  lift: LiftId | null;
  unit: WeightUnit;
  main: SetEntry | null;
  accessories: AccessoryRecord[];
  /** The accessory Anakin is currently asking about. */
  offer: string | null;
  /** Anakin pushes back on an under-minimum Skip exactly once. */
  pushedBack: boolean;
  /** Came back from the report via "Add the missing numbers". */
  rescoring: boolean;
  video: { status: 'none' | 'skipped' | 'analyzing' | 'done' | 'failed'; turnId?: string; result?: VideoResult };
  questionOrder: QuestionId[];
  answers: Partial<Record<QuestionId, Answer>>;
  verdict: Verdict | null;
  typeInstead: boolean;
  thread: ThreadItem[];
  pending: PendingTurn | null;
  nextItemId: number;
}

export type DiagnosticAction =
  | { type: 'loading' }
  | { type: 'loaded'; data: LoadResponse }
  | { type: 'loadFailed' }
  | { type: 'submit'; turn: Turn }
  | { type: 'succeeded'; turnId: string; result: TurnResult }
  | { type: 'failed'; turnId: string }
  | { type: 'retry' }
  | { type: 'videoResolved'; turnId: string; result: VideoResult | null }
  | { type: 'unblock' }
  | { type: 'setTypeInstead'; value: boolean }
  | { type: 'verdictRefreshed'; verdict: Verdict };

const ALL_QUESTIONS: QuestionId[] = ['q0', 'q1', 'q2'];

export function initialState(sessionId: string, unit: WeightUnit = 'lb'): DiagnosticState {
  const s: DiagnosticState = {
    sessionId,
    loadStatus: 'ready',
    stage: 'lift',
    maxProgress: 0,
    lift: null,
    unit,
    main: null,
    accessories: [],
    offer: null,
    pushedBack: false,
    rescoring: false,
    video: { status: 'none' },
    questionOrder: ALL_QUESTIONS,
    answers: {},
    verdict: null,
    typeInstead: false,
    thread: [],
    pending: null,
    nextItemId: 0,
  };
  return anakin(anakin(s, COPY.intro), COPY.askLift);
}

// ─── Thread helpers ──────────────────────────────────────────────────────────

function push(s: DiagnosticState, item: DistributiveOmit<ThreadItem, 'id'>): DiagnosticState {
  const id = `i${s.nextItemId}`;
  return { ...s, nextItemId: s.nextItemId + 1, thread: [...s.thread, { ...item, id } as ThreadItem] };
}

function anakin(s: DiagnosticState, text: string): DiagnosticState {
  return push(s, { kind: 'anakin', text });
}

function toStage(s: DiagnosticState, stage: Stage): DiagnosticState {
  return { ...s, stage, maxProgress: Math.max(s.maxProgress, progressIndex(stage)) };
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

// ─── Guards ──────────────────────────────────────────────────────────────────

/** Whether an action is legal right now. The composer only offers legal ones. */
export function canSubmit(s: DiagnosticState, input: TurnInput): boolean {
  if (s.pending || s.loadStatus !== 'ready') return false;
  switch (input.type) {
    case 'lift':
      return s.stage === 'lift';
    case 'main':
      return s.stage === 'numbers';
    case 'accessory':
    case 'untrained':
      return s.stage === 'acc' && input.exerciseId === s.offer;
    case 'skip':
      return s.stage === 'acc' && input.exerciseId === s.offer && (s.rescoring || !canMoveOn(s.accessories));
    case 'change':
      return s.stage === 'acc' && !!s.lift && !!s.offer && changeOffer(s.lift, s.accessories, s.offer) !== null;
    case 'moveOn':
      return s.stage === 'acc' && canMoveOn(s.accessories);
    case 'video':
    case 'skipVideo':
      return s.stage === 'video';
    case 'answer':
      return isQuestionStage(s.stage) && input.question === s.stage && input.text.trim().length > 0;
    case 'verdict':
      return s.stage === 'ready';
    case 'addNumbers':
      return s.stage === 'verdict' && !!s.verdict && !!s.lift && nextOffer(s.lift, reopenSkipped(s.accessories)) !== null;
  }
}

export function userBubbleText(input: TurnInput): string {
  switch (input.type) {
    case 'lift':
      return liftInfo(input.lift).name;
    case 'main':
    case 'accessory':
      return formatSet(input.set);
    case 'untrained':
      return COPY.dontTrain;
    case 'skip':
    case 'skipVideo':
      return COPY.skip;
    case 'change':
      return COPY.change;
    case 'moveOn':
      return COPY.moveOn;
    case 'video':
      return COPY.attachedSet(input.durationSec);
    case 'answer':
      return input.text.trim();
    case 'verdict':
      return COPY.getVerdict;
    case 'addNumbers':
      return COPY.addMissingNumbers;
  }
}

// ─── Submit / settle ─────────────────────────────────────────────────────────

function submit(s: DiagnosticState, turn: Turn, bubbleId?: string): DiagnosticState {
  const before = s;
  let next: DiagnosticState;
  let id: string;
  if (bubbleId) {
    // Retry: the bubble keeps its original id and position.
    id = bubbleId;
    next = {
      ...s,
      nextItemId: Math.max(s.nextItemId, Number(bubbleId.slice(1)) + 1),
      thread: [...s.thread, { kind: 'user', id, turnId: turn.id, text: userBubbleText(turn.input), status: 'sending' }],
    };
  } else {
    id = `i${s.nextItemId}`;
    next = push(s, { kind: 'user', turnId: turn.id, text: userBubbleText(turn.input), status: 'sending' });
  }

  // Optimistic stage moves for the long-running turns, so their composer
  // (a spinner) is what the user sees while the request is in flight.
  const input = turn.input;
  if (input.type === 'verdict') next = toStage(next, 'generating');
  if (input.type === 'video') next = toStage({ ...next, video: { status: 'analyzing', turnId: turn.id } }, 'analyzing');
  if (input.type === 'accessory' && s.rescoring) {
    next = toStage(anakin(next, COPY.rescoring(loggedCount(s.accessories) + 1)), 'generating');
  }

  return { ...next, pending: { turn, status: 'sending', bubbleId: id, before } };
}

function markBubble(thread: ThreadItem[], bubbleId: string, status: 'sent' | 'failed'): ThreadItem[] {
  return thread.map((t) => (t.kind === 'user' && t.id === bubbleId ? { ...t, status } : t));
}

function succeeded(s: DiagnosticState, turnId: string, result: TurnResult): DiagnosticState {
  if (!s.pending || s.pending.turn.id !== turnId) return s;
  const { turn, bubbleId } = s.pending;
  const settled: DiagnosticState = { ...s, pending: null, thread: markBubble(s.thread, bubbleId, 'sent') };
  return applyTurn(settled, turn, result);
}

function failed(s: DiagnosticState, turnId: string): DiagnosticState {
  if (!s.pending || s.pending.turn.id !== turnId) return s;
  const { before, bubbleId, turn } = s.pending;
  // Roll back anything optimistic, keep the user's bubble in place, greyed.
  const bubble: ThreadItem = { kind: 'user', id: bubbleId, turnId, text: userBubbleText(turn.input), status: 'failed' };
  const nextItemId = Math.max(before.nextItemId, Number(bubbleId.slice(1)) + 1);
  return { ...before, nextItemId, thread: [...before.thread, bubble], pending: { ...s.pending, status: 'failed' } };
}

function retry(s: DiagnosticState): DiagnosticState {
  if (!s.pending || s.pending.status !== 'failed') return s;
  const { before, turn, bubbleId } = s.pending;
  const resubmitted = submit(before, turn, bubbleId);
  return { ...resubmitted, nextItemId: Math.max(resubmitted.nextItemId, s.nextItemId) };
}

// ─── Turn effects ────────────────────────────────────────────────────────────

function applyTurn(s: DiagnosticState, turn: Turn, result: TurnResult): DiagnosticState {
  const input = turn.input;
  switch (input.type) {
    case 'lift':
      return toStage(anakin({ ...s, lift: input.lift }, COPY.askNumbers(liftInfo(input.lift).name)), 'numbers');

    case 'main': {
      const withMain = { ...s, main: input.set, unit: input.set.unit };
      const offer = nextOffer(withMain.lift!, withMain.accessories);
      if (!offer) return toVideo(withMain);
      return toStage(anakin({ ...withMain, offer }, COPY.firstAccessory(offer)), 'acc');
    }

    case 'accessory': {
      const records = [...s.accessories, { exerciseId: input.exerciseId, status: 'logged' as const, set: input.set }];
      if (s.rescoring) {
        if (result.verdict) return showVerdict({ ...s, accessories: records, rescoring: false, offer: null }, result.verdict);
        // Re-score came back without a verdict — keep the old one rather than strand the thread.
        return keepVerdict({ ...s, accessories: records });
      }
      return afterAccessory({ ...s, accessories: records }, 'logged');
    }

    case 'untrained': {
      const records = [...s.accessories, { exerciseId: input.exerciseId, status: 'untrained' as const }];
      if (s.rescoring) {
        const offer = nextOffer(s.lift!, records);
        if (!offer) return keepVerdict({ ...s, accessories: records });
        return anakin({ ...s, accessories: records, offer }, COPY.afterUntrained(offer, volumeNoun(s.lift!)));
      }
      return afterAccessory({ ...s, accessories: records }, 'untrained');
    }

    case 'skip': {
      if (s.rescoring) return keepVerdict(s);
      const records = [...s.accessories, { exerciseId: input.exerciseId, status: 'skipped' as const }];
      return afterAccessory({ ...s, accessories: records }, 'skipped');
    }

    case 'change': {
      const offer = changeOffer(s.lift!, s.accessories, input.exerciseId);
      if (!offer) return s;
      return anakin({ ...s, offer }, COPY.afterChange(offer));
    }

    case 'moveOn':
      return s.rescoring ? keepVerdict(s) : toVideo(s);

    case 'video': {
      const withTurn = { ...s, video: { status: 'analyzing' as const, turnId: turn.id } };
      const v = result.video;
      if (v?.status === 'complete') return resolveVideo(toStage(withTurn, 'analyzing'), turn.id, v.result ?? null);
      if (v?.status === 'failed') return resolveVideo(toStage(withTurn, 'analyzing'), turn.id, null);
      return toStage(withTurn, 'analyzing');
    }

    case 'skipVideo':
      return askQuestion(anakin({ ...s, video: { status: 'skipped' }, questionOrder: ALL_QUESTIONS }, COPY.videoSkipped), 'q0');

    case 'answer': {
      const answer: Answer = {
        source: input.optionId ? 'chip' : 'text',
        optionId: input.optionId,
        text: input.text.trim(),
        flags: input.flags,
      };
      const answered = { ...s, typeInstead: false, answers: { ...s.answers, [input.question]: answer } };
      const idx = s.questionOrder.indexOf(input.question);
      const nextQ = s.questionOrder[idx + 1];
      if (nextQ) return askQuestion(answered, nextQ);
      if (result.limitReached) return limitReached(answered);
      return toStage(anakin(answered, COPY.ready), 'ready');
    }

    case 'verdict':
      if (result.limitReached || !result.verdict) return limitReached(s);
      return showVerdict(s, result.verdict);

    case 'addNumbers': {
      // Lifts skipped the first time are exactly the missing numbers — offer them again.
      const accessories = reopenSkipped(s.accessories);
      const offer = nextOffer(s.lift!, accessories);
      if (!offer) return s;
      // "discards the stale verdict card"
      const thread = s.thread.filter((t) => t.kind !== 'verdict');
      return toStage(anakin({ ...s, accessories, thread, rescoring: true, offer }, COPY.resumeNumbers(offer)), 'acc');
    }
  }
}

function reopenSkipped(records: AccessoryRecord[]): AccessoryRecord[] {
  return records.filter((r) => r.status !== 'skipped');
}

function afterAccessory(s: DiagnosticState, kind: 'logged' | 'untrained' | 'skipped'): DiagnosticState {
  const lift = s.lift!;
  const n = loggedCount(s.accessories);
  if (n >= TARGET_RATIOS) return toVideo(anakin(s, COPY.threeLogged));
  const offer = nextOffer(lift, s.accessories);
  if (!offer) return toVideo(s);

  const withOffer = { ...s, offer };
  if (n === 2) return anakin(withOffer, COPY.offerThird(offer));
  if (kind === 'logged') return anakin(withOffer, COPY.afterLogged(offer));
  if (kind === 'untrained') return anakin(withOffer, COPY.afterUntrained(offer, volumeNoun(lift)));
  if (!s.pushedBack) return anakin({ ...withOffer, pushedBack: true }, COPY.pushBack(offer));
  return anakin(withOffer, COPY.afterSkipAgain(offer));
}

function toVideo(s: DiagnosticState): DiagnosticState {
  const thin = loggedCount(s.accessories) < 2;
  return toStage(anakin({ ...s, offer: null }, thin ? COPY.askVideoThin : COPY.askVideo), 'video');
}

function askQuestion(s: DiagnosticState, q: QuestionId): DiagnosticState {
  return toStage(anakin(s, questionFor(s.lift!, q).text), q);
}

function limitReached(s: DiagnosticState): DiagnosticState {
  return toStage(push(s, { kind: 'limit' }), 'blocked');
}

function showVerdict(s: DiagnosticState, verdict: Verdict): DiagnosticState {
  const line = COPY.verdictLine[verdict.grade];
  return toStage(push(anakin({ ...s, verdict, rescoring: false, offer: null }, line), { kind: 'verdict', verdict }), 'verdict');
}

function keepVerdict(s: DiagnosticState): DiagnosticState {
  if (!s.verdict) return toVideo({ ...s, rescoring: false });
  return toStage(
    push(anakin({ ...s, rescoring: false, offer: null }, COPY.keepVerdict), { kind: 'verdict', verdict: s.verdict }),
    'verdict',
  );
}

function resolveVideo(s: DiagnosticState, turnId: string, result: VideoResult | null): DiagnosticState {
  if (s.stage !== 'analyzing' || s.video.turnId !== turnId) return s;
  if (!result) {
    return askQuestion(anakin({ ...s, video: { status: 'failed', turnId }, questionOrder: ALL_QUESTIONS }, COPY.videoFailed), 'q0');
  }
  const withCard = push({ ...s, video: { status: 'done', turnId, result } }, { kind: 'video', result });
  const option = phaseOption(s.lift!, result.stickingPhase);
  if (!option) {
    // A readable clip that didn't pin the phase still counts as video; the
    // phase question stays in (never dead-end, never guess).
    return askQuestion(anakin({ ...withCard, questionOrder: ALL_QUESTIONS }, COPY.videoNoPhase), 'q0');
  }
  // "A successful video answers the phase question" — stored as if given.
  const answers = { ...withCard.answers, q0: { source: 'video' as const, optionId: option.id, text: option.label, flags: option.flags } };
  return askQuestion(anakin({ ...withCard, answers, questionOrder: ['q1', 'q2'] }, COPY.phaseSettled), 'q1');
}

function volumeNoun(lift: LiftId): string {
  switch (liftFamily(lift)) {
    case 'press':
      return 'pressing volume';
    case 'deadlift':
      return 'pulling volume';
    case 'squat':
      return 'leg volume';
  }
}

// ─── Hydrate ─────────────────────────────────────────────────────────────────

/**
 * Rebuild the thread by replaying the persisted turns through the same
 * reducer. Stage comes out of the replay — never from thread length.
 */
export function hydrate(sessionId: string, data: LoadResponse): DiagnosticState {
  let s = initialState(sessionId, data.unit ?? 'lb');
  const ordered = [...data.turns].sort((a, b) => a.seq - b.seq);
  for (const rec of ordered) {
    const turn: Turn = { id: rec.clientTurnId, input: rec.input };
    // A turn after a block means the block was lifted live (purchase, or a
    // new day) — replay the same "You're clear" beat the user saw.
    if (s.stage === 'blocked') s = unblock(s);
    s = succeeded(submit(s, turn), turn.id, rec.result ?? {});
  }
  if (s.stage === 'blocked' && !data.limit.reached) s = unblock(s);
  return s;
}

function unblock(s: DiagnosticState): DiagnosticState {
  if (s.stage !== 'blocked') return s;
  return toStage(anakin(s, COPY.unblocked), 'ready');
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function diagnosticReducer(s: DiagnosticState, action: DiagnosticAction): DiagnosticState {
  switch (action.type) {
    case 'loading':
      return { ...s, loadStatus: 'loading' };
    case 'loaded':
      return hydrate(s.sessionId, action.data);
    case 'loadFailed':
      return { ...s, loadStatus: 'failed' };
    case 'submit':
      return canSubmit(s, action.turn.input) ? submit(s, action.turn) : s;
    case 'succeeded':
      return succeeded(s, action.turnId, action.result);
    case 'failed':
      return failed(s, action.turnId);
    case 'retry':
      return retry(s);
    case 'videoResolved':
      return resolveVideo(s, action.turnId, action.result);
    case 'unblock':
      return unblock(s);
    case 'setTypeInstead':
      return isQuestionStage(s.stage) ? { ...s, typeInstead: action.value } : s;
    case 'verdictRefreshed': {
      if (!s.verdict) return s;
      const thread = s.thread.map((t) => (t.kind === 'verdict' ? { ...t, verdict: action.verdict } : t));
      return { ...s, verdict: action.verdict, thread };
    }
  }
}
