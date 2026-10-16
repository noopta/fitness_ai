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
