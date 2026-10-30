// A session the user reported that nothing logged (Oct 2026).
//
// Saeed, 29 Oct 04:30: "I finished tonight off with Muay Thai. Did 3 min 5
// rounds bag work…" — Anakin replied "Logged — Muay Thai conditioning…" and
// called no tool. He sent it again; Anakin read his log, saw only the heavy
// lift, and said it was "already saved". It went in at the third ask.
//
// Food already had this check (needsIntakeLog). This is the same for any
// activity, by the shape of the sentence rather than a list of sports: they
// say they did it (a completed action) and how much (minutes, rounds, sets,
// reps, distance…), and it isn't a question or a plan. "Shot hoops for 45
// mins", "rolled 3 rounds of 8", "walked the dog an hour" all qualify. Pure.

/** A completed action in their words. */
const DONE = /\b(did|done|went|played|shot|ran|jogged|sprinted|walked|hiked|biked|cycled|rode|swam|rowed|lifted|trained|sparred|rolled|drilled|practi[cs]ed|hit|finished|ended|wrapped up|knocked out|got (in|through)|completed|worked (on|out)|boxed|climbed|bouldered|skated|surfed|skied|snowboarded|danced|stretched|kicked|threw|pressed|squatted|benched|deadlifted|pulled|curled|skipped|jumped|paddled|golfed|bowled|wrestled|grappled|fought|competed|raced|spun|ellipticaled)\b|\b(first|second|third|last|morning|evening|afternoon|night|today'?s|tonight'?s) (session|workout|lift|training|run|ride|swim|class|practice)\b|\b(session|workout|training|practice|class|game|match) (today|tonight|this morning|this evening|was|went)\b/i;

/** How much: a duration, a count of rounds/sets/reps, a distance. */
const MEASURE = /\b\d+(\.\d+)?\s*(x|×)\s*\d+\b|\b(\d+(\.\d+)?|an?|half an?|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|ninety)\s*-?\s*(sets?|reps?|rounds?|laps?|lengths?|mins?|minutes?|hrs?|hours?|secs?|seconds?|km|k|kms|kilometers?|kilometres?|mi|miles?|yards?|yds|meters?|metres?|m|games?|holes?|innings|kicks?|punches|shots?|throws?|pitches|push-?ups?|pull-?ups?|sit-?ups?|burpees|lbs?|pounds|kg|kgs|kilos?|inch|inches|in|cal|calories|floors|sprints?)\b/i;

/** Not a report: a question, a plan, a wish, a habit, someone else. */
const NOT_REPORT = /\?|\b(will|i'?ll|going to|gonna|plan(ning)? (to|on)|tomorrow|later today|next (week|time|session)|should i|can i|could i|would it|want to|wanna|thinking (of|about)|need to|have to|used to|usually|every (day|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|program|routine|my (friend|brother|sister|partner|wife|husband|coach|dad|mom)|how (many|much|long|do)|what (should|did|do)|if i|in the past|years? ago|last (year|month)|my best|my pr|personal best|max is)\b/i;

/**
 * The app's own messages after a guided session ("I just finished Legs: 10 of
 * 13 sets, 1 min, top set Squat 320 × 3. What changes for next time?") — the
 * app saved that session already. Instructions ("Swap today's upper for 3
 * sets…") aren't reports either.
 */
const APP_SUMMARY = /\b\d+ of \d+ sets\b/i;
const INSTRUCTION = /^\s*(please\s+)?(swap|replace|switch|make|add|remove|drop|give me|build|create|schedule|move|set|adjust|plan|show|tell|change)\b/i;
/** "Log push day done today at 65 mins": asking for a log is a report too. */
const LOG_ASK = /^\s*(please\s+|can you\s+|could you\s+)?(log|add|record|track)\b[^?]{0,80}\b(workout|session|day|run|ride|swim|class|lift|training|game|match|practice|min|mins|minutes|hours?|hrs?|sets?|reps?)\b/i;

/** Corrections to something already logged go to update_workout, not a new log. */
export const CORRECTION = /\b(actually|instead of|not \d|should (be|have been)|change|fix|correct|wrong|meant|typo|edit|update)\b/i;

/** Pure: the sentences in the message that report a session they did. */
export function activitySentences(message: string): string[] {
  const text = String(message ?? '').replace(/<app_note>[\s\S]*?<\/app_note>/g, ' ').replace(/^\s*\(sent [^)]*\)\s*/i, '');
  if (APP_SUMMARY.test(text)) return [];
  const parts = text.split(/(?<=[.!?\n])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const hits: string[] = parts.filter((s) => LOG_ASK.test(s) && !/\b(meal|food|breakfast|lunch|dinner|snack|calories|protein|weight|sleep|water|steps)\b/i.test(s));
  // A cue and a measure can sit in neighbouring sentences ("Finished with Muay Thai. Did 5 rounds…").
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (NOT_REPORT.test(s) || INSTRUCTION.test(s) || hits.includes(s)) continue;
    const window = [parts[i - 1], s, parts[i + 1]].filter((x) => x && !NOT_REPORT.test(x)).join(' ');
    if (DONE.test(s) && MEASURE.test(window)) hits.push(s);
    else if (MEASURE.test(s) && /\b\d+\s*(sets?|x|×)\s*(of\s*)?\d+/i.test(s) && DONE.test(window)) hits.push(s);
  }
  // A bare list of lifts ("Back squat 3 sets 3 reps 135lbs… Barbell row 4 sets 6 reps…") is a log with no verb.
  if (!hits.length) {
    const lines = parts.filter((x) => !NOT_REPORT.test(x) && !INSTRUCTION.test(x));
    const sets = lines.join(' ').match(/\b\d+\s*(sets?|reps?)\b|\b\d+\s*[x×]\s*\d+\b/gi) ?? [];
    if (sets.length >= 2 && lines.length && !NOT_REPORT.test(text)) hits.push(lines[0]);
  }
  return hits;
}

/** Pure: did they report a session they did? */
export function reportsActivity(message: string): boolean {
  return activitySentences(message).length > 0;
}

/** Workout tools that put a session in their log (or fix one that's there). */
export const WORKOUT_LOG_TOOLS = ['log_workout', 'log_conditioning', 'log_past_workouts', 'log_set', 'update_workout', 'delete_workout'];

/** Pure: a reported session and no workout tool even tried this turn (a preview or a question back counts as handling it). */
export function needsActivityLog(message: string, toolsUsed: string[]): boolean {
  if (toolsUsed.some((t) => WORKOUT_LOG_TOOLS.includes(t))) return false;
  return reportsActivity(message);
}

export interface LoggedSession { title: string | null; date: string; loggedAt: string }

/** The nudge, with what's really in their log for the day (from the database, not the model's memory). */
export function activityLogNudge(dayLabel: string, sessions: LoggedSession[]): string {
  const list = sessions.length
    ? sessions.map((s) => `- ${s.title ?? 'Workout'} (logged ${s.loggedAt})`).join('\n')
    : '- nothing yet';
  return `(Server check: the user reported a session they did, and no workout tool saved anything this turn — your reply above was not shown. Their log for ${dayLabel}, from the database:\n${list}\nIf this session is in that list, say so by its title. If it's a correction to one there, call update_workout. Otherwise log it now — log_conditioning for sport or time-based work (estimate the minutes from the rounds if they didn't give a total), log_workout for sets and reps — then write your reply. If you can't log it without an answer from them (a missing number), ask that one short question instead. Never say it's logged unless a tool saved it this turn.)`;
}
