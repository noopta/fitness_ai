// Every user-facing string in the diagnostic, in one place (§9 "Share one
// core"). Anakin's lines use a tiny markup — *emphasis* and **strong** — that
// both apps render through parseRich().

import { exerciseName } from './lifts';

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
export const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

export const COPY = {
  anakin: 'Anakin',
  statusOnline: 'Diagnosing',
  statusTyping: 'typing…',
  progressDone: 'Done',

  // Opening + lift
  intro: "I'm Anakin. Give me a few numbers and a couple of answers, and I'll tell you what's actually holding your lift back.",
  askLift: 'Which lift are we diagnosing?',

  // Numbers
  askNumbers: (liftName: string) =>
    `**${liftName}.** What's a recent working set? Weight, sets and reps from your last heavy session.`,
  weightLabel: (unit: string) => `Weight (${unit})`,
  setsLabel: 'Sets',
  repsLabel: 'Reps',

  // Accessories (§5)
  firstAccessory: (id: string) =>
    `Now the lifts that explain it — I need at least two. Start with **${exerciseName(id)}**?`,
  afterLogged: (id: string) => `Good. And *${exerciseName(id)}*?`,
  afterUntrained: (id: string, volume: string) =>
    `That's signal, not a blank — a gap in your ${volume}. What about *${exerciseName(id)}*?`,
  pushBack: (id: string) => `I need two ratios minimum, so let's try *${exerciseName(id)}*.`,
  afterSkipAgain: (id: string) => `Okay. *${exerciseName(id)}*?`,
  afterChange: (id: string) => `Sure. *${exerciseName(id)}*?`,
  offerThird: (id: string) =>
    `Two is enough to score you — a third sharpens it. **${exerciseName(id)}**, or move on?`,
  counterUnderMin: (n: number) => `${n} of 2 minimum`,
  counterAtMin: (n: number) => `${n} logged · 3 sharpens it`,
  dontTrain: "I don't train it",
  skip: 'Skip',
  change: 'Change',
  moveOn: 'Move on',

  // Video (§6)
  threeLogged: "Three ratios — that's a clear picture.",
  askVideo:
    "Last thing, and it's optional: one working rep on video, filmed side-on. I'll measure where it stalls. 60 seconds max.",
  askVideoThin: 'Thin on ratios, so the video matters more than usual here. One rep, side-on?',
  attachSet: 'Attach a set',
  attachedSet: (durationSec: number | null) =>
    durationSec ? `Attached a set · 0:${String(Math.round(durationSec)).padStart(2, '0')}` : 'Attached a set',
  trackingBar: 'Tracking the bar…',
  videoCardTitle: 'From your video',
  stickingPoint: 'Sticking point',
  elbowFlare: 'Elbow flare',
  barDrift: 'Bar drift',
  phaseSettled: 'The phase is settled — so two questions instead of three.',
  videoFailed: "I couldn't get a clean read on that clip, so I'll ask instead. Three quick questions.",
  videoSkipped: 'No problem. Three quick questions.',

  // Interview
  typeInstead: 'Type instead',
  backToQuick: 'Back to quick answers',
  typePlaceholder: 'Type your answer',
  ready: "That's everything I need.",
  getVerdict: 'Get my verdict',
  writingVerdict: 'Writing your verdict…',

  // Verdict
  verdictLine: ['Without a ratio I won\'t name it. Here\'s the closest read, and the test that settles it.',
    'One ratio gets you a lean, not a verdict. The report shows what would confirm it.',
    "Here's what's holding it back."] as const,
  openReport: 'Open full report',
  done: 'Done',
  confidence: (n: number) => `${n}% confidence`,

  // Re-scoring (§7)
  addMissingNumbers: 'Add the missing numbers',
  resumeNumbers: (id: string) => `Go on — **${exerciseName(id)}**?`,
  rescoring: (ratios: number) =>
    `${countWord(ratios)} ${ratios === 1 ? 'ratio' : 'ratios'} now — re-scoring on what you've already told me.`,
  keepVerdict: 'Keeping your verdict as it was.',

  // Failure + limits (§8)
  didntSend: "Didn't send",
  retry: 'Retry',
  limitTitle: 'Daily limit reached',
  limitBody: 'One diagnosis a day · your answers are saved',
  goUnlimited: 'Go unlimited',
  later: 'Later',
  paused: 'Thread paused · your answers are saved',
  unblocked: "You're clear. Ready when you are.",

  // Report
  reportVerdict: 'Verdict',
  reportClosestRead: 'Closest read',
  evidence: 'Evidence',
  candidates: 'Candidates',
  primary: 'Primary',
  secondary: 'Secondary',
  ruledOut: 'Ruled out',
  leading: 'Leading',
  open: 'Open',
  strengthProfile: 'Strength profile',
  efficiency: 'Efficiency',
  notEnoughLifts: 'Not enough lifts logged to chart your profile. Two ratios unlock the radar and efficiency score.',
  validationTest: 'Validation test',
  sharpenThis: 'What would sharpen this',
  sharpenLog: (id: string) => `Log your ${exerciseName(id)}`,
  sharpenVideo: 'Film one working rep, side-on',
  fixTitle: 'Your fix',
  fixLockedTitle: 'Your fix is ready',
  fixLockedBody: (n: number) =>
    `A protocol built around this weak link — ${n > 0 ? `${n} accessories` : 'accessories'} chosen for you, with sets, loads and progression rules.`,
  confirmLockedTitle: 'Confirm it first',
  confirmLockedBody: 'Unlock the confirmation test protocol and the program that adapts once the limiter is named.',
  startFreeMonth: 'Start your free month',
  freeMonthFine: 'First month free · cancel anytime',
  trackNextTime: 'Track next time',
  share: 'Share',
  linkCopied: 'Link copied',
  close: 'Close',
  progression: 'Progression',

  // Paywall
  paywallTitle: 'Go unlimited',
  paywallPromise: 'Unlimited diagnoses, the protocol that fixes each one, and a coach that keeps adjusting.',
  payWithApple: 'Pay with Apple Pay',
  payByCard: 'Pay by card',
  restore: 'Restore purchase',
  terms: 'Terms',
  privacy: 'Privacy',

  // Home
  greeting: (name: string | null | undefined, hour: number) => {
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${name.split(' ')[0]}` : part;
  },
  heroStartTitle: "Find what's holding your lift back",
  heroStartBody: 'A two-minute conversation with Anakin. Numbers in, verdict out.',
  heroStartCta: 'Start a diagnostic',
  heroResumeTitle: (liftShort: string) => `Finish your *${liftShort}* diagnostic`,
  heroResumeBody: 'Your answers are saved. Pick up where you left off.',
  heroResume: 'Resume',
  diagnostics: 'Diagnostics',
  inProgress: 'In progress',
  noDiagnostics: 'No diagnostics yet.',
  upgradeTitle: 'Unlock the fix',
  upgradeBody: 'The diagnosis is free. Pro adds the protocol that fixes it and a coach that adapts it.',
} as const;
