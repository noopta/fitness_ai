// Train Together routes — consent enforcement, overlap finder, pin lifecycle.
// Prisma + push notifications are mocked; auth is a real JWT (requireAuth is
// stateless).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_at_least_32_chars_long!!';

// ─── Prisma mock ──────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  friendship: { findMany: vi.fn() },
  scheduleOverride: { findMany: vi.fn() },
  partnerWorkout: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  partnerWorkoutMember: { update: vi.fn() },
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) { Object.assign(this, mocks); });
  return { PrismaClient };
});

const mockSendPushToUser = vi.fn();
const mockSendPushToUsers = vi.fn();
vi.mock('../services/notificationService.js', () => ({
  sendPushToUser: mockSendPushToUser,
  sendPushToUsers: mockSendPushToUsers,
}));

const ME = 'u-1';
const FRIEND = 'u-2';
const token = jwt.sign({ id: ME, email: 'me@axiom.io', tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

const PPL = JSON.stringify({
  phases: [{ durationWeeks: 12, trainingDays: [
    { day: 'Day 1', focus: 'Push' }, { day: 'Day 2', focus: 'Pull' }, { day: 'Day 3', focus: 'Legs' },
  ]}],
});

async function buildApp() {
  const { default: routes } = await import('../routes/trainTogether.js');
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

function wireFriendship() {
  mocks.friendship.findMany.mockResolvedValue([{ requesterId: ME, addresseeId: FRIEND }]);
}

// user.findUnique dispatch: overlap "me" lookup selects scheduleSharing;
// loadUserCalendar selects programStartDate; name lookups select name.
function wireUsers(opts: {
  meSharing?: boolean; mePremium?: never; meProgram?: string | null;
  friendSharing?: boolean; friendProgram?: string | null;
} = {}) {
  const { meSharing = true, meProgram = PPL, friendSharing = true, friendProgram = PPL } = opts;
  const start = new Date(); // program week 1 starts today for both
  mocks.user.findUnique.mockImplementation(async ({ where, select }: any) => {
    if (select?.scheduleSharing && select?.name) {
      return { scheduleSharing: meSharing, savedProgram: meProgram, splitLabel: 'PPL', name: 'Me', username: 'me' };
    }
    if (select?.scheduleSharing) return { scheduleSharing: meSharing };
    if (select?.programStartDate) {
      const program = where.id === ME ? meProgram : friendProgram;
      return { savedProgram: program, programStartDate: start };
    }
    return { name: where.id === ME ? 'Me' : 'Alex', username: null };
  });
  mocks.user.findMany.mockResolvedValue([
    { id: FRIEND, name: 'Alex', username: 'alex', avatarBase64: null,
      scheduleSharing: friendSharing, savedProgram: friendProgram, splitLabel: 'PPL' },
  ]);
  mocks.scheduleOverride.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  for (const model of Object.values(mocks)) {
    for (const fn of Object.values(model)) (fn as any).mockReset?.();
  }
  mockSendPushToUser.mockReset();
  mockSendPushToUser.mockResolvedValue(undefined);
  mockSendPushToUsers.mockReset();
  mockSendPushToUsers.mockResolvedValue(undefined);
  mocks.user.update.mockResolvedValue({});
  mocks.partnerWorkout.findMany.mockResolvedValue([]);
});

describe('consent', () => {
  it('PUT /train-together/sharing persists the flag', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/train-together/sharing')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(mocks.user.update).toHaveBeenCalledWith({ where: { id: ME }, data: { scheduleSharing: true } });
  });

  it('requires auth', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/train-together/friends');
    expect(res.status).toBe(401);
  });
});

describe('GET /train-together/friends', () => {
  it('annotates friends with selectability and reasons', async () => {
    wireFriendship();
    mocks.user.findMany.mockResolvedValue([
      { id: FRIEND, name: 'Alex', username: 'alex', avatarBase64: null, scheduleSharing: false, savedProgram: PPL, splitLabel: 'PPL' },
    ]);
    const app = await buildApp();
    const res = await request(app).get('/api/train-together/friends').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: FRIEND, sharing: false, hasProgram: true, selectable: false });
  });
});

describe('GET /train-together/overlap', () => {
  it('403 with sharing_off when the requester has not opted in', async () => {
    wireFriendship();
    wireUsers({ meSharing: false });
    const app = await buildApp();
    const res = await request(app)
      .get(`/api/train-together/overlap?friendIds=${FRIEND}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('sharing_off');
  });

  it('403 with per-friend reasons when a friend is not sharing', async () => {
    wireFriendship();
    wireUsers({ friendSharing: false });
    const app = await buildApp();
    const res = await request(app)
      .get(`/api/train-together/overlap?friendIds=${FRIEND}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.blocked).toEqual([{ id: FRIEND, name: 'Alex', reason: 'not_sharing' }]);
  });

  it('403 when the target is not an accepted friend', async () => {
    mocks.friendship.findMany.mockResolvedValue([]);
    wireUsers();
    const app = await buildApp();
    const res = await request(app)
      .get('/api/train-together/overlap?friendIds=u-stranger')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns tiered days for identical programs started the same day', async () => {
    wireFriendship();
    wireUsers();
    const app = await buildApp();
    const res = await request(app)
      .get(`/api/train-together/overlap?friendIds=${FRIEND}&weeks=1`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.dates).toHaveLength(7);
    expect(res.body.participants).toHaveLength(2);
    expect(res.body.participants[0]).toMatchObject({ isMe: true, splitLabel: 'PPL' });
    // Same PPL, same start date: days 1-3 exact, later days rest/rest = none.
    expect(res.body.days[0]).toMatchObject({ date: res.body.dates[0], tier: 'exact' });
    expect(res.body.days[0].sessions).toHaveLength(2);
    expect(res.body.days[6].tier).toBe('none');
  });
});

describe('pins', () => {
  it('creates a pin with the current tier and notifies invitees', async () => {
    wireFriendship();
    wireUsers();
    mocks.partnerWorkout.create.mockResolvedValue({ id: 'pin1', members: [] });
    const app = await buildApp();
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const res = await request(app)
      .post('/api/train-together/pins')
      .set('Authorization', `Bearer ${token}`)
      .send({ date, memberIds: [FRIEND], note: '6pm' });
    expect(res.status).toBe(201);
    const createArg = mocks.partnerWorkout.create.mock.calls[0][0];
    expect(createArg.data.pinnedTier).toBe('exact'); // both on Push today
    expect(createArg.data.members.create).toEqual([
      { userId: ME, response: 'accepted' },
      { userId: FRIEND, response: 'pending' },
    ]);
    expect(mockSendPushToUsers).toHaveBeenCalledWith(
      [FRIEND], 'Train together?', expect.stringContaining('Me'), expect.anything(),
    );
  });

  it('rejects pinning with a non-friend', async () => {
    mocks.friendship.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const res = await request(app)
      .post('/api/train-together/pins')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2099-01-08', memberIds: ['u-stranger'] });
    expect(res.status).toBe(403);
  });

  it('accepting as the last pending member confirms the pin', async () => {
    wireUsers();
    mocks.partnerWorkout.findUnique.mockResolvedValue({
      id: 'pin1', date: '2099-01-08', status: 'pending', creatorId: FRIEND,
      members: [
        { id: 'm1', userId: FRIEND, response: 'accepted' },
        { id: 'm2', userId: ME, response: 'pending' },
      ],
    });
    mocks.partnerWorkoutMember.update.mockResolvedValue({});
    mocks.partnerWorkout.update.mockResolvedValue({});
    const app = await buildApp();
    const res = await request(app)
      .post('/api/train-together/pins/pin1/respond')
      .set('Authorization', `Bearer ${token}`)
      .send({ response: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    expect(mocks.partnerWorkout.update).toHaveBeenCalledWith({ where: { id: 'pin1' }, data: { status: 'confirmed' } });
    expect(mockSendPushToUsers).toHaveBeenCalled(); // "X is in" to the others
  });

  it('a group-pin acceptance that does not yet confirm still notifies the host', async () => {
    wireUsers();
    mocks.partnerWorkout.findUnique.mockResolvedValue({
      id: 'pin1', date: '2099-01-08', status: 'pending', creatorId: FRIEND,
      members: [
        { id: 'm1', userId: FRIEND, response: 'accepted' },
        { id: 'm2', userId: ME, response: 'pending' },
        { id: 'm3', userId: 'u-3', response: 'pending' }, // still outstanding
      ],
    });
    mocks.partnerWorkoutMember.update.mockResolvedValue({});
    const app = await buildApp();
    const res = await request(app)
      .post('/api/train-together/pins/pin1/respond')
      .set('Authorization', `Bearer ${token}`)
      .send({ response: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending'); // u-3 hasn't answered
    expect(mocks.partnerWorkout.update).not.toHaveBeenCalled();
    expect(mockSendPushToUser).toHaveBeenCalledWith(
      FRIEND, expect.any(String), expect.stringContaining('waiting on 1 more'), expect.anything(),
    );
  });

  it('the only invitee declining cancels the pin and tells the creator', async () => {
    wireUsers();
    mocks.partnerWorkout.findUnique.mockResolvedValue({
      id: 'pin1', date: '2099-01-08', status: 'pending', creatorId: FRIEND,
      members: [
        { id: 'm1', userId: FRIEND, response: 'accepted' },
        { id: 'm2', userId: ME, response: 'pending' },
      ],
    });
    mocks.partnerWorkoutMember.update.mockResolvedValue({});
    mocks.partnerWorkout.update.mockResolvedValue({});
    const app = await buildApp();
    const res = await request(app)
      .post('/api/train-together/pins/pin1/respond')
      .set('Authorization', `Bearer ${token}`)
      .send({ response: 'declined' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(mockSendPushToUser).toHaveBeenCalledWith(
      FRIEND, expect.any(String), expect.stringContaining("can't make"), expect.anything(),
    );
  });

  it('DELETE by the creator cancels; by a member just leaves', async () => {
    wireUsers();
    const pin = {
      id: 'pin1', date: '2099-01-08', status: 'confirmed', creatorId: ME,
      members: [
        { id: 'm1', userId: ME, response: 'accepted' },
        { id: 'm2', userId: FRIEND, response: 'accepted' },
      ],
    };
    mocks.partnerWorkout.findUnique.mockResolvedValue(pin);
    mocks.partnerWorkout.update.mockResolvedValue({});
    const app = await buildApp();

    const res = await request(app)
      .delete('/api/train-together/pins/pin1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');

    // Member (not creator) leaving
    mocks.partnerWorkout.findUnique.mockResolvedValue({ ...pin, creatorId: FRIEND });
    mocks.partnerWorkoutMember.update.mockResolvedValue({});
    const res2 = await request(app)
      .delete('/api/train-together/pins/pin1')
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(200);
    expect(res2.body.left).toBe(true);
    expect(mocks.partnerWorkoutMember.update).toHaveBeenCalledWith({
      where: { id: 'm1' }, data: { response: 'declined' },
    });
  });
});
