// Log truth (Oct 2026): a log goes on the day the user named, and a reply
// never says "logged" unless a tool saved it. Built from Saeed's 27–29 Oct
// messages (the Muay Thai that never saved; the lift and BJJ logged on
// Monday) plus other sports and phrasings, so the rules hold for any activity.

import { describe, it, expect } from 'vitest';
import { dayPhrases, chooseLogDate, weekdayIndex, dayNote, shortDayLabel, shift } from '../agent/dayWords.js';
import { activitySentences, reportsActivity, needsActivityLog, activityLogNudge } from '../agent/activityReport.js';
import { logClaim, claimsLogWithoutSave, dropLogClaims } from '../agent/actionClaims.js';
import { sentStamp, modelHistory } from '../agent/conversation.js';
import { evaluate, recordLogTruth, resetOpsWatchForTests } from '../services/opsWatch.js';

const TUE = '2026-10-27'; // Saeed's Tuesday (America/Regina)

const pick = (text: string, o: Partial<Parameters<typeof chooseLogDate>[0]> = {}) => chooseLogDate({ text, today: TUE, localHour: 14, ...o });

describe('dayWords — the day a log goes on, from their words', () => {
  it("Saeed's three Tuesday messages land where he meant (the model asked for Monday each time)", () => {
    expect(pick('Yesterday I also after the gym did Maui Thai for 2 hours.', { modelDate: '2026-10-26' })).toMatchObject({ date: '2026-10-26', basis: 'said', said: 'yesterday' });
    expect(pick('First session of the day  Back squat: 4 sets of 4 reps 115lbs 135lbs 205lbs 205lbs', { modelDate: '2026-10-26' })).toMatchObject({ date: TUE, basis: 'overruled', modelDate: '2026-10-26' });
    expect(pick('Ended the night with BJJ drilled for 15 mins then did 3 rounds of 8 mins of rolling live', { modelDate: '2026-10-26', localHour: 23 })).toMatchObject({ date: TUE, basis: 'overruled' });
  });

  it('no day named → today, whatever the model passed', () => {
    expect(pick('shot hoops for 45 mins')).toEqual({ date: TUE, basis: 'today' });
    expect(pick('shot hoops for 45 mins', { modelDate: TUE })).toEqual({ date: TUE, basis: 'today' });
    expect(pick('shot hoops for 45 mins', { modelDate: '2026-10-20' })).toMatchObject({ date: TUE, basis: 'overruled' });
  });

  it.each([
    ['yesterday', '2026-10-26'], ['last night', '2026-10-26'], ['day before yesterday', '2026-10-25'],
    ['3 days ago', '2026-10-24'], ['two days ago', '2026-10-25'], ['a couple days ago', '2026-10-25'],
    ['on Monday', '2026-10-26'], ['Sunday', '2026-10-25'], ['last Tuesday', '2026-10-20'], ['tuesday', TUE],
    ['tueasay', TUE], ['thurs', '2026-10-22'], ['wensday', '2026-10-21'],
    ['the 26th', '2026-10-26'], ['Oct 26', '2026-10-26'], ['26 October', '2026-10-26'], ['10/26', '2026-10-26'], ['2026-10-25', '2026-10-25'],
    ['this morning', TUE], ['tonight', TUE], ['earlier today', TUE],
  ])('"%s" → %s', (words, date) => {
    expect(pick(`${words} I ran 5 km`)).toMatchObject({ date });
  });

  it('after midnight, "tonight" and "the night" are the evening that just ended', () => {
    expect(chooseLogDate({ text: 'I finished tonight off with Muay Thai', today: '2026-10-29', localHour: 1 })).toMatchObject({ date: '2026-10-28' });
    expect(chooseLogDate({ text: 'Ended the night with BJJ', today: '2026-10-29', localHour: 2 })).toMatchObject({ date: '2026-10-28' });
    expect(chooseLogDate({ text: 'I finished tonight off with Muay Thai', today: '2026-10-28', localHour: 22 })).toMatchObject({ date: '2026-10-28' });
  });

  it('a day compared to is not the day it happened ("same as yesterday", "heavier than Monday")', () => {
    expect(pick('Squat 225 for 3, heavier than Monday')).toEqual({ date: TUE, basis: 'today' });
    expect(pick('same workout as yesterday, 45 mins')).toEqual({ date: TUE, basis: 'today' });
    expect(pick('first time running since Sunday, 5k')).toEqual({ date: TUE, basis: 'today' });
  });

  it('words that end in "day" but are not weekdays never resolve', () => {
    for (const w of ['today', 'birthday', 'holiday', 'someday', 'everyday', 'anyway', 'midway', 'replay', 'essay', 'payday', 'leg day']) expect(weekdayIndex(w)).toBeNull();
    expect(dayPhrases('leg day was brutal, did it anyway', TUE)).toEqual([]);
    expect(dayPhrases('I did 5/3/1 squats', TUE)).toEqual([]);
  });

  it('a split message carries the day; an older one does not', () => {
    // Within a few minutes (logDate passes recentUserText only then).
    expect(pick('then 20 min on the bike', { recentUserText: 'Yesterday I lifted legs', modelDate: '2026-10-26' })).toMatchObject({ date: '2026-10-26', basis: 'context' });
    // Hours later the caller passes nothing: today.
    expect(pick('then 20 min on the bike', { modelDate: '2026-10-26' })).toMatchObject({ date: TUE, basis: 'overruled' });
  });

  it("Anakin's question about a day carries; a statement mentioning one doesn't (logDate passes only the question)", () => {
    expect(pick('squat 3x5 at 225', { askedText: 'Nice — what did you do on Monday?', modelDate: '2026-10-26' })).toMatchObject({ date: '2026-10-26', basis: 'context' });
  });

  it('"that day" is the day of their last log; vague days keep a recent model date or ask', () => {
    expect(pick('that day I also benched 3x5', { lastLogDate: '2026-10-25', modelDate: '2026-10-25' })).toMatchObject({ date: '2026-10-25', basis: 'said' });
    expect(pick('the other day I swam 2 km', { modelDate: '2026-10-24' })).toMatchObject({ date: '2026-10-24', basis: 'picked' });
    // No usable date → today, said so (nobody is made to specify; the card can move it).
    expect(pick('the other day I swam 2 km', { modelDate: '2026-09-01' })).toMatchObject({ basis: 'assumed', said: 'the other day' });
    expect(pick('the other day I swam 2 km')).toMatchObject({ basis: 'assumed', said: 'the other day' });
    expect(pick('that day I also benched')).toMatchObject({ basis: 'assumed' });
  });

  it('two days named: the model must pick one of them', () => {
    expect(pick('Monday I lifted and Sunday I ran 5k', { modelDate: '2026-10-25' })).toMatchObject({ date: '2026-10-25', basis: 'said' });
    expect(pick('Monday I lifted and Sunday I ran 5k', { modelDate: TUE })).toMatchObject({ basis: 'assumed', date: '2026-10-26', said: 'monday' }); // two days, no matching model date → the latest, said so
  });

  it('never a future day', () => {
    expect(pick('next monday I will run 5k')).toHaveProperty('ask');
    expect(pick('Oct 30 I ran 5k')).toHaveProperty('ask'); // this year's is in 3 days; last year's is too far back to be meant
  });

  it('the tool result tells the reply which day it went on', () => {
    expect(dayNote({ date: TUE, basis: 'overruled', modelDate: '2026-10-26' }, TUE)).toContain('today (Tue 27 Oct), not Mon 26 Oct');
    expect(dayNote({ date: '2026-10-26', basis: 'said', said: 'yesterday' }, TUE)).toBe('Logged on Mon 26 Oct.');
    expect(shortDayLabel('2026-10-26')).toBe('Mon 26 Oct');
    expect(shift('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('activityReport — a session they did, by sentence shape', () => {
  it.each([
    'I finished tonight off with Maui thai. Did 3 min 5 rounds bag work with 10 pushups every round then did 30 kicks left and right x3 so 90 kicks total.',
    'Ended the night with BJJ drilled for 15 mins then did 3 rounds of 8 mins of rolling live',
    'First session of the day  Back squat: 4 sets of 4 reps 115lbs 135lbs 205lbs 205lbs  Barbell rows: 4 sets of 6 reps',
    'Okay now for Wednesday so far I’ve one this. Back squat 3 sets 3 reps 135lbs 205lbs 225lbs Barbell row 4 sets 6 reps 105lbs 125lbs',
    'Shot a basketball for 45 mins',
    'played pickup soccer for 90 minutes',
    'walked the dog for an hour',
    'did yoga for 30 min this morning',
    'Swam 2 km this morning',
    'rode the peloton 20 minutes then stretched',
    'Went bouldering for 2 hours',
    'hit 18 holes of golf',
    'Log push day done today at 65 mins',
    'I did 5 sets of bicep curls for 8 reps at 70 lbs',
  ])('reports: %s', (m) => {
    expect(reportsActivity(m)).toBe(true);
  });

  it.each([
    'How many sets should I do for squats?',
    "I'm going to run 5k tomorrow",
    'I used to swim 2 km every day',
    'Can you build me a program with 4 sets of 8',
    'had 200g greek yogurt',
    'First session of the day was a lift.',
    'my PR is 225 for 3',
    'Swap today’s upper for 3 sets 6-10 reps for dips and pull ups everything else can be 2 sets',
    'I just finished Legs: 10 of 13 sets, 1 min, top set Squat 320 × 3. What changes for next time?',
    'What did I lift on Monday?',
    'my friend ran 10k yesterday',
    'Log my lunch, chicken and rice',
  ])('not a report: %s', (m) => {
    expect(reportsActivity(m)).toBe(false);
  });

  it('a workout tool tried this turn (even a preview or an error) means it was handled', () => {
    const m = 'Shot a basketball for 45 mins';
    expect(needsActivityLog(m, [])).toBe(true);
    expect(needsActivityLog(m, ['read_recent_workouts'])).toBe(true); // Saeed 04:33: read, then "already saved"
    expect(needsActivityLog(m, ['log_conditioning'])).toBe(false);
    expect(needsActivityLog(m, ['log_past_workouts'])).toBe(false);
    expect(needsActivityLog(m, ['update_workout'])).toBe(false);
  });

  it('app notes and the sent stamp never count as the report', () => {
    expect(activitySentences('<app_note>\nLogged · Run · 5 km · 30 min\n</app_note>\n\nthanks!')).toEqual([]);
  });

  it('the nudge lists the day from the database, with when each was logged', () => {
    const n = activityLogNudge('Wed 28 Oct', [{ title: 'Heavy lift', date: '2026-10-28', loggedAt: 'Wed 28 Oct, 3:17 pm' }]);
    expect(n).toContain('- Heavy lift (logged Wed 28 Oct, 3:17 pm)');
    expect(n).toContain('Never say it');
    expect(n).not.toMatch(/reply with nothing/);
    expect(activityLogNudge('Tue 27 Oct', [])).toContain('- nothing yet');
  });
});

describe('actionClaims — "logged" needs a save behind it', () => {
  it.each([
    ['Logged — Muay Thai conditioning tonight, about 45 minutes: bag rounds with pushups.', 'action'],
    ['Got it — I’ve logged your squat session.', 'action'],
    ['It’s in the books.', 'action'],
    ['Saved as your Saturday template — handstands, HSPU.', 'action'],
    ['Logged yesterday’s sleep at 7 hours.', 'action'],
    ['Added it to your log for today.', 'action'],
    ['That Muay Thai session is already on your log for tonight.', 'status'],
    ['No need to log it again, it’s already saved alongside today’s heavy lift.', 'status'],
    ['Once it’s logged, your streak updates.', null],
    ['You logged 3 sessions this week.', null],
    ['The BJJ session isn’t showing up — it may not have saved.', null],
    ['Want me to log it?', null],
    ['Here’s what’s logged for Monday: legs.', null],
    ['Added sugar’s still high at about 81 g.', null],
    ['I put a card up that drops the Dead Bug core work.', null],
    ['Nice work — that’s a PR.', null],
    ['I don’t have a tool for that — that card only shows up in the same turn a workout is logged.', null],
  ])('%s → %s', (reply, kind) => {
    expect(logClaim(reply)).toBe(kind);
  });

  it('an action claim needs a save this turn; a status claim needs at least a look', () => {
    const r = 'Logged — Muay Thai conditioning, 45 minutes.';
    expect(claimsLogWithoutSave(r, [], [])).toBe('action');
    expect(claimsLogWithoutSave(r, [], ['read_recent_workouts'])).toBe('action');
    expect(claimsLogWithoutSave(r, ['log_conditioning'], ['log_conditioning'])).toBeNull();
    const s = 'That session is already on your log.';
    expect(claimsLogWithoutSave(s, [], [])).toBe('status');
    expect(claimsLogWithoutSave(s, [], ['read_recent_workouts'])).toBeNull();
  });

  it('an unbacked claim is replaced, the rest of the reply kept', () => {
    const out = dropLogClaims('Logged — Muay Thai conditioning tonight, about 45 minutes. Watch your recovery closely.');
    expect(out).toBe('Watch your recovery closely. I haven’t saved that yet — say the word and I’ll log it.');
    expect(logClaim(out)).toBeNull();
  });
});

describe('history timestamps', () => {
  it('each past user message starts with when it was sent, in their time', () => {
    expect(sentStamp('2026-10-27T20:43:30.976Z', 'America/Regina')).toBe('(sent Tue 27 Oct, 2:43 pm)');
    expect(sentStamp('2026-10-28T05:36:43.778Z', 'America/Regina')).toBe('(sent Tue 27 Oct, 11:36 pm)');
    expect(sentStamp(undefined, 'America/Regina')).toBe('');
    expect(sentStamp('2026-10-27T20:43:30Z', 'Not/AZone')).toMatch(/^\(sent Tue 27 Oct, 4:43 pm\)$/);
  });

  it('modelHistory stamps user messages when given a timezone, and only then', () => {
    const stored = [
      { role: 'user' as const, text: 'Yesterday I also did Muay Thai for 2 hours', at: '2026-10-27T17:28:30Z' },
      { role: 'assistant' as const, text: 'Logged — 2 hours of Muay Thai yesterday.', at: '2026-10-27T17:28:30Z' },
      { role: 'user' as const, text: 'First session of the day Back squat 4x4', at: '2026-10-27T20:43:30Z' },
      { role: 'assistant' as const, text: 'Nice.', at: '2026-10-27T20:43:30Z' },
    ];
    const { history } = modelHistory(stored, 'America/Regina');
    expect(history[0].content).toBe('(sent Tue 27 Oct, 11:28 am)\nYesterday I also did Muay Thai for 2 hours');
    expect(history[2].content).toBe('(sent Tue 27 Oct, 2:43 pm)\nFirst session of the day Back squat 4x4');
    expect(history[1].content).toBe('Logged — 2 hours of Muay Thai yesterday.');
    expect(modelHistory(stored).history[0].content).toBe('Yesterday I also did Muay Thai for 2 hours');
  });
});

describe('ops watch — log truth', () => {
  it('one false claim that reached the rewrite alerts; nudges and overrules only in bulk', () => {
    resetOpsWatchForTests();
    const now = Date.now();
    recordLogTruth('claim_nudged', now);
    recordLogTruth('date_overruled', now);
    expect(evaluate(now).filter((a) => a.key.startsWith('log_truth'))).toEqual([]);
    recordLogTruth('claim_rewritten', now);
    expect(evaluate(now).map((a) => a.key)).toContain('log_truth:claim_rewritten');
    for (let i = 0; i < 3; i++) recordLogTruth('date_overruled', now);
    expect(evaluate(now).map((a) => a.key)).toContain('log_truth:date_overruled');
    resetOpsWatchForTests();
  });
});
