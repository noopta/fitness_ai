// Personal-training routes — the access rules matter more than the shapes
// here: the flag gate, the practice gate, and that a trainer can only read
// an active client of the practice they run. Prisma is mocked; auth is a
// real JWT (requireAuth is stateless).

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_at_least_32_chars_long!!';
process.env.PERSONAL_TRAINING_USERS = 'trainer@axiom.io';
process.env.FRONTEND_URL = 'https://axiomtraining.io';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  institution: { create: vi.fn() },
  institutionMember: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  institutionInvite: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  workoutLog: { findMany: vi.fn(), groupBy: vi.fn() },
  nutritionLog: { findMany: vi.fn() },
  wellnessCheckin: { findMany: vi.fn(), groupBy: vi.fn() },
  bodyWeightLog: { findMany: vi.fn() },
  adaptationProposal: { findMany: vi.fn() },
  directConversation: { findUnique: vi.fn() },
  message: { findMany: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) { Object.assign(this, mocks); });
  return { PrismaClient };
});
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn() }));

const TRAINER = 't-1';
const sign = (id: string, email: string) => jwt.sign({ id, email, tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
const trainerToken = sign(TRAINER, 'trainer@axiom.io');
const strangerToken = sign('u-9', 'someone@example.com');
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const PRACTICE = { id: 'p-1', name: 'Kofi Coaching', slug: 'pt-kofi-abc123', logoUrl: null };
const clientUser = {
  id: 'c-1', name: 'Maya Okafor', email: 'maya@example.com', savedProgram: null, programStartDate: null,
  coachGoal: null, coachProfile: null, constraintsText: null,
};

let app: express.Express;
beforeAll(async () => {
  const { default: routes } = await import('../routes/personalTraining.js');
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/personal-training', routes);
});

beforeEach(() => {
  for (const model of Object.values(mocks)) {
    if (typeof model === 'function') { (model as any).mockReset(); continue; }
    for (const fn of Object.values(model)) (fn as any).mockReset();
  }
  mocks.user.update.mockResolvedValue({});
  mocks.institutionMember.findFirst.mockResolvedValue({ institution: PRACTICE });
  mocks.institutionMember.findMany.mockResolvedValue([{ joinedAt: new Date(Date.now() - 60 * 86_400_000), user: clientUser }]);
  mocks.workoutLog.findMany.mockResolvedValue([]);
  mocks.workoutLog.groupBy.mockResolvedValue([{ userId: 'c-1', _max: { createdAt: new Date() } }]);
  mocks.nutritionLog.findMany.mockResolvedValue([]);
  mocks.wellnessCheckin.findMany.mockResolvedValue([]);
  mocks.wellnessCheckin.groupBy.mockResolvedValue([]);
  mocks.bodyWeightLog.findMany.mockResolvedValue([]);
  mocks.adaptationProposal.findMany.mockResolvedValue([]);
  mocks.directConversation.findUnique.mockResolvedValue(null);
});

describe('gates', () => {
  it('requires a session', async () => {
    expect((await request(app).get('/api/personal-training/clients')).status).toBe(401);
  });

  it('does not exist for an account that is not a flagged trainer', async () => {
    for (const path of ['/me', '/clients', '/clients/c-1', '/clients/c-1/timeline']) {
      const r = await request(app).get(`/api/personal-training${path}`).set(auth(strangerToken));
      expect(r.status).toBe(404);
    }
    const post = await request(app).post('/api/personal-training/practice').set(auth(strangerToken)).send({ name: 'Sneaky' });
    expect(post.status).toBe(404);
    expect(mocks.institution.create).not.toHaveBeenCalled();
  });

  it('asks a flagged trainer with no practice to set one up', async () => {
    mocks.institutionMember.findFirst.mockResolvedValue(null);
    const r = await request(app).get('/api/personal-training/clients').set(auth(trainerToken));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('no_practice');
  });

  it('only resolves a practice where the user is an active coach', async () => {
    await request(app).get('/api/personal-training/clients').set(auth(trainerToken));
    expect(mocks.institutionMember.findFirst.mock.calls[0][0].where).toMatchObject({
      userId: TRAINER, role: 'coach', active: true, institution: { active: true },
    });
  });
});

describe('GET /me and POST /practice', () => {
  it('returns the trainer and a null practice before setup', async () => {
    mocks.institutionMember.findFirst.mockResolvedValue(null);
    mocks.user.findUnique.mockResolvedValue({ id: TRAINER, name: 'Kofi Mensah', email: 'trainer@axiom.io' });
    const r = await request(app).get('/api/personal-training/me').set(auth(trainerToken));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ trainer: { id: TRAINER, name: 'Kofi Mensah', initials: 'KM' }, practice: null });
  });

  it('creates a practice with the trainer as its coach', async () => {
    mocks.institutionMember.findFirst.mockResolvedValue(null);
    mocks.institution.create.mockImplementation(async ({ data }: any) => ({ id: 'p-2', name: data.name, slug: data.slug, logoUrl: null }));
    const r = await request(app).post('/api/personal-training/practice').set(auth(trainerToken)).send({ name: '  Kofi Mensah Coaching ' });
    expect(r.status).toBe(201);
    const { data } = mocks.institution.create.mock.calls[0][0];
    expect(data.name).toBe('Kofi Mensah Coaching');
    expect(data.slug).toMatch(/^pt-kofi-mensah-coaching-[0-9a-f]{6}$/);
    expect(data.members.create).toEqual({ userId: TRAINER, role: 'coach', active: true });
  });

  it('returns the existing practice instead of making a second', async () => {
    const r = await request(app).post('/api/personal-training/practice').set(auth(trainerToken)).send({ name: 'Another' });
    expect(r.status).toBe(200);
    expect(r.body.practice).toEqual(PRACTICE);
    expect(mocks.institution.create).not.toHaveBeenCalled();
  });

  it('validates the name', async () => {
    mocks.institutionMember.findFirst.mockResolvedValue(null);
    for (const name of ['', 'x', 'y'.repeat(81), 42]) {
      const r = await request(app).post('/api/personal-training/practice').set(auth(trainerToken)).send({ name });
      expect(r.status).toBe(400);
    }
  });
});

describe('GET /clients', () => {
  it('lists active clients of the trainer’s practice with counts', async () => {
    const r = await request(app).get('/api/personal-training/clients').set(auth(trainerToken));
    expect(r.status).toBe(200);
    expect(mocks.institutionMember.findMany.mock.calls[0][0].where).toEqual({ institutionId: 'p-1', role: 'athlete', active: true });
    expect(r.body.counts).toEqual({ all: 1, support: 0, new: 0, onPlan: 1, paused: 0 });
    expect(r.body.clients[0]).toMatchObject({ id: 'c-1', name: 'Maya Okafor', initials: 'MO', status: 'onPlan', channel: 'app', program: null });
    expect(r.body.clients[0].engagement8w).toHaveLength(8);
  });

  it('never selects avatars or credentials for the roster', async () => {
    await request(app).get('/api/personal-training/clients').set(auth(trainerToken));
    const select = mocks.institutionMember.findMany.mock.calls[0][0].select.user.select;
    expect(Object.keys(select).sort()).toEqual(
      ['coachGoal', 'coachProfile', 'constraintsText', 'email', 'id', 'name', 'programStartDate', 'savedProgram'],
    );
  });

  it('keeps counts for the whole roster when a status chip narrows the rows', async () => {
    const r = await request(app).get('/api/personal-training/clients?status=support').set(auth(trainerToken));
    expect(r.body.clients).toEqual([]);
    expect(r.body.counts.all).toBe(1);
  });

  it('filters by search text', async () => {
    const hit = await request(app).get('/api/personal-training/clients?q=MAYA').set(auth(trainerToken));
    const miss = await request(app).get('/api/personal-training/clients?q=jordan').set(auth(trainerToken));
    expect(hit.body.clients).toHaveLength(1);
    expect(miss.body).toMatchObject({ clients: [], counts: { all: 0 } });
  });

  it('returns an empty roster without querying activity', async () => {
    mocks.institutionMember.findMany.mockResolvedValue([]);
    const r = await request(app).get('/api/personal-training/clients').set(auth(trainerToken));
    expect(r.body).toEqual({ clients: [], counts: { all: 0, support: 0, new: 0, onPlan: 0, paused: 0 } });
    expect(mocks.workoutLog.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /clients/:id', () => {
  it('scopes the lookup to the practice and 404s for anyone else', async () => {
    mocks.institutionMember.findMany.mockResolvedValue([]);
    const r = await request(app).get('/api/personal-training/clients/u-other').set(auth(trainerToken));
    expect(r.status).toBe(404);
    expect(mocks.institutionMember.findMany.mock.calls[0][0].where).toEqual({
      institutionId: 'p-1', role: 'athlete', active: true, userId: { in: ['u-other'] },
    });
  });

  it('returns the client', async () => {
    const r = await request(app).get('/api/personal-training/clients/c-1').set(auth(trainerToken));
    expect(r.status).toBe(200);
    expect(r.body.client.id).toBe('c-1');
  });
});

describe('GET /clients/:id/timeline', () => {
  const member = { active: true, role: 'athlete', user: { name: 'Maya Okafor', email: 'maya@example.com' } };

  it('reads nothing about a user who is not an active client of this practice', async () => {
    for (const m of [null, { ...member, active: false }, { ...member, role: 'coach' }]) {
      mocks.institutionMember.findUnique.mockResolvedValue(m);
      mocks.workoutLog.findMany.mockClear();
      const r = await request(app).get('/api/personal-training/clients/c-1/timeline').set(auth(trainerToken));
      expect(r.status).toBe(404);
      expect(mocks.workoutLog.findMany).not.toHaveBeenCalled();
      expect(mocks.message.findMany).not.toHaveBeenCalled();
    }
    expect(mocks.institutionMember.findUnique.mock.calls[0][0].where).toEqual({
      institutionId_userId: { institutionId: 'p-1', userId: 'c-1' },
    });
  });

  it('merges sources newest first in the trainer’s unit', async () => {
    mocks.institutionMember.findUnique.mockResolvedValue(member);
    mocks.user.findUnique.mockResolvedValue({ unitPreference: 'metric' });
    mocks.workoutLog.findMany.mockResolvedValue([
      { id: 'w1', createdAt: new Date('2026-09-28T10:00:00Z'), title: 'Lower', exercises: JSON.stringify([{ name: 'Back squat', sets: 3, reps: '5', weightKg: 100 }]), notes: null, duration: 50 },
      { id: 'w2', createdAt: new Date('2026-10-01T10:00:00Z'), title: 'Lower', exercises: JSON.stringify([{ name: 'Back squat', sets: 3, reps: '5', weightKg: 105 }]), notes: null, duration: 50 },
    ]);
    mocks.wellnessCheckin.findMany.mockResolvedValue([
      { id: 'k1', createdAt: new Date('2026-09-30T08:00:00Z'), mood: 3, energy: 2, sleepHours: 6, stress: 3 },
    ]);
    mocks.bodyWeightLog.findMany.mockResolvedValue([
      { id: 'b1', createdAt: new Date('2026-09-29T08:00:00Z'), weightKg: null, weightLbs: 180, notes: null },
    ]);
    mocks.directConversation.findUnique.mockResolvedValue({ id: 'conv' });
    mocks.message.findMany.mockResolvedValue([{ id: 'm1', createdAt: new Date('2026-10-02T09:00:00Z'), senderId: 'c-1', body: 'Knee is sore' }]);
    mocks.message.findFirst.mockResolvedValue({ id: 'm1' });

    const r = await request(app).get('/api/personal-training/clients/c-1/timeline').set(auth(trainerToken));
    expect(r.status).toBe(200);
    expect(r.body.nextCursor).toBeNull();
    expect(r.body.events.map((e: any) => e.id)).toEqual(['message:m1', 'workout:w2', 'checkin:k1', 'measurement:b1', 'workout:w1']);
    expect(r.body.events[0].flag).toEqual({ label: 'Unanswered', tone: 'zinc' });
    expect(r.body.events[1]).toMatchObject({ body: 'Back squat 3×5 at 105 kg\n50 min', flag: { label: 'PR · Back squat', tone: 'green' } });
    expect(r.body.events[3].body).toBe('81.6 kg');
    // Only the thread between this trainer and this client is read.
    expect(mocks.directConversation.findUnique.mock.calls[0][0].where).toEqual({
      participantAId_participantBId: { participantAId: 'c-1', participantBId: TRAINER },
    });
  });

  it('only queries the kinds asked for', async () => {
    mocks.institutionMember.findUnique.mockResolvedValue(member);
    mocks.user.findUnique.mockResolvedValue({ unitPreference: 'imperial' });
    await request(app).get('/api/personal-training/clients/c-1/timeline?kind=checkin').set(auth(trainerToken));
    expect(mocks.wellnessCheckin.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.workoutLog.findMany).not.toHaveBeenCalled();
    expect(mocks.directConversation.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /clients/invite', () => {
  beforeEach(() => {
    mocks.institutionInvite.create.mockImplementation(async ({ data }: any) => ({ ...data, token: 'tok-1' }));
  });

  it('mints a client invite bound to the practice and the email', async () => {
    const r = await request(app).post('/api/personal-training/clients/invite').set(auth(trainerToken)).send({ mode: 'app', email: ' Dami@Example.com ' });
    expect(r.status).toBe(201);
    expect(r.body.link).toBe('https://axiomtraining.io/personal-training/join/tok-1');
    expect(mocks.institutionInvite.create.mock.calls[0][0].data).toMatchObject({
      institutionId: 'p-1', invitedByUserId: TRAINER, email: 'dami@example.com', role: 'athlete',
    });
  });

  it('cannot be talked into minting a coach invite', async () => {
    await request(app).post('/api/personal-training/clients/invite').set(auth(trainerToken)).send({ role: 'coach' });
    expect(mocks.institutionInvite.create.mock.calls[0][0].data.role).toBe('athlete');
  });

  it('rejects the no-install link mode and bad emails', async () => {
    const link = await request(app).post('/api/personal-training/clients/invite').set(auth(trainerToken)).send({ mode: 'link' });
    expect(link.status).toBe(400);
    expect(link.body.code).toBe('mode_unavailable');
    const bad = await request(app).post('/api/personal-training/clients/invite').set(auth(trainerToken)).send({ email: 'not-an-email' });
    expect(bad.status).toBe(400);
    expect(mocks.institutionInvite.create).not.toHaveBeenCalled();
  });
});

describe('invites — client side', () => {
  const invite = {
    id: 'i-1', token: 'tok-1', institutionId: 'p-1', invitedByUserId: TRAINER, email: null, role: 'athlete',
    usedAt: null, expiresAt: new Date(Date.now() + 86_400_000), institution: PRACTICE,
  };
  const clientToken = sign('c-7', 'dami@example.com');

  it('previews the practice and trainer name without the trainer flag', async () => {
    mocks.institutionInvite.findUnique.mockResolvedValue(invite);
    mocks.user.findUnique.mockResolvedValue({ name: 'Kofi Mensah' });
    const r = await request(app).get('/api/personal-training/invites/tok-1').set(auth(clientToken));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ practice: PRACTICE, trainerName: 'Kofi Mensah', email: null });
  });

  it('rejects used, expired and non-client invites', async () => {
    for (const [over, status] of [
      [{ usedAt: new Date() }, 400], [{ expiresAt: new Date(Date.now() - 1000) }, 400], [{ role: 'coach' }, 404],
    ] as const) {
      mocks.institutionInvite.findUnique.mockResolvedValue({ ...invite, ...over });
      const r = await request(app).post('/api/personal-training/invites/tok-1/accept').set(auth(clientToken));
      expect(r.status).toBe(status);
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('joins the practice as a client', async () => {
    mocks.institutionInvite.findUnique.mockResolvedValue(invite);
    mocks.$transaction.mockImplementation(async (fn: any) => fn(mocks));
    mocks.institutionMember.findUnique.mockResolvedValue(null);
    mocks.institutionMember.upsert.mockResolvedValue({ id: 'm-1' });
    mocks.institutionInvite.update.mockResolvedValue({});
    const r = await request(app).post('/api/personal-training/invites/tok-1/accept').set(auth(clientToken));
    expect(r.status).toBe(200);
    expect(r.body.practice).toEqual(PRACTICE);
    expect(mocks.institutionMember.upsert.mock.calls[0][0].create).toEqual({ institutionId: 'p-1', userId: 'c-7', role: 'athlete', active: true });
  });

  it('enforces the email an invite was issued to', async () => {
    mocks.institutionInvite.findUnique.mockResolvedValue({ ...invite, email: 'someone-else@example.com' });
    mocks.$transaction.mockImplementation(async (fn: any) => fn(mocks));
    mocks.user.findUnique.mockResolvedValue({ email: 'dami@example.com' });
    const r = await request(app).post('/api/personal-training/invites/tok-1/accept').set(auth(clientToken));
    expect(r.status).toBe(403);
    expect(mocks.institutionMember.upsert).not.toHaveBeenCalled();
  });

  it('will not let the trainer demote themselves by opening their own invite', async () => {
    mocks.institutionInvite.findUnique.mockResolvedValue(invite);
    mocks.$transaction.mockImplementation(async (fn: any) => fn(mocks));
    mocks.institutionMember.findUnique.mockResolvedValue({ active: true, role: 'coach' });
    const r = await request(app).post('/api/personal-training/invites/tok-1/accept').set(auth(trainerToken));
    expect(r.status).toBe(400);
    expect(mocks.institutionMember.upsert).not.toHaveBeenCalled();
  });
});
