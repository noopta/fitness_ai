// Coach beta list: public signup (consent, honeypot, upsert, 24h re-send
// throttle, best-effort notifications), admin list + CSV, signed unsubscribe.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const store = vi.hoisted(() => ({ rows: [] as any[], seq: 0 }));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async (_m: any) => ({ sent: true, provider: 'sendgrid' as const })) }));
const sms = vi.hoisted(() => ({ create: vi.fn(async (_m: any) => ({ sid: 'SM1' })) }));

const raw = vi.hoisted(() => ({
  query: vi.fn(async (..._a: any[]): Promise<any[]> => []),
  exec: vi.fn(async (..._a: any[]): Promise<number> => 1),
}));
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.$queryRawUnsafe = raw.query;
    this.$executeRawUnsafe = raw.exec;
  }),
}));

// The route stores through coachBetaRepo (raw SQL); an in-memory stand-in here.
vi.mock('../services/coachBetaRepo.js', () => {
  const byEmail = (email: string) => store.rows.find((r) => r.email === email) ?? null;
  const byId = (id: string) => store.rows.find((r) => r.id === id) ?? null;
  const update = async (id: string, patch: any) => {
    const r = byId(id); if (!r) return 0;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) r[k] = v;
    return 1;
  };
  return {
    findSignupByEmail: vi.fn(async (email: string) => (byEmail(email) ? { ...byEmail(email) } : null)),
    findSignupById: vi.fn(async (id: string) => (byId(id) ? { ...byId(id) } : null)),
    updateSignup: vi.fn(update),
    upsertSignupByEmail: vi.fn(async (email: string, create: any, patch: any) => {
      const r = byEmail(email);
      if (r) { await update(r.id, patch); return { ...r }; }
      const row = { id: `cb-${++store.seq}`, email, createdAt: new Date(), notifiedAt: null, unsubscribedAt: null, invitedAt: null, ...create };
      store.rows.push(row); return { ...row };
    }),
    listSignupRows: vi.fn(async () => store.rows.slice().sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())),
    markUnsubscribed: vi.fn(async (id: string) => {
      const r = byId(id); if (!r || r.unsubscribedAt) return 0;
      r.unsubscribedAt = new Date(); return 1;
    }),
  };
});
vi.mock('../services/mailService.js', () => mail);
vi.mock('twilio', () => ({ default: vi.fn(() => ({ messages: { create: sms.create } })) }));
vi.mock('../middleware/rateLimiter.js', () => ({ outboundNotifyLimiter: (_q: any, _s: any, n: any) => n() }));
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const email = req.headers['x-test-user'];
    if (!email) return res.status(401).json({ error: 'auth' });
    req.user = { id: `u-${email}`, email, tier: 'free' };
    next();
  },
}));

process.env.COACH_BETA_ENABLED = "1";
process.env.JWT_SECRET = 'test-secret';
delete process.env.EMAIL_UNSUB_SECRET;
process.env.ADMIN_EMAILS = 'inquiries@axiomtraining.io';
process.env.WAITLIST_NOTIFY_EMAIL = 'founder@example.com';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'tok';
process.env.TWILIO_PHONE_NUMBER = '+15550000000';
process.env.NOTIFICATION_PHONE = '+15551111111';

const { default: router, smsBody, csvCell, SMS_MAX } = await import('../routes/coachBeta.js');
const unsub = await import('../services/emailUnsubscribe.js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api', router);

const ADMIN = { 'x-test-user': 'inquiries@axiomtraining.io' };
const MEMBER = { 'x-test-user': 'someone@example.com' };

const valid = {
  email: '  Coach@Example.COM ',
  name: 'Sam <b>Lee</b>',
  socialPlatform: 'instagram',
  socialHandle: '@samlifts',
  coachingType: 'hybrid',
  clientCount: '11-30',
  platformToday: 'Trainerize',
  website: 'https://sam.example',
  message: 'Hi\nthere',
  source: 'ig-bio',
  marketingConsent: true,
  company: '',
};

const toCoach = () => mail.sendEmail.mock.calls.filter(([m]) => m.to === 'coach@example.com');
const toFounder = () => mail.sendEmail.mock.calls.filter(([m]) => m.to === 'founder@example.com');

beforeEach(() => {
  store.rows = []; store.seq = 0;
  mail.sendEmail.mockClear(); sms.create.mockClear();
  mail.sendEmail.mockImplementation(async () => ({ sent: true, provider: 'sendgrid' as const }));
});

describe('POST /api/coach-beta/signup', () => {
  it('stores the signup (lowercased email, consent timestamp) and sends confirmation, founder email and SMS', async () => {
    const r = await request(app).post('/api/coach-beta/signup').set('User-Agent', 'UA/1').send(valid);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, alreadyOnList: false });

    expect(store.rows).toHaveLength(1);
    const row = store.rows[0];
    expect(row.email).toBe('coach@example.com');
    expect(row.socialHandle).toBe('samlifts');
    expect(row.marketingConsentAt).toBeInstanceOf(Date);
    expect(row.source).toBe('ig-bio');
    expect(row.userAgent).toBe('UA/1');
    expect(row.notifiedAt).toBeInstanceOf(Date);

    const [conf] = toCoach().map(([m]) => m);
    expect(conf.subject).toBe('You’re on the Axiom coaching beta list');
    expect(conf.html).toContain('/coach-beta/unsubscribe?token=');
    expect(conf.html).toContain('[POSTAL ADDRESS]');
    expect(conf.html).toContain('Sam &lt;b&gt;Lee&lt;/b&gt;');
    expect(conf.html).not.toContain('<b>Lee</b>');
    expect(conf.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    const [founder] = toFounder().map(([m]) => m);
    expect(founder.replyTo).toBe('coach@example.com');
    expect(founder.html).toContain('Sam &lt;b&gt;Lee&lt;/b&gt;');
    expect(founder.html).toContain('Trainerize');
    expect(founder.html).not.toContain('<b>Lee</b>');

    expect(sms.create).toHaveBeenCalledTimes(1);
    expect(sms.create.mock.calls[0][0].body).toBe('🧑‍🏫 Coach beta: Sam <b>Lee</b> — Instagram@samlifts — 11-30 clients — hybrid');
    expect(sms.create.mock.calls[0][0].to).toBe('+15551111111');
  });

  it('honeypot filled → 200 but nothing stored or sent', async () => {
    const r = await request(app).post('/api/coach-beta/signup').send({ ...valid, company: 'Acme Bots' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(store.rows).toHaveLength(0);
    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(sms.create).not.toHaveBeenCalled();
  });

  it('missing or false consent → 400, nothing stored', async () => {
    const { marketingConsent: _c, ...noConsent } = valid;
    expect((await request(app).post('/api/coach-beta/signup').send(noConsent)).status).toBe(400);
    expect((await request(app).post('/api/coach-beta/signup').send({ ...valid, marketingConsent: false })).status).toBe(400);
    expect((await request(app).post('/api/coach-beta/signup').send({ ...valid, marketingConsent: 'true' })).status).toBe(400);
    expect(store.rows).toHaveLength(0);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it('bad email → 400; unknown select values do not gate the signup', async () => {
    expect((await request(app).post('/api/coach-beta/signup').send({ ...valid, email: 'nope' })).status).toBe(400);
    const r = await request(app).post('/api/coach-beta/signup').send({ ...valid, socialPlatform: 'threads', clientCount: 'lots', coachingType: 'weird' });
    expect(r.status).toBe(200);
    expect(store.rows[0]).toMatchObject({ socialPlatform: 'other', clientCount: null, coachingType: null });
  });

  it('caps long fields', async () => {
    await request(app).post('/api/coach-beta/signup').send({ ...valid, platformToday: 'x'.repeat(500), message: 'm'.repeat(3000), source: 's'.repeat(400) });
    expect(store.rows[0].platformToday).toHaveLength(200);
    expect(store.rows[0].message).toHaveLength(1000);
    expect(store.rows[0].source).toHaveLength(120);
  });

  it('repeat within 24h → alreadyOnList, fields updated, no second confirmation, no second founder ping', async () => {
    await request(app).post('/api/coach-beta/signup').send(valid);
    mail.sendEmail.mockClear(); sms.create.mockClear();
    const r = await request(app).post('/api/coach-beta/signup').send({ ...valid, clientCount: '31-100' });
    expect(r.body).toEqual({ ok: true, alreadyOnList: true });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].clientCount).toBe('31-100');
    expect(toCoach()).toHaveLength(0);
    expect(toFounder()).toHaveLength(0);
    expect(sms.create).not.toHaveBeenCalled();
  });

  it('repeat after 24h re-sends the confirmation', async () => {
    await request(app).post('/api/coach-beta/signup').send(valid);
    store.rows[0].notifiedAt = new Date(Date.now() - 25 * 3600_000);
    mail.sendEmail.mockClear();
    const r = await request(app).post('/api/coach-beta/signup').send(valid);
    expect(r.body.alreadyOnList).toBe(true);
    expect(toCoach()).toHaveLength(1);
  });

  it('mail and SMS failures never fail the request', async () => {
    mail.sendEmail.mockImplementation(async () => { throw new Error('smtp down'); });
    sms.create.mockImplementationOnce(async () => { throw new Error('twilio down'); });
    const r = await request(app).post('/api/coach-beta/signup').send(valid);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(store.rows[0].notifiedAt).toBeNull();
  });
});

describe('smsBody', () => {
  it('falls back to email and truncates to 300 chars', () => {
    const body = smsBody({ email: 'a@b.co', marketingConsent: true } as any);
    expect(body).toBe('🧑‍🏫 Coach beta: a@b.co — no handle — ? clients — ?');
    expect(Array.from(smsBody({ email: 'a@b.co', name: 'n'.repeat(400), marketingConsent: true } as any))).toHaveLength(SMS_MAX);
  });
});

describe('admin list + CSV', () => {
  it('requires auth and an admin', async () => {
    expect((await request(app).get('/api/coach-beta/signups')).status).toBe(401);
    expect((await request(app).get('/api/coach-beta/signups').set(MEMBER)).status).toBe(403);
    expect((await request(app).get('/api/coach-beta/signups.csv').set(MEMBER)).status).toBe(403);
  });

  it('lists newest first', async () => {
    await request(app).post('/api/coach-beta/signup').send(valid);
    await request(app).post('/api/coach-beta/signup').send({ ...valid, email: 'second@example.com' });
    store.rows[1].createdAt = new Date(store.rows[0].createdAt.getTime() + 1000);
    const r = await request(app).get('/api/coach-beta/signups').set(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.signups.map((s: any) => s.email)).toEqual(['second@example.com', 'coach@example.com']);
  });

  it('CSV quotes cells and neutralises formulas', async () => {
    await request(app).post('/api/coach-beta/signup').send({ ...valid, name: '=HYPERLINK("http://evil","x")', platformToday: '+1 tool, "quoted"', message: '@SUM(A1)' });
    const r = await request(app).get('/api/coach-beta/signups.csv').set(ADMIN);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(r.text).toContain(`"'+1 tool, ""quoted"""`);
    expect(r.text).toContain(`"'@SUM(A1)"`);
    expect(r.text.split('\r\n')[0]).toMatch(/^"createdAt","email","name"/);
  });

  it('csvCell edge cases', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell('-2+3')).toBe(`"'-2+3"`);
    expect(csvCell('\tx')).toBe(`"'\tx"`);
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell(new Date('2026-10-17T00:00:00Z'))).toBe('"2026-10-17T00:00:00.000Z"');
  });
});

describe('unsubscribe', () => {
  it('GET with a signed token sets unsubscribedAt; bad tokens are rejected', async () => {
    await request(app).post('/api/coach-beta/signup').send(valid);
    const id = store.rows[0].id;
    expect((await request(app).get('/api/coach-beta/unsubscribe?token=garbage')).status).toBe(400);
    expect((await request(app).get(`/api/coach-beta/unsubscribe?token=${encodeURIComponent(`${id}.forged`)}`)).status).toBe(400);
    // A user/blog unsubscribe token for the same id is not a coach-list token.
    expect((await request(app).get(`/api/coach-beta/unsubscribe?token=${encodeURIComponent(`${id}.${unsub.unsubscribeToken(id)}`)}`)).status).toBe(400);
    expect(store.rows[0].unsubscribedAt).toBeNull();

    const r = await request(app).get(`/api/coach-beta/unsubscribe?token=${encodeURIComponent(unsub.coachBetaUnsubscribeToken(id))}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('unsubscribed');
    expect(store.rows[0].unsubscribedAt).toBeInstanceOf(Date);
    // Idempotent.
    expect((await request(app).get(`/api/coach-beta/unsubscribe?token=${encodeURIComponent(unsub.coachBetaUnsubscribeToken(id))}`)).status).toBe(200);
  });

  it('the link in the confirmation email works; POST one-click also unsubscribes', async () => {
    await request(app).post('/api/coach-beta/signup').send(valid);
    const html: string = toCoach()[0][0].html;
    const token = decodeURIComponent(/unsubscribe\?token=([^"&]+)/.exec(html)![1]);
    expect(unsub.verifyCoachBetaUnsubscribeToken(token)).toBe(store.rows[0].id);

    const r = await request(app).post(`/api/coach-beta/unsubscribe?token=${encodeURIComponent(token)}`).type('form').send('List-Unsubscribe=One-Click');
    expect(r.status).toBe(200);
    expect(store.rows[0].unsubscribedAt).toBeInstanceOf(Date);
    expect((await request(app).post('/api/coach-beta/unsubscribe?token=bad')).status).toBe(400);
  });

  it('unknown id with a valid signature → 404 page', async () => {
    const r = await request(app).get(`/api/coach-beta/unsubscribe?token=${encodeURIComponent(unsub.coachBetaUnsubscribeToken('nope'))}`);
    expect(r.status).toBe(404);
  });

  it('re-signing up after unsubscribing is a fresh opt-in', async () => {
    await request(app).post('/api/coach-beta/signup').send(valid);
    store.rows[0].unsubscribedAt = new Date();
    await request(app).post('/api/coach-beta/signup').send(valid);
    expect(store.rows[0].unsubscribedAt).toBeNull();
  });
});

describe('coachBetaRepo (raw SQL, works without a generated delegate)', () => {
  it('inserts a new email with whitelisted columns only, then reads it back with Dates', async () => {
    const repo = await vi.importActual<typeof import('../services/coachBetaRepo.js')>('../services/coachBetaRepo.js');
    raw.query.mockReset(); raw.exec.mockReset(); raw.exec.mockResolvedValue(1);
    raw.query
      .mockResolvedValueOnce([]) // findSignupByEmail → none
      .mockResolvedValueOnce([{ id: 'x', email: 'a@b.co', createdAt: 1760659200000, notifiedAt: null, marketingConsentAt: BigInt(1760659200000) }]);
    const row = await repo.upsertSignupByEmail('a@b.co', { name: 'A', marketingConsentAt: new Date(), evil: 'x"; DROP TABLE' } as any, {});
    const [sql, ...params] = raw.exec.mock.calls[0];
    expect(sql).toContain('INSERT INTO "CoachBetaSignup"');
    expect(sql).not.toContain('evil');
    expect(params).toContain('a@b.co');
    expect(params).not.toContain('x"; DROP TABLE');
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.marketingConsentAt).toBeInstanceOf(Date);
    expect(row.notifiedAt).toBeNull();
  });

  it('updates an existing email instead of inserting; unsubscribe only touches subscribed rows', async () => {
    const repo = await vi.importActual<typeof import('../services/coachBetaRepo.js')>('../services/coachBetaRepo.js');
    raw.query.mockReset(); raw.exec.mockReset(); raw.exec.mockResolvedValue(1);
    raw.query.mockResolvedValue([{ id: 'x', email: 'a@b.co', createdAt: new Date() }]);
    await repo.upsertSignupByEmail('a@b.co', { name: 'new' }, { name: 'upd', unsubscribedAt: null });
    expect(raw.exec.mock.calls[0][0]).toMatch(/^UPDATE "CoachBetaSignup" SET "name" = \?, "unsubscribedAt" = \? WHERE "id" = \?$/);
    expect(raw.exec.mock.calls[0].slice(1)).toEqual(['upd', null, 'x']);
    await repo.markUnsubscribed('x');
    expect(raw.exec.mock.calls[1][0]).toContain('"unsubscribedAt" IS NULL');
  });
});
