// Account (catalog ACC-01…12): identity, date of birth, deletion, export,
// sign-out and other hand-offs. Name and username changes go through the real
// routes (moderation, reserved names, uniqueness) via loopback.

import { SUPPORT_EMAIL as TEMPLATE_SUPPORT_EMAIL } from '../../services/emailTemplates.js';
import { registerToolkit } from '../registry.js';
import { defineOp, UNDO_DELETE_MS, executeOp } from '../ops.js';
import { callApi } from '../loopback.js';
import { tool, schema, str, prisma } from './kit.js';
import { validateDateOfBirth } from '../../validation/physiologicalBounds.js';
import { requestReset } from '../../services/passwordResetService.js';
import type { CardDraft } from '../cards/types.js';

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || TEMPLATE_SUPPORT_EMAIL;
const TERMS_URL = process.env.TERMS_URL || 'https://axiomtraining.io/terms';
const PRIVACY_URL = process.env.PRIVACY_URL || 'https://axiomtraining.io/privacy';

const fmtDob = (d: Date | string | null | undefined) => {
  if (!d) return 'Not set';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? 'Not set' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const planLabel = (tier: string, sub?: string | null) => (tier === 'pro' || tier === 'enterprise' ? `Pro${sub === 'active' ? '' : ''}` : 'Free');

defineOp({
  name: 'account.set',
  run: async (userId, args) => {
    const field = String(args.field);
    const value = args.value == null ? null : String(args.value).trim();
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true, dateOfBirth: true } });
    if (!u) throw new Error('User not found');
    if (field === 'name') {
      if (!value) throw new Error('A name can’t be empty.');
      await callApi(userId, 'PUT', '/auth/profile', { name: value.slice(0, 60) });
      return { result: { display: value }, inverse: u.name ? { op: 'account.set', args: { field, value: u.name } } : null, summary: `Name · ${u.name ?? '—'} → ${value}` };
    }
    if (field === 'username') {
      const clean = (value ?? '').replace(/^@/, '');
      await callApi(userId, 'PUT', '/auth/username', { username: clean });
      return { result: { display: `@${clean}` }, inverse: u.username ? { op: 'account.set', args: { field, value: u.username } } : null, summary: `Username · ${u.username ? '@' + u.username : '—'} → @${clean}` };
    }
    if (field === 'dateOfBirth') {
      const err = value ? validateDateOfBirth(value) : 'Enter a date of birth.';
      if (err) throw new Error(err);
      await prisma.user.update({ where: { id: userId }, data: { dateOfBirth: new Date(value!) } });
      return {
        result: { display: fmtDob(value) },
        inverse: u.dateOfBirth ? { op: 'account.set', args: { field, value: u.dateOfBirth.toISOString().slice(0, 10) } } : null,
        summary: `Date of birth · ${fmtDob(u.dateOfBirth)} → ${fmtDob(value)}`,
      };
    }
    throw new Error(`Can’t change ${field} here.`);
  },
});

defineOp({
  name: 'account.delete',
  run: async (userId, args) => {
    await callApi(userId, 'DELETE', '/auth/account', { reason: args.reason ?? null });
    return { result: { deleted: true }, inverse: null, summary: 'Account deleted' };
  },
});

async function suggestUsernames(userId: string, base: string): Promise<string[]> {
  const stem = base.replace(/[^a-z0-9_]/gi, '').slice(0, 24) || 'lifter';
  const candidates = [`${stem}1`, `${stem}_lifts`, `the_${stem}`, `${stem}_${new Date().getFullYear() % 100}`, `${stem}x`];
  const out: string[] = [];
  for (const c of candidates) {
    if (out.length >= 3) break;
    try {
      const r = await callApi<{ available: boolean }>(userId, 'GET', `/auth/check-username?username=${encodeURIComponent(c)}`);
      if (r.available) out.push(`@${c}`);
    } catch { /* skip */ }
  }
  return out;
}

export const ACCOUNT_TOOLS = [
  tool({
    name: 'read_account', kind: 'read', fn: 'ACC-01',
    description: 'Read the user’s account: display name, @username, email, sign-in method, plan, member since, date of birth.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Account' }),
    execute: async (_i, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true, email: true, tier: true, stripeSubStatus: true, createdAt: true, dateOfBirth: true, googleId: true, appleId: true, hashedPassword: true } });
      if (!u) throw new Error('User not found');
      const via = [u.hashedPassword ? 'Email' : null, u.googleId ? 'Google' : null, u.appleId ? 'Apple' : null].filter(Boolean).join(', ') || 'Email';
      return { name: u.name, username: u.username, email: u.email, plan: planLabel(u.tier, u.stripeSubStatus), memberSince: u.createdAt.toISOString().slice(0, 10), dateOfBirth: u.dateOfBirth?.toISOString().slice(0, 10) ?? null, signIn: via };
    },
    card: (_i, r) => ({
      fn: 'ACC-01', pattern: 'glance', rule: 'show', meta: { label: 'Account', open: { page: 'account' } },
      rows: [
        { key: 'Name', value: r.name ?? 'Not set', editable: { field: 'name', kind: 'text' } },
        { key: 'Username', value: r.username ? `@${r.username}` : 'Not set', editable: { field: 'username', kind: 'text' } },
        { key: 'Email', value: r.email ?? '—' },
        { key: 'Signs in with', value: r.signIn },
        { key: 'Plan', value: r.plan },
        { key: 'Date of birth', value: fmtDob(r.dateOfBirth), editable: { field: 'dateOfBirth', kind: 'date' } },
        { key: 'Member since', value: new Date(`${r.memberSince}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) },
      ],
      pending: { edits: {
        name: { op: 'account.set', args: { field: 'name' }, valueKey: 'value', parse: 'text' },
        username: { op: 'account.set', args: { field: 'username' }, valueKey: 'value', parse: 'text' },
        dateOfBirth: { op: 'account.set', args: { field: 'dateOfBirth' }, valueKey: 'value', parse: 'date' },
      } },
    }),
  }),
  tool({
    name: 'update_account', kind: 'set', fn: 'ACC-02',
    description: 'Change the user’s display name, @username or date of birth — only when they ask. One field per call. A taken username returns alternatives instead of changing anything.',
    input_schema: schema({ field: { type: 'string', enum: ['name', 'username', 'dateOfBirth'] }, value: { type: 'string', description: 'New value. dateOfBirth as YYYY-MM-DD.' } }, ['field', 'value']),
    receipt: (i) => ({ verb: 'Adjusted', text: i.field === 'username' ? 'Username' : i.field === 'dateOfBirth' ? 'Date of birth' : 'Name' }),
    execute: async (input, userId) => {
      const field = str(input.field);
      const value = str(input.value);
      if (field === 'username') {
        const clean = value.replace(/^@/, '');
        const check = await callApi<{ available: boolean }>(userId, 'GET', `/auth/check-username?username=${encodeURIComponent(clean)}`).catch(() => ({ available: true }));
        if (!check.available) {
          const u = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
          return { taken: true, requested: `@${clean}`, current: u?.username ? `@${u.username}` : null, suggestions: await suggestUsernames(userId, clean) };
        }
      }
      const change = await executeOp(userId, 'account.set', { field, value });
      return { changed: change.summary, field, _change: change };
    },
    card: (input, r) => {
      if (r.taken) {
        return {
          fn: 'ACC-03', pattern: 'setting', rule: 'change_undo', meta: { label: 'Username', open: { page: 'account' } },
          change: { key: 'Username', from: r.current ?? '—', to: r.requested, note: 'Taken.' },
          ask: { q: 'Any of these?', options: r.suggestions, typeInstead: true },
          pending: { answer: { op: 'account.set', args: { field: 'username' }, valueKey: 'value' } },
        } as CardDraft;
      }
      const [key, rest] = String(r.changed).split(' · ');
      const [from, to] = (rest ?? '').split(' → ');
      const fnMap: Record<string, string> = { name: 'ACC-02', username: 'ACC-03', dateOfBirth: 'ACC-05' };
      return { fn: fnMap[r.field] ?? 'ACC-02', pattern: 'setting', rule: 'change_undo', meta: { label: 'Account', open: { page: 'account' } }, change: { key, from, to }, undoLine: `Undone — back to ${from}` } as CardDraft;
    },
  }),
  tool({
    name: 'request_account_deletion', kind: 'confirm', fn: 'ACC-09',
    description: 'The user wants to delete their account. Shows what is deleted and kept, asks why, and requires typing DELETE on the card. You can never delete it yourself.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Account data' }),
    execute: async (_i, userId) => {
      const [workouts, meals, programs, created] = await Promise.all([
        prisma.workoutLog.count({ where: { userId } }), prisma.mealEntry.count({ where: { userId } }),
        prisma.completedProgram.count({ where: { userId } }), prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
      ]);
      const months = created ? Math.max(1, Math.round((Date.now() - created.createdAt.getTime()) / (30 * 86400000))) : 1;
      return { workouts, meals, programs, months };
    },
    card: (_i, r) => {
      const reasons = ['Too expensive', 'Didn’t use it enough', 'Missing features', 'Switching apps', 'Something didn’t work', 'Other'];
      return {
        fn: 'ACC-09', pattern: 'confirm', rule: 'confirm_delete', meta: { label: 'Delete account' },
        lose: {
          items: [`${r.months} month${r.months === 1 ? '' : 's'} of data`, `${r.workouts} workouts and ${r.meals} meals`, `${r.programs + 1} program${r.programs ? 's' : ''}, your chats with me, friends and posts`],
          keep: 'Payment records are kept for 7 years, as tax law requires.',
          typed: 'DELETE',
        },
        options: reasons,
        choice: { options: reasons, value: -1, field: 'reason' },
        actions: [
          { id: 'delete', label: 'Delete account', kind: 'destructive', requiresTyped: 'DELETE' },
          { id: 'keep', label: 'Keep my account', kind: 'cancel' },
        ],
        pending: {
          actions: { delete: { op: 'account.delete', args: {}, status: 'deleted', line: 'Account deleted' }, keep: { kind: 'keep', line: 'Kept — nothing deleted' } },
          choice: { field: 'reason', argKey: 'reason', values: reasons },
        },
      };
    },
  }),
  tool({
    name: 'export_data', kind: 'intent', fn: 'ACC-10',
    description: 'The user wants a copy of all their data. Returns a download link valid for 10 minutes.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Opened', text: 'Data export' }),
    execute: async (_i, userId) => callApi<{ url: string }>(userId, 'GET', '/auth/export-link'),
    card: (_i, r) => ({
      fn: 'ACC-10', pattern: 'handoff', rule: 'show', meta: { label: 'Your data' },
      rows: [{ key: 'Includes', value: 'Profile, workouts, meals, weigh-ins, check-ins, programs, chats' }, { key: 'Format', value: 'JSON file' }],
      note: 'The link works for 10 minutes.',
      handoff: { label: 'Download', action: 'open_url', args: { url: r.url } },
    }),
  }),
  tool({
    name: 'show_legal_links', kind: 'read', fn: 'ACC-11',
    description: 'Links to the terms of service and privacy policy.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Terms and privacy' }),
    execute: async () => ({ terms: TERMS_URL, privacy: PRIVACY_URL }),
    card: (_i, r) => ({ fn: 'ACC-11', pattern: 'glance', rule: 'show', meta: { label: 'Terms and privacy' }, actions: [
      { id: 'terms', label: 'Terms of service', kind: 'secondary', client: { action: 'open_url', args: { url: r.terms } } },
      { id: 'privacy', label: 'Privacy policy', kind: 'secondary', client: { action: 'open_url', args: { url: r.privacy } } },
    ] }),
  }),
  tool({
    name: 'change_email', kind: 'intent', fn: 'ACC-06',
    description: 'The user wants a different login email. That can’t be changed in the app yet; this hands them to support.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Checked', text: 'Email changes' }),
    execute: async () => ({ supportEmail: SUPPORT_EMAIL }),
    card: (_i, r) => ({ fn: 'ACC-06', pattern: 'handoff', rule: 'handoff', meta: { label: 'Change email' }, note: 'Your account stays the same — only the address changes.', handoff: { label: 'Email support', action: 'open_url', args: { url: `mailto:${r.supportEmail}?subject=${encodeURIComponent('Change my login email')}` } } }),
  }),
  tool({
    name: 'send_password_reset', kind: 'intent', fn: 'ACC-07',
    description: 'The user forgot or wants to change their password. Emails them a 6-digit reset code and opens the reset screen.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Sent', text: 'Reset code' }),
    execute: async (_i, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, hashedPassword: true, googleId: true, appleId: true } });
      if (!u?.email) throw new Error('There’s no email on this account.');
      if (!u.hashedPassword && (u.googleId || u.appleId)) return { noPassword: true, via: u.appleId ? 'Apple' : 'Google' };
      const r = await requestReset(u.email);
      return { email: u.email, cooldownRemainingSec: r.cooldownRemainingSec ?? 0 };
    },
    card: (_i, r) => r.noPassword
      ? { fn: 'ACC-07', pattern: 'handoff', rule: 'handoff', meta: { label: 'Password' }, note: `You sign in with ${r.via}, so there’s no Axiom password to reset.` }
      : { fn: 'ACC-07', pattern: 'handoff', rule: 'handoff', meta: { label: 'Password reset' }, rows: [{ key: 'Code sent to', value: r.email }], note: r.cooldownRemainingSec ? `A code was just sent — check your inbox.` : 'It expires in 15 minutes.', handoff: { label: 'Enter the code', action: 'reset_password', args: { email: r.email } } },
  }),
  ...([
    ['sign_out', 'ACC-08', 'Sign the user out on this phone (their plan and chat stay on the account).', 'Sign out', 'sign_out', 'Your plan and chat stay on this account.'],
    ['check_for_updates', 'ACC-12', 'Check whether a newer version of the app is available and install it.', 'Check for updates', 'check_updates', 'Updates install on the next launch.'],
    ['start_new_conversation', 'MEM-04', 'Start a fresh chat thread. History stays on the server.', 'Start fresh', 'new_conversation', 'I still remember what you’ve told me.'],
    ['open_phone_settings', 'PRF-07', 'Push notifications and camera permissions are phone settings; this opens them.', 'Open phone settings', 'open_os_settings', 'Notifications are switched on or off in your phone’s settings.'],
  ] as const).map(([name, fn, description, label, action, note]) => tool({
    name, kind: 'intent', fn, description, input_schema: schema({}),
    receipt: () => ({ verb: 'Opened', text: label }),
    execute: async () => ({ ok: true }),
    card: () => ({ fn, pattern: 'handoff', rule: 'handoff', meta: { label }, note, handoff: { label, action: action as any } }),
  })),
];
registerToolkit(ACCOUNT_TOOLS);
export { UNDO_DELETE_MS };
