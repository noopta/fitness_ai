// Welcome + blog broadcast email contracts: once per user / once per post,
// only to opted-in verified addresses, unsubscribe link is signed, and the
// public unsubscribe route flips the flag without leaking anything.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const store = vi.hoisted(() => ({ users: [] as any[], posts: [] as any[] }));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ sent: true, provider: 'sendgrid' as const })) }));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    const matchWhere = (row: any, where: any) => Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
      return row[k] === v;
    });
    this.user = {
      findUnique: vi.fn(async (a: any) => store.users.find(u => u.id === a.where.id) ?? null),
      findMany: vi.fn(async (a: any) => store.users.filter(u => matchWhere(u, a.where))),
      updateMany: vi.fn(async (a: any) => {
        const rows = store.users.filter(u => matchWhere(u, a.where));
        rows.forEach(r => Object.assign(r, a.data));
        return { count: rows.length };
      }),
    };
    this.blogPost = {
      findUnique: vi.fn(async (a: any) => store.posts.find(p => p.id === a.where.id) ?? null),
      updateMany: vi.fn(async (a: any) => {
        const rows = store.posts.filter(p => matchWhere(p, a.where));
        rows.forEach(r => Object.assign(r, a.data));
        return { count: rows.length };
      }),
      update: vi.fn(async (a: any) => { const r = store.posts.find(p => p.id === a.where.id); Object.assign(r, a.data); return r; }),
    };
  }),
}));
vi.mock('../services/mailService.js', () => mail);

process.env.JWT_SECRET = 'test-secret';
process.env.WELCOME_EMAIL_SINCE = '2026-09-01T00:00:00Z';

const { maybeSendWelcomeEmail } = await import('../services/welcomeEmailService.js');
const { broadcastBlogPost } = await import('../services/blogBroadcastService.js');
const { unsubscribeUrl, verifyUnsubscribeToken, unsubscribeToken } = await import('../services/emailUnsubscribe.js');
const { markdownToEmailHtml, welcomeEmail } = await import('../services/emailTemplates.js');
const { default: emailRouter } = await import('../routes/email.js');

const app = express();
app.use(express.json());
app.use('/api', emailRouter);

const NEW = () => ({ id: 'u-new', name: 'Sam Lee', email: 'sam@x.com', emailVerified: true, marketingEmailsOptOut: false, createdAt: new Date('2026-09-10T12:00:00Z'), welcomeEmailSentAt: null });
const OLD = () => ({ id: 'u-old', name: 'Old Timer', email: 'old@x.com', emailVerified: true, marketingEmailsOptOut: false, createdAt: new Date('2026-05-01T00:00:00Z'), welcomeEmailSentAt: null });

beforeEach(() => {
  store.users = [];
  store.posts = [];
  mail.sendEmail.mockClear();
  mail.sendEmail.mockImplementation(async () => ({ sent: true, provider: 'sendgrid' as const }));
});

describe('welcome email', () => {
  it('sends once to a new account, with first name, reply-to support, and an unsubscribe link', async () => {
    store.users = [NEW()];
    expect(await maybeSendWelcomeEmail('u-new')).toBe('sent');
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    const arg = mail.sendEmail.mock.calls[0][0] as any;
    expect(arg.to).toBe('sam@x.com');
    expect(arg.subject).toBe('Welcome to Axiom, Sam');
    expect(arg.replyTo).toBe('inquiries@axiomtraining.io');
    expect(arg.html).toContain('Hi Sam,');
    expect(arg.html).toContain('+105%');            // Alex's social proof
    expect(arg.html).toContain('/email/unsubscribe?u=u-new');
    expect(arg.text).toContain('Where to start');

    expect(await maybeSendWelcomeEmail('u-new')).toBe('already_sent');
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('skips accounts created before the feature shipped, and marks them so they are never retried', async () => {
    store.users = [OLD()];
    expect(await maybeSendWelcomeEmail('u-old')).toBe('legacy_account');
    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(store.users[0].welcomeEmailSentAt).toBeTruthy();
  });

  it('releases the claim when the provider fails so the next sign-in retries', async () => {
    store.users = [NEW()];
    mail.sendEmail.mockImplementationOnce(async () => ({ sent: false, provider: 'sendgrid' as const, reason: 'quota' }));
    expect(await maybeSendWelcomeEmail('u-new')).toBe('send_failed');
    expect(store.users[0].welcomeEmailSentAt).toBeNull();
    expect(await maybeSendWelcomeEmail('u-new')).toBe('sent');
  });

  it('does nothing for accounts without an email (Apple hide-my-email off)', async () => {
    store.users = [{ ...NEW(), email: null }];
    expect(await maybeSendWelcomeEmail('u-new')).toBe('no_email');
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});

describe('blog broadcast', () => {
  const POST = () => ({ id: 'p1', slug: 'launch', title: 'Launch week', excerpt: 'We shipped.', content: '## New\n\n- **Form check**\n- Recipes\n\nSee [the site](https://axiomtraining.io).', category: 'Update', published: true, emailedAt: null, emailedCount: 0 });

  it('emails verified, opted-in users once per post and records the count', async () => {
    store.posts = [POST()];
    store.users = [
      NEW(),
      { ...OLD(), id: 'u2', email: 'two@x.com' },
      { ...OLD(), id: 'u-unverified', email: 'unv@x.com', emailVerified: false },
      { ...OLD(), id: 'u-optout', email: 'out@x.com', marketingEmailsOptOut: true },
      { ...OLD(), id: 'u-noemail', email: null },
    ];
    const r = await broadcastBlogPost('p1');
    expect(r).toEqual({ status: 'sent', sent: 2, failed: 0, recipients: 2 });
    const tos = mail.sendEmail.mock.calls.map(c => (c[0] as any).to).sort();
    expect(tos).toEqual(['sam@x.com', 'two@x.com']);
    const arg = mail.sendEmail.mock.calls[0][0] as any;
    expect(arg.subject).toBe('Launch week');
    expect(arg.headers['List-Unsubscribe']).toMatch(/^<.*\/email\/unsubscribe\?u=.*>$/);
    expect(arg.html).toContain('<strong>Form check</strong>');
    expect(arg.html).toContain('href="https://axiomtraining.io"');
    expect(arg.html).toContain('/blog/launch');
    expect(store.posts[0].emailedCount).toBe(2);
    expect(store.posts[0].emailedAt).toBeTruthy();

    expect((await broadcastBlogPost('p1')).status).toBe('already_emailed');
    expect(mail.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('refuses drafts and unknown posts', async () => {
    store.posts = [{ ...POST(), published: false }];
    store.users = [NEW()];
    expect((await broadcastBlogPost('p1')).status).toBe('not_published');
    expect((await broadcastBlogPost('nope')).status).toBe('not_found');
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it('counts per-recipient failures without aborting the run', async () => {
    store.posts = [POST()];
    store.users = [NEW(), { ...OLD(), id: 'u2', email: 'two@x.com' }];
    mail.sendEmail.mockImplementationOnce(async () => ({ sent: false, provider: 'sendgrid' as const, reason: 'bounce' }));
    const r = await broadcastBlogPost('p1');
    expect(r.sent + r.failed).toBe(2);
    expect(r.failed).toBe(1);
  });
});

describe('markdownToEmailHtml', () => {
  it('escapes raw HTML and renders the basics', () => {
    const html = markdownToEmailHtml('# Title\n\n<script>alert(1)</script>\n\n1. one\n2. two\n\n> quote\n\n---\n\n`code` and *em*');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Title');
    expect(html).toContain('<ol');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<hr');
    expect(html).toContain('<code');
    expect(html).toContain('<em>em</em>');
  });
  it('welcome copy falls back gracefully without a name', () => {
    expect(welcomeEmail(null).subject).toBe('Welcome to Axiom');
    expect(welcomeEmail('  ').html).toContain('Hi there,');
  });
});

describe('unsubscribe', () => {
  it('signed link flips the flag; forged or foreign links do not', async () => {
    store.users = [NEW(), { ...OLD(), id: 'u2', email: 'two@x.com' }];
    const url = new URL(unsubscribeUrl('u-new'));
    expect(verifyUnsubscribeToken('u-new', url.searchParams.get('t')!)).toBe(true);
    expect(verifyUnsubscribeToken('u2', url.searchParams.get('t')!)).toBe(false);

    const ok = await request(app).get(`/api/email/unsubscribe?u=u-new&t=${encodeURIComponent(unsubscribeToken('u-new'))}`);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('unsubscribed');
    expect(store.users[0].marketingEmailsOptOut).toBe(true);
    expect(store.users[1].marketingEmailsOptOut).toBe(false);

    const forged = await request(app).get(`/api/email/unsubscribe?u=u2&t=${encodeURIComponent(unsubscribeToken('u-new'))}`);
    expect(forged.status).toBe(400);
    expect(store.users[1].marketingEmailsOptOut).toBe(false);

    const post = await request(app).post(`/api/email/unsubscribe?u=u2&t=${encodeURIComponent(unsubscribeToken('u2'))}`);
    expect(post.status).toBe(200);
    expect(store.users[1].marketingEmailsOptOut).toBe(true);
  });
});
