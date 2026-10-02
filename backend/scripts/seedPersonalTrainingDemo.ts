// Demo data for the personal-training dashboard: one practice, the given
// trainers as its coaches, and ten mock clients covering every roster status.
//
//   npx tsx scripts/seedPersonalTrainingDemo.ts              # seed (no-op if already seeded)
//   npx tsx scripts/seedPersonalTrainingDemo.ts --refresh    # remove, then seed again
//   npx tsx scripts/seedPersonalTrainingDemo.ts --remove     # remove everything this script made
//   PT_DEMO_TRAINERS=a@x.com,b@y.com npx tsx scripts/…       # override the trainer accounts
//
// Every date is relative to when the script runs, so the roster ages: after a
// week most demo clients will read "No session logged in N days". Run
// --refresh to reset it.
//
// Safe to run against production:
//  - mock clients use the existing test-account convention
//    (axiom.test.*@example.com), which the program-rescue sweep already skips;
//  - they have no password, no push token and are opted out of every email,
//    so they cannot sign in and nothing is ever sent to them;
//  - they are created with coachOnboardingDone=false so the weekly-review job
//    does not write chat messages for them;
//  - trainer accounts are only given a membership row — nothing else on them
//    is touched, and --remove takes exactly that row away again.

import { PrismaClient } from '@prisma/client';
import { DEFAULT_QUESTIONS, analyse } from '../src/services/personalTraining/checkinAnalysis.js';

const prisma = new PrismaClient();

const PRACTICE = { name: 'Axiom Demo Practice', slug: 'pt-axiom-demo' };
const CLIENT_EMAIL = (key: string) => `axiom.test.pt.${key}@example.com`;
const CLIENT_EMAIL_PREFIX = 'axiom.test.pt.';
const TRAINER_EMAILS = (process.env.PT_DEMO_TRAINERS ?? 'anuptaislam33@gmail.com,inquiries@axiomtraining.io')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const DAY = 86_400_000;
const NOW = Date.now();
/** `d` days ago at roughly `hour` local-ish time. */
const ago = (d: number, hour = 18) => new Date(NOW - d * DAY + (hour - 12) * 3_600_000);
const dateStr = (d: number) => ago(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
/** Every `step` days from `from` days ago down to `to` days ago. */
const every = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((from - to) / step) + 1 }, (_, i) => from - i * step);

function program(startedDaysAgo: number, daysPerWeek: number) {
  const days = Array.from({ length: daysPerWeek }, () => ({}));
  return {
    savedProgram: JSON.stringify({
      daysPerWeek,
      phases: [
        { phaseName: 'Foundation', durationWeeks: 4, trainingDays: days },
        { phaseName: 'Strength', durationWeeks: 4, trainingDays: days },
        { phaseName: 'Peak', durationWeeks: 4, trainingDays: days },
      ],
    }),
    programStartDate: ago(startedDaysAgo),
  };
}

// Loads climb 2.5 kg every third session, so PRs appear now and then rather than every log.
// A client marked `plateau` holds the same loads throughout.
const step = (i: number, flat = false) => (flat ? 0 : Math.floor(i / 3) * 2.5);
const lower = (squatKg: number, i: number, flat = false) => JSON.stringify([
  { name: 'Back squat', sets: 3, reps: '5', weightKg: squatKg + step(i, flat), rpe: 8 },
  { name: 'Deadlift', sets: 2, reps: '5', weightKg: Math.round(squatKg * 1.2) + step(i, flat), rpe: 8 },
  { name: 'Romanian deadlift', sets: 3, reps: '8', weightKg: Math.round(squatKg * 0.8) },
  { name: 'Walking lunge', sets: 3, reps: '12', weightKg: 20 },
  { name: 'Plank', sets: 3, reps: '60s' },
]);
const upper = (benchKg: number, i: number, flat = false) => JSON.stringify([
  { name: 'Bench press', sets: 4, reps: '6', weightKg: benchKg + step(i, flat), rpe: 8 },
  { name: 'Barbell row', sets: 4, reps: '8', weightKg: Math.round(benchKg * 0.8) },
  { name: 'Overhead press', sets: 3, reps: '8', weightKg: Math.round(benchKg * 0.6) },
  { name: 'Pull-up', sets: 3, reps: '8' },
]);

interface DemoClient {
  key: string;
  name: string;
  joinedDaysAgo: number;
  goal?: string;
  program?: { startedDaysAgo: number; daysPerWeek: number };
  injuries?: { area: string; note?: string; resolvedAt?: string }[];
  constraintsText?: string;
  squatKg: number;
  benchKg: number;
  /** Days ago of each logged session. */
  sessions: number[];
  /** Days ago of each nutrition log. */
  nutrition?: number[];
  /** [daysAgo, mood, energy, sleepHours, stress] on 1–5 scales. */
  checkIns?: [number, number, number, number, number][];
  /** [daysAgo, kg] */
  bodyweight?: [number, number][];
  lastSessionNote?: string;
  proposals?: { daysAgo: number; title: string; reasoning: string; status: string; key: string }[];
  /** Thread with each trainer: [daysAgo, from, body]. */
  messages?: [number, 'trainer' | 'client', string][];
  /** Holds the same loads every session, so the plateau rule fires. */
  plateau?: boolean;
  /** A trainer check-in in the inbox: answered `daysAgo`, or missed. */
  trainerCheckIn?:
    | { daysAgo: number; answers: { energy: number; sleep: number; stress: number; pain: string; notes: string }; reply: string }
    | { missedDaysAgo: number; nudged: boolean };
}

const CLIENTS: DemoClient[] = [
  {
    key: 'maya', name: 'Maya Okafor', joinedDaysAgo: 120, goal: 'Squat 100 kg by December',
    program: { startedDaysAgo: 40, daysPerWeek: 4 },
    injuries: [{ area: 'Left knee', note: 'Patellar tendon, flares under deep flexion' }, { area: 'Right shoulder', resolvedAt: '2026-07-10' }],
    squatKg: 80, benchKg: 45, sessions: every(55, 9, 2), nutrition: every(55, 10, 1),
    checkIns: [[26, 4, 4, 7.5, 2], [19, 4, 3, 7, 3], [12, 3, 3, 6.5, 3]],
    bodyweight: [[30, 68.2], [23, 68.0], [16, 67.6], [10, 67.9]],
    lastSessionNote: 'Left knee felt tight on the last set',
    proposals: [
      { daysAgo: 17, key: 'load_change:romanian deadlift', title: 'Add 2.5 kg to Romanian deadlift', reasoning: 'Hit the top of the rep range in two consecutive sessions.', status: 'applied' },
      { daysAgo: 9, key: 'load_change:back squat', title: 'Hold back squat load this week', reasoning: 'RPE climbed from 7 to 9 at the same load across the last two sessions, and she noted knee tightness.', status: 'pending' },
    ],
    messages: [
      [13, 'trainer', 'Great week. Keep the knee warm-up before squats.'],
      [8, 'client', 'Knee has been sore since Tuesday so I skipped legs. Should I rest it or train around it?'],
    ],
  },
  {
    key: 'priya', name: 'Priya Nair', joinedDaysAgo: 90, goal: 'Lose 5 kg, keep strength',
    program: { startedDaysAgo: 30, daysPerWeek: 4 },
    trainerCheckIn: { missedDaysAgo: 5, nudged: true },
    squatKg: 60, benchKg: 35, sessions: [...every(55, 16, 2), 3], nutrition: every(55, 16, 1),
    checkIns: [[34, 4, 4, 7, 2], [20, 3, 3, 7, 3]],
    bodyweight: [[50, 71.4], [36, 70.6], [22, 70.1]],
    messages: [[18, 'trainer', 'Solid block so far. How is the calorie target feeling?'], [17, 'client', 'Manageable. Work is about to get busy though.'], [16, 'trainer', 'Understood. Tell me if we need to drop to three days.']],
  },
  {
    key: 'aisha', name: 'Aisha Khan', joinedDaysAgo: 75, goal: 'General strength',
    constraintsText: 'Lower back', squatKg: 55, benchKg: 32.5, sessions: every(54, 2, 3), nutrition: every(40, 0, 2),
    trainerCheckIn: {
      daysAgo: 1, answers: { energy: 2, sleep: 2, stress: 5, pain: 'Lower back has been aching after deadlifts.', notes: 'Work has been brutal this week.' },
      reply: 'Thanks for being straight with me, Aisha. This reads like a week to pull back, and I do not want you deadlifting through a sore back. Take the loads down and skip the deadlifts until we have talked.',
    },
    checkIns: [[15, 4, 4, 7, 2], [8, 3, 3, 6.5, 3], [1, 2, 2, 5, 5]],
  },
  { key: 'sam', name: 'Sam Whitfield', joinedDaysAgo: 9, squatKg: 50, benchKg: 40, sessions: [] },
  {
    key: 'dami', name: 'Dami Bello', joinedDaysAgo: 5, goal: 'First pull-up',
    program: { startedDaysAgo: 4, daysPerWeek: 3 },
    squatKg: 40, benchKg: 25, sessions: [4, 2, 1], nutrition: [4, 3, 2, 1, 0], checkIns: [[1, 5, 4, 8, 1]],
    messages: [[5, 'trainer', 'Welcome aboard. First session is in your app — log it when you are done.'], [4, 'client', 'Done. Harder than it looked.'], [4, 'trainer', 'That is the right amount of hard. See you Thursday.']],
  },
  {
    key: 'leo', name: 'Leo Martins', joinedDaysAgo: 11, goal: 'Build muscle, 4 days a week',
    program: { startedDaysAgo: 10, daysPerWeek: 4 },
    squatKg: 70, benchKg: 55, sessions: [10, 8, 6, 5, 3, 1], nutrition: every(10, 0, 1), bodyweight: [[10, 78.3], [3, 78.9]],
  },
  {
    key: 'jordan', name: 'Jordan Lee', joinedDaysAgo: 200, goal: 'Half marathon and a 1.5x bodyweight deadlift',
    program: { startedDaysAgo: 60, daysPerWeek: 4 },
    squatKg: 100, benchKg: 70, sessions: every(55, 1, 2), nutrition: every(55, 0, 1),
    checkIns: [[27, 4, 4, 7.5, 2], [13, 4, 4, 7, 2], [6, 5, 4, 8, 2]],
    trainerCheckIn: {
      daysAgo: 2, answers: { energy: 4, sleep: 4, stress: 2, pain: 'None', notes: 'Long run went well on Sunday.' },
      reply: 'Thanks for checking in, Jordan. Solid week, and good to hear the long run went well. Keep doing what you are doing and we will stay on plan.',
    },
    bodyweight: [[42, 74.0], [28, 73.8], [14, 73.9]],
  },
  {
    key: 'tomas', name: 'Tomás Rivera', joinedDaysAgo: 60, goal: 'Bench 120 kg',
    program: { startedDaysAgo: 20, daysPerWeek: 4 },
    squatKg: 110, benchKg: 95, sessions: [...every(55, 30, 4), ...every(28, 0, 2)], nutrition: every(28, 0, 1),
    checkIns: [[9, 4, 4, 7, 2], [2, 4, 4, 7.5, 2]],
    proposals: [{ daysAgo: 6, key: 'load_change:bench press', title: 'Add 2.5 kg to bench press', reasoning: 'Six reps at RPE 7 on all four sets, twice in a row.', status: 'applied' }],
  },
  {
    key: 'hannah', name: 'Hannah Schmidt', joinedDaysAgo: 140, goal: 'Drop to 65 kg for a spring race',
    program: { startedDaysAgo: 45, daysPerWeek: 3 },
    squatKg: 62.5, benchKg: 37.5, sessions: every(54, 1, 2), nutrition: every(55, 0, 1), plateau: true,
    trainerCheckIn: {
      daysAgo: 1, answers: { energy: 3, sleep: 3, stress: 3, pain: 'No', notes: 'Hungry on the lower calories but managing.' },
      reply: 'Thanks for the check-in, Hannah. Hunger on a cut is normal, but tell me if energy drops further. Let us keep this week manageable: hit the main lifts and leave the rest if you are short on energy.',
    },
    checkIns: [[29, 4, 3, 7, 3], [22, 4, 4, 7, 2], [15, 4, 4, 7.5, 2], [8, 4, 4, 7, 2], [1, 5, 4, 8, 2]],
    bodyweight: [[49, 69.1], [42, 68.7], [35, 68.2], [28, 67.9], [21, 67.5], [14, 67.0], [7, 66.6], [1, 66.3]],
  },
  {
    key: 'chidi', name: 'Chidi Eze', joinedDaysAgo: 180, goal: 'Deadlift 200 kg',
    program: { startedDaysAgo: 70, daysPerWeek: 4 },
    injuries: [{ area: 'Left hamstring', note: 'Grade 1 strain', resolvedAt: '2026-08-20' }],
    squatKg: 130, benchKg: 90, sessions: every(55, 0, 2), nutrition: every(50, 0, 2),
    trainerCheckIn: {
      daysAgo: 1, answers: { energy: 5, sleep: 4, stress: 1, pain: 'None, hamstring feels normal.', notes: '' },
      reply: 'Thanks for checking in, Chidi. Great to hear the hamstring feels normal. Same plan next week.',
    },
    checkIns: [[10, 4, 4, 7, 2], [3, 4, 5, 8, 1]],
    messages: [[7, 'client', 'Hamstring felt completely normal on deadlifts today.'], [6, 'trainer', 'Good. We go back to full range pulls next week.']],
  },
];

async function findTrainers() {
  const trainers = await prisma.user.findMany({
    where: { email: { in: TRAINER_EMAILS } },
    select: { id: true, email: true },
  });
  const missing = TRAINER_EMAILS.filter((e) => !trainers.some((t) => t.email?.toLowerCase() === e));
  if (missing.length) console.warn(`  ! no account for ${missing.join(', ')} — skipped`);
  return trainers;
}

async function remove() {
  const clients = await prisma.user.findMany({
    where: { email: { startsWith: CLIENT_EMAIL_PREFIX, endsWith: '@example.com' } },
    select: { id: true },
  });
  const ids = clients.map((c) => c.id);
  const practice = await prisma.institution.findUnique({ where: { slug: PRACTICE.slug }, select: { id: true } });

  await prisma.$transaction(async (tx) => {
    if (ids.length) {
      const byUser = { userId: { in: ids } };
      // Deleting a conversation cascades to its messages.
      await tx.directConversation.deleteMany({ where: { OR: [{ participantAId: { in: ids } }, { participantBId: { in: ids } }] } });
      await tx.workoutLog.deleteMany({ where: byUser });
      await tx.nutritionLog.deleteMany({ where: byUser });
      await tx.wellnessCheckin.deleteMany({ where: byUser });
      await tx.bodyWeightLog.deleteMany({ where: byUser });
      await tx.adaptationProposal.deleteMany({ where: byUser });
      await tx.institutionMember.deleteMany({ where: byUser });
    }
    if (practice) {
      // Everything the dashboard itself stored for this practice.
      const scoped = { where: { practiceId: practice.id } };
      await tx.ptBriefing.deleteMany(scoped); // items cascade
      await tx.ptAnakinThread.deleteMany(scoped); // messages cascade
      await tx.ptCheckIn.deleteMany(scoped);
      await tx.ptCheckInSchedule.deleteMany(scoped);
      await tx.ptDraft.deleteMany(scoped);
      await tx.ptReport.deleteMany(scoped);
      await tx.ptNotification.deleteMany(scoped);
      await tx.ptNotificationSettings.deleteMany(scoped);
      await tx.ptScheduledQuestion.deleteMany(scoped);
      await tx.ptAuditLog.deleteMany(scoped);
      await tx.institutionInvite.deleteMany({ where: { institutionId: practice.id } });
      await tx.institutionMember.deleteMany({ where: { institutionId: practice.id } });
      await tx.institution.delete({ where: { id: practice.id } });
    }
    if (ids.length) await tx.user.deleteMany({ where: { id: { in: ids } } });
  });
  console.log(`  removed ${ids.length} demo client(s)${practice ? ' and the demo practice' : ''}`);
}

async function seed() {
  if (await prisma.institution.findUnique({ where: { slug: PRACTICE.slug } })) {
    console.log('  demo practice already exists — nothing to do (use --refresh to rebuild it)');
    return;
  }
  const trainers = await findTrainers();
  if (trainers.length === 0) throw new Error('No trainer account found; nothing seeded.');

  await prisma.$transaction(async (tx) => {
    const practice = await tx.institution.create({ data: PRACTICE });
    for (const t of trainers) {
      await tx.institutionMember.create({ data: { institutionId: practice.id, userId: t.id, role: 'coach' } });
    }

    for (const c of CLIENTS) {
      const user = await tx.user.create({
        data: {
          name: c.name,
          email: CLIENT_EMAIL(c.key),
          emailVerified: true,
          unitPreference: 'metric',
          // Backdated so seven new accounts do not show up as today's signups.
          createdAt: ago(c.joinedDaysAgo + 30),
          coachGoal: c.goal ?? null,
          constraintsText: c.constraintsText ?? null,
          coachProfile: c.injuries ? JSON.stringify({ injuryList: c.injuries }) : null,
          ...(c.program ? program(c.program.startedDaysAgo, c.program.daysPerWeek) : {}),
          reengagementOptOut: true,
          marketingEmailsOptOut: true,
          welcomeEmailSentAt: new Date(),
        },
      });
      await tx.institutionMember.create({
        data: { institutionId: practice.id, userId: user.id, role: 'athlete', joinedAt: ago(c.joinedDaysAgo) },
      });

      const sessions = [...c.sessions].sort((a, b) => b - a); // oldest first
      if (sessions.length) {
        await tx.workoutLog.createMany({
          data: sessions.map((d, i) => ({
            userId: user.id,
            date: dateStr(d),
            createdAt: ago(d, 18),
            title: i % 2 ? 'Upper' : 'Lower',
            exercises: i % 2 ? upper(c.benchKg, i, c.plateau) : lower(c.squatKg, i, c.plateau),
            duration: 50 + (i % 3) * 5,
            notes: i === sessions.length - 1 ? c.lastSessionNote ?? null : null,
          })),
        });
      }
      if (c.nutrition?.length) {
        await tx.nutritionLog.createMany({
          data: c.nutrition.map((d) => ({ userId: user.id, date: dateStr(d), createdAt: ago(d, 20), proteinG: 140, carbsG: 220, fatG: 70, calories: 2070 })),
        });
      }
      if (c.checkIns?.length) {
        await tx.wellnessCheckin.createMany({
          data: c.checkIns.map(([d, mood, energy, sleepHours, stress]) => ({ userId: user.id, date: dateStr(d), createdAt: ago(d, 8), mood, energy, sleepHours, stress })),
        });
      }
      if (c.bodyweight?.length) {
        await tx.bodyWeightLog.createMany({
          data: c.bodyweight.map(([d, weightKg]) => ({ userId: user.id, date: dateStr(d), createdAt: ago(d, 7), weightKg })),
        });
      }
      for (const p of c.proposals ?? []) {
        await tx.adaptationProposal.create({
          data: {
            userId: user.id, kind: 'load_change', dedupeKey: p.key, title: p.title, reasoning: p.reasoning,
            evidence: '{}', proposal: '{}', status: p.status, createdAt: ago(p.daysAgo, 19),
            decidedAt: p.status === 'applied' ? ago(p.daysAgo, 20) : null,
          },
        });
      }
      // A check-in in the trainer's inbox, analysed by the same code a real submission runs through.
      const k = c.trainerCheckIn;
      if (k && 'daysAgo' in k) {
        const checkIn = await tx.ptCheckIn.create({
          data: { practiceId: practice.id, clientId: user.id, questionsJson: JSON.stringify(DEFAULT_QUESTIONS), dueAt: ago(k.daysAgo + 0.5, 18) },
        });
        const last7 = c.sessions.filter((d) => d >= k.daysAgo && d < k.daysAgo + 7).length;
        const a = analyse(DEFAULT_QUESTIONS, k.answers, { logged: last7, target: c.program?.daysPerWeek ?? 3 }, checkIn.id);
        const draft = await tx.ptDraft.create({
          data: { practiceId: practice.id, trainerId: trainers[0].id, clientId: user.id, kind: 'checkin_reply', sourceId: checkIn.id, text: k.reply },
        });
        await tx.ptCheckIn.update({
          where: { id: checkIn.id },
          data: {
            status: 'submitted', submittedAt: ago(k.daysAgo, 9), classification: a.classification, summary: a.summary,
            signalsJson: JSON.stringify(a.signals), evidenceJson: JSON.stringify(a.evidence), draftId: draft.id,
            answersJson: JSON.stringify(DEFAULT_QUESTIONS.map((q) => ({ question: q.text, answer: String((k.answers as Record<string, string | number>)[q.id] ?? '') }))),
          },
        });
      } else if (k) {
        await tx.ptCheckIn.create({
          data: {
            practiceId: practice.id, clientId: user.id, questionsJson: JSON.stringify(DEFAULT_QUESTIONS), status: 'missed',
            dueAt: ago(k.missedDaysAgo, 18), nudgedAt: k.nudged ? ago(k.missedDaysAgo - 1, 18) : null,
          },
        });
      }

      // The same thread with each trainer, so both demo accounts see it.
      for (const t of c.messages?.length ? trainers : []) {
        const [a, b] = t.id < user.id ? [t.id, user.id] : [user.id, t.id];
        const conversation = await tx.directConversation.create({ data: { participantAId: a, participantBId: b } });
        await tx.message.createMany({
          data: c.messages!.map(([d, from, body], i) => ({
            conversationId: conversation.id,
            senderId: from === 'trainer' ? t.id : user.id,
            body,
            createdAt: new Date(ago(d, 9).getTime() + i * 60_000),
            // Only a client's final, unanswered message is left unread.
            readAt: from === 'client' && i === c.messages!.length - 1 ? null : ago(d, 10),
          })),
        });
      }
    }
    // The practice default schedule exists but is switched OFF: nothing is sent
    // to the mock clients on a timer. Switch it on in Check-ins → Configure to
    // watch the weekly prompt, nudge and missed escalation run.
    await tx.ptCheckInSchedule.create({
      data: { practiceId: practice.id, clientId: null, questionsJson: JSON.stringify(DEFAULT_QUESTIONS), active: false },
    });
    for (const t of trainers) {
      await tx.ptScheduledQuestion.create({ data: { practiceId: practice.id, trainerId: t.id, text: 'Who has not trained in 7 days?', scope: 'all' } });
    }
  }, { timeout: 60_000 });

  console.log(`  seeded "${PRACTICE.name}" with ${CLIENTS.length} demo clients; coaches: ${trainers.map((t) => t.email).join(', ')}`);
}

async function main() {
  const flag = process.argv[2];
  if (flag && !['--remove', '--refresh'].includes(flag)) throw new Error(`Unknown option ${flag}`);
  console.log(`[pt-demo] ${flag ?? 'seed'}`);
  if (flag === '--remove' || flag === '--refresh') await remove();
  if (flag !== '--remove') await seed();
}

main()
  .catch((err) => { console.error('[pt-demo] failed:', err.message ?? err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
