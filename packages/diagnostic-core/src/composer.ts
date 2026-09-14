import type { ComposerMode } from './types';
import type { DiagnosticState } from './reducer';
import { COPY } from './copy';
import { LIFTS, exerciseName } from './lifts';
import { canMoveOn, changeOffer, loggedCount, MIN_RATIOS } from './accessories';
import { questionFor } from './questions';
import { composerModeFor, isQuestionStage, progressLabel } from './stages';

export type ComposerView =
  | { mode: 'chips'; options: { id: string; label: string; flags: string[] }[]; typeInstead: boolean; disabled: boolean }
  | { mode: 'typing'; placeholder: string; disabled: boolean }
  | { mode: 'numbers'; unit: string; disabled: boolean }
  | {
      mode: 'accessory';
      exerciseId: string;
      exerciseName: string;
      unit: string;
      counter: { text: string; atMinimum: boolean };
      canChange: boolean;
      /** Below the minimum: quiet Skip. At 2+: solid Move on. Re-scoring keeps Skip. */
      escape: 'skip' | 'moveOn';
      disabled: boolean;
    }
  | { mode: 'video'; disabled: boolean }
  | { mode: 'generate'; label: string; disabled: boolean }
  | { mode: 'waiting'; label: string; canSkip: boolean }
  | { mode: 'done' }
  | { mode: 'blocked'; caption: string };

/** Everything a composer needs to render, derived from state alone. */
export function composerView(s: DiagnosticState): ComposerView {
  const mode: ComposerMode = composerModeFor(s.stage, s.typeInstead);
  const disabled = s.pending !== null;
  switch (mode) {
    case 'chips':
      if (s.stage === 'lift') {
        return { mode, options: LIFTS.map((l) => ({ id: l.id, label: l.name, flags: [] })), typeInstead: false, disabled };
      }
      return {
        mode,
        options: isQuestionStage(s.stage) && s.lift ? questionFor(s.lift, s.stage).options : [],
        typeInstead: true,
        disabled,
      };
    case 'typing':
      return { mode, placeholder: COPY.typePlaceholder, disabled };
    case 'numbers':
      return { mode, unit: s.unit, disabled };
    case 'accessory': {
      const n = loggedCount(s.accessories);
      const atMinimum = n >= MIN_RATIOS;
      const offer = s.offer ?? '';
      return {
        mode,
        exerciseId: offer,
        exerciseName: exerciseName(offer),
        unit: s.unit,
        counter: { text: atMinimum ? COPY.counterAtMin(n) : COPY.counterUnderMin(n), atMinimum },
        canChange: !!s.lift && !!s.offer && changeOffer(s.lift, s.accessories, s.offer) !== null,
        escape: !s.rescoring && canMoveOn(s.accessories) ? 'moveOn' : 'skip',
        disabled,
      };
    }
    case 'video':
      return { mode, disabled };
    case 'generate':
      return { mode, label: COPY.getVerdict, disabled };
    case 'waiting':
      if (s.stage === 'analyzing') {
        return { mode, label: s.video.status === 'uploading' ? COPY.uploadingSet : COPY.measuringSet, canSkip: true };
      }
      return { mode, label: COPY.writingVerdict, canSkip: false };
    case 'done':
      return { mode };
    case 'blocked':
      return { mode, caption: COPY.paused };
  }
}

export function headerView(s: DiagnosticState): { progress: string; typing: boolean } {
  return { progress: progressLabel(s.stage, s.maxProgress), typing: s.pending?.status === 'sending' };
}
