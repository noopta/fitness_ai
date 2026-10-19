// Joining a personal trainer from chat, over a real (temporary) SQLite
// database and the real routes: short codes, the invite notice, the
// coach_invite card's Accept / Not now, the redeem tool's provenance rule,
// resolving a code or link, and leaving a practice.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const dir = mkdtempSync(join(tmpdir(), 'coach-invite-'));
process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_at_least_32_chars_long!!';
process.env.PERSONAL_TRAINING_USERS = 'kavi@example.com';
process.env.FRONTEND_URL = 'https://axiomtraining.io';
process.env.AGENT_ENABLED = 'true';
process.env.UI_V2_ENABLED = '1';

const push = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../services/notificationService.js', async (importOriginal) => ({ ...(await importOriginal<any>()), sendPushToUser: push }));

const DAY = 86_400_000;
const token = (id: string, email: string) => `Bearer ${jwt.sign({ id, email, tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`;
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const api = '/api/personal-training';

let app: express.Express;
let prisma: any;
let ci: typeof import('../services/personalTraining/clientInvites.js');
let notices: typeof import('../agent/notices.js');
let store: typeof import('../agent/cards/store.js');
let coaching: typeof import('../agent/toolkits/coaching.js');
let setTurnMessage: (u: string, t: string) => void;
const id = { kavi: '', cara: '', dan: '', eve: '', practice: '' };
const as = { kavi: '', cara: '', dan: '', eve: '' };

beforeAll(async () => {
  execSync('./node_modules/.bin/prisma db push --skip-generate --schema prisma/schema.prisma', { env: process.env, stdio: 'ignore' });
  prisma = (await import('../services/personalTraining/db.js')).prisma;
  ci = await import('../services/personalTraining/clientInvites.js');
  notices = await import('../agent/notices.js');
  store = await import('../agent/cards/store.js');
  coaching = await import('../agent/toolkits/coaching.js');
  ({ setTurnMessage } = await import('../agent/turnMessage.js'));
  const { default: pt } = await import('../routes/personalTraining.js');
  const { default: cards } = await import('../routes/agentCards.js');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.headers['x-pt-caps'] ??= 'not-joined'; next(); });
  app.use(api, pt);
  app.use('/api', cards);

  const user = (name: string, email: string) => prisma.user.create({ data: { name, email, emailVerified: true, timezone: 'Europe/London' } });
  const kavi = await user('Kavi Nair', 'kavi@example.com');
  // Mixed case on purpose: invites are stored lowercased, matching must not care.
  const cara = await user('Cara Diaz', 'Cara@Example.com');
  const dan = await user('Dan Ito', 'dan@example.com');
  const eve = await user('Eve Moss', 'eve@example.com');
  const practice = await prisma.institution.create({ data: { name: 'Kavi Strength', slug: 'pt-kavi', members: { create: { userId: kavi.id, role: 'coach' } } } });
  Object.assign(id, { kavi: kavi.id, cara: cara.id, dan: dan.id, eve: eve.id, practice: practice.id });
  Object.assign(as, { kavi: token(kavi.id, 'kavi@example.com'), cara: token(cara.id, 'Cara@Example.com'), dan: token(dan.id, 'dan@example.com'), eve: token(eve.id, 'eve@example.com') });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const invite = (data: Record<string, unknown>) => prisma.institutionInvite.create({
  data: { institutionId: id.practice, invitedByUserId: id.kavi, role: 'athlete', expiresAt: new Date(Date.now() + 7 * DAY), ...data },
});
const thread = async (userId: string) => JSON.parse((await prisma.agentConversation.findUnique({ where: { userId } }))?.messagesJson ?? '[]');
const cardRow = (cardId: string) => prisma.agentCard.findUnique({ where: { id: cardId } });
const membership = (userId: string) => prisma.institutionMember.findUnique({ where: { institutionId_userId: { institutionId: id.practice, userId } } });

describe('short codes', () => {
  it('are XXXX-XXXX from an alphabet without 0, O, 1 or I', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = ci.generateShortCode();
      expect(c).toMatch(CODE_RE);
      seen.add(c);
    }
    expect(seen.size).toBe(2000);
    expect(ci.SHORT_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it('normalise case-insensitively, with or without the dash', () => {
    expect(ci.normalizeShortCode('k7qm3xpa')).toBe('K7QM-3XPA');
    expect(ci.normalizeShortCode(' k7qm-3xpa ')).toBe('K7QM-3XPA');
    expect(ci.normalizeShortCode('K7QM 3XPA')).toBe('K7QM-3XPA');
    expect(ci.normalizeShortCode('K7QM-3XP0')).toBeNull();
    expect(ci.normalizeShortCode('K7QM-3XP')).toBeNull();
  });

  it('parse links, axiom links, tokens and bare codes — not sentences', () => {
    const t = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(ci.parseInviteRef(`https://axiomtraining.io/personal-training/join/${t}`)).toEqual({ token: t });
    expect(ci.parseInviteRef(`axiom://personal-training/join/${t.toUpperCase()}`)).toEqual({ token: t });
    expect(ci.parseInviteRef('axiom://coach/join/k7qm-3xpa')).toEqual({ code: 'K7QM-3XPA' });
    expect(ci.parseInviteRef(t)).toEqual({ token: t });
    expect(ci.parseInviteRef('k7qm3xpa')).toEqual({ code: 'K7QM-3XPA' });
    expect(ci.parseInviteRef('my strength coach')).toBeNull();
    expect(ci.parseInviteRef('https://axiomtraining.io/personal-training/team/join/' + t)).toBeNull();
  });

  it('every new client invite gets one; the trainer sees it beside the link', async () => {
    const r = await request(app).post(`${api}/clients/invite`).set('Authorization', as.kavi).send({ mode: 'app', email: 'nobody@example.com' });
    expect(r.status).toBe(201);
    expect(r.body.shortCode).toMatch(CODE_RE);
    expect(r.body.link).toBe(`https://axiomtraining.io/personal-training/join/${r.body.token}`);
  });

  it('older invites get a code when the trainer lists them, and keep it', async () => {
    const old = await invite({ email: null });
    const first = await request(app).get(`${api}/invites`).set('Authorization', as.kavi);
    expect(first.status).toBe(200);
    const row = first.body.invites.find((i: any) => i.token === old.token);
    expect(row.shortCode).toMatch(CODE_RE);
    const again = await request(app).get(`${api}/invites`).set('Authorization', as.kavi);
    expect(again.body.invites.find((i: any) => i.token === old.token).shortCode).toBe(row.shortCode);
    // Clients cannot list a practice's invites.
    expect((await request(app).get(`${api}/invites`).set('Authorization', as.dan)).status).toBe(404);
  });
});

describe('push on invite', () => {
  it('pushes an existing account that the invite names, opening chat', async () => {
    push.mockClear();
    const r = await request(app).post(`${api}/clients/invite`).set('Authorization', as.kavi).send({ mode: 'app', email: 'eve@example.com' });
    expect(r.status).toBe(201);
    await vi.waitFor(() => expect(push).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith(id.eve, 'Kavi Nair invited you to train with them', expect.any(String), { type: 'coach_invite', screen: 'coach' }, 'social');
    await prisma.institutionInvite.update({ where: { token: r.body.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
  });

  it('does not push for an address with no account', async () => {
    push.mockClear();
    await request(app).post(`${api}/clients/invite`).set('Authorization', as.kavi).send({ mode: 'app', email: 'new-person@example.com' });
    await new Promise((r) => setTimeout(r, 50));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('resolve', () => {
  it('finds an invite by code (any case, no dash) or by link, without revealing the email', async () => {
    const r = await request(app).post(`${api}/clients/invite`).set('Authorization', as.kavi).send({ mode: 'app', email: 'someone@example.com' });
    const loose = r.body.shortCode.replace('-', '').toLowerCase();
    const byCode = await request(app).post(`${api}/invites/resolve`).set('Authorization', as.dan).send({ code: loose });
    expect(byCode.status).toBe(200);
    expect(byCode.body.invite).toMatchObject({ token: r.body.token, trainerName: 'Kavi Nair', practice: { name: 'Kavi Strength' }, state: 'open', emailLocked: true, forViewer: false });
    expect(JSON.stringify(byCode.body)).not.toContain('someone@example.com');
    const byLink = await request(app).post(`${api}/invites/resolve`).set('Authorization', as.dan).send({ link: r.body.link });
    expect(byLink.body.invite.token).toBe(r.body.token);
    const byAppLink = await request(app).post(`${api}/invites/resolve`).set('Authorization', as.dan).send({ link: `axiom://coach/join/${r.body.shortCode}` });
    expect(byAppLink.body.invite.token).toBe(r.body.token);
  });

  it('says what is wrong with a bad or unknown code', async () => {
    expect((await request(app).post(`${api}/invites/resolve`).set('Authorization', as.dan).send({ code: 'hello' })).status).toBe(400);
    expect((await request(app).post(`${api}/invites/resolve`).set('Authorization', as.dan).send({ code: 'ZZZZ-ZZZZ' })).status).toBe(404);
    expect((await request(app).post(`${api}/invites/resolve`).send({ code: 'ZZZZ-ZZZZ' })).status).toBe(401);
  });
});

describe('invite notice', () => {
  let cardId = '';
  let inviteToken = '';

  it('posts once for an open invite to the user\'s email, with the coach_invite card', async () => {
    const inv = await invite({ email: 'cara@example.com' });
    inviteToken = inv.token;
    expect(await notices.postPendingNotices(id.cara)).toBe(1);
    const msgs = await thread(id.cara);
    const turn = msgs[msgs.length - 1];
    expect(turn.text).toBe('Kavi Nair invited you to train with Kavi Strength.');
    expect(turn.origin).toBe('anakin');
    cardId = turn.cards[0].id;
    const card = await store.getCard(id.cara, cardId);
    expect(card).toMatchObject({ fn: 'coach_invite', pattern: 'proposal', invite: { trainer: 'Kavi Nair', practice: 'Kavi Strength' } });
    expect(card.why).toBe('If you accept, Kavi Nair will see your workouts, check-ins, body weight, program and the injuries you\'ve listed, and can message you.');
    expect(card.actions?.map((a) => a.label)).toEqual(['Accept', 'Not now']);
    // The token is server-side only.
    expect(JSON.stringify(card)).not.toContain(inv.token);
    expect(JSON.parse((await cardRow(cardId)).pendingJson).actions.accept.args.token).toBe(inv.token);
    // Once per invite.
    expect(await notices.postPendingNotices(id.cara)).toBe(0);
  });

  it('raises nothing for expired, accepted or someone else\'s invites', async () => {
    await invite({ email: 'eve@example.com', expiresAt: new Date(Date.now() - DAY) });
    await invite({ email: 'eve@example.com', usedAt: new Date(), usedByUserId: id.dan });
    await invite({ email: 'not-eve@example.com' });
    expect(await notices.coachInviteNotices(id.eve, 'eve@example.com', 'UTC')).toEqual([]);
    expect(await notices.postPendingNotices(id.eve)).toBe(0);
  });

  it('Accept joins through the shared service, then Anakin follows up with the check-in day', async () => {
    await prisma.ptCheckInSchedule.create({ data: { practiceId: id.practice, clientId: null, frequency: 'weekly', dayOfWeek: 1, hour: 18, questionsJson: '[]', active: true } });
    const r = await request(app).post(`/api/coach/agent/cards/${cardId}/action`).set('Authorization', as.cara).send({ actionId: 'accept' });
    expect(r.status).toBe(200);
    expect(r.body.card.state).toMatchObject({ status: 'applied', line: 'You’re coached by Kavi Nair now.' });
    expect(await membership(id.cara)).toMatchObject({ role: 'athlete', active: true });
    expect((await prisma.institutionInvite.findUnique({ where: { token: inviteToken } })).usedByUserId).toBe(id.cara);
    const msgs = await thread(id.cara);
    expect(msgs[msgs.length - 1].text).toMatch(/You're in\. Check-ins with Kavi Nair come every Monday/);
  });

  it('is idempotent on repeated taps', async () => {
    const before = (await thread(id.cara)).length;
    const again = await request(app).post(`/api/coach/agent/cards/${cardId}/action`).set('Authorization', as.cara).send({ actionId: 'accept' });
    expect(again.status).toBe(200);
    expect(again.body.card.state.status).toBe('applied');
    expect(await prisma.institutionMember.count({ where: { institutionId: id.practice, userId: id.cara } })).toBe(1);
    expect((await thread(id.cara)).length).toBe(before);
    // The web join page after the card: the same person, nothing changes.
    const web = await request(app).post(`${api}/invites/${inviteToken}/accept`).set('Authorization', as.cara);
    expect(web.status).toBe(200);
    expect(web.body.alreadyMember).toBe(true);
  });
});

describe('Not now and the email lock', () => {
  it('Not now keeps the invite open and says where to find it', async () => {
    const inv = await invite({ email: 'dan@example.com', expiresAt: new Date('2026-12-04T12:00:00Z') });
    const view = (await ci.describeInvite(inv.token, { id: id.dan, email: 'dan@example.com' }))!;
    const card = await store.saveCard(id.dan, ci.coachInviteCard(view, 'Europe/London'));
    const r = await request(app).post(`/api/coach/agent/cards/${card.id}/action`).set('Authorization', as.dan).send({ actionId: 'later' });
    expect(r.status).toBe(200);
    expect(r.body.card.state).toMatchObject({ status: 'kept', line: 'Invite kept — it\'s open until Fri 4 Dec. Find it under You → Coach.' });
    const after = await prisma.institutionInvite.findUnique({ where: { token: inv.token } });
    expect(after.usedAt).toBeNull();
    expect(await membership(id.dan)).toBeNull();
    // Still listed under You → Coach.
    const mine = await request(app).get(`${api}/coaching`).set('Authorization', as.dan);
    expect(mine.body.pending.map((p: any) => p.token)).toContain(inv.token);
    expect(mine.body.coaching).toEqual([]);
  });

  it('rejects an email-locked invite for a different account, on the web and on the card', async () => {
    const inv = await invite({ email: 'cara@example.com' });
    expect((await request(app).post(`${api}/invites/${inv.token}/accept`).set('Authorization', as.eve)).status).toBe(403);
    await expect(ci.acceptClientInvite(inv.token, id.eve)).rejects.toMatchObject({ status: 403 });
    // A card for the wrong account renders settled, with no Accept.
    const view = (await ci.describeInvite(inv.token, { id: id.eve, email: 'eve@example.com' }))!;
    const draft = ci.coachInviteCard(view, 'UTC');
    expect(draft.actions).toBeUndefined();
    expect(draft.state).toMatchObject({ status: 'expired', line: 'This invite was sent to a different email address.' });
    // And if one were tapped anyway, the op settles it instead of joining.
    const { executeOp, withWriteGuard } = await import('../agent/ops.js');
    const change = await withWriteGuard('allow', 'test', () => executeOp(id.eve, 'coach.accept_invite', { token: inv.token, inviteId: inv.id }));
    expect(change.result).toMatchObject({ status: 'expired' });
    expect(await membership(id.eve)).toBeNull();
  });

  it('an expired invite renders disabled', async () => {
    const inv = await invite({ email: null, expiresAt: new Date(Date.now() - DAY) });
    const draft = ci.coachInviteCard((await ci.describeInvite(inv.token, { id: id.eve, email: 'eve@example.com' }))!, 'UTC');
    expect(draft.state?.status).toBe('expired');
    expect(draft.actions).toBeUndefined();
  });
});

describe('redeem_coach_invite', () => {
  const tool = () => coaching.COACHING_TOOLS.find((t) => t.name === 'redeem_coach_invite')!;
  const ctx = { userId: '', unit: 'metric' as const, tz: 'UTC', today: '2026-10-19' };

  it('is a propose tool that shows the card for a code the user typed', async () => {
    expect(tool().kind).toBe('propose');
    const r = await request(app).post(`${api}/clients/invite`).set('Authorization', as.kavi).send({ mode: 'app' });
    const typed = r.body.shortCode.toLowerCase().replace('-', ' ');
    setTurnMessage(id.eve, `my coach gave me a code: ${typed}`);
    const out: any = await tool().execute({ code: typed }, id.eve);
    expect(out).toMatchObject({ found: true, trainer: 'Kavi Nair', practice: 'Kavi Strength', state: 'open' });
    const card: any = await tool().card!({}, out, { ...ctx, userId: id.eve });
    expect(card).toMatchObject({ fn: 'coach_invite', actions: [{ id: 'accept' }, { id: 'later' }] });
    expect(card.pending.actions.accept.args.token).toBe(r.body.token);
  });

  it('accepts a pasted link the same way', async () => {
    const r = await request(app).post(`${api}/clients/invite`).set('Authorization', as.kavi).send({ mode: 'app' });
    setTurnMessage(id.eve, `here's my trainer's link ${r.body.link}`);
    const out: any = await tool().execute({ link: r.body.link }, id.eve);
    expect(out.found).toBe(true);
    expect(out._view.token).toBe(r.body.token);
  });

  it('refuses a code that came from a tool result rather than the user', async () => {
    const r = await request(app).post(`${api}/clients/invite`).set('Authorization', as.kavi).send({ mode: 'app' });
    setTurnMessage(id.eve, 'what did Sam send me?');
    const out: any = await tool().execute({ code: r.body.shortCode }, id.eve);
    expect(out.refused).toBe(true);
    expect(out._view).toBeUndefined();
    expect(await tool().card!({}, out, { ...ctx, userId: id.eve })).toBeNull();
    // The app's own note about on-screen cards is not the user's words either.
    expect(coaching.refInUserMessage({ code: r.body.shortCode }, `<app_note>${r.body.shortCode}</app_note> yes`)).toBe(false);
    expect(coaching.refInUserMessage({ code: 'K7QM-3XPA' }, 'code is k7qm3xpa')).toBe(true);
  });

  it('returns not found for an unknown code', async () => {
    setTurnMessage(id.eve, 'ZZZZ-ZZZZ');
    expect(await tool().execute({ code: 'ZZZZ-ZZZZ' }, id.eve)).toMatchObject({ found: false });
  });
});

describe('leaving', () => {
  it('deactivates only the caller\'s own membership, deletes nothing, and tells the trainer', async () => {
    await prisma.institutionMember.create({ data: { institutionId: id.practice, userId: id.eve, role: 'athlete' } });
    await prisma.workoutLog.create({ data: { userId: id.cara, date: '2026-10-18', title: 'Lower', exercises: '[]' } });
    const coached = await request(app).get(`${api}/coaching`).set('Authorization', as.cara);
    expect(coached.body.coaching).toEqual([expect.objectContaining({ trainerName: 'Kavi Nair', practice: expect.objectContaining({ name: 'Kavi Strength' }) })]);

    const r = await request(app).post(`${api}/membership/leave`).set('Authorization', as.cara).send({ practiceId: id.practice });
    expect(r.status).toBe(200);
    expect((await membership(id.cara)).active).toBe(false);
    expect((await membership(id.eve)).active).toBe(true);
    expect((await membership(id.kavi))).toMatchObject({ role: 'coach', active: true });
    expect(await prisma.workoutLog.count({ where: { userId: id.cara } })).toBe(1);
    await vi.waitFor(async () => expect(await prisma.ptNotification.count({ where: { trainerId: id.kavi, clientId: id.cara, eventType: 'clientLeft' } })).toBe(1));
    expect((await request(app).get(`${api}/coaching`).set('Authorization', as.cara)).body.coaching).toEqual([]);
  });

  it('refuses when the caller is not a client there, and never touches a trainer', async () => {
    expect((await request(app).post(`${api}/membership/leave`).set('Authorization', as.cara).send({ practiceId: id.practice })).status).toBe(404);
    expect((await request(app).post(`${api}/membership/leave`).set('Authorization', as.kavi).send({ practiceId: id.practice })).status).toBe(404);
    expect((await membership(id.kavi)).active).toBe(true);
    expect((await request(app).post(`${api}/membership/leave`).set('Authorization', as.cara).send({})).status).toBe(400);
  });
});
