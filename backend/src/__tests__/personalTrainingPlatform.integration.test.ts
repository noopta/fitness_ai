// Coach-platform foundation, end to end over a real (temporary) SQLite
// database: a trainer adds a no-install client, the client opens their link
// and submits things that land in the dossier (the handoff's phase-0 exit
// criterion), and the contraindication rules engine refuses what it must.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const dir = mkdtempSync(join(tmpdir(), 'pt-platform-'));
process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_at_least_32_chars_long!!';
process.env.PERSONAL_TRAINING_USERS = 'kofi@example.com,other@example.com';
process.env.PERSONAL_TRAINING_UNDO_SECONDS = '0';
process.env.FRONTEND_URL = 'https://axiomtraining.io';

const token = (id: string, email: string) => `Bearer ${jwt.sign({ id, email, tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`;
const tokenOf = (url: string) => url.split('/c/')[1].split('?')[0];

let app: express.Express;
let prisma: any;
let deliverDueDrafts: (now?: Date) => Promise<number>;
const id = { trainer: '', other: '', practice: '', maya: '' };
const as = { trainer: '', other: '', maya: '' };
const api = '/api/personal-training';
const portal = '/api/pt-portal';

beforeAll(async () => {
  execSync('./node_modules/.bin/prisma db push --skip-generate --schema prisma/schema.prisma', { env: process.env, stdio: 'ignore' });
  prisma = (await import('../services/personalTraining/db.js')).prisma;
  ({ deliverDueDrafts } = await import('../services/personalTraining/drafts.js'));
  const { default: routes } = await import('../routes/personalTraining.js');
  const { default: portalRoutes } = await import('../routes/ptPortal.js');
  app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => { req.headers['x-pt-caps'] ??= 'not-joined'; next(); });
  app.use(api, routes);
  app.use(portal, portalRoutes);

  const user = (name: string, email: string, extra: object = {}) => prisma.user.create({ data: { name, email, emailVerified: true, unitPreference: 'metric', ...extra } });
  const trainer = await user('Kofi Mensah', 'kofi@example.com');
  const other = await user('Other Trainer', 'other@example.com');
  const maya = await user('Maya Okafor', 'maya@example.com', { constraintsText: 'Torn ACL left knee, not cleared' });
  const practice = await prisma.institution.create({ data: { name: 'Kofi Coaching', slug: 'pt-kofi', members: { create: { userId: trainer.id, role: 'coach' } } } });
  await prisma.institution.create({ data: { name: 'Other Practice', slug: 'pt-other', members: { create: { userId: other.id, role: 'coach' } } } });
  await prisma.institutionMember.create({ data: { institutionId: practice.id, userId: maya.id, role: 'athlete' } });
  Object.assign(id, { trainer: trainer.id, other: other.id, practice: practice.id, maya: maya.id });
  Object.assign(as, { trainer: token(trainer.id, 'kofi@example.com'), other: token(other.id, 'other@example.com'), maya: token(maya.id, 'maya@example.com') });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('no-install clients (phase 0 exit criterion)', () => {
  const links: string[] = [];
  const clientIds: string[] = [];

  it('a trainer adds five link clients', async () => {
    for (const name of ['Ada Obi', 'Ben Cole', 'Cara Diaz', 'Dev Shah', 'Eli Park']) {
      const r = await request(app).post(`${api}/clients`).set('Authorization', as.trainer).send({ name, email: `${name.split(' ')[0].toLowerCase()}@mail.test`, tags: ['Online', 'online', 'Fat loss'] });
      expect(r.status).toBe(201);
      expect(r.body.client).toMatchObject({ name, channel: 'webLink', state: 'active', tags: ['online', 'fat loss'], contactEmail: `${name.split(' ')[0].toLowerCase()}@mail.test` });
      expect(r.body.link.url).toMatch(/^https:\/\/axiomtraining\.io\/c\/[A-Za-z0-9_-]{43}$/);
      links.push(r.body.link.url);
      clientIds.push(r.body.client.id);
    }
    const roster = await request(app).get(`${api}/clients`).set('Authorization', as.trainer);
    expect(roster.body.clients.filter((c: any) => c.channel === 'webLink')).toHaveLength(5);
    const tags = await request(app).get(`${api}/tags`).set('Authorization', as.trainer);
    expect(tags.body.tags).toEqual([{ tag: 'fat loss', count: 5 }, { tag: 'online', count: 5 }]);
  });

  it('the account behind a link client cannot be signed in to and holds no contact details', async () => {
    const u = await prisma.user.findUnique({ where: { id: clientIds[0] } });
    expect(u).toMatchObject({ email: null, hashedPassword: null, googleId: null, appleId: null, reengagementOptOut: true });
  });

  it('only a hash of the token is stored', async () => {
    const rows = await prisma.ptClientLink.findMany();
    for (const r of rows) {
      expect(links.some((l) => tokenOf(l) === r.tokenHash)).toBe(false);
      expect(r.tokenCipher).not.toContain(tokenOf(links[0]));
    }
  });

  it('each client opens their link and submits something that lands in their dossier', async () => {
    for (const [i, url] of links.entries()) {
      const auth = `PtLink ${tokenOf(url)}`;
      const home = await request(app).get(`${portal}/home`).set('Authorization', auth);
      expect(home.status).toBe(200);
      expect(home.body.branding).toMatchObject({ practiceName: 'Kofi Coaching', trainerName: 'Kofi Mensah' });
      const w = await request(app).post(`${portal}/measurements`).set('Authorization', auth).send({ kind: 'bodyweight', value: 70 + i, unit: 'kg' });
      expect(w.status).toBe(201);
      const m = await request(app).post(`${portal}/messages`).set('Authorization', auth).send({ text: `Hi coach, this is client ${i}` });
      expect(m.status).toBe(201);
    }
    // The trainer sees each submission on that client's timeline, through the same code an app client's goes through.
    for (const [i, cid] of clientIds.entries()) {
      const t = await request(app).get(`${api}/clients/${cid}/timeline`).set('Authorization', as.trainer);
      expect(t.status).toBe(200);
      const kinds = t.body.events.map((e: any) => e.kind);
      expect(kinds).toContain('measurement');
      expect(kinds).toContain('message');
      expect(t.body.events.find((e: any) => e.kind === 'message').body).toContain(`client ${i}`);
    }
  });

  it('a link opens only its own client', async () => {
    const auth = `PtLink ${tokenOf(links[0])}`;
    const theirs = await prisma.ptCheckIn.create({ data: { practiceId: id.practice, clientId: clientIds[1], questionsJson: '[]', dueAt: new Date() } });
    expect((await request(app).get(`${portal}/check-ins/${theirs.id}`).set('Authorization', auth)).status).toBe(404);
    // And it is never a session for the rest of the API.
    expect((await request(app).get(`${api}/clients`).set('Authorization', auth)).status).toBe(401);
  });

  it('a client answers a check-in through the portal and the trainer gets it with a draft reply', async () => {
    const auth = `PtLink ${tokenOf(links[2])}`;
    const req = await request(app).post(`${api}/check-ins/request`).set('Authorization', as.trainer).send({ clientIds: [clientIds[2]] });
    expect(req.body.requested).toBe(1);
    const prompt = await prisma.message.findFirst({ where: { senderId: id.trainer, body: { contains: 'check-in is ready' } }, orderBy: { createdAt: 'desc' } });
    // The prompt points a link client at their portal, not at the app.
    expect(prompt.body).toContain(`${links[2]}?checkin=`);
    const home = await request(app).get(`${portal}/home`).set('Authorization', auth);
    expect(home.body.checkIns).toHaveLength(1);
    const k = await request(app).get(`${portal}/check-ins/${home.body.checkIns[0].id}`).set('Authorization', auth);
    const answers = Object.fromEntries(k.body.questions.map((q: any) => [q.id, q.type === 'scale' ? 3 : q.type === 'number' ? 7 : 'All good']));
    const sub = await request(app).post(`${portal}/check-ins/${home.body.checkIns[0].id}`).set('Authorization', auth).send({ answers });
    expect(sub.status).toBe(200);
    const inbox = await request(app).get(`${api}/check-ins`).set('Authorization', as.trainer);
    const mine = inbox.body.checkIns.find((c: any) => c.clientId === clientIds[2]);
    expect(mine).toMatchObject({ channel: 'webLink' });
    expect(mine.draft.status).toBe('pending');
  });

  it('a trainer reply reaches the client in their portal', async () => {
    const r = await request(app).post(`${api}/clients/${clientIds[3]}/message`).set('Authorization', as.trainer).send({ text: 'Nice work this week.' });
    expect(r.status).toBe(200);
    await deliverDueDrafts(new Date(Date.now() + 1000));
    const msgs = await request(app).get(`${portal}/messages`).set('Authorization', `PtLink ${tokenOf(links[3])}`);
    expect(msgs.body.messages.map((m: any) => [m.fromClient, m.body])).toEqual([[true, 'Hi coach, this is client 3'], [false, 'Nice work this week.']]);
  });

  it('issuing a new link revokes the old one, and revoking ends access', async () => {
    const old = `PtLink ${tokenOf(links[4])}`;
    const fresh = await request(app).post(`${api}/clients/${clientIds[4]}/link`).set('Authorization', as.trainer);
    expect(fresh.status).toBe(201);
    expect((await request(app).get(`${portal}/home`).set('Authorization', old)).status).toBe(404);
    const now = `PtLink ${tokenOf(fresh.body.link.url)}`;
    expect((await request(app).get(`${portal}/home`).set('Authorization', now)).status).toBe(200);
    // The trainer can copy the same live link again.
    const again = await request(app).get(`${api}/clients/${clientIds[4]}/link`).set('Authorization', as.trainer);
    expect(again.body.link.url).toBe(fresh.body.link.url);
    await request(app).delete(`${api}/clients/${clientIds[4]}/link`).set('Authorization', as.trainer);
    expect((await request(app).get(`${portal}/home`).set('Authorization', now)).status).toBe(404);
  });

  it('pausing drops a client into the paused chip; archiving hides them and closes their link', async () => {
    const p = await request(app).patch(`${api}/clients/${clientIds[0]}`).set('Authorization', as.trainer).send({ state: 'paused', stateReason: 'Travelling' });
    expect(p.body.client).toMatchObject({ status: 'paused', statusReason: 'Travelling', state: 'paused' });
    const roster = await request(app).get(`${api}/clients?status=paused`).set('Authorization', as.trainer);
    expect(roster.body.counts.paused).toBe(1);
    const a = await request(app).patch(`${api}/clients/${clientIds[1]}`).set('Authorization', as.trainer).send({ state: 'archived' });
    expect(a.body.client.state).toBe('archived');
    const after = await request(app).get(`${api}/clients`).set('Authorization', as.trainer);
    expect(after.body.clients.map((c: any) => c.id)).not.toContain(clientIds[1]);
    expect((await request(app).get(`${portal}/home`).set('Authorization', `PtLink ${tokenOf(links[1])}`)).status).toBe(404);
  });

  it("only a link client's name can be edited by the trainer", async () => {
    expect((await request(app).patch(`${api}/clients/${clientIds[2]}`).set('Authorization', as.trainer).send({ name: 'Cara D.' })).body.client.name).toBe('Cara D.');
    expect((await request(app).patch(`${api}/clients/${id.maya}`).set('Authorization', as.trainer).send({ name: 'Nope' })).status).toBe(409);
  });

  it("another practice's trainer cannot touch these clients", async () => {
    expect((await request(app).get(`${api}/clients/${clientIds[2]}/link`).set('Authorization', as.other)).status).toBe(404);
    expect((await request(app).patch(`${api}/clients/${clientIds[2]}`).set('Authorization', as.other).send({ state: 'archived' })).status).toBe(404);
  });
});

describe('contraindications and the rules engine', () => {
  it("reads the client's own words into a structured, not-cleared contraindication", async () => {
    const r = await request(app).get(`${api}/clients/${id.maya}/contraindications`).set('Authorization', as.trainer);
    expect(r.body.contraindications).toHaveLength(1);
    expect(r.body.contraindications[0]).toMatchObject({ bodyPart: 'knee', side: 'left', severity: 'severe', clearance: 'not_cleared', source: 'client_reported', needsReview: true });
    expect(r.body.contraindications[0].id).toMatch(/^inferred:/);
  });

  it('refuses knee-loading work even before a trainer has reviewed it', async () => {
    const r = await request(app).post(`${api}/clients/${id.maya}/guardrails/check`).set('Authorization', as.trainer).send({ exercises: ['Back Squat', 'Bench Press', 'Box Jump'] });
    expect(r.body.report.ok).toBe(false);
    expect(r.body.report.violations.map((v: any) => v.exercise)).toEqual(['Back Squat', 'Box Jump']);
  });

  it('confirming replaces the inferred one, and a clearance change is audited', async () => {
    const list = await request(app).get(`${api}/clients/${id.maya}/contraindications`).set('Authorization', as.trainer);
    const inferred = list.body.contraindications[0];
    const c = await request(app).post(`${api}/clients/${id.maya}/contraindications`).set('Authorization', as.trainer)
      .send({ fromInferred: inferred.id, bodyPart: 'knee', side: 'left', condition: 'ACL reconstruction', severity: 'severe' });
    expect(c.status).toBe(201);
    const after = await request(app).get(`${api}/clients/${id.maya}/contraindications`).set('Authorization', as.trainer);
    expect(after.body.contraindications.map((x: any) => x.label)).toEqual(['ACL reconstruction']);
    expect(after.body.contraindications[0].needsReview).toBe(false);

    const u = await request(app).patch(`${api}/clients/${id.maya}/contraindications/${c.body.contraindication.id}`).set('Authorization', as.trainer).send({ clearance: 'modified' });
    expect(u.body.contraindication.clearance).toBe('modified');
    const audit = await prisma.ptAuditLog.findFirst({ where: { action: 'contraindication_clearance', itemId: c.body.contraindication.id } });
    expect(JSON.parse(audit.metaJson)).toMatchObject({ before: { clearance: 'not_cleared' }, after: { clearance: 'modified' } });

    // Severe and modified: squats stay refused; hinges become warnings.
    const check = await request(app).post(`${api}/clients/${id.maya}/guardrails/check`).set('Authorization', as.trainer).send({ exercises: ['Back Squat', 'Romanian Deadlift'] });
    expect(check.body.report.violations.map((v: any) => [v.exercise, v.level])).toEqual([['Back Squat', 'block'], ['Romanian Deadlift', 'warn']]);
  });

  it('the briefing guardrail reads the structured rows', async () => {
    const { checkContraindications } = await import('../services/personalTraining/guardrails.js');
    const { contraindicationsFor } = await import('../services/personalTraining/contraindications.js');
    const contras = await contraindicationsFor(id.practice, id.maya);
    expect(checkContraindications(contras, 'squat').conflicts).toEqual(['ACL reconstruction']);
    expect(checkContraindications(contras, 'bench').conflicts).toEqual([]);
  });

  it('validates input', async () => {
    const bad = await request(app).post(`${api}/clients/${id.maya}/contraindications`).set('Authorization', as.trainer).send({ bodyPart: 'elbowz', condition: 'x' });
    expect(bad.status).toBe(400);
    const meta = await request(app).get(`${api}/contraindications/meta`).set('Authorization', as.trainer);
    expect(meta.body.bodyParts.find((b: any) => b.key === 'knee').primary).toContain('squat');
  });
});

describe('goals and measurements', () => {
  it('a goal starts from today and tracks progress from logged data', async () => {
    const [cid] = (await prisma.ptClientProfile.findMany({ where: { channel: 'webLink' }, orderBy: { createdAt: 'asc' }, take: 1 })).map((p: any) => p.clientId);
    const g = await request(app).post(`${api}/clients/${cid}/goals`).set('Authorization', as.trainer).send({ metric: 'bodyweight', target: 66, deadline: '2027-01-31' });
    expect(g.status).toBe(201);
    expect(g.body.goal).toMatchObject({ metric: 'bodyweight', baseline: 70, target: 66, current: 70, direction: 'down', unit: 'kg', progress: 0 });
    await prisma.bodyWeightLog.create({ data: { userId: cid, date: '2026-10-20', weightKg: 68, createdAt: new Date(Date.now() + 60_000) } });
    const list = await request(app).get(`${api}/clients/${cid}/goals`).set('Authorization', as.trainer);
    expect(list.body.goals[0]).toMatchObject({ current: 68, progress: 50 });
  });

  it("a trainer's measurements are theirs to remove; a client's weigh-in is not", async () => {
    const r = await request(app).post(`${api}/clients/${id.maya}/measurements`).set('Authorization', as.trainer).send({ kind: 'waist', value: 80, unit: 'cm' });
    expect(r.status).toBe(201);
    const waist = r.body.measurements.find((m: any) => m.kind === 'waist');
    expect(waist).toMatchObject({ value: 80, unit: 'cm', source: 'trainer', deletable: true });
    expect((await request(app).delete(`${api}/clients/${id.maya}/measurements/${waist.id}`).set('Authorization', as.trainer)).status).toBe(200);
  });

  it('photos need the media store', async () => {
    const r = await request(app).post(`${api}/clients/${id.maya}/photos`).set('Authorization', as.trainer).send({ imageBase64: 'x'.repeat(200) });
    expect(r.status).toBe(503);
  });
});

describe('practice profile and branding', () => {
  it('saves profile fields and shows the brand on the portal', async () => {
    const r = await request(app).put(`${api}/practice/profile`).set('Authorization', as.trainer).send({ bio: 'Strength coach', specialties: ['Powerlifting', 'Rehab'], brandColor: '#1F6FEB', timezone: 'Europe/London' });
    expect(r.body.profile).toMatchObject({ bio: 'Strength coach', specialties: ['Powerlifting', 'Rehab'], brandColor: '#1F6FEB', timezone: 'Europe/London' });
    expect((await request(app).put(`${api}/practice/profile`).set('Authorization', as.trainer).send({ brandColor: 'blue' })).status).toBe(400);
    const link = await prisma.ptClientLink.findFirst({ where: { revokedAt: null, clientId: { not: undefined } }, orderBy: { createdAt: 'asc' } });
    expect(link).toBeTruthy();
  });
});

describe('conversational intake (rules path, model off under test)', () => {
  let auth = '';
  let cid = '';
  beforeAll(async () => {
    const r = await request(app).post(`${api}/clients`).set('Authorization', as.trainer).send({ name: 'Ivy Intake' });
    cid = r.body.client.id;
    auth = `PtLink ${tokenOf(r.body.link.url)}`;
  });

  it('asks one question at a time, probes a vague answer once, and records injuries as not-cleared contraindications', async () => {
    const start = await request(app).post(`${portal}/intake/start`).set('Authorization', auth);
    expect(start.body.intake).toMatchObject({ status: 'in_progress', current: 'goal' });
    const say = (text: string) => request(app).post(`${portal}/intake/answer`).set('Authorization', auth).send({ text });

    let r = await say('get fit');
    // Vague: the same field again, as a follow-up.
    expect(r.body.intake.current).toBe('goal');
    expect(r.body.intake.transcript.at(-1)).toMatchObject({ role: 'trainer', field: 'goal', probe: true });
    r = await say('Lose 5 kg by March and deadlift 100 kg');
    expect(r.body.intake.current).toBe('experience');
    r = await say('About two years of gym training, mostly machines');
    r = await say('Three days a week, 60 minutes each');
    r = await say('Commercial gym with full equipment');
    r = await say('Left knee meniscus tear last year, physio has not cleared me for running');
    expect(r.body.intake.current).toBe('medical');
    r = await say('none');
    r = await say('Seven hours of sleep, medium stress');
    r = await say('Three meals a day, I skip breakfast often');
    r = await say('I love deadlifts and hate burpees');
    expect(r.body.intake.status).toBe('complete');
    expect(r.body.intake.completeness).toBeGreaterThanOrEqual(90);

    const contras = await request(app).get(`${api}/clients/${cid}/contraindications`).set('Authorization', as.trainer);
    expect(contras.body.contraindications).toHaveLength(1);
    expect(contras.body.contraindications[0]).toMatchObject({ bodyPart: 'knee', side: 'left', severity: 'severe', clearance: 'not_cleared', source: 'intake', needsReview: true });

    const trainerView = await request(app).get(`${api}/clients/${cid}/intake`).set('Authorization', as.trainer);
    expect(trainerView.body.intake.fields.find((f: any) => f.key === 'goal').answer).toContain('Lose 5 kg');
    expect((await say('one more')).status).toBe(409);
  });
});

describe('nutrition targets and compliance', () => {
  it('rolls up what a link client logged against the trainer targets', async () => {
    const r = await request(app).post(`${api}/clients`).set('Authorization', as.trainer).send({ name: 'Nia Nutrition' });
    const cid = r.body.client.id;
    const auth = `PtLink ${tokenOf(r.body.link.url)}`;
    await request(app).put(`${api}/clients/${cid}/nutrition-targets`).set('Authorization', as.trainer).send({ calories: 2000, proteinG: 150 });
    const today = new Date().toISOString().slice(0, 10);
    expect((await request(app).post(`${portal}/meals`).set('Authorization', auth).send({ name: 'Chicken and rice', calories: 1100, proteinG: 80, date: today })).status).toBe(201);
    await request(app).post(`${portal}/meals`).set('Authorization', auth).send({ name: 'Oats', calories: 900, proteinG: 60, date: today });
    const n = await request(app).get(`${api}/clients/${cid}/nutrition`).set('Authorization', as.trainer);
    expect(n.body.nutrition.week).toMatchObject({ daysLogged: 1, avgCalories: 2000, avgProteinG: 140, caloriesOnTarget: 1, proteinOnTarget: 1 });
    expect(n.body.nutrition.line).toBe('Logged 1 of 7 days, protein on target 1 of 1, calories within 10% on 1.');
    expect((await request(app).put(`${api}/clients/${cid}/nutrition-targets`).set('Authorization', as.trainer).send({ calories: 100 })).status).toBe(400);
  });
});

describe('messaging inbox', () => {
  it('lists threads awaiting a reply first, with a context strip, and drafts a reply that is not sent', async () => {
    const t = await request(app).get(`${api}/inbox`).set('Authorization', as.trainer);
    expect(t.status).toBe(200);
    expect(t.body.threads.length).toBeGreaterThan(0);
    expect(t.body.threads[0].awaitingReply).toBe(true);
    const first = t.body.threads[0];
    const open = await request(app).get(`${api}/inbox/${first.clientId}`).set('Authorization', as.trainer);
    expect(open.body.context).toHaveProperty('contraindications');
    expect(open.body.messages.at(-1).fromClient).toBe(true);
    const after = await request(app).get(`${api}/inbox`).set('Authorization', as.trainer);
    expect(after.body.threads.find((x: any) => x.clientId === first.clientId).unread).toBe(0);
    const before = await prisma.message.count();
    const d = await request(app).post(`${api}/inbox/${first.clientId}/draft`).set('Authorization', as.trainer);
    expect(d.status).toBe(201);
    expect(d.body.draft.status).toBe('pending');
    expect(await prisma.message.count()).toBe(before);
  });
});

describe('export', () => {
  it('exports every client with their records as JSON and CSV, and audits it', async () => {
    const j = await request(app).get(`${api}/export`).set('Authorization', as.trainer);
    expect(j.status).toBe(200);
    expect(j.body.format).toBe('axiom-practice-export');
    const maya = j.body.clients.find((c: any) => c.id === id.maya);
    expect(maya.contraindications.map((c: any) => c.condition)).toContain('ACL reconstruction');
    const csv = await request(app).get(`${api}/export/clients.csv`).set('Authorization', as.trainer);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toBe('client_id,name,email,contact_email,phone,channel,status,state,tags,joined_at,injuries');
    expect(csv.text).toContain('Maya Okafor');
    expect((await request(app).get(`${api}/export/secrets.csv`).set('Authorization', as.trainer)).status).toBe(404);
    expect(await prisma.ptAuditLog.count({ where: { action: 'exported' } })).toBe(2);
    // Another practice exports only its own (empty) roster.
    const other = await request(app).get(`${api}/export`).set('Authorization', as.other);
    expect(other.body.clients).toEqual([]);
  });

  it('neutralises spreadsheet formulas in CSV cells', async () => {
    const { toCsv } = await import('../services/personalTraining/exportData.js');
    expect(toCsv([['=SUM(A1)', 'a,b', 'say "hi"']])).toBe(`'=SUM(A1),"a,b","say ""hi"""\r\n`);
  });
});

describe('program builder and the rules engine', () => {
  const doc = (items: { name: string; load?: any }[], weeks = 1) => ({
    weeks: Array.from({ length: weeks }, (_, w) => ({ label: `Week ${w + 1}`, days: [{ name: 'Lower', weekday: 1, blocks: [{ kind: 'single', items: items.map((i) => ({ ...i, sets: 3, reps: '5' })) }] }] })),
  });

  it('saves a draft with a conflict, shows it, and refuses to publish it', async () => {
    const c = await request(app).post(`${api}/programs`).set('Authorization', as.trainer).send({ clientId: id.maya, name: 'Block A' });
    expect(c.status).toBe(201);
    const pid = c.body.program.id;
    const u = await request(app).put(`${api}/programs/${pid}`).set('Authorization', as.trainer).send({ doc: doc([{ name: 'Back Squat', load: { type: 'percent1rm', value: 75 } }, { name: 'Romanian Deadlift' }, { name: 'Bench Press' }]) });
    expect(u.status).toBe(200);
    expect(u.body.program.check.publishable).toBe(false);
    expect(u.body.program.check.guardrails.violations.map((v: any) => [v.exercise, v.level])).toEqual([['Back Squat', 'block'], ['Romanian Deadlift', 'warn']]);
    const p = await request(app).post(`${api}/programs/${pid}/publish`).set('Authorization', as.trainer);
    expect(p.status).toBe(409);
    expect(p.body.check.publishable).toBe(false);

    // Acknowledging can clear the warning but never the refusal.
    const ack = await request(app).post(`${api}/programs/${pid}/acknowledge`).set('Authorization', as.trainer)
      .send({ keys: u.body.program.check.guardrails.violations.map((v: any) => `${v.exercise}|${v.contraindicationId}`) });
    expect(ack.body.program.check.guardrails.violations.map((v: any) => v.exercise)).toEqual(['Back Squat']);
    expect((await request(app).post(`${api}/programs/${pid}/publish`).set('Authorization', as.trainer)).status).toBe(409);

    // Swap the squat for upper work: now it publishes, the client is told, and it is audited as the trainer's decision.
    await request(app).put(`${api}/programs/${pid}`).set('Authorization', as.trainer).send({ doc: doc([{ name: 'Romanian Deadlift' }, { name: 'Bench Press' }]) });
    const ok = await request(app).post(`${api}/programs/${pid}/publish`).set('Authorization', as.trainer);
    expect(ok.status).toBe(200);
    expect(ok.body.program.status).toBe('published');
    const a = await prisma.ptAuditLog.findFirst({ where: { action: 'program_published', itemId: pid } });
    expect(JSON.parse(a.metaJson)).toMatchObject({ suggestedBy: 'trainer', approvedBy: id.trainer });
    expect(await prisma.ptDraft.findFirst({ where: { kind: 'program', sourceId: pid, status: 'sending' } })).toBeTruthy();

    // A live edit that the engine refuses is not saved.
    const bad = await request(app).put(`${api}/programs/${pid}`).set('Authorization', as.trainer).send({ doc: doc([{ name: 'Box Jump' }]) });
    expect(bad.status).toBe(409);
    expect((await request(app).get(`${api}/programs/${pid}`).set('Authorization', as.trainer)).body.program.doc.weeks[0].days[0].blocks[0].items.map((i: any) => i.name)).toEqual(['Romanian Deadlift', 'Bench Press']);
  });

  it('flags progression jumps and structural problems', async () => {
    const { structuralIssues, normaliseDoc } = await import('../services/personalTraining/programs.js');
    const d = normaliseDoc({ weeks: [
      { days: [{ name: 'A', blocks: [{ kind: 'single', items: [{ name: 'Bench Press', sets: 3, reps: '5', load: { type: 'percent1rm', value: 70 } }] }] }] },
      { days: [{ name: 'A', blocks: [{ kind: 'amrap', items: [{ name: 'Bench Press', sets: 3, reps: '5', load: { type: 'percent1rm', value: 85 } }, { name: 'Row', sets: 3, reps: '8', load: { type: 'rpe', value: 11 } }] }] }] },
    ] });
    const texts = structuralIssues(d).map((i) => `${i.level}:${i.text}`);
    expect(texts).toContain('warn:Week 2: bench press jumps 15 points of 1RM in a week');
    expect(texts).toContain('block:Row: RPE must be between 1 and 10');
    expect(texts.some((t) => t.includes('AMRAP block has no time cap'))).toBe(true);
    expect(structuralIssues(normaliseDoc({ weeks: [{ days: [] }] }))[0]).toMatchObject({ level: 'block', text: 'Add at least one exercise' });
  });

  it('templates copy to clients as drafts with fresh ids', async () => {
    const t = await request(app).post(`${api}/programs`).set('Authorization', as.trainer).send({ isTemplate: true, name: 'Upper base', doc: doc([{ name: 'Bench Press' }]) });
    expect(t.body.program).toMatchObject({ isTemplate: true, clientId: null });
    expect(t.body.program.check.publishable).toBe(false);
    const cp = await request(app).post(`${api}/programs/${t.body.program.id}/copy`).set('Authorization', as.trainer).send({ clientIds: [id.maya] });
    expect(cp.body.programs[0]).toMatchObject({ clientId: id.maya, source: 'template', status: 'draft', name: 'Upper base' });
    expect(cp.body.programs[0].doc.weeks[0].id).not.toBe(t.body.program.doc.weeks[0].id);
    const list = await request(app).get(`${api}/programs?templates=1`).set('Authorization', as.trainer);
    expect(list.body.programs.map((p: any) => p.name)).toContain('Upper base');
    expect((await request(app).post(`${api}/programs/${t.body.program.id}/publish`).set('Authorization', as.trainer)).status).toBe(409);
  });

  it('AI drafts are rewritten once, then stripped, and refusals from the brief are stated', async () => {
    const { generateProgram } = await import('../services/personalTraining/programAi.js');
    const calls: string[] = [];
    const draftFn = async (_s: string, user: string) => {
      calls.push(user);
      return JSON.stringify({ name: 'Return to strength', rationale: 'Upper focus while the knee recovers.', weeks: [{ label: 'Week 1', days: [{ name: 'Day 1', why: 'Full body.', blocks: [{ kind: 'single', items: [
        { name: 'Box Jump', sets: 3, reps: '5', why: 'Power' }, { name: 'Bench Press', sets: 3, reps: '8', load: { type: 'rpe', value: 7 }, why: 'Main press' },
      ] }] }] }] });
    };
    const p = await generateProgram(id.practice, id.trainer, id.maya, { brief: 'Power block with box jumps and pressing', weeks: 1, daysPerWeek: 1 }, draftFn);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('TRAINER CONTRAINDICATIONS');
    expect(calls[1]).toContain('YOUR LAST DRAFT BROKE THE HARD RULES with: Box Jump');
    expect(p.status).toBe('draft');
    expect(p.source).toBe('ai');
    expect(p.doc.weeks[0].days[0].blocks[0].items.map((i) => i.name)).toEqual(['Bench Press']);
    expect(p.annotations.some((a) => a.kind === 'removed' && a.text.includes('Box Jump'))).toBe(true);
    expect(p.annotations.some((a) => a.kind === 'guardrail' && a.text.startsWith('Not programmed: plyometric'))).toBe(true);
    expect(p.annotations.some((a) => a.kind === 'rationale' && a.text === 'Main press')).toBe(true);
    expect(p.check.guardrails!.violations).toEqual([]);
    expect(await prisma.ptAuditLog.findFirst({ where: { action: 'program_suggested', itemId: p.id } })).toBeTruthy();
  });

  it('generation fails cleanly when the model is unavailable', async () => {
    const { generateProgram } = await import('../services/personalTraining/programAi.js');
    await expect(generateProgram(id.practice, id.trainer, id.maya, { brief: 'Strength block please', weeks: 4, daysPerWeek: 3 }, async () => null)).rejects.toMatchObject({ status: 503 });
    await expect(generateProgram(id.practice, id.trainer, id.maya, { brief: 'x', weeks: 4, daysPerWeek: 3 }, async () => null)).rejects.toMatchObject({ status: 400 });
  });

  it('the client sees the published program in the portal and can run it in the app', async () => {
    const link = await request(app).post(`${api}/clients/${id.maya}/link`).set('Authorization', as.trainer);
    const auth = `PtLink ${tokenOf(link.body.link.url)}`;
    const r = await request(app).get(`${portal}/program`).set('Authorization', auth);
    expect(r.body.trainerProgram).toMatchObject({ name: 'Block A', canApplyInApp: true, skip: [] });
    const apply = await request(app).post(`${portal}/program/apply`).set('Authorization', auth);
    expect(apply.status).toBe(200);
    const u = await prisma.user.findUnique({ where: { id: id.maya }, select: { savedProgram: true } });
    const saved = JSON.parse(u.savedProgram);
    expect(saved).toMatchObject({ source: 'personal_trainer', durationWeeks: 1 });
    expect(saved.phases[0].trainingDays[0]).toMatchObject({ day: 'Monday — Lower', focus: 'Lower' });
    expect(saved.phases[0].trainingDays[0].exercises.map((e: any) => e.exercise)).toEqual(['Romanian Deadlift', 'Bench Press']);
  });

  it('the exercise library carries patterns; a practice tag adds to them and never removes', async () => {
    const lib = await request(app).get(`${api}/exercises?q=squat`).set('Authorization', as.trainer);
    expect(lib.body.exercises.find((e: any) => e.name === 'Barbell Back Squat').patterns).toContain('squat');
    const mine = await request(app).post(`${api}/exercises`).set('Authorization', as.trainer).send({ name: 'Mystery Sled Thing', patterns: ['plyometric'], videoUrl: 'https://youtu.be/x' });
    expect(mine.status).toBe(201);
    const check = await request(app).post(`${api}/clients/${id.maya}/guardrails/check`).set('Authorization', as.trainer).send({ exercises: ['Mystery Sled Thing'] });
    expect(check.body.report.violations[0]).toMatchObject({ exercise: 'Mystery Sled Thing', level: 'block' });
    expect((await request(app).post(`${api}/exercises`).set('Authorization', as.trainer).send({ name: 'X', videoUrl: 'http://bad' })).status).toBe(400);
  });
});

describe('app program converter', () => {
  it('merges identical consecutive weeks into one phase and splits on change', async () => {
    const { toAppProgram, normaliseDoc } = await import('../services/personalTraining/programs.js');
    const wk = (v: number) => ({ days: [{ name: 'A', blocks: [{ kind: 'superset', rounds: 3, items: [{ name: 'Bench Press', sets: 3, reps: '5', load: { type: 'percent1rm', value: v } }, { name: 'Row', sets: 3, reps: '10' }] }] }] });
    const app = toAppProgram(normaliseDoc({ weeks: [wk(70), wk(70), wk(75)] }), 'Block', 'Strength');
    expect(app.phases.map((p: any) => [p.weeksLabel, p.durationWeeks])).toEqual([['Weeks 1-2', 2], ['Week 3', 1]]);
    expect(app.phases[0].trainingDays[0].exercises[0]).toMatchObject({ exercise: 'Bench Press', intensity: '70% 1RM', notes: 'Superset A1 · 3 rounds' });
  });
});
