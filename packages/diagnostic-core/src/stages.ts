import type { ComposerMode, Stage } from './types';

export const STAGES: Stage[] = [
  'lift', 'numbers', 'acc', 'video', 'analyzing', 'q0', 'q1', 'q2', 'ready', 'generating', 'verdict', 'blocked',
];

/** The ordered list the progress pill counts over (§4). */
export const PROGRESS_STAGES = ['lift', 'numbers', 'acc', 'video', 'q0', 'ready', 'verdict'] as const;
export const PROGRESS_TOTAL = PROGRESS_STAGES.length;

/** Sub-stages map to their parent so the counter never exceeds 7. */
const PROGRESS_PARENT: Record<Stage, (typeof PROGRESS_STAGES)[number]> = {
  lift: 'lift',
  numbers: 'numbers',
  acc: 'acc',
  video: 'video',
  analyzing: 'video',
  q0: 'q0',
  q1: 'q0',
  q2: 'q0',
  blocked: 'q0',
  ready: 'ready',
  generating: 'ready',
  verdict: 'verdict',
};

export function progressIndex(stage: Stage): number {
  return PROGRESS_STAGES.indexOf(PROGRESS_PARENT[stage]);
}

/** "3 / 7", or "Done" at the verdict. `maxIndex` keeps it from moving backwards. */
export function progressLabel(stage: Stage, maxIndex: number): string {
  if (stage === 'verdict') return 'Done';
  const idx = Math.max(progressIndex(stage), maxIndex);
  return `${Math.min(idx, PROGRESS_TOTAL - 1) + 1} / ${PROGRESS_TOTAL}`;
}

/**
 * Stage → composer mode. Exhaustive on purpose: a stage with no mode would
 * render as an empty footer, which is the failure the spec calls out.
 */
export function composerModeFor(stage: Stage, typeInstead: boolean): ComposerMode {
  switch (stage) {
    case 'lift':
      return 'chips';
    case 'numbers':
      return 'numbers';
    case 'acc':
      return 'accessory';
    case 'video':
      return 'video';
    case 'analyzing':
    case 'generating':
      return 'waiting';
    case 'q0':
    case 'q1':
    case 'q2':
      return typeInstead ? 'typing' : 'chips';
    case 'ready':
      return 'generate';
    case 'verdict':
      return 'done';
    case 'blocked':
      return 'blocked';
    default: {
      const exhaustive: never = stage;
      throw new Error(`Unhandled stage: ${String(exhaustive)}`);
    }
  }
}

export function isQuestionStage(stage: Stage): stage is 'q0' | 'q1' | 'q2' {
  return stage === 'q0' || stage === 'q1' || stage === 'q2';
}
