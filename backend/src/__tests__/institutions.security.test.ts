/**
 * Oct-2026 audit remediation: institution coach powers.
 *  - a coach can't deactivate another coach (self and athletes only)
 *  - coach-role invites must name an email
 *  - PATCH /:slug: name ≤120, logoUrl https ≤2048
 *  - coach → athlete message ≤2000 chars and moderated ('coach_message')
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const inst = { id: 'inst1', slug: 'gym', name: 'Gym', logoUrl: null };
const members: Record<string, { userId: string; role: string; active: boolean }> = {};
const prismaMock = {
  institution: { findUnique: vi.fn(async () => inst), update: vi.fn(async ({ data }: any) => ({ ...inst, ...data })) },
  institutionMember: {
    findUnique: vi.fn(async ({ where }: any) => {
      const m = members[where.institutionId_userId.userId];
      return m ? { id: `m_${m.userId}`, institutionId: inst.id, ...m } : null;
    }),
    update: vi.fn(async ({ where }: any) => ({ ...members[where.institutionId_userId.userId], active: false })),
  },
  institutionInvite: { create: vi.fn(async ({ data }: any) => ({ id: 'inv1', token: 'tok', ...data })) },
  directConversation: { upsert: vi.fn(async () => ({ id: 'c1' })) },
  message: { create: vi.fn(async ({ data }: any) => ({ id: 'msg1', ...data })) },
};
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) { Object.assign(this, prismaMock); }),
}));
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: req.headers['x-test-user'], email: null, tier: 'free' }; next(); },
}));
const moderateText = vi.fn(async (..._a: any[]) => ({ allowed: true, message: null, blockedCategory: null }));
vi.mock('../services/moderationService.js', () => ({ moderateText: (...a: any[]) => moderateText(...a) }));

let app: express.Express;
beforeAll(async () => {
  const { default: routes } = await import('../routes/institutions.js');
  app = express();
  app.use(express.json());
  app.use('/api/institutions', routes);
});
beforeEach(() => {
  for (const k of Object.keys(members)) delete members[k];
  members.coachA = { userId: 'coachA', role: 'coach', active: true };
  members.coachB = { userId: 'coachB', role: 'coach', active: true };
  members.ath = { userId: 'ath', role: 'athlete', active: true };
  prismaMock.institutionMember.update.mockClear();
  prismaMock.institution.update.mockClear();
  prismaMock.institutionInvite.create.mockClear();
  prismaMock.message.create.mockClear();
  moderateText.mockClear();
});

const as = (u: string) => ({ 'x-test-user': u });

describe('DELETE /:slug/members/:userId', () => {
  it('refuses to let one coach deactivate another', async () => {
    const res = await request(app).delete('/api/institutions/gym/members/coachB').set(as('coachA'));
    expect(res.status).toBe(403);
    expect(prismaMock.institutionMember.update).not.toHaveBeenCalled();
  });
  it('lets a coach step down and remove athletes', async () => {
    expect((await request(app).delete('/api/institutions/gym/members/coachA').set(as('coachA'))).status).toBe(200);
    expect((await request(app).delete('/api/institutions/gym/members/ath').set(as('coachA'))).status).toBe(200);
  });
});

describe('POST /:slug/invite', () => {
  it('requires an email for coach invites', async () => {
    expect((await request(app).post('/api/institutions/gym/invite').set(as('coachA')).send({ role: 'coach' })).status).toBe(400);
    expect((await request(app).post('/api/institutions/gym/invite').set(as('coachA')).send({ role: 'coach', email: 'not-an-email' })).status).toBe(400);
    const ok = await request(app).post('/api/institutions/gym/invite').set(as('coachA')).send({ role: 'coach', email: 'New@Coach.com' });
    expect(ok.status).toBe(201);
    expect(prismaMock.institutionInvite.create.mock.calls[0][0].data.email).toBe('new@coach.com');
  });
  it('still allows open athlete invites', async () => {
    expect((await request(app).post('/api/institutions/gym/invite').set(as('coachA')).send({ role: 'athlete' })).status).toBe(201);
  });
});

describe('PATCH /:slug', () => {
  it('caps the name at 120', async () => {
    expect((await request(app).patch('/api/institutions/gym').set(as('coachA')).send({ name: 'x'.repeat(121) })).status).toBe(400);
    expect((await request(app).patch('/api/institutions/gym').set(as('coachA')).send({ name: 'x'.repeat(120) })).status).toBe(200);
  });
  it('accepts only https logo URLs up to 2048 chars (or null)', async () => {
    for (const bad of ['http://x.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAA', `https://x.com/${'a'.repeat(2048)}`, 42]) {
      const r = await request(app).patch('/api/institutions/gym').set(as('coachA')).send({ logoUrl: bad });
      expect(r.status, String(bad).slice(0, 30)).toBe(400);
    }
    expect((await request(app).patch('/api/institutions/gym').set(as('coachA')).send({ logoUrl: 'https://cdn.example.com/logo.png' })).status).toBe(200);
    expect((await request(app).patch('/api/institutions/gym').set(as('coachA')).send({ logoUrl: null })).status).toBe(200);
    expect(prismaMock.institution.update).toHaveBeenCalledTimes(2);
  });
});

describe('POST /:slug/athletes/:userId/message', () => {
  it('rejects messages over 2000 characters', async () => {
    const res = await request(app).post('/api/institutions/gym/athletes/ath/message').set(as('coachA')).send({ body: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });
  it('moderates on the coach_message surface and blocks a rejected message', async () => {
    moderateText.mockResolvedValueOnce({ allowed: false, message: 'Not allowed', blockedCategory: 'harassment' });
    const res = await request(app).post('/api/institutions/gym/athletes/ath/message').set(as('coachA')).send({ body: 'hey' });
    expect(res.status).toBe(400);
    expect(moderateText).toHaveBeenCalledWith('hey', 'coach_message', 'coachA');
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });
  it('sends an allowed message', async () => {
    const res = await request(app).post('/api/institutions/gym/athletes/ath/message').set(as('coachA')).send({ body: 'Nice squat today' });
    expect(res.status).toBe(201);
    expect(prismaMock.message.create).toHaveBeenCalled();
  });
});
