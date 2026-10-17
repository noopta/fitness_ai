// Email compliance contracts (2026-10 audit, H2/H8):
// - RFC 8058 one-click unsubscribe POST accepts the same signed token as the
//   footer link, clears the marketing opt-in, and handles the weekly category.
// - Signing key: no literal fallback; EMAIL_UNSUB_SECRET, else derived from
//   JWT_SECRET; production refuses to start only when both are unset; legacy
//   JWT_SECRET-signed links still verify.
// - Waitlist: name/phone are escaped and capped; no promo enrolment without
//   explicit marketingConsent; unsubscribe line + postal address present.
// - Welcome: transactional only unless User.marketingConsentAt is set.
// - BlogSubscriber double opt-in: admin import sends a confirm link, nothing
//   is broadcast until a POST to that link confirms the row.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';

const store = vi.hoisted(() => ({ users: [] as any[], posts: [] as any[], subs: [] as any[], seq: 0 }));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async (_m: any) => ({ sent: true, provider: 'sendgrid' as const })) }));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    const matchWhere = (row: any, where: any) => Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'not' in v) return (row[k] ?? null) !== v.not;
      return (row[k] ?? null) === v;
    });
    const table = (name: 'users' | 'posts' | 'subs') => ({
      findUnique: vi.fn(async (a: any) => store[name].find((r) => Object.entries(a.where).every(([k, v]) => r[k] === v)) ?? null),
      findMany: vi.fn(async (a: any) => store[name].filter((r) => matchWhere(r, a?.where))),
      create: vi.fn(async (a: any) => {
        const row = { id: `${name}-${++store.seq}`, unsubscribedAt: null, confirmedAt: null, confirmSentAt: null, createdAt: new Date(), ...a.data };
        store[name].push(row); return row;
      }),
      update: vi.fn(async (a: any) => { const r = store[name].find((x) => x.id === a.where.id); Object.assign(r, a.data); return r; }),
      updateMany: vi.fn(async (a: any) => {
        const rows = store[name].filter((r) => matchWhere(r, a.where));
        rows.forEach((r) => Object.assign(r, a.data));
        return { count: rows.length };
      }),
    });
    this.user = table('users');
    this.blogPost = table('posts');
    this.blogSubscriber = table('subs');
  }),
}));
vi.mock('../services/mailService.js', () => mail);
vi.mock('../middleware/rateLimiter.js', () => ({ outboundNotifyLimiter: (_q: any, _s: any, n: any) => n() }));
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const email = req.headers['x-test-user'];
    if (!email) return res.status(401).json({ error: 'auth' });
    req.user = { id: `u-${email}`, email, tier: 'free' };
    next();
  },
}));

process.env.JWT_SECRET = 'test-secret';
delete process.env.EMAIL_UNSUB_SECRET;
process.env.WELCOME_EMAIL_SINCE = '2026-09-01T00:00:00Z';
process.env.ADMIN_EMAILS = 'inquiries@axiomtraining.io';

const unsub = await import('../services/emailUnsubscribe.js');
const { maybeSendWelcomeEmail } = await import('../services/welcomeEmailService.js');
const { broadcastBlogPost } = await import('../services/blogBroadcastService.js');
const { default: emailRouter } = await import('../routes/email.js');
const { default: blogRouter } = await import('../routes/blog.js');
const { default: waitlistRouter, NAME_MAX, PHONE_MAX } = await import('../routes/waitlist.js');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/api', emailRouter);
app.use('/api', blogRouter);
app.use('/api', waitlistRouter);

const ADMIN = { 'x-test-user': 'inquiries@axiomtraining.io' };
const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', name: 'Sam Lee', email: 'sam@x.com', emailVerified: true, marketingEmailsOptOut: false,
  marketingConsentAt: new Date('2026-10-01T00:00:00Z') as Date | null, notificationPrefsJson: '{"push":true}',
  createdAt: new Date('2026-10-10T00:00:00Z'), welcomeEmailSentAt: null, ...over,
});
const sent = () => mail.sendEmail.mock.calls.map((c) => c[0] as any);
const q = (u: string) => new URL(u).search;

beforeEach(() => {
  store.users = []; store.posts = []; store.subs = []; store.seq = 0;
  mail.sendEmail.mockClear();
  mail.sendEmail.mockImplementation(async () => ({ sent: true, provider: 'sendgrid' as const }));
});

describe('one-click unsubscribe (RFC 8058 POST)', () => {
  it('accepts the signed token from List-Unsubscribe and clears the marketing opt-in', async () => {
    store.users = [user()];
    const r = await request(app).post(`/api/email/unsubscribe${q(unsub.unsubscribeUrl('u1'))}`)
      .type('form').send('List-Unsubscribe=One-Click');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(store.users[0].marketingConsentAt).toBeNull();
    expect(store.users[0].marketingEmailsOptOut).toBe(true);
  });

  it('turns off only the weekly email for c=weekly', async () => {
    store.users = [user()];
    const r = await request(app).post(`/api/email/unsubscribe${q(unsub.unsubscribeUrl('u1', 'weekly'))}`).type('form').send('List-Unsubscribe=One-Click');
    expect(r.status).toBe(200);
    expect(JSON.parse(store.users[0].notificationPrefsJson)).toEqual({ push: true, weeklyEmail: false });
    expect(store.users[0].marketingConsentAt).not.toBeNull();
  });

  it('rejects forged or foreign tokens', async () => {
    store.users = [user(), user({ id: 'u2', email: 'two@x.com' })];
    const r = await request(app).post(`/api/email/unsubscribe?u=u2&t=${encodeURIComponent(unsub.unsubscribeToken('u1'))}`);
    expect(r.status).toBe(400);
    expect(store.users[1].marketingConsentAt).not.toBeNull();
  });

  it('is idempotent and 200s for a valid token whose row is gone', async () => {
    const r = await request(app).post(`/api/email/unsubscribe${q(unsub.unsubscribeUrl('ghost'))}`);
    expect(r.status).toBe(200);
  });

  it('still honours links signed with the legacy raw JWT_SECRET key', async () => {
    store.users = [user()];
    const legacy = crypto.createHmac('sha256', 'test-secret').update('unsub:u1').digest('base64url');
    expect(unsub.unsubscribeToken('u1')).not.toBe(legacy);           // new links use the derived key
    const r = await request(app).post(`/api/email/unsubscribe?u=u1&t=${encodeURIComponent(legacy)}`);
    expect(r.status).toBe(200);
    expect(store.users[0].marketingConsentAt).toBeNull();
  });
});

describe('signing key', () => {
  it('throws in production only when both EMAIL_UNSUB_SECRET and JWT_SECRET are unset', () => {
    expect(() => unsub.resolveUnsubSecret({ NODE_ENV: 'production' } as any)).toThrow(/EMAIL_UNSUB_SECRET or JWT_SECRET/);
    expect(unsub.resolveUnsubSecret({ NODE_ENV: 'production', EMAIL_UNSUB_SECRET: 'k', JWT_SECRET: 'x' } as any)).toBe('k');
    // Production with only JWT_SECRET keeps working (derived key) instead of crashing at startup.
    expect(unsub.resolveUnsubSecret({ NODE_ENV: 'production', JWT_SECRET: 'abc' } as any))
      .toBe(crypto.createHash('sha256').update('abcunsub').digest('hex'));
  });
  it('derives a key from JWT_SECRET, never the secret itself or a literal; dev without secrets gets a random key', () => {
    const k = unsub.resolveUnsubSecret({ NODE_ENV: 'development', JWT_SECRET: 'abc' } as any);
    expect(k).toBe(crypto.createHash('sha256').update('abcunsub').digest('hex'));
    expect(k).not.toBe('abc');
    expect(k).not.toBe('dev-unsub-secret');
    const eph = unsub.resolveUnsubSecret({ NODE_ENV: 'development' } as any);
    expect(eph).toMatch(/^[0-9a-f]{64}$/);
    expect(unsub.resolveUnsubSecret({ NODE_ENV: 'test' } as any)).toBe(eph); // stable within a process
  });
  it('confirm and unsubscribe tokens are not interchangeable', () => {
    expect(unsub.verifyConfirmToken('s1', unsub.unsubscribeToken('s1'))).toBe(false);
    expect(unsub.verifyUnsubscribeToken('s1', unsub.confirmToken('s1'))).toBe(false);
  });
});

describe('waitlist', () => {
  it('escapes and caps name/phone in the founder notification and the confirmation', async () => {
    const name = `<img src=x onerror=alert(1)>${'A'.repeat(300)}`;
    const r = await request(app).post('/api/waitlist').send({ email: 'Lead@X.com', name, phone: '+1 (555) 010-0000<script>' + '9'.repeat(100) });
    expect(r.status).toBe(200);
    const [founder, confirm] = sent();
    expect(founder.html).not.toContain('<img src=x');
    expect(founder.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(founder.html).not.toContain('<script>');
    const shownName = /Name:<\/strong> ([^<]*)</.exec(founder.html)![1];
    expect(shownName.replace(/&[a-z]+;/g, 'x').length).toBeLessThanOrEqual(NAME_MAX + 40);
    const shownPhone = /Phone:<\/strong> ([^<]*)</.exec(founder.html)![1];
    expect(shownPhone.length).toBeLessThanOrEqual(PHONE_MAX);
    expect(confirm.to).toBe('lead@x.com');
    expect(confirm.html).not.toContain('<img src=x');
  });

  it('does not enrol in promotions without marketingConsent, and always carries an unsubscribe line + postal address', async () => {
    await request(app).post('/api/waitlist').send({ email: 'a@x.com', name: 'Ana' });
    const confirm = sent()[1];
    expect(confirm.html).not.toMatch(/discounts|promotions|offers/i);
    expect(confirm.html).toMatch(/unsubscribe/i);
    expect(confirm.html).toContain('[POSTAL ADDRESS]');
    expect(confirm.headers['List-Unsubscribe']).toContain('mailto:');
  });

  it('mentions offers only when marketingConsent is true; non-boolean truthy values are rejected', async () => {
    await request(app).post('/api/waitlist').send({ email: 'a@x.com', marketingConsent: true });
    expect(sent()[1].html).toMatch(/offers/);
    mail.sendEmail.mockClear();
    const bad = await request(app).post('/api/waitlist').send({ email: 'a@x.com', marketingConsent: 'yes' });
    expect(bad.status).toBe(400);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});

describe('welcome email respects marketing consent', () => {
  it('without marketingConsentAt: transactional only, no promo block, no unsubscribe link or headers', async () => {
    store.users = [user({ marketingConsentAt: null })];
    expect(await maybeSendWelcomeEmail('u1')).toBe('sent');
    const m = sent()[0];
    expect(m.html).toContain('Where to start');
    expect(m.html).not.toContain('What members use most');
    expect(m.html).not.toContain('/email/unsubscribe');
    expect(m.headers).toBeUndefined();
    expect(m.html).toContain('not medical advice');
  });

  it('with marketingConsentAt: promo block plus one-click unsubscribe headers', async () => {
    store.users = [user()];
    expect(await maybeSendWelcomeEmail('u1')).toBe('sent');
    const m = sent()[0];
    expect(m.html).toContain('What members use most');
    expect(m.headers['List-Unsubscribe']).toContain('/email/unsubscribe?u=u1');
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('ignores the legacy opt-out default: no consent record means no promo even if marketingEmailsOptOut is false', async () => {
    store.users = [user({ marketingConsentAt: null, marketingEmailsOptOut: false })];
    await maybeSendWelcomeEmail('u1');
    expect(sent()[0].html).not.toContain('What members use most');
  });
});

describe('BlogSubscriber double opt-in', () => {
  const POST = () => ({ id: 'p1', slug: 'launch', title: 'Launch', excerpt: 'x', content: 'Hello', category: 'Update', published: true, emailedAt: null, emailedCount: 0 });

  it('import → confirmation email → GET does not confirm → POST confirms → broadcast includes', async () => {
    const add = await request(app).post('/api/blog/admin/subscribers').set(ADMIN).send({ emails: ['friend@x.com'] });
    expect(add.status).toBe(200);
    expect(add.body.added).toEqual(['friend@x.com']);
    expect(add.body.confirmationsSent).toEqual(['friend@x.com']);
    const sub = store.subs[0];
    expect(sub.confirmedAt).toBeNull();
    expect(sub.confirmSentAt).toBeInstanceOf(Date);

    const confirmMail = sent()[0];
    expect(confirmMail.to).toBe('friend@x.com');
    const link = /href="([^"]*\/email\/confirm\?[^"]+)"/.exec(confirmMail.html)![1].replace(/&amp;/g, '&');
    expect(link).toContain(`s=${sub.id}`);

    // Pending subscribers get nothing.
    store.posts = [POST()];
    mail.sendEmail.mockClear();
    expect((await broadcastBlogPost('p1')).recipients).toBe(0);

    // A scanner/prefetch GET only renders the button.
    const get = await request(app).get(`/api/email/confirm${q(link)}`);
    expect(get.status).toBe(200);
    expect(get.text).toContain('<form method="post"');
    expect(sub.confirmedAt).toBeNull();

    const forged = await request(app).post(`/api/email/confirm?s=${sub.id}&t=${encodeURIComponent(unsub.unsubscribeToken(sub.id))}`);
    expect(forged.status).toBe(400);
    expect(sub.confirmedAt).toBeNull();

    const ok = await request(app).post(`/api/email/confirm${q(link)}`);
    expect(ok.status).toBe(200);
    expect(sub.confirmedAt).toBeInstanceOf(Date);

    store.posts = [POST()];
    const r = await broadcastBlogPost('p1');
    expect(r.recipients).toBe(1);
    expect(sent()[0].to).toBe('friend@x.com');
    expect(sent()[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('an unsubscribed address cannot be re-confirmed and is not re-mailed on re-import', async () => {
    store.subs = [{ id: 's1', email: 'gone@x.com', source: 'admin', addedBy: null, unsubscribedAt: new Date(), confirmedAt: null, confirmSentAt: null, createdAt: new Date() }];
    const add = await request(app).post('/api/blog/admin/subscribers').set(ADMIN).send({ emails: ['gone@x.com'] });
    expect(add.body.existing).toEqual(['gone@x.com']);
    expect(mail.sendEmail).not.toHaveBeenCalled();
    const r = await request(app).post(`/api/email/confirm${q(unsub.confirmSubscriptionUrl('s1'))}`);
    expect(r.status).toBe(409);
    expect(store.subs[0].confirmedAt).toBeNull();
  });

  it('re-importing a pending address re-sends at most once a week', async () => {
    store.subs = [{ id: 's1', email: 'p@x.com', source: 'admin', addedBy: null, unsubscribedAt: null, confirmedAt: null, confirmSentAt: new Date(), createdAt: new Date() }];
    await request(app).post('/api/blog/admin/subscribers').set(ADMIN).send({ emails: ['p@x.com'] });
    expect(mail.sendEmail).not.toHaveBeenCalled();
    store.subs[0].confirmSentAt = new Date(Date.now() - 8 * 86_400_000);
    await request(app).post('/api/blog/admin/subscribers').set(ADMIN).send({ emails: ['p@x.com'] });
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('postal address + opt-in on every marketing send', () => {
  it('every template carries the shared POSTAL_ADDRESS constant in html and text', async () => {
    const t = await import('../services/emailTemplates.js');
    const u = 'https://api.example/email/unsubscribe?u=u1&t=x';
    const msgs = [
      t.welcomeEmail('Sam', { marketing: true, unsubscribeUrl: u }),
      t.welcomeEmail('Sam'),
      t.subscriberConfirmationEmail('https://api.example/email/confirm?s=1&t=x'),
      t.waitlistConfirmationEmail({ name: 'Ana', marketing: false }),
      t.waitlistConfirmationEmail({ name: 'Ana', marketing: true }),
      t.blogPostEmail({ slug: 's', title: 'T', excerpt: 'e', content: 'Hello', category: 'Update' } as any, u),
    ];
    for (const m of msgs) {
      expect(m.html).toContain(t.escapeHtml(t.POSTAL_ADDRESS));
      expect(m.text).toContain(t.POSTAL_ADDRESS);
    }
  });

  it('blog broadcast skips accounts without a marketingConsentAt record', async () => {
    store.users = [
      user({ id: 'yes', email: 'yes@x.com' }),
      user({ id: 'no', email: 'no@x.com', marketingConsentAt: null, marketingEmailsOptOut: false }),
    ];
    store.posts = [{ id: 'p1', slug: 'launch', title: 'Launch', excerpt: 'x', content: 'Hello', category: 'Update', published: true, emailedAt: null, emailedCount: 0 }];
    const r = await broadcastBlogPost('p1');
    expect(r.recipients).toBe(1);
    expect(sent().map((m) => m.to)).toEqual(['yes@x.com']);
  });
});
