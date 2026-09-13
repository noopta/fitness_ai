// Emails a published blog post to every opted-in Axiom user and every
// admin-added subscriber (BlogSubscriber). Once per post
// (BlogPost.emailedAt), claimed atomically before any mail goes out so a
// double-click on Publish can't send twice. Recipients: verified email, not
// unsubscribed. Sends in small parallel batches; per-recipient failures are
// counted, not fatal.
import { PrismaClient } from '@prisma/client';
import { sendEmail } from './mailService.js';
import { blogPostEmail, SUPPORT_EMAIL } from './emailTemplates.js';
import { unsubscribeUrl } from './emailUnsubscribe.js';

const prisma = new PrismaClient();
const BATCH = 10;

export interface BroadcastResult {
  status: 'sent' | 'already_emailed' | 'not_published' | 'not_found' | 'disabled';
  sent: number;
  failed: number;
  recipients: number;
}

export interface Recipient { id: string; email: string }

/**
 * Everyone a blog post goes to: verified, opted-in accounts plus admin-added
 * BlogSubscriber rows that haven't unsubscribed. Deduped by lowercased email
 * so a subscriber who later signs up is emailed once, via their account.
 */
export async function recipients(): Promise<Recipient[]> {
  const users = await prisma.user.findMany({
    where: { email: { not: null }, emailVerified: true, marketingEmailsOptOut: false },
    select: { id: true, email: true },
  });
  const subs = await prisma.blogSubscriber.findMany({
    where: { unsubscribedAt: null },
    select: { id: true, email: true },
  });
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of [...users, ...subs]) {
    const email = (r.email ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ id: r.id, email: r.email! });
  }
  return out;
}

export async function broadcastBlogPost(postId: string): Promise<BroadcastResult> {
  const none = (status: BroadcastResult['status']): BroadcastResult => ({ status, sent: 0, failed: 0, recipients: 0 });
  if (process.env.BLOG_EMAIL_ENABLED === '0') return none('disabled');

  const post = await prisma.blogPost.findUnique({ where: { id: postId } });
  if (!post) return none('not_found');
  if (!post.published) return none('not_published');
  if (post.emailedAt) return none('already_emailed');

  const claimed = await prisma.blogPost.updateMany({
    where: { id: post.id, emailedAt: null },
    data: { emailedAt: new Date() },
  });
  if (claimed.count !== 1) return none('already_emailed');

  const users = await recipients();

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < users.length; i += BATCH) {
    const slice = users.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async u => {
      const unsub = unsubscribeUrl(u.id);
      const msg = blogPostEmail(post, unsub);
      try {
        const r = await sendEmail({
          to: u.email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          replyTo: SUPPORT_EMAIL,
          headers: { 'List-Unsubscribe': `<${unsub}>` },
        });
        return r.sent;
      } catch {
        return false;
      }
    }));
    for (const ok of results) ok ? sent++ : failed++;
  }

  await prisma.blogPost.update({ where: { id: post.id }, data: { emailedCount: sent } }).catch(() => {});
  console.log(`[blog] emailed "${post.title}" → ${sent} sent, ${failed} failed, ${users.length} recipients`);
  return { status: 'sent', sent, failed, recipients: users.length };
}

/** Fire-and-forget for the publish route: never blocks the admin's save. */
export function scheduleBlogBroadcast(postId: string): void {
  setImmediate(() => {
    Promise.resolve()
      .then(() => broadcastBlogPost(postId))
      .catch(err => console.error('[blog] broadcast error:', err?.message ?? err));
  });
}
