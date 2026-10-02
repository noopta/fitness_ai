// End-to-end over a real (temporary) SQLite database and the real routes.
//
// The property that matters most (handoff §2.1, §13): nothing reaches a
// client without an explicit trainer action, and every such action is in the
// audit log. The checks at the bottom assert that for every Message the
// feature created during the run, not just for the happy path.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const dir = mkdtempSync(join(tmpdir(), 'pt-flow-'));
process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_at_least_32_chars_long!!';
process.env.PERSONAL_TRAINING_USERS = 'kofi@example.com,other@example.com';
process.env.PERSONAL_TRAINING_UNDO_SECONDS = '5';
process.env.FRONTEND_URL = 'https://axiomtraining.io';

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const dateStr = (d: number) => ago(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const squat = (kg: number) => JSON.stringify([{ name: 'Back squat', sets: 3, reps: '5', weightKg: kg }]);
const token = (id: string, email: string) => `Bearer ${jwt.sign({ id, email, tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`;
const events = (text: string) => text.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)));

let app: express.Express;
let prisma: any;
let deliverDueDrafts: (now?: Date) => Promise<number>;
let runSweeps: (now?: Date) => Promise<void>;
const id = { trainer: '', other: '', practice: '', maya: '', jordan: '', sam: '' };
const as = { trainer: '', other: '', maya: '', jordan: '' };
const api = '/api/personal-training';

beforeAll(async () => {
  execSync('./node_modules/.bin/prisma db push --skip-generate --schema prisma/schema.prisma', { env: process.env, stdio: 'ignore' });
  prisma = (await import('../services/personalTraining/db.js')).prisma;
  ({ deliverDueDrafts } = await import('../services/personalTraining/drafts.js'));
  ({ runSweeps } = await import('../services/personalTraining/jobs.js'));
  const { default: routes } = await import('../routes/personalTraining.js');
  app = express();
  app.use(express.json());
  // The suite speaks as an up-to-date client; the "older app" case overrides this header.
  app.use((req, _res, next) => { req.headers['x-pt-caps'] ??= 'not-joined'; next(); });
  app.use(api, routes);

  const user = (name: string, email: string, extra: object = {}) => prisma.user.create({ data: { name, email, emailVerified: true, unitPreference: 'metric', ...extra } });
  const trainer = await user('Kofi Mensah', 'kofi@example.com');
  const other = await user('Other Trainer', 'other@example.com');
  const maya = await user('Maya Okafor', 'maya@example.com', { coachProfile: JSON.stringify({ injuryList: [{ area: 'Left knee' }] }) });
  const jordan = await user('Jordan Lee', 'jordan@example.com');
  const sam = await user('Sam Whitfield', 'sam@example.com');
  const practice = await prisma.institution.create({ data: { name: 'Kofi Coaching', slug: 'pt-kofi', members: { create: { userId: trainer.id, role: 'coach' } } } });
  await prisma.institution.create({ data: { name: 'Other Practice', slug: 'pt-other', members: { create: { userId: other.id, role: 'coach' } } } });
  for (const [u, joined] of [[maya, 90], [jordan, 90], [sam, 3]] as const) {
    await prisma.institutionMember.create({ data: { institutionId: practice.id, userId: u.id, role: 'athlete', joinedAt: ago(joined) } });
  }
  // Maya: stalled squat, last session 9 days ago, and an unanswered message about her knee.
  for (const d of [44, 37, 30, 23, 16, 9]) await prisma.workoutLog.create({ data: { userId: maya.id, date: dateStr(d), createdAt: ago(d), title: 'Lower', exercises: squat(100) } });
  const [a, b] = trainer.id < maya.id ? [trainer.id, maya.id] : [maya.id, trainer.id];
  const convo = await prisma.directConversation.create({ data: { participantAId: a, participantBId: b } });
  await prisma.message.create({ data: { conversationId: convo.id, senderId: maya.id, body: 'Knee has been sore since Tuesday so I skipped legs.', createdAt: ago(2) } });
  // Jordan: training steadily and progressing.
  for (const [i, d] of [40, 33, 26, 19, 12, 5, 1].entries()) await prisma.workoutLog.create({ data: { userId: jordan.id, date: dateStr(d), createdAt: ago(d), title: 'Lower', exercises: squat(100 + i * 2.5) } });

  Object.assign(id, { trainer: trainer.id, other: other.id, practice: practice.id, maya: maya.id, jordan: jordan.id, sam: sam.id });
  Object.assign(as, { trainer: token(trainer.id, 'kofi@example.com'), other: token(other.id, 'other@example.com'), maya: token(maya.id, 'maya@example.com'), jordan: token(jordan.id, 'jordan@example.com') });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const trainerMessages = () => prisma.message.findMany({ where: { senderId: id.trainer }, orderBy: { createdAt: 'asc' } });

describe('briefing', () => {
  let mayaItem: any;

  it('starts with nothing generated', async () => {
    const r = await request(app).get(`${api}/briefing/today`).set('Authorization', as.trainer);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ trainerFirstName: 'Kofi', clientCount: 3, briefing: null, stale: false });
  });

  it('streams sources and cards, then is stored', async () => {
    const r = await request(app).get(`${api}/briefing/today/stream`).set('Authorization', as.trainer);
    const stream = events(r.text);
    expect(stream.filter((e) => e.type === 'source').map((e) => e.source)).toEqual(['workouts', 'checkIns', 'messages', 'programs']);
    const items = stream.filter((e) => e.type === 'item').map((e) => e.item);
    const done = stream.find((e) => e.type === 'done');
    expect(done.briefing.status).toBe('ready');
    // Maya needs attention; Jordan set a PR yesterday (worth a look); Sam is new and on plan.
    expect(done.briefing.summary).toEqual({ attention: 1, look: 1, onPlan: 1 });
    expect(done.briefing.onPlanClients.map((c: any) => c.name)).toEqual(['Sam Whitfield']);
    expect(items.map((i: any) => i.headline)).toEqual(['Maya mentioned pain', 'New PR: Back squat']);

    mayaItem = items.find((i: any) => i.clientId === id.maya);
    expect(mayaItem).toMatchObject({ severity: 'attention', headline: 'Maya mentioned pain', primaryLabel: 'Send reply' });
    expect(mayaItem.guardrail).toEqual({ checked: 1, label: 'Checked against 1 contraindication' });
    // Evidence is never empty, and the draft is a pending proposal, not a sent message.
    for (const item of items) {
      expect(item.evidence.reasons.length).toBeGreaterThan(0);
      expect(item.evidence.sources.length).toBeGreaterThan(0);
      expect(item.draft.status).toBe('pending');
    }
    expect(await trainerMessages()).toHaveLength(0);

    const again = await request(app).get(`${api}/briefing/today`).set('Authorization', as.trainer);
    expect(again.body.stale).toBe(false);
    expect(again.body.briefing.items).toHaveLength(2);
  });

  it('replays the stored briefing instead of generating twice', async () => {
    const r = await request(app).get(`${api}/briefing/today/stream`).set('Authorization', as.trainer);
    expect(events(r.text).filter((e) => e.type === 'item')).toHaveLength(2);
    expect(await prisma.ptBriefing.count()).toBe(1);
    expect(await prisma.ptDraft.count({ where: { kind: 'briefing' } })).toBe(2);
  });

  it('is invisible to a trainer of another practice', async () => {
    const r = await request(app).post(`${api}/briefing/items/${mayaItem.id}/resolve`).set('Authorization', as.other).send({ action: 'messaged' });
    expect(r.status).toBe(404);
    const d = await request(app).post(`${api}/drafts/${mayaItem.draft.id}/send`).set('Authorization', as.other).send({});
    expect(d.status).toBe(404);
    expect(await prisma.ptAuditLog.count()).toBe(0);
  });

  it('sending opens an undo window and delivers nothing yet', async () => {
    const r = await request(app).post(`${api}/briefing/items/${mayaItem.id}/resolve`).set('Authorization', as.trainer)
      .send({ action: 'messaged', editedText: 'Rest the knee this week, Maya. I will rework Thursday.' });
    expect(r.status).toBe(200);
    expect(r.body.item.resolution).toMatchObject({ action: 'messaged', summary: 'Maya Okafor — Message sent · logged to audit trail' });
    expect(r.body.item.draft.status).toBe('sending');
    // The sweep runs, but the window is still open.
    expect(await deliverDueDrafts()).toBe(0);
    expect(await trainerMessages()).toHaveLength(0);
    const actions = (await prisma.ptAuditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((a: any) => `${a.itemType}:${a.action}`);
    expect(actions).toEqual(['draft:sent', 'briefing_item:resolved']);
  });

  it('undo takes it back completely', async () => {
    const r = await request(app).delete(`${api}/briefing/items/${mayaItem.id}/resolve`).set('Authorization', as.trainer);
    expect(r.status).toBe(200);
    expect(r.body.item.resolution).toBeUndefined();
    expect(r.body.item.draft.status).toBe('pending');
    expect(await deliverDueDrafts(new Date(Date.now() + 60_000))).toBe(0);
    expect(await trainerMessages()).toHaveLength(0);
    expect(await prisma.ptAuditLog.count({ where: { action: 'undone' } })).toBe(2);
  });

  it('delivers exactly once after the window closes, as the trainer edited it', async () => {
    await request(app).post(`${api}/briefing/items/${mayaItem.id}/resolve`).set('Authorization', as.trainer)
      .send({ action: 'messaged', editedText: 'Rest the knee this week, Maya. I will rework Thursday.' });
    const later = new Date(Date.now() + 6_000);
    expect(await deliverDueDrafts(later)).toBe(1);
    expect(await deliverDueDrafts(later)).toBe(0);
    const sent = await trainerMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe('Rest the knee this week, Maya. I will rework Thursday.');

    const log = await prisma.ptAuditLog.findFirst({ where: { action: 'sent' }, orderBy: { createdAt: 'desc' } });
    expect(log).toMatchObject({ trainerId: id.trainer, clientId: id.maya, editedText: sent[0].body });
    expect(log.originalText).toBeTruthy();
    expect(JSON.parse(log.metaJson).editDistance).toBeGreaterThan(0);

    // Too late to undo now.
    const undo = await request(app).delete(`${api}/briefing/items/${mayaItem.id}/resolve`).set('Authorization', as.trainer);
    expect(undo.status).toBe(409);
    expect(await trainerMessages()).toHaveLength(1);
  });

  it('cannot be resolved twice, and a bad action is refused', async () => {
    const twice = await request(app).post(`${api}/briefing/items/${mayaItem.id}/resolve`).set('Authorization', as.trainer).send({ action: 'dismissed' });
    expect(twice.status).toBe(409);
    const bad = await request(app).post(`${api}/briefing/items/${mayaItem.id}/resolve`).set('Authorization', as.trainer).send({ action: 'apply' });
    expect(bad.status).toBe(400);
  });
});

describe('check-ins', () => {
  let mayaCheckIn = '';
  let jordanCheckIn = '';

  it('does nothing until a trainer switches a schedule on or asks', async () => {
    await runSweeps();
    expect(await prisma.ptCheckIn.count()).toBe(0);
    const s = await request(app).get(`${api}/check-in-schedules`).set('Authorization', as.trainer);
    expect(s.body.schedules).toHaveLength(1);
    expect(s.body.schedules[0]).toMatchObject({ id: null, clientId: null, active: false });
  });

  it('asks only real clients, sends each one prompt, and audits it', async () => {
    const before = (await trainerMessages()).length;
    const r = await request(app).post(`${api}/check-ins/request`).set('Authorization', as.trainer).send({ clientIds: [id.maya, id.jordan, id.other, 'nope'] });
    expect(r.body).toEqual({ requested: 2 });
    const rows = await prisma.ptCheckIn.findMany();
    mayaCheckIn = rows.find((k: any) => k.clientId === id.maya).id;
    jordanCheckIn = rows.find((k: any) => k.clientId === id.jordan).id;
    const prompts = (await trainerMessages()).slice(before);
    expect(prompts).toHaveLength(2);
    expect(prompts[0].body).toContain('https://axiomtraining.io/personal-training/check-in/');
    expect(await prisma.ptAuditLog.count({ where: { action: 'checkin_prompt' } })).toBe(2);
    // Asking again while one is outstanding does not stack a second.
    const again = await request(app).post(`${api}/check-ins/request`).set('Authorization', as.trainer).send({ clientIds: [id.maya] });
    expect(again.body).toEqual({ requested: 0 });
  });

  it('shows a check-in only to the client it is for', async () => {
    expect((await request(app).get(`${api}/check-in-requests/${mayaCheckIn}`).set('Authorization', as.jordan)).status).toBe(404);
    expect((await request(app).post(`${api}/check-in-requests/${mayaCheckIn}`).set('Authorization', as.jordan).send({ answers: {} })).status).toBe(404);
    const mine = await request(app).get(`${api}/check-in-requests/${mayaCheckIn}`).set('Authorization', as.maya);
    expect(mine.body).toMatchObject({ practiceName: 'Kofi Coaching', trainerName: 'Kofi Mensah', status: 'due' });
    expect(mine.body.questions).toHaveLength(5);
  });

  it('validates answers, then classifies and drafts a reply', async () => {
    const bad = await request(app).post(`${api}/check-in-requests/${mayaCheckIn}`).set('Authorization', as.maya).send({ answers: { energy: 9 } });
    expect(bad.status).toBe(400);
    const flagged = await request(app).post(`${api}/check-in-requests/${mayaCheckIn}`).set('Authorization', as.maya)
      .send({ answers: { energy: 2, sleep: 3, stress: 4, pain: 'Left knee still hurts on stairs.', notes: '' } });
    expect(flagged.status).toBe(200);
    const routine = await request(app).post(`${api}/check-in-requests/${jordanCheckIn}`).set('Authorization', as.jordan)
      .send({ answers: { energy: 5, sleep: 4, stress: 1, pain: 'None', notes: 'Feeling good' } });
    expect(routine.status).toBe(200);
    expect((await request(app).post(`${api}/check-in-requests/${jordanCheckIn}`).set('Authorization', as.jordan).send({ answers: {} })).status).toBe(409);

    const inbox = await request(app).get(`${api}/check-ins`).set('Authorization', as.trainer);
    expect(inbox.body.routinePending).toBe(1);
    const maya = inbox.body.checkIns.find((c: any) => c.clientId === id.maya);
    expect(maya).toMatchObject({ classification: 'flag', draft: { status: 'pending' } });
    expect(maya.signals).toContainEqual({ label: 'Pain mentioned', tone: 'red' });
    expect(maya.evidence.reasons.length).toBeGreaterThan(0);
    expect(inbox.body.checkIns.find((c: any) => c.clientId === id.jordan).classification).toBe('routine');
  });

  it('batch-sends routine replies only; a flagged check-in is never batch-sent', async () => {
    const before = (await trainerMessages()).length;
    const r = await request(app).post(`${api}/check-ins/send-routine`).set('Authorization', as.trainer);
    expect(r.body).toEqual({ sent: 1 });
    await deliverDueDrafts(new Date(Date.now() + 6_000));
    const sent = (await trainerMessages()).slice(before);
    expect(sent).toHaveLength(1);
    const maya = await prisma.ptCheckIn.findUnique({ where: { id: mayaCheckIn } });
    const jordan = await prisma.ptCheckIn.findUnique({ where: { id: jordanCheckIn } });
    expect(maya.reviewedAt).toBeNull();
    expect(jordan.reviewedAt).not.toBeNull();
    expect((await prisma.ptDraft.findUnique({ where: { id: maya.draftId } })).status).toBe('pending');
  });

  it('"mark read, no reply" reviews without sending', async () => {
    const before = (await trainerMessages()).length;
    const r = await request(app).post(`${api}/check-ins/${mayaCheckIn}/read`).set('Authorization', as.trainer);
    expect(r.status).toBe(200);
    await deliverDueDrafts(new Date(Date.now() + 60_000));
    expect((await trainerMessages()).length).toBe(before);
    expect(await prisma.ptAuditLog.count({ where: { action: 'marked_read' } })).toBe(1);
  });

  it('saves a schedule and refuses a malformed one', async () => {
    const base = { questions: [{ text: 'How was the week?', type: 'text' }], dayOfWeek: 0, hour: 18, nudgeAfterHours: 24, flagAfterHours: 48, pauseAfterMisses: 2, active: true };
    expect((await request(app).put(`${api}/check-in-schedules`).set('Authorization', as.trainer).send({ ...base, flagAfterHours: 10 })).status).toBe(400);
    expect((await request(app).put(`${api}/check-in-schedules`).set('Authorization', as.trainer).send({ ...base, clientId: id.other })).status).toBe(404);
    const ok = await request(app).put(`${api}/check-in-schedules`).set('Authorization', as.trainer).send(base);
    expect(ok.body.schedule).toMatchObject({ clientId: null, active: true });
    // Switching it on mid-week does not backfill last Sunday's check-in.
    const count = await prisma.ptCheckIn.count();
    await runSweeps();
    expect(await prisma.ptCheckIn.count()).toBe(count);
  });
});

describe('notifications', () => {
  it('records pain as immediate and quiet logs as timeline, once', async () => {
    const feed = await request(app).get(`${api}/notifications`).set('Authorization', as.trainer);
    expect(feed.status).toBe(200);
    expect(feed.body.immediate.some((n: any) => n.eventType === 'painReported' && n.clientId === id.maya)).toBe(true);
    expect(feed.body.unread).toBeGreaterThan(0);
    const total = await prisma.ptNotification.count();
    await request(app).get(`${api}/notifications`).set('Authorization', as.trainer);
    expect(await prisma.ptNotification.count()).toBe(total);

    const read = await request(app).patch(`${api}/notifications/read`).set('Authorization', as.trainer).send({});
    expect(read.body.unread).toBe(0);
  });

  it('will not let pain be silenced through the API', async () => {
    const bad = await request(app).put(`${api}/notification-settings`).set('Authorization', as.trainer).send({ rules: { painReported: 'timeline' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Safety events always reach you/);
    const ok = await request(app).put(`${api}/notification-settings`).set('Authorization', as.trainer)
      .send({ rules: { pr: 'immediate' }, quietHours: { start: 22, end: 6 }, overrides: [{ clientId: id.maya, eventType: '*', tier: 'immediate', note: 'until knee is cleared' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.rules.find((x: any) => x.eventType === 'pr').tier).toBe('immediate');
    expect(ok.body.rules.find((x: any) => x.eventType === 'painReported')).toMatchObject({ tier: 'immediate', locked: true });
    expect(ok.body.quietHours).toEqual({ start: 22, end: 6 });
    expect(ok.body.overrides[0]).toMatchObject({ clientName: 'Maya Okafor', note: 'until knee is cleared' });
    expect(typeof ok.body.weeklyEstimate).toBe('number');
  });
});

describe('progress and reports', () => {
  it('reports the plateau and the progress', async () => {
    const r = await request(app).get(`${api}/progress?lift=squat&weeks=6`).set('Authorization', as.trainer);
    expect(r.body.unit).toBe('kg');
    expect(Object.fromEntries(r.body.rows.map((x: any) => [x.client.name, x.status]))).toEqual({ 'Maya Okafor': 'plateau', 'Jordan Lee': 'progressing', 'Sam Whitfield': 'noData' });
    expect(r.body.kpis).toMatchObject({ progressing: 1, plateau: 1 });
  });

  it('drafts a report, lets the trainer edit it, and sends it through the same audited path', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const draft = await request(app).get(`${api}/reports?clientId=${id.jordan}&month=${month}`).set('Authorization', as.trainer);
    expect(draft.body.report).toMatchObject({ status: 'draft', trainerName: 'Kofi Mensah', practiceName: 'Kofi Coaching' });
    expect(draft.body.report.title).toMatch(/^Your \w+, Jordan\.$/);
    const reportId = draft.body.report.id;
    expect((await request(app).get(`${api}/reports?clientId=${id.other}`).set('Authorization', as.trainer)).status).toBe(404);
    expect((await request(app).patch(`${api}/reports/${reportId}`).set('Authorization', as.other).send({ coachNote: 'x' })).status).toBe(404);

    const edited = await request(app).patch(`${api}/reports/${reportId}`).set('Authorization', as.trainer).send({ coachNote: 'Proud of this block.' });
    expect(edited.body.report.coachNote).toBe('Proud of this block.');

    const before = (await trainerMessages()).length;
    const sent = await request(app).post(`${api}/reports/${reportId}/send`).set('Authorization', as.trainer);
    expect(sent.body.report.status).toBe('sent');
    expect(sent.body.report.undoUntil).toBeTruthy();
    expect((await trainerMessages()).length).toBe(before);

    const undone = await request(app).delete(`${api}/reports/${reportId}/send`).set('Authorization', as.trainer);
    expect(undone.body.report.status).toBe('draft');

    await request(app).post(`${api}/reports/${reportId}/send`).set('Authorization', as.trainer);
    await deliverDueDrafts(new Date(Date.now() + 6_000));
    const delivered = (await trainerMessages()).slice(before);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].body).toContain('From Kofi: Proud of this block.');
    expect((await request(app).patch(`${api}/reports/${reportId}`).set('Authorization', as.trainer).send({ coachNote: 'late' })).status).toBe(409);
  });
});

describe('Ask Anakin', () => {
  let threadId = '';
  let messageId = '';

  it('answers from the roster with per-client evidence', async () => {
    const r = await request(app).post(`${api}/anakin/threads/new/messages`).set('Authorization', as.trainer).send({ text: 'Who is on a plateau on squat?', scope: 'all' });
    const stream = events(r.text);
    expect(stream.map((e) => e.type)).toEqual(['thread', 'status', 'answer', 'done']);
    ({ threadId, messageId } = stream[0]);
    const answer = stream[2];
    expect(answer.text).toBe('1 client is on a plateau on squat.');
    expect(answer.rows[0]).toMatchObject({ clientId: id.maya });
    expect(answer.note).toMatch(/^Excluded: Sam/);
  });

  it('asks instead of guessing an ambiguous range, then answers the choice', async () => {
    const r = await request(app).post(`${api}/anakin/threads/${threadId}/messages`).set('Authorization', as.trainer).send({ text: 'Who hit PRs this month?' });
    const clarify = events(r.text).find((e) => e.type === 'clarify');
    expect(clarify.options).toHaveLength(3);
    const chosen = await request(app).post(`${api}/anakin/threads/${threadId}/messages`).set('Authorization', as.trainer)
      .send({ text: 'Who hit PRs this month?', clarifyChoice: 'Last 30 days' });
    const answer = events(chosen.text).find((e) => e.type === 'answer');
    expect(answer.rows.map((x: any) => x.clientId)).toEqual([id.jordan]);
    // The clarified turn is one user message, not two.
    const thread = await request(app).get(`${api}/anakin/threads/${threadId}`).set('Authorization', as.trainer);
    expect(thread.body.messages.filter((m: any) => m.role === 'user')).toHaveLength(2);
  });

  it('applies an answer as a roster filter, for its owner only', async () => {
    const f = await request(app).get(`${api}/anakin/threads/${threadId}/messages/${messageId}/filter`).set('Authorization', as.trainer);
    expect(f.body.question).toBe('Who is on a plateau on squat?');
    expect(f.body.rows).toEqual([{ clientId: id.maya, evidence: expect.stringContaining('flat at') }]);
    expect((await request(app).get(`${api}/anakin/threads/${threadId}/messages/${messageId}/filter`).set('Authorization', as.other)).status).toBe(404);
    expect((await request(app).get(`${api}/anakin/threads/${threadId}`).set('Authorization', as.other)).status).toBe(404);
  });

  it('drafts messages for the clients in the last answer and sends nothing', async () => {
    const before = (await trainerMessages()).length;
    await request(app).post(`${api}/anakin/threads/${threadId}/messages`).set('Authorization', as.trainer).send({ text: 'Who is on a plateau on squat?' });
    const r = await request(app).post(`${api}/anakin/threads/${threadId}/messages`).set('Authorization', as.trainer).send({ text: 'Draft a message to these clients' });
    const drafts = events(r.text).find((e) => e.type === 'drafts');
    expect(drafts.drafts).toHaveLength(1);
    expect(drafts.drafts[0]).toMatchObject({ clientId: id.maya, status: 'pending' });
    await deliverDueDrafts(new Date(Date.now() + 60_000));
    expect((await trainerMessages()).length).toBe(before);
  });

  it('schedules a question to run every morning, but not one it cannot interpret', async () => {
    const ok = await request(app).post(`${api}/anakin/scheduled`).set('Authorization', as.trainer).send({ text: 'Who has not trained in 7 days?' });
    expect(ok.status).toBe(201);
    expect(ok.body.scheduled).toHaveLength(1);
    expect((await request(app).post(`${api}/anakin/scheduled`).set('Authorization', as.trainer).send({ text: 'What is the weather?' })).status).toBe(400);
    const off = await request(app).patch(`${api}/anakin/scheduled/${ok.body.scheduled[0].id}`).set('Authorization', as.trainer).send({ active: false });
    expect(off.body.scheduled[0].active).toBe(false);
  });
});

describe('client dossier', () => {
  it('gives an overview whose summary shows its basis, and the open items', async () => {
    const r = await request(app).get(`${api}/clients/${id.maya}/overview`).set('Authorization', as.trainer);
    expect(r.status).toBe(200);
    expect(r.body.summary.text).toMatch(/^Maya has no program yet\./);
    expect(r.body.summary.evidence.reasons.length).toBeGreaterThan(1);
    expect(r.body.stats.some((s: any) => s.label === 'Squat est. 1RM')).toBe(true);
    expect((await request(app).get(`${api}/clients/${id.other}/overview`).set('Authorization', as.trainer)).status).toBe(404);
    expect((await request(app).get(`${api}/clients/${id.maya}/overview`).set('Authorization', as.other)).status).toBe(404);
  });

  it('returns no program when the client has none', async () => {
    const r = await request(app).get(`${api}/clients/${id.maya}/program`).set('Authorization', as.trainer);
    expect(r.body).toEqual({ program: null });
  });

  it('keeps notes private to the practice and puts them on the timeline', async () => {
    const made = await request(app).post(`${api}/clients/${id.maya}/notes`).set('Authorization', as.trainer).send({ body: ' Prefers morning sessions. ' });
    expect(made.status).toBe(201);
    expect(made.body.note).toMatchObject({ body: 'Prefers morning sessions.', authorName: 'Kofi Mensah' });
    const noteId = made.body.note.id;

    expect((await request(app).post(`${api}/clients/${id.maya}/notes`).set('Authorization', as.trainer).send({ body: '   ' })).status).toBe(400);
    // Another practice cannot read, edit or delete it — nor can the client herself.
    expect((await request(app).get(`${api}/clients/${id.maya}/notes`).set('Authorization', as.other)).status).toBe(404);
    expect((await request(app).patch(`${api}/clients/${id.maya}/notes/${noteId}`).set('Authorization', as.other).send({ body: 'x' })).status).toBe(404);
    expect((await request(app).get(`${api}/clients/${id.maya}/notes`).set('Authorization', as.maya)).status).toBe(404);
    // A note id from one client cannot be reached through another client's URL.
    expect((await request(app).delete(`${api}/clients/${id.jordan}/notes/${noteId}`).set('Authorization', as.trainer)).status).toBe(404);

    const edited = await request(app).patch(`${api}/clients/${id.maya}/notes/${noteId}`).set('Authorization', as.trainer).send({ body: 'Prefers 7 AM sessions.' });
    expect(edited.body.note.body).toBe('Prefers 7 AM sessions.');
    const timeline = await request(app).get(`${api}/clients/${id.maya}/timeline?kind=note`).set('Authorization', as.trainer);
    expect(timeline.body.events).toEqual([expect.objectContaining({ kind: 'note', title: 'Note · Kofi Mensah', body: 'Prefers 7 AM sessions.' })]);

    expect((await request(app).delete(`${api}/clients/${id.maya}/notes/${noteId}`).set('Authorization', as.trainer)).status).toBe(200);
    expect((await request(app).get(`${api}/clients/${id.maya}/notes`).set('Authorization', as.trainer)).body.notes).toEqual([]);
  });

  it('sends a message the trainer wrote through the same undo window and audit trail', async () => {
    const before = (await trainerMessages()).length;
    expect((await request(app).post(`${api}/clients/${id.maya}/message`).set('Authorization', as.trainer).send({ text: '  ' })).status).toBe(400);
    expect((await request(app).post(`${api}/clients/${id.other}/message`).set('Authorization', as.trainer).send({ text: 'hello' })).status).toBe(404);
    const r = await request(app).post(`${api}/clients/${id.maya}/message`).set('Authorization', as.trainer).send({ text: 'How did Thursday go?' });
    expect(r.body.draft).toMatchObject({ status: 'sending', text: 'How did Thursday go?' });
    expect((await trainerMessages()).length).toBe(before);

    const undone = await request(app).delete(`${api}/drafts/${r.body.draft.id}/send`).set('Authorization', as.trainer);
    expect(undone.body.draft.status).toBe('pending');
    await deliverDueDrafts(new Date(Date.now() + 60_000));
    expect((await trainerMessages()).length).toBe(before);

    await request(app).post(`${api}/clients/${id.maya}/message`).set('Authorization', as.trainer).send({ text: 'How did Thursday go?' });
    await deliverDueDrafts(new Date(Date.now() + 6_000));
    const sent = (await trainerMessages()).slice(before);
    expect(sent.map((m: any) => m.body)).toEqual(['How did Thursday go?']);
  });
});

describe('spreadsheet import', () => {
  const upload = {
    fileName: 'clients.xlsx',
    sheets: [
      { name: 'Clients', rows: [['Name', 'Email', 'Goal', 'Injuries'], ['Priya Nair', 'priya@example.com', 'Lose 5 kg', 'Lower back'], ['Jordan Lee', 'jordan@example.com', 'Deadlift 200', ''], ['Leo Martins', '', 'Build muscle', '']] },
      { name: 'Training', rows: [
        ['Client', 'Date', 'Exercise', 'Sets', 'Reps', 'Weight (kg)'],
        ['Priya Nair', '2026-08-03', 'Back squat', '3', '5', '60'], ['Priya Nair', '2026-08-10', 'Back squat', '3', '5', '62.5'],
        ['Jordan Lee', '2025-12-01', 'Deadlift', '3', '5', '150'],
        ['Leo Martins', 'sometime', 'Bench press', '3', '5', '70'],
      ] },
      { name: 'Weigh-ins', rows: [['Client', 'Date', 'Body weight'], ['Priya Nair', '2026-08-03', '70.5']] },
    ],
  };
  let importId = '';
  let priya = '';

  it('proposes a reading and imports nothing on upload', async () => {
    const r = await request(app).post(`${api}/imports`).set('Authorization', as.trainer).send(upload);
    expect(r.status).toBe(201);
    importId = r.body.id;
    expect(r.body.status).toBe('review');
    expect(r.body.sheets.map((s: any) => [s.name, s.mapping.kind])).toEqual([['Clients', 'clients'], ['Training', 'workouts'], ['Weigh-ins', 'bodyweight']]);
    expect(r.body.summary).toEqual({ clients: 3, workouts: 3, bodyweights: 1, skippedRows: 1 });
    expect(r.body.warnings).toContain('1 row skipped: date could not be read ("Training" row 5)');
    const byName = Object.fromEntries(r.body.clients.map((c: any) => [c.name, c]));
    // Jordan is already on the roster by email; Priya and Leo are new.
    expect(byName['Jordan Lee'].matchesExisting).toBe(true);
    expect(byName['Priya Nair']).toMatchObject({ matchesExisting: false, workouts: 2, bodyweights: 1, firstDate: '2026-08-03', lastDate: '2026-08-10' });
    expect(byName['Priya Nair'].sample[0]).toEqual({ date: '2026-08-10', summary: 'Back squat 3×5 at 63 kg' });
    expect(await prisma.ptProspect.count()).toBe(0);
    expect(await prisma.ptImportedWorkout.count()).toBe(0);
  });

  it('is private to the practice and rejects an empty or oversized upload', async () => {
    expect((await request(app).get(`${api}/imports/${importId}`).set('Authorization', as.other)).status).toBe(404);
    expect((await request(app).post(`${api}/imports/${importId}/confirm`).set('Authorization', as.other)).status).toBe(404);
    expect((await request(app).post(`${api}/imports`).set('Authorization', as.trainer).send({ fileName: 'x.csv', sheets: [{ name: 'A', rows: [['', '']] }] })).status).toBe(400);
    expect((await request(app).post(`${api}/imports`).set('Authorization', as.maya).send(upload)).status).toBe(404);
  });

  it('re-reads the file when the trainer corrects the mapping', async () => {
    const current = (await request(app).get(`${api}/imports/${importId}`).set('Authorization', as.trainer)).body;
    const mappings = current.sheets.map((s: any) => (s.name === 'Weigh-ins' ? { ...s.mapping, kind: 'ignore' } : s.mapping));
    const off = await request(app).put(`${api}/imports/${importId}/mapping`).set('Authorization', as.trainer).send({ mappings });
    expect(off.body.summary.bodyweights).toBe(0);
    expect(off.body.warnings).toContain('"Weigh-ins" was not read: no client, training or bodyweight columns were recognised');
    const back = await request(app).put(`${api}/imports/${importId}/mapping`).set('Authorization', as.trainer).send({ mappings: current.sheets.map((s: any) => s.mapping) });
    expect(back.body.summary.bodyweights).toBe(1);
  });

  it('imports once: new people as Not joined, a known email onto the existing client', async () => {
    const r = await request(app).post(`${api}/imports/${importId}/confirm`).set('Authorization', as.trainer);
    expect(r.status).toBe(200);
    expect(r.body.import).toMatchObject({ status: 'imported', clients: 3, workouts: 3 });
    expect((await request(app).post(`${api}/imports/${importId}/confirm`).set('Authorization', as.trainer)).status).toBe(409);
    expect((await request(app).put(`${api}/imports/${importId}/mapping`).set('Authorization', as.trainer).send({ mappings: [] })).status).toBe(409);

    const roster = await request(app).get(`${api}/clients`).set('Authorization', as.trainer);
    expect(roster.body.counts.notJoined).toBe(2);
    const notJoined = roster.body.clients.filter((c: any) => c.status === 'notJoined');
    expect(notJoined.map((c: any) => c.name).sort()).toEqual(['Leo Martins', 'Priya Nair']);
    const p = notJoined.find((c: any) => c.name === 'Priya Nair');
    priya = p.id;
    expect(priya).toMatch(/^prospect:/);
    expect(p).toMatchObject({ email: 'priya@example.com', statusReason: 'Not on Axiom yet · 2 imported sessions', contraindications: [{ label: 'Lower back', active: true }] });
    // Jordan stays one client, not two.
    expect(roster.body.clients.filter((c: any) => c.name === 'Jordan Lee')).toHaveLength(1);
    // Nothing was written into anyone's own account.
    expect(await prisma.workoutLog.count({ where: { userId: id.jordan, date: '2025-12-01' } })).toBe(0);
    expect(await prisma.ptAuditLog.count({ where: { action: 'import_confirmed' } })).toBe(1);
  });

  it('gives an app published before the import a status it can draw', async () => {
    const old = await request(app).get(`${api}/clients`).set('Authorization', as.trainer).set('x-pt-caps', 'none');
    const p = old.body.clients.find((c: any) => c.id === priya);
    expect(p).toMatchObject({ status: 'new', statusReason: 'Not on Axiom yet · 2 imported sessions' });
    expect(old.body.clients.some((c: any) => c.status === 'notJoined')).toBe(false);
    const viaQuery = await request(app).get(`${api}/clients?caps=not-joined`).set('Authorization', as.trainer).set('x-pt-caps', 'none');
    expect(viaQuery.body.clients.find((c: any) => c.id === priya).status).toBe('notJoined');
  });

  it('shows a not-joined client\'s imported history, and the existing client\'s alongside what they log', async () => {
    const t = await request(app).get(`${api}/clients/${encodeURIComponent(priya)}/timeline`).set('Authorization', as.trainer);
    expect(t.status).toBe(200);
    expect(t.body.events.map((e: any) => [e.kind, e.flag?.label])).toEqual([['workout', 'PR · Back squat'], ['workout', 'Imported'], ['measurement', 'Imported']]);
    const overview = await request(app).get(`${api}/clients/${encodeURIComponent(priya)}/overview`).set('Authorization', as.trainer);
    expect(overview.body.summary.text).toBe('Priya has not joined Axiom yet, so this is their imported history only. 2 sessions were imported, the most recent from 10 Aug. Active injury on file: Lower back.');
    // No plan means nothing to adhere to: the overview does not invent an adherence figure.
    expect(overview.body.stats.map((x: any) => x.label)).not.toContain('4-week adherence');
    expect(overview.body.openItems).toEqual([]);
    expect((await request(app).get(`${api}/clients/${encodeURIComponent(priya)}/timeline`).set('Authorization', as.other)).status).toBe(404);

    const jordan = await request(app).get(`${api}/clients/${id.jordan}/timeline?kind=workout`).set('Authorization', as.trainer);
    const imported = jordan.body.events.filter((e: any) => e.flag?.label === 'Imported');
    expect(imported).toHaveLength(1);
    expect(imported[0].body).toContain('Deadlift 3×5 at 150 kg');
  });

  it('never sends to someone who has not joined', async () => {
    const before = (await trainerMessages()).length;
    const msg = await request(app).post(`${api}/clients/${encodeURIComponent(priya)}/message`).set('Authorization', as.trainer).send({ text: 'hello' });
    expect(msg.status).toBe(409);
    expect(msg.body.code).toBe('not_joined');
    expect((await request(app).post(`${api}/check-ins/request`).set('Authorization', as.trainer).send({ clientIds: [priya] })).body).toEqual({ requested: 0 });
    // The briefing is about people the trainer can reach; imported-only clients are not in it.
    const briefing = await request(app).get(`${api}/briefing/today`).set('Authorization', as.trainer);
    expect(briefing.body.clientCount).toBe(3);
    await runSweeps();
    expect(await prisma.ptNotification.count({ where: { clientId: priya } })).toBe(0);
    expect((await trainerMessages()).length).toBe(before);
  });

  it('invites a not-joined client; when they accept, the record becomes theirs', async () => {
    const leo = (await request(app).get(`${api}/clients?status=notJoined`).set('Authorization', as.trainer)).body.clients.find((c: any) => c.name === 'Leo Martins').id;
    expect((await request(app).post(`${api}/clients/${encodeURIComponent(leo)}/invite`).set('Authorization', as.trainer).send({})).status).toBe(400); // no email on file
    expect((await request(app).post(`${api}/clients/${id.jordan}/invite`).set('Authorization', as.trainer).send({})).status).toBe(400);
    expect((await request(app).post(`${api}/clients/${encodeURIComponent(priya)}/invite`).set('Authorization', as.other).send({})).status).toBe(404);

    await request(app).post(`${api}/clients/${encodeURIComponent(priya)}/notes`).set('Authorization', as.trainer).send({ body: 'Met at the gym open day.' });
    const invite = await request(app).post(`${api}/clients/${encodeURIComponent(priya)}/invite`).set('Authorization', as.trainer).send({});
    expect(invite.status).toBe(201);
    expect(invite.body).toMatchObject({ email: 'priya@example.com', link: expect.stringContaining('/personal-training/join/') });

    const account = await prisma.user.create({ data: { name: 'Priya Nair', email: 'priya@example.com', emailVerified: true } });
    const asPriya = token(account.id, 'priya@example.com');
    // The link is bound to her address: someone else cannot use it.
    expect((await request(app).post(`${api}/invites/${invite.body.token}/accept`).set('Authorization', as.jordan)).status).toBe(403);
    expect((await request(app).post(`${api}/invites/${invite.body.token}/accept`).set('Authorization', asPriya)).status).toBe(200);

    const roster = await request(app).get(`${api}/clients`).set('Authorization', as.trainer);
    const joined = roster.body.clients.filter((c: any) => c.name === 'Priya Nair');
    expect(joined).toHaveLength(1);
    expect(joined[0].id).toBe(account.id);
    expect(joined[0].status).not.toBe('notJoined');
    expect(roster.body.counts.notJoined).toBe(1);
    // Her imported history and the note followed her; her own account holds none of it.
    const t = await request(app).get(`${api}/clients/${account.id}/timeline`).set('Authorization', as.trainer);
    expect(t.body.events.map((e: any) => e.kind).sort()).toEqual(['measurement', 'note', 'workout', 'workout']);
    expect(await prisma.workoutLog.count({ where: { userId: account.id } })).toBe(0);
    expect((await request(app).get(`${api}/clients/${encodeURIComponent(priya)}/timeline`).set('Authorization', as.trainer)).status).toBe(404);
  });

  it('undoes an import as a batch', async () => {
    expect((await request(app).post(`${api}/imports/${importId}/undo`).set('Authorization', as.other)).status).toBe(404);
    const r = await request(app).post(`${api}/imports/${importId}/undo`).set('Authorization', as.trainer);
    expect(r.status).toBe(200);
    expect(await prisma.ptImportedWorkout.count()).toBe(0);
    expect(await prisma.ptImportedWeight.count()).toBe(0);
    expect(await prisma.ptProspect.count()).toBe(0);
    expect((await request(app).get(`${api}/clients`).set('Authorization', as.trainer)).body.counts.notJoined).toBe(0);
    expect((await request(app).post(`${api}/imports/${importId}/undo`).set('Authorization', as.trainer)).status).toBe(409);
    const list = await request(app).get(`${api}/imports`).set('Authorization', as.trainer);
    expect(list.body.imports).toEqual([expect.objectContaining({ id: importId, status: 'undone', fileName: 'clients.xlsx' })]);
  });
});

describe('the invariant', () => {
  it('every message the dashboard sent traces to a trainer action in the audit log', async () => {
    const sent = await trainerMessages();
    expect(sent.length).toBeGreaterThan(0);
    const logs = await prisma.ptAuditLog.findMany({ where: { action: { in: ['delivered', 'checkin_prompt', 'checkin_nudge'] } } });
    const audited = new Set(logs.map((l: any) => JSON.parse(l.metaJson).messageId));
    for (const m of sent) expect(audited.has(m.id)).toBe(true);

    // Each delivered draft was explicitly sent by a trainer first.
    for (const l of logs.filter((x: any) => x.action === 'delivered')) {
      expect(await prisma.ptAuditLog.count({ where: { itemType: 'draft', itemId: l.itemId, action: 'sent', trainerId: id.trainer } })).toBeGreaterThan(0);
    }
    // And no draft is sitting in a half-sent state.
    expect(await prisma.ptDraft.count({ where: { status: 'sending' } })).toBe(0);
  });

  it('nothing was ever sent to someone who is not a client of the practice', async () => {
    const convos = await prisma.directConversation.findMany({ where: { OR: [{ participantAId: id.trainer }, { participantBId: id.trainer }] } });
    const others = convos.map((c: any) => (c.participantAId === id.trainer ? c.participantBId : c.participantAId)).sort();
    expect(others).toEqual([id.jordan, id.maya].sort());
  });
});
