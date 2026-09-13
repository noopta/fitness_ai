import type { QuestionId } from './types';
import { liftFamily } from './lifts';

export interface QuestionOption {
  id: string;
  label: string;
  /** Engine SessionFlags this answer sets. Empty = informative, no flag. */
  flags: string[];
  /** For q0 only: the movement phase this answer points at. */
  phase?: string;
}

export interface Question {
  id: QuestionId;
  text: string;
  options: QuestionOption[];
}

// q0 is always the phase question — the one a successful video answers (§6).
// q1/q2 resolve what numbers can't see. Chip answers map straight onto the
// engine's SessionFlags so no free-text keyword parsing is needed; "Type
// instead" answers still go through the server's text parser.

const PRESS: Question[] = [
  {
    id: 'q0',
    text: 'On a hard rep, where does the bar slow down?',
    options: [
      { id: 'off_chest', label: 'Off the chest', flags: ['hard_off_chest'], phase: 'bottom' },
      { id: 'mid_range', label: 'Mid-way up', flags: ['hard_mid_range'], phase: 'ascent' },
      { id: 'lockout', label: 'Near lockout', flags: ['hard_at_lockout'], phase: 'lockout' },
      { id: 'unsure', label: 'Not sure', flags: [] },
    ],
  },
  {
    id: 'q1',
    text: 'When a set gets heavy, what does the bar do?',
    options: [
      { id: 'drifts', label: 'Drifts toward my face', flags: ['bar_drifts'] },
      { id: 'flare', label: 'Elbows flare early', flags: ['elbows_flare_early'] },
      { id: 'touch', label: 'Touches a different spot', flags: ['touch_point_inconsistent'] },
      { id: 'on_path', label: 'Stays on path', flags: [] },
    ],
  },
  {
    id: 'q2',
    text: 'How do paused reps compare to touch-and-go?',
    options: [
      { id: 'much_harder', label: 'Much harder', flags: ['pause_much_harder'] },
      { id: 'same', label: 'About the same', flags: [] },
      { id: 'shoulder', label: 'My shoulder complains', flags: ['shoulder_discomfort'] },
      { id: 'never', label: 'I never pause', flags: [] },
    ],
  },
];

const DEADLIFT: Question[] = [
  {
    id: 'q0',
    text: 'On a heavy pull, where does it get hard?',
    options: [
      { id: 'floor', label: 'Off the floor', flags: ['hard_off_floor'], phase: 'initial_pull' },
      { id: 'knees', label: 'Around the knees', flags: ['hard_mid_range'], phase: 'knee_level' },
      { id: 'lockout', label: 'At lockout', flags: ['hard_at_lockout'], phase: 'lockout' },
      { id: 'unsure', label: 'Not sure', flags: [] },
    ],
  },
  {
    id: 'q1',
    text: 'What breaks first when it gets heavy?',
    options: [
      { id: 'hips', label: 'Hips shoot up', flags: ['hips_shoot_up'] },
      { id: 'back', label: 'Back rounds', flags: ['back_rounds'] },
      { id: 'drift', label: 'Bar drifts forward', flags: ['bar_drifts_forward'] },
      { id: 'grip', label: 'My grip', flags: ['grip_limiting'] },
    ],
  },
  {
    id: 'q2',
    text: 'Where do you feel it the next day?',
    options: [
      { id: 'low_back', label: 'Lower back', flags: ['feel_lower_back'] },
      { id: 'hams', label: 'Hamstrings and glutes', flags: [] },
      { id: 'upper', label: 'Upper back and traps', flags: [] },
      { id: 'nowhere', label: 'Nowhere in particular', flags: [] },
    ],
  },
];

const SQUAT: Question[] = [
  {
    id: 'q0',
    text: 'On a heavy squat, where does it get hard?',
    options: [
      { id: 'hole', label: 'Out of the hole', flags: ['hard_off_floor'], phase: 'bottom' },
      { id: 'mid', label: 'Halfway up', flags: ['hard_mid_range'], phase: 'ascent' },
      { id: 'unsure', label: 'Not sure', flags: [] },
    ],
  },
  {
    id: 'q1',
    text: 'What happens to your position when it gets heavy?',
    options: [
      { id: 'hips', label: 'Hips shoot up', flags: ['hips_shoot_up'] },
      { id: 'chest', label: 'Chest drops', flags: ['chest_drops'] },
      { id: 'elbows', label: 'Elbows drop', flags: ['elbows_drop'] },
      { id: 'none', label: 'Nothing obvious', flags: [] },
    ],
  },
  {
    id: 'q2',
    text: 'Can you hit depth comfortably?',
    options: [
      { id: 'tight', label: 'Hips or ankles feel tight', flags: ['mobility_restriction'] },
      { id: 'fine', label: 'Depth is fine', flags: [] },
      { id: 'unsure', label: 'Not sure', flags: [] },
    ],
  },
];

export function questionsFor(lift: string): Question[] {
  switch (liftFamily(lift)) {
    case 'press':
      return PRESS;
    case 'deadlift':
      return DEADLIFT;
    default:
      // Front squats don't have hips shooting; back squats rarely drop elbows.
      return SQUAT.map((q) =>
        q.id !== 'q1'
          ? q
          : {
              ...q,
              options: q.options.filter((o) =>
                lift === 'barbell_front_squat' ? o.id !== 'hips' : o.id !== 'elbows',
              ),
            },
      );
  }
}

export function questionFor(lift: string, id: QuestionId): Question {
  return questionsFor(lift).find((q) => q.id === id)!;
}

/** The q0 option matching a phase the video measured, if any. */
export function phaseOption(lift: string, phase: string | null): QuestionOption | null {
  if (!phase) return null;
  return questionFor(lift, 'q0').options.find((o) => o.phase === phase) ?? null;
}
