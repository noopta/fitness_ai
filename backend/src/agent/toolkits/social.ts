// Friends, feed, messages, groups, Train Together (SOC, GRP, TT), plus
// diagnostics & form checks (DIA, FRM), plan & billing (BIL) and teams (INS).
// Anything other people will see is a DRAFT; nothing leaves until the user
// taps Send / Post. Ops call the real routes (moderation, block checks, rate
// limits, pushes) through loopback.

import { registerToolkit } from '../registry.js';
import { defineOp } from '../ops.js';
import { callApi } from '../loopback.js';
import { tool, schema, str, numOr, prisma, parseJson } from './kit.js';
import { dayLabel, plural, weight } from '../cards/format.js';
import type { CardDraft } from '../cards/types.js';

const who = (u: any) => u?.name || (u?.username ? `@${u.username}` : 'Someone');

/** Resolve a friend by name / @username; ambiguous → candidates. */
async function resolveFriend(userId: string, q: string): Promise<{ friend?: any; candidates?: any[] }> {
  const friends: any[] = await callApi(userId, 'GET', '/social/friends');
  const n = q.replace(/^@/, '').toLowerCase().trim();
  const exact = friends.filter((f) => (f.username ?? '').toLowerCase() === n || (f.name ?? '').toLowerCase() === n);
  if (exact.length === 1) return { friend: exact[0] };
  const part = friends.filter((f) => (f.username ?? '').toLowerCase().includes(n) || (f.name ?? '').toLowerCase().includes(n));
  if (part.length === 1) return { friend: part[0] };
  return { candidates: (part.length ? part : friends).slice(0, 5) };
}

// ── Ops ──────────────────────────────────────────────────────────────────────
const op = (name: string, run: (u: string, a: any) => Promise<{ result?: unknown; inverse: any; summary: string }>) => defineOp({ name, run });
op('social.post', async (u, a) => { const r: any = await callApi(u, 'POST', '/social/share', { itemType: a.itemType, payload: a.payload, caption: a.caption ?? undefined, visibility: a.visibility ?? 'friends' }); return { result: { id: r.id }, inverse: { op: 'social.delete_post', args: { id: r.id } }, summary: `Posted · ${String(a.caption ?? a.payload?.text ?? a.itemType).slice(0, 60)}` }; });
op('social.delete_post', async (u, a) => { await callApi(u, 'DELETE', `/social/posts/${a.id}`); return { inverse: null, summary: 'Post deleted' }; });
op('social.react', async (u, a) => { const r: any = await callApi(u, 'POST', `/social/posts/${a.postId}/react`); return { result: r, inverse: { op: 'social.react', args: a }, summary: r.liked ? 'Liked a post' : 'Unliked a post' }; });
op('social.comment', async (u, a) => { await callApi(u, 'POST', `/social/posts/${a.postId}/comments`, { text: a.text }); return { inverse: null, summary: `Commented · ${String(a.text).slice(0, 60)}` }; });
op('social.report', async (u, a) => { await callApi(u, 'POST', '/social/report', { itemId: a.itemId, targetType: a.targetType, reason: a.reason, details: a.details }); return { inverse: null, summary: 'Reported' }; });
op('social.friend_request', async (u, a) => { const r: any = await callApi(u, 'POST', '/social/friends/request', { targetUserId: a.targetUserId }); return { result: r, inverse: null, summary: r.status === 'accepted' ? `Now friends with ${a.name}` : `Friend request sent to ${a.name}` }; });
op('social.accept', async (u, a) => { await callApi(u, 'POST', '/social/friends/accept', { requesterId: a.requesterId }); return { inverse: null, summary: `Accepted ${a.name}` }; });
op('social.decline', async (u, a) => { await callApi(u, 'POST', '/social/friends/decline', { requesterId: a.requesterId }); return { inverse: null, summary: `Declined ${a.name}` }; });
op('social.unfriend', async (u, a) => { await callApi(u, 'DELETE', `/social/friends/${a.userId}`); return { inverse: null, summary: `Removed ${a.name}` }; });
op('social.block', async (u, a) => { await callApi(u, 'POST', `/social/users/${a.userId}/block`); return { inverse: null, summary: `Blocked ${a.name}` }; });
op('social.dm', async (u, a) => { const c: any = await callApi(u, 'POST', '/social/conversations', { participantId: a.recipientId }); await callApi(u, 'POST', `/social/conversations/${c.id}/messages`, { body: a.body }); return { result: { conversationId: c.id }, inverse: null, summary: `Sent to ${a.name}` }; });
op('social.forward_workout', async (u, a) => { await callApi(u, 'POST', '/social/workouts/forward', { recipientId: a.recipientId, kind: a.kind, workout: a.workout, note: a.note ?? undefined }); return { inverse: null, summary: `Sent a workout to ${a.name}` }; });
op('social.forward_post', async (u, a) => { await callApi(u, 'POST', `/social/posts/${a.postId}/forward`, { recipientId: a.recipientId, message: a.note ?? undefined }); return { inverse: null, summary: `Sent a post to ${a.name}` }; });
op('social.forward_article', async (u, a) => { await callApi(u, 'POST', `/social/articles/${a.articleId}/forward`, { recipientId: a.recipientId, message: a.note ?? undefined }); return { inverse: null, summary: `Sent an article to ${a.name}` }; });
op('social.save_article', async (u, a) => { await callApi(u, a.save ? 'POST' : 'DELETE', `/social/articles/${a.id}/save`); return { inverse: { op: 'social.save_article', args: { ...a, save: !a.save } }, summary: a.save ? 'Saved article' : 'Unsaved article' }; });
op('groups.create', async (u, a) => { const r: any = await callApi(u, 'POST', '/groups', a.group); return { result: r, inverse: { op: 'groups.leave', args: { id: r.group.id } }, summary: `Started ${a.group.name}` }; });
op('groups.message', async (u, a) => { await callApi(u, 'POST', `/groups/${a.id}/messages`, { text: a.text }); return { inverse: null, summary: `Posted in ${a.name}` }; });
op('groups.update', async (u, a) => { await callApi(u, 'PATCH', `/groups/${a.id}`, a.patch); return { inverse: a.previous ? { op: 'groups.update', args: { id: a.id, patch: a.previous } } : null, summary: `Updated ${a.name}` }; });
op('groups.leave', async (u, a) => { await callApi(u, 'POST', `/groups/${a.id}/leave`); return { inverse: null, summary: 'Left the group' }; });
op('tt.nudge', async (u, a) => { await callApi(u, 'POST', '/train-together/nudge', { friendId: a.friendId }); return { inverse: null, summary: `Asked ${a.name} to share their schedule` }; });
op('tt.pin', async (u, a) => { const r: any = await callApi(u, 'POST', '/train-together/pins', { date: a.date, memberIds: a.memberIds, note: a.note ?? undefined }); return { result: { id: r.id }, inverse: { op: 'tt.cancel', args: { id: r.id } }, summary: `Invited ${a.names} for ${dayLabel(a.date)}` }; });
op('tt.respond', async (u, a) => { await callApi(u, 'POST', `/train-together/pins/${a.id}/respond`, { response: a.response }); return { inverse: null, summary: a.response === 'accepted' ? 'You’re in' : 'Declined' }; });
op('tt.cancel', async (u, a) => { await callApi(u, 'DELETE', `/train-together/pins/${a.id}`); return { inverse: null, summary: 'Partner session cancelled' }; });
op('tt.shared_accept', async (u, a) => { await callApi(u, 'POST', `/train-together/pins/${a.id}/shared-session/respond`, { response: 'accepted' }); return { inverse: null, summary: 'Using the shared workout' }; });
op('diag.share', async (u, a) => { const r: any = await callApi(u, 'POST', `/lift-diagnostics/${a.id}/share`); return { result: r, inverse: null, summary: `Shared · ${r.shareUrl}` }; });
op('diag.delete', async (u, a) => { await callApi(u, 'DELETE', `/sessions/${a.id}`); return { inverse: null, summary: 'Diagnostic deleted' }; });
op('form.delete', async (u, a) => { await callApi(u, 'DELETE', `/form-analysis/${a.id}`); return { inverse: null, summary: 'Form check deleted' }; });
op('capture.form_started', async (u, a) => {
  const fa = await prisma.formAnalysis.findFirst({ where: { id: String(a.value), userId: u } });
  if (!fa) throw new Error('That upload didn’t arrive.');
  const next: CardDraft = { fn: 'FRM-01', pattern: 'glance', rule: 'show', meta: { label: `Form check · ${fa.exercise ?? fa.exerciseHint ?? 'video'}` }, skeleton: 3, note: 'Analysing — I’ll post the result here when it’s ready.' };
  return { result: { nextCard: next }, inverse: null, summary: 'Form check uploaded' };
});

const need = (friend: any, candidates: any[] | undefined, q: string): CardDraft | null => friend ? null : ({ fn: 'SOC-06', pattern: 'ask', rule: 'show', ask: { q: `Which friend — “${q}”?`, options: (candidates ?? []).map(who), typeInstead: true }, pending: { answer: { asMessage: 'I mean {answer}.' } } });

export const SOCIAL_TOOLS = [
  tool({
    name: 'read_feed', kind: 'read', fn: 'SOC-01',
    description: 'Recent posts and workouts from the user’s friends (ids, who, what, likes, comments).',
    input_schema: schema({ limit: { type: 'number' } }),
    receipt: () => ({ verb: 'Pulled', text: 'Friends’ activity' }),
    execute: async (input, userId) => {
      const r: any = await callApi(userId, 'GET', `/social/feed?slim=1&include_research=0&limit=${Math.min(20, Math.max(1, numOr(input.limit, 8)!))}`);
      return { posts: (r.items ?? []).filter((i: any) => i.kind === 'post').map((i: any) => ({ id: i.data.id, who: who(i.data.sharer), type: i.data.itemType, text: i.data.caption ?? i.data.payload?.text ?? i.data.payload?.title ?? '', likes: i.data.reactionCount, likedByMe: i.data.likedByMe, comments: i.data.commentCount, at: i.data.createdAt })) };
    },
    card: (_i, r) => r.posts.length
      ? { fn: 'SOC-01', pattern: 'glance', rule: 'show', meta: { label: 'Friends', open: { page: 'feed' } }, rows: r.posts.slice(0, 6).map((p: any) => ({ key: p.who, value: `${p.likes} ♥`, sub: String(p.text || p.type).slice(0, 80) })) }
      : { fn: 'SOC-01', pattern: 'glance', rule: 'show', meta: { label: 'Friends' }, empty: 'Nothing from friends yet.', actions: [{ id: 'invite', label: 'Invite a friend', kind: 'primary', client: { action: 'send_message', args: { text: 'Give me my invite link.' } } }] },
  }),
  tool({
    name: 'draft_post', kind: 'draft', fn: 'SOC-02',
    description: 'Draft a feed post: text, or share a workout (workoutLogId), a PR, a streak, the strength profile or the program. audience friends (default) or public. Shows exactly what others will see; posts only on the user’s tap.',
    input_schema: schema({ text: { type: 'string' }, kind: { type: 'string', enum: ['text', 'workout', 'pr', 'streak', 'strength_profile', 'program'] }, workoutLogId: { type: 'string' }, audience: { type: 'string', enum: ['friends', 'public'] } }),
    receipt: () => ({ verb: 'Drafted', text: 'Post' }),
    execute: async (input, userId) => {
      const kind = str(input.kind) || 'text';
      let payload: any = { text: str(input.text) };
      let attachment: { title: string; sub?: string } | undefined;
      if (kind === 'workout') {
        const log = str(input.workoutLogId) ? await prisma.workoutLog.findFirst({ where: { id: str(input.workoutLogId), userId } }) : await prisma.workoutLog.findFirst({ where: { userId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
        if (!log) throw new Error('No workout to share yet.');
        const exs = parseJson<any[]>(log.exercises, []);
        payload = { title: log.title ?? 'Workout', date: log.date, duration: log.duration, exercises: exs.map((e) => ({ name: e.name, sets: e.sets, reps: e.reps, weightKg: e.weightKg })) };
        attachment = { title: `${log.title ?? 'Workout'} · ${dayLabel(log.date)}`, sub: `${plural(exs.length, 'exercise')}` };
      } else if (kind !== 'text') {
        attachment = { title: kind === 'pr' ? 'Personal record' : kind === 'streak' ? 'Streak' : kind === 'program' ? 'My program' : 'Strength profile' };
        payload = { text: str(input.text), kind };
      }
      if (kind === 'text' && !payload.text) throw new Error('What should the post say?');
      return { itemType: kind === 'text' ? 'text' : kind, payload, caption: kind === 'text' ? undefined : str(input.text) || undefined, audience: str(input.audience) === 'public' ? 'public' : 'friends', attachment };
    },
    card: (_i, r) => ({
      fn: 'SOC-02', pattern: 'draft', rule: 'draft_send', meta: { label: 'Draft · post' },
      draft: { to: r.audience === 'public' ? 'Everyone' : 'Friends', audience: r.audience === 'public' ? 'Anyone on Axiom can see this' : 'Your friends see this', body: r.caption ?? r.payload.text ?? '', ...(r.attachment ? { attachment: r.attachment } : {}) },
      actions: [{ id: 'send', label: 'Post', kind: 'primary' }, { id: 'edit', label: 'Edit', kind: 'secondary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }],
      pending: { actions: { send: { op: 'social.post', args: { itemType: r.itemType, payload: r.payload, caption: r.caption, visibility: r.audience }, status: 'posted', line: `Posted to ${r.audience === 'public' ? 'everyone' : 'Friends'}` }, edit: { kind: 'dismiss' }, cancel: { kind: 'cancel', line: 'Cancelled — nothing posted' } } },
    }),
  }),
  tool({
    name: 'draft_comment', kind: 'draft', fn: 'SOC-03',
    description: 'Draft a comment on a friend’s post (postId from read_feed), optionally with a like. Sends on tap.',
    input_schema: schema({ postId: { type: 'string' }, text: { type: 'string' }, like: { type: 'boolean' } }, ['postId']),
    receipt: () => ({ verb: 'Drafted', text: 'Comment' }),
    execute: async (input, userId) => {
      const r: any = await callApi(userId, 'GET', '/social/feed?slim=1&include_research=0&limit=30');
      const post = (r.items ?? []).find((i: any) => i.kind === 'post' && i.data.id === str(input.postId))?.data;
      if (!post) throw new Error('I can’t find that post.');
      return { postId: post.id, who: who(post.sharer), what: String(post.caption ?? post.payload?.text ?? post.itemType).slice(0, 80), text: str(input.text), like: !!input.like && !post.likedByMe };
    },
    card: (_i, r) => {
      const actions: CardDraft['actions'] = [];
      const pend: Record<string, any> = {};
      if (r.text) { actions.push({ id: 'send', label: 'Send', kind: 'primary' }); pend.send = { op: 'social.comment', args: { postId: r.postId, text: r.text }, status: 'sent', line: 'Sent' }; }
      if (r.like) { actions.push({ id: 'like', label: 'Like', kind: r.text ? 'secondary' : 'primary' }); pend.like = { op: 'social.react', args: { postId: r.postId }, line: 'Liked' }; }
      actions.push({ id: 'cancel', label: 'Cancel', kind: 'cancel' }); pend.cancel = { kind: 'cancel', line: 'Cancelled — nothing sent' };
      return { fn: 'SOC-03', pattern: 'draft', rule: 'draft_send', meta: { label: `Draft · comment for ${r.who}` }, draft: { to: r.who, audience: 'Everyone who can see the post', body: r.text || '♥', attachment: { title: r.what } }, actions, pending: { actions: pend } };
    },
  }),
  tool({
    name: 'delete_post', kind: 'confirm', fn: 'SOC-04',
    description: 'Delete one of the user’s own posts (postId, or the latest).',
    input_schema: schema({ postId: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Post to delete' }),
    execute: async (input, userId) => {
      const post = str(input.postId) ? await prisma.sharedItem.findFirst({ where: { id: str(input.postId), sharerId: userId } }) : await prisma.sharedItem.findFirst({ where: { sharerId: userId, recipientId: null }, orderBy: { createdAt: 'desc' } });
      if (!post) throw new Error('That isn’t one of your posts.');
      const p = parseJson<any>(post.payload as any, {});
      return { id: post.id, what: String(post.caption ?? p.text ?? post.itemType).slice(0, 80) };
    },
    card: (_i, r) => ({ fn: 'SOC-04', pattern: 'confirm', rule: 'confirm_delete', meta: { label: 'Delete post' }, lose: { items: [r.what, 'Its likes and comments'] }, actions: [{ id: 'delete', label: 'Delete', kind: 'destructive' }, { id: 'keep', label: 'Keep', kind: 'cancel' }], pending: { actions: { delete: { op: 'social.delete_post', args: { id: r.id }, status: 'deleted', line: 'Deleted' }, keep: { kind: 'keep' } } } }),
  }),
  tool({
    name: 'report_content', kind: 'draft', fn: 'SOC-05',
    description: 'Report a post, comment, message or user (itemId + targetType). The user picks the reason on the card.',
    input_schema: schema({ itemId: { type: 'string' }, targetType: { type: 'string', enum: ['post', 'comment', 'message', 'user'] }, details: { type: 'string' } }, ['itemId']),
    receipt: () => ({ verb: 'Drafted', text: 'Report' }),
    execute: async (input) => ({ itemId: str(input.itemId), targetType: str(input.targetType) || 'post', details: str(input.details) }),
    card: (_i, r) => {
      const reasons = ['harassment', 'spam', 'hate', 'sexual', 'violence', 'self_harm', 'other'];
      const labels = ['Harassment', 'Spam', 'Hate', 'Sexual content', 'Violence', 'Self-harm', 'Something else'];
      return { fn: 'SOC-05', pattern: 'confirm', rule: 'draft_send', meta: { label: `Report ${r.targetType}` }, options: labels, choice: { options: labels, value: -1, field: 'reason' },
        actions: [{ id: 'report', label: 'Report', kind: 'destructive' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }],
        pending: { actions: { report: { op: 'social.report', args: { itemId: r.itemId, targetType: r.targetType, reason: 'other', details: r.details || undefined }, status: 'sent', line: 'Reported — thanks' }, cancel: { kind: 'cancel' } }, choice: { field: 'reason', argKey: 'reason', values: reasons } } };
    },
  }),
  tool({
    name: 'read_friends', kind: 'read', fn: 'SOC-06',
    description: 'The user’s friends, and pending friend requests to them (with Accept / Decline on the card).',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Friends' }),
    execute: async (_i, userId) => {
      const [friends, requests]: any[] = await Promise.all([callApi(userId, 'GET', '/social/friends'), callApi(userId, 'GET', '/social/friends/requests')]);
      return { friends: friends.map((f: any) => ({ id: f.id, name: who(f), username: f.username })), requests: requests.map((q: any) => ({ requesterId: q.requesterId, name: who(q.requester) })) };
    },
    card: (_i, r) => {
      const cards: CardDraft[] = [];
      if (r.requests.length) cards.push({
        fn: 'SOC-08', pattern: 'glance', rule: 'draft_send', meta: { label: `Friend requests · ${r.requests.length}` },
        rows: r.requests.map((q: any) => ({ key: q.name })),
        actions: r.requests.slice(0, 3).flatMap((q: any, i: number) => [{ id: `a${i}`, label: `Accept ${q.name}`.slice(0, 30), kind: 'primary' as const }, { id: `d${i}`, label: 'Decline', kind: 'secondary' as const }]),
        pending: { actions: Object.fromEntries(r.requests.slice(0, 3).flatMap((q: any, i: number) => [[`a${i}`, { op: 'social.accept', args: { requesterId: q.requesterId, name: q.name }, line: `Now friends with ${q.name}` }], [`d${i}`, { op: 'social.decline', args: { requesterId: q.requesterId, name: q.name }, line: 'Declined' }]])) },
      });
      cards.push(r.friends.length ? { fn: 'SOC-06', pattern: 'glance', rule: 'show', meta: { label: `Friends · ${r.friends.length}`, open: { page: 'feed' } }, rows: r.friends.slice(0, 10).map((f: any) => ({ key: f.name, sub: f.username ? `@${f.username}` : undefined })) }
        : { fn: 'SOC-06', pattern: 'glance', rule: 'show', meta: { label: 'Friends' }, empty: 'No friends here yet.', actions: [{ id: 'invite', label: 'Invite someone', kind: 'primary', client: { action: 'send_message', args: { text: 'Give me my invite link.' } } }] });
      return cards;
    },
  }),
  tool({
    name: 'find_people', kind: 'read', fn: 'SOC-07',
    description: 'Search Axiom users by name or @username, with whether you’re already friends. Then draft_friend_request to add one.',
    input_schema: schema({ q: { type: 'string' } }, ['q']),
    receipt: (i) => ({ verb: 'Searched', text: `People · ${str(i.q)}` }),
    execute: async (input, userId) => ({ people: ((await callApi<any[]>(userId, 'GET', `/social/users/search?q=${encodeURIComponent(str(input.q))}`)) ?? []).map((p) => ({ id: p.id, name: who(p), username: p.username, status: p.friendshipStatus })) }),
    card: (_i, r) => r.people.length
      ? { fn: 'SOC-07', pattern: 'glance', rule: 'show', meta: { label: 'People' }, rows: r.people.slice(0, 6).map((p: any) => ({ key: p.name, value: p.status === 'accepted' ? 'Friends' : p.status === 'pending_sent' ? 'Requested' : p.status === 'pending_received' ? 'Wants to be friends' : '', sub: p.username ? `@${p.username}` : undefined })) }
      : { fn: 'SOC-07', pattern: 'glance', rule: 'show', meta: { label: 'People' }, empty: 'No one by that name.' },
  }),
  tool({
    name: 'draft_friend_request', kind: 'draft', fn: 'SOC-07',
    description: 'Draft a friend request to a user (userId from find_people). Sends on tap.',
    input_schema: schema({ userId: { type: 'string' } }, ['userId']),
    receipt: () => ({ verb: 'Drafted', text: 'Friend request' }),
    execute: async (input, userId) => {
      const p: any = await callApi(userId, 'GET', `/social/profile/${encodeURIComponent(str(input.userId))}`);
      return { id: p.user.id, name: who(p.user), username: p.user.username, mutual: p.mutualFriendsCount, status: p.friendshipStatus };
    },
    card: (_i, r) => r.status === 'accepted'
      ? { fn: 'SOC-07', pattern: 'glance', rule: 'show', meta: { label: r.name }, empty: 'You’re already friends.' }
      : { fn: 'SOC-07', pattern: 'draft', rule: 'draft_send', meta: { label: 'Draft · friend request' }, draft: { to: r.name, audience: r.mutual ? `${plural(r.mutual, 'mutual friend')}` : 'No mutual friends', attachment: { title: r.name, sub: r.username ? `@${r.username}` : undefined } },
          actions: [{ id: 'send', label: 'Send request', kind: 'primary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }],
          pending: { actions: { send: { op: 'social.friend_request', args: { targetUserId: r.id, name: r.name }, status: 'sent', line: 'Request sent' }, cancel: { kind: 'cancel' } } } },
  }),
  tool({
    name: 'remove_or_block', kind: 'confirm', fn: 'SOC-09',
    description: 'Remove a friend, or block someone (they can’t see you or message you). friend = name or @username; action remove | block.',
    input_schema: schema({ friend: { type: 'string' }, userId: { type: 'string' }, action: { type: 'string', enum: ['remove', 'block'] } }, ['action']),
    receipt: (i) => ({ verb: 'Read', text: i.action === 'block' ? 'Block' : 'Remove friend' }),
    execute: async (input, userId) => {
      if (str(input.userId)) { const p: any = await callApi(userId, 'GET', `/social/profile/${str(input.userId)}`); return { id: p.user.id, name: who(p.user), action: str(input.action) }; }
      const { friend, candidates } = await resolveFriend(userId, str(input.friend));
      return friend ? { id: friend.id, name: who(friend), action: str(input.action) } : { candidates, q: str(input.friend) };
    },
    card: (_i, r) => r.candidates ? need(null, r.candidates, r.q) : ({
      fn: 'SOC-09', pattern: 'confirm', rule: 'confirm_delete', meta: { label: r.action === 'block' ? `Block ${r.name}` : `Remove ${r.name}` },
      lose: { items: r.action === 'block' ? ['They can’t see your posts or message you', 'You’re no longer friends'] : ['You stop seeing each other’s posts and schedules'] },
      actions: [{ id: 'go', label: r.action === 'block' ? 'Block' : 'Remove', kind: 'destructive' }, { id: 'keep', label: 'Cancel', kind: 'cancel' }],
      pending: { actions: { go: { op: r.action === 'block' ? 'social.block' : 'social.unfriend', args: { userId: r.id, name: r.name }, status: 'deleted', line: r.action === 'block' ? 'Blocked' : 'Removed' }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    name: 'read_user_profile', kind: 'read', fn: 'SOC-10',
    description: 'Someone’s public profile: name, @username, whether you’re friends, mutual friends.',
    input_schema: schema({ userId: { type: 'string' }, friend: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Profile' }),
    execute: async (input, userId) => {
      let id = str(input.userId);
      if (!id && str(input.friend)) { const { friend, candidates } = await resolveFriend(userId, str(input.friend)); if (!friend) return { candidates, q: str(input.friend) }; id = friend.id; }
      const p: any = await callApi(userId, 'GET', `/social/profile/${encodeURIComponent(id)}`);
      return { id: p.user.id, name: who(p.user), username: p.user.username, status: p.friendshipStatus, mutual: p.mutualFriendsCount, since: p.user.createdAt };
    },
    card: (_i, r) => r.candidates ? need(null, r.candidates, r.q) : ({ fn: 'SOC-10', pattern: 'glance', rule: 'show', meta: { label: r.name, open: { page: 'person', params: { id: r.id } } }, rows: [...(r.username ? [{ key: 'Username', value: `@${r.username}` }] : []), { key: 'Friends', value: r.status === 'accepted' ? 'Yes' : r.status === 'pending_sent' ? 'Requested' : 'No' }, { key: 'Mutual friends', value: String(r.mutual) }],
      actions: r.status === 'accepted' ? [{ id: 'msg', label: 'Message', kind: 'secondary', client: { action: 'send_message', args: { text: `Message ${r.name}: ` } } }] : [{ id: 'add', label: 'Add friend', kind: 'secondary', client: { action: 'send_message', args: { text: `Send ${r.name} a friend request.` } } }] }),
  }),
  tool({
    name: 'get_invite_link', kind: 'draft', fn: 'SOC-11',
    description: 'The user’s personal invite link to bring a friend onto Axiom.',
    input_schema: schema({ to: { type: 'string', description: 'Who it’s for (for the card only).' } }),
    receipt: () => ({ verb: 'Read', text: 'Invite link' }),
    execute: async (input, userId) => ({ ...(await callApi<any>(userId, 'GET', '/social/invite')), to: str(input.to) }),
    card: (_i, r) => ({ fn: 'SOC-11', pattern: 'draft', rule: 'draft_send', meta: { label: 'Invite link' }, draft: { to: r.to || 'A friend', audience: 'Anyone with the link', body: `Train with me on Axiom: ${r.link}` },
      actions: [{ id: 'copy', label: 'Copy link', kind: 'primary', client: { action: 'share', args: { text: `Train with me on Axiom: ${r.link}`, url: r.link, mode: 'copy' } } }, { id: 'share', label: 'Share', kind: 'secondary', client: { action: 'share', args: { text: `Train with me on Axiom: ${r.link}`, url: r.link } } }] }),
  }),
  tool({
    name: 'read_messages', kind: 'read', fn: 'SOC-12',
    description: 'The user’s direct-message inbox: who, last message, unread count.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Messages' }),
    execute: async (_i, userId) => ({ conversations: ((await callApi<any[]>(userId, 'GET', '/social/conversations')) ?? []).slice(0, 10).map((c) => ({ id: c.id, with: who(c.otherUser), withId: c.otherUser?.id, last: c.lastMessage, unread: c.unreadCount, at: c.lastMessageAt })) }),
    card: (_i, r) => r.conversations.length
      ? { fn: 'SOC-12', pattern: 'glance', rule: 'show', meta: { label: 'Messages', open: { page: 'messages' } }, rows: r.conversations.slice(0, 6).map((c: any) => ({ key: c.with, value: c.unread ? `${c.unread} new` : '', sub: String(c.last ?? '').slice(0, 70) })) }
      : { fn: 'SOC-12', pattern: 'glance', rule: 'show', meta: { label: 'Messages' }, empty: 'No messages yet.' },
  }),
  tool({
    name: 'draft_message', kind: 'draft', fn: 'SOC-12',
    description: 'Draft a direct message to a friend or coach (to = name or @username). Sends on tap; the user can edit it first.',
    input_schema: schema({ to: { type: 'string' }, body: { type: 'string' } }, ['to', 'body']),
    receipt: (i) => ({ verb: 'Drafted', text: `Message to ${str(i.to)}` }),
    execute: async (input, userId) => {
      const { friend, candidates } = await resolveFriend(userId, str(input.to));
      if (!friend) return { candidates, q: str(input.to) };
      return { id: friend.id, name: who(friend), body: str(input.body).slice(0, 4000) };
    },
    card: (_i, r) => r.candidates ? need(null, r.candidates, r.q) : ({ fn: 'SOC-12', pattern: 'draft', rule: 'draft_send', meta: { label: 'Draft · message' }, draft: { to: r.name, audience: `Only ${r.name} sees this`, body: r.body },
      actions: [{ id: 'send', label: 'Send', kind: 'primary' }, { id: 'edit', label: 'Edit', kind: 'secondary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }],
      pending: { actions: { send: { op: 'social.dm', args: { recipientId: r.id, body: r.body, name: r.name }, status: 'sent', line: 'Sent' }, edit: { kind: 'dismiss' }, cancel: { kind: 'cancel', line: 'Cancelled — nothing sent' } } } }),
  }),
  tool({
    name: 'draft_forward', kind: 'draft', fn: 'SOC-13',
    description: 'Send a friend a workout (today’s planned session, or a logged one), a post, or an article, with an optional note. what = today | logged | post | article; id for logged/post/article.',
    input_schema: schema({ to: { type: 'string' }, what: { type: 'string', enum: ['today', 'logged', 'post', 'article'] }, id: { type: 'string' }, note: { type: 'string' } }, ['to', 'what']),
    receipt: () => ({ verb: 'Drafted', text: 'Share with a friend' }),
    execute: async (input, userId) => {
      const { friend, candidates } = await resolveFriend(userId, str(input.to));
      if (!friend) return { candidates, q: str(input.to) };
      const what = str(input.what);
      if (what === 'today') {
        const t: any = await callApi(userId, 'GET', '/coach/today');
        const s = t?.todaySession; if (!s) throw new Error('Nothing is planned today.');
        return { friend: { id: friend.id, name: who(friend) }, op: 'social.forward_workout', args: { kind: 'planned', workout: { date: new Date().toISOString().slice(0, 10), title: s.day ?? s.name, focus: s.focus, exercises: (s.exercises ?? []).map((e: any) => ({ name: e.exercise ?? e.name, sets: e.sets, reps: e.reps, intensity: e.intensity })) } }, title: `${s.day ?? 'Today’s session'}`, note: str(input.note) };
      }
      if (what === 'logged') {
        const log = str(input.id) ? await prisma.workoutLog.findFirst({ where: { id: str(input.id), userId } }) : await prisma.workoutLog.findFirst({ where: { userId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
        if (!log) throw new Error('No logged workout to send.');
        return { friend: { id: friend.id, name: who(friend) }, op: 'social.forward_workout', args: { kind: 'logged', workout: { id: log.id, date: log.date, title: log.title, duration: log.duration, exercises: parseJson<any[]>(log.exercises, []) } }, title: `${log.title ?? 'Workout'} · ${dayLabel(log.date)}`, note: str(input.note) };
      }
      return { friend: { id: friend.id, name: who(friend) }, op: what === 'post' ? 'social.forward_post' : 'social.forward_article', args: what === 'post' ? { postId: str(input.id) } : { articleId: str(input.id) }, title: what === 'post' ? 'A post' : 'An article', note: str(input.note) };
    },
    card: (_i, r) => r.candidates ? need(null, r.candidates, r.q) : ({ fn: 'SOC-13', pattern: 'draft', rule: 'draft_send', meta: { label: `Draft · to ${r.friend.name}` }, draft: { to: r.friend.name, audience: `Only ${r.friend.name} sees this`, body: r.note || undefined, attachment: { title: r.title } },
      actions: [{ id: 'send', label: 'Send', kind: 'primary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }],
      pending: { actions: { send: { op: r.op, args: { ...r.args, recipientId: r.friend.id, name: r.friend.name, note: r.note || undefined }, status: 'sent', line: 'Sent' }, cancel: { kind: 'cancel' } } } }),
  }),
  tool({
    name: 'read_articles', kind: 'read', fn: 'SOC-14',
    description: 'Research articles from the feed (optionally the saved ones), each with Save and Send on the card.',
    input_schema: schema({ saved: { type: 'boolean' } }),
    receipt: () => ({ verb: 'Pulled', text: 'Research' }),
    execute: async (input, userId) => ({ saved: !!input.saved, items: ((await callApi<any>(userId, 'GET', input.saved ? '/social/articles/saved' : '/social/feed/articles')).items ?? []).slice(0, 5).map((a: any) => ({ id: a.id, title: a.title, source: a.source, url: a.url, summary: a.summary })) }),
    card: (_i, r) => r.items.length ? {
      fn: 'SOC-14', pattern: 'glance', rule: 'show', meta: { label: r.saved ? 'Saved articles' : 'New research' },
      rows: r.items.map((a: any) => ({ key: a.title, sub: a.source })),
      actions: r.items.slice(0, 3).flatMap((a: any, i: number) => [{ id: `read${i}`, label: `Read: ${a.title}`.slice(0, 36), kind: 'secondary' as const, client: { action: 'open_url' as const, args: { url: a.url } } }, ...(!r.saved ? [{ id: `save${i}`, label: 'Save', kind: 'secondary' as const }] : [])]),
      pending: { actions: Object.fromEntries(r.items.slice(0, 3).map((a: any, i: number) => [`save${i}`, { op: 'social.save_article', args: { id: a.id, save: true }, line: 'Saved' }])) },
    } : { fn: 'SOC-14', pattern: 'glance', rule: 'show', meta: { label: 'Research' }, empty: r.saved ? 'No saved articles.' : 'Nothing new right now.' },
  }),
  tool({
    name: 'read_leaderboard', kind: 'read', fn: 'SOC-15',
    description: 'Friends ranked by estimated 1RM on a lift (default flat bench). Lists the lifts that have entries too.',
    input_schema: schema({ lift: { type: 'string', description: 'e.g. flat_bench_press, back_squat, deadlift' } }),
    receipt: () => ({ verb: 'Pulled', text: 'Leaderboard' }),
    execute: async (input, userId) => {
      const [board, lifts]: any[] = await Promise.all([callApi(userId, 'GET', `/social/leaderboard?lift=${encodeURIComponent(str(input.lift) || 'flat_bench_press')}`), callApi(userId, 'GET', '/social/leaderboard/lifts')]);
      return { lift: board.lift, entries: board.entries, lifts: lifts.lifts };
    },
    card: async (_i, r, ctx) => r.entries.length
      ? { fn: 'SOC-15', pattern: 'glance', rule: 'show', meta: { label: `Leaderboard · ${String(r.lift).replace(/_/g, ' ')}`, open: { page: 'leaderboard' } }, rows: r.entries.slice(0, 8).map((e: any) => ({ key: `${e.rank}. ${e.isYou ? 'You' : who(e)}`, value: weight(ctx.unit, e.e1RM), mark: e.isYou ? 'chg' as const : undefined })) }
      : { fn: 'SOC-15', pattern: 'glance', rule: 'show', meta: { label: 'Leaderboard' }, empty: 'No friends have logged that lift yet.' },
  }),

  // ── Groups ──
  tool({
    name: 'read_groups', kind: 'read', fn: 'GRP-01',
    description: 'The user’s groups: name, goal, members, last message, whether Anakin checks in daily.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Groups' }),
    execute: async (_i, userId) => ({ groups: ((await callApi<any>(userId, 'GET', '/groups')).groups ?? []).map((g: any) => ({ id: g.id, name: g.name, goal: g.groupGoal, members: g.members?.length ?? 0, anakinDaily: g.anakinDailyEnabled, last: g.messages?.[0]?.text ?? null, myGoal: g.members?.find((m: any) => m.userId === userId)?.goal ?? null })) }),
    card: (_i, r) => r.groups.length ? { fn: 'GRP-01', pattern: 'glance', rule: 'show', meta: { label: 'Groups', open: { page: 'groups' } }, rows: r.groups.map((g: any) => ({ key: g.name, value: plural(g.members, 'member'), sub: String(g.last ?? g.goal ?? '').slice(0, 70) })) } : { fn: 'GRP-01', pattern: 'glance', rule: 'show', meta: { label: 'Groups' }, empty: 'You’re not in a group yet.' },
  }),
  tool({
    name: 'draft_group', kind: 'draft', fn: 'GRP-02',
    description: 'Draft a new group with friends (names or @usernames), a shared goal, your own goal, and whether Anakin checks in every morning. Only friends can be added. Creates on tap.',
    input_schema: schema({ name: { type: 'string' }, goal: { type: 'string' }, members: { type: 'array', items: { type: 'string' } }, myGoal: { type: 'string' }, anakinDaily: { type: 'boolean' } }, ['name']),
    receipt: () => ({ verb: 'Drafted', text: 'Group' }),
    execute: async (input, userId) => {
      const names: string[] = [];
      const usernames: string[] = [];
      for (const m of (Array.isArray(input.members) ? input.members : []) as string[]) {
        const { friend } = await resolveFriend(userId, String(m));
        if (friend?.username) { usernames.push(friend.username); names.push(who(friend)); }
      }
      return { group: { name: str(input.name).slice(0, 80), groupGoal: str(input.goal) || undefined, memberUsernames: usernames, selfGoal: str(input.myGoal) || undefined, anakinDailyEnabled: !!input.anakinDaily }, names };
    },
    card: (_i, r) => ({ fn: 'GRP-02', pattern: 'draft', rule: 'draft_send', meta: { label: 'Draft · group' },
      draft: { to: r.names.join(', ') || 'Just you for now', audience: 'Members see messages and each other’s goals', body: r.group.groupGoal ?? '', attachment: { title: r.group.name, sub: r.group.anakinDailyEnabled ? 'Anakin checks in every morning' : undefined } },
      actions: [{ id: 'send', label: 'Create group', kind: 'primary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }],
      pending: { actions: { send: { op: 'groups.create', args: { group: r.group }, status: 'sent', line: 'Group created' }, cancel: { kind: 'cancel' } } } }),
  }),
  tool({
    name: 'draft_group_message', kind: 'draft', fn: 'GRP-03',
    description: 'Draft a message to one of the user’s groups (group = name).',
    input_schema: schema({ group: { type: 'string' }, text: { type: 'string' } }, ['group', 'text']),
    receipt: () => ({ verb: 'Drafted', text: 'Group message' }),
    execute: async (input, userId) => {
      const gs: any[] = (await callApi<any>(userId, 'GET', '/groups')).groups ?? [];
      const g = gs.find((x) => x.name.toLowerCase().includes(str(input.group).toLowerCase()));
      if (!g) throw new Error(`You’re not in a group called "${str(input.group)}".`);
      return { id: g.id, name: g.name, members: g.members?.length ?? 0, text: str(input.text).slice(0, 2000) };
    },
    card: (_i, r) => ({ fn: 'GRP-03', pattern: 'draft', rule: 'draft_send', meta: { label: `Draft · ${r.name}` }, draft: { to: r.name, audience: `${plural(r.members, 'member')} see this`, body: r.text }, actions: [{ id: 'send', label: 'Send', kind: 'primary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }], pending: { actions: { send: { op: 'groups.message', args: { id: r.id, text: r.text, name: r.name }, status: 'sent', line: 'Sent' }, cancel: { kind: 'cancel' } } } }),
  }),
  tool({
    name: 'update_group', kind: 'set', fn: 'GRP-04',
    description: 'Change a group’s goal, Anakin’s daily check-in, or the user’s own goal in it, when they ask.',
    input_schema: schema({ group: { type: 'string' }, goal: { type: 'string' }, anakinDaily: { type: 'boolean' }, myGoal: { type: 'string' } }, ['group']),
    receipt: () => ({ verb: 'Adjusted', text: 'Group' }),
    execute: async (input, userId) => {
      const gs: any[] = (await callApi<any>(userId, 'GET', '/groups')).groups ?? [];
      const g = gs.find((x) => x.name.toLowerCase().includes(str(input.group).toLowerCase()));
      if (!g) throw new Error(`You’re not in a group called "${str(input.group)}".`);
      const patch: any = {}; const previous: any = {}; const lines: string[] = [];
      if (input.goal !== undefined) { patch.groupGoal = str(input.goal) || null; previous.groupGoal = g.groupGoal; lines.push(`Group goal · ${g.groupGoal ?? '—'} → ${patch.groupGoal ?? '—'}`); }
      if (typeof input.anakinDaily === 'boolean') { patch.anakinDailyEnabled = input.anakinDaily; previous.anakinDailyEnabled = g.anakinDailyEnabled; lines.push(`Anakin’s daily check-in · ${g.anakinDailyEnabled ? 'On' : 'Off'} → ${input.anakinDaily ? 'On' : 'Off'}`); }
      if (input.myGoal !== undefined) { const mine = g.members?.find((m: any) => m.userId === userId)?.goal ?? null; patch.selfGoal = str(input.myGoal) || null; previous.selfGoal = mine; lines.push(`My goal · ${mine ?? '—'} → ${patch.selfGoal ?? '—'}`); }
      if (!lines.length) throw new Error('Say what to change.');
      const { executeOp } = await import('../ops.js');
      const change = await executeOp(userId, 'groups.update', { id: g.id, patch, previous, name: g.name });
      return { lines, name: g.name, _change: change };
    },
    card: (_i, r) => ({ fn: 'GRP-04', pattern: 'setting', rule: 'change_undo', meta: { label: r.name }, rows: r.lines.map((l: string) => { const [key, rest] = l.split(' · '); const [from, to] = (rest ?? '').split(' → '); return { key, value: to, sub: `was ${from}` }; }) }),
  }),
  tool({
    name: 'leave_group', kind: 'confirm', fn: 'GRP-05',
    description: 'Leave one of the user’s groups.',
    input_schema: schema({ group: { type: 'string' } }, ['group']),
    receipt: () => ({ verb: 'Read', text: 'Group' }),
    execute: async (input, userId) => {
      const gs: any[] = (await callApi<any>(userId, 'GET', '/groups')).groups ?? [];
      const g = gs.find((x) => x.name.toLowerCase().includes(str(input.group).toLowerCase()));
      if (!g) throw new Error(`You’re not in a group called "${str(input.group)}".`);
      return { id: g.id, name: g.name };
    },
    card: (_i, r) => ({ fn: 'GRP-05', pattern: 'confirm', rule: 'confirm_delete', meta: { label: `Leave ${r.name}` }, lose: { items: ['You stop getting its messages and check-ins'] }, actions: [{ id: 'leave', label: 'Leave', kind: 'destructive' }, { id: 'stay', label: 'Stay', kind: 'cancel' }], pending: { actions: { leave: { op: 'groups.leave', args: { id: r.id }, status: 'deleted', line: 'Left' }, stay: { kind: 'keep', line: 'Stayed' } } } }),
  }),

  // ── Train Together ──
  tool({
    name: 'find_training_overlap', kind: 'read', fn: 'TT-01',
    description: 'Days in the next 2–4 weeks when the user and friends (names) both train, with how well the sessions match. Both need schedule sharing on.',
    input_schema: schema({ friends: { type: 'array', items: { type: 'string' } }, weeks: { type: 'number' } }, ['friends']),
    receipt: () => ({ verb: 'Computed', text: 'Shared training days' }),
    execute: async (input, userId) => {
      const ids: string[] = []; const names: string[] = [];
      for (const f of (input.friends as string[]) ?? []) { const { friend } = await resolveFriend(userId, String(f)); if (friend) { ids.push(friend.id); names.push(who(friend)); } }
      if (!ids.length) throw new Error('I couldn’t find those friends.');
      try {
        const r: any = await callApi(userId, 'GET', `/train-together/overlap?friendIds=${ids.join(',')}&weeks=${Math.min(4, Math.max(1, numOr(input.weeks, 2)!))}`);
        return { names, ids, days: (r.days ?? []).filter((d: any) => d.tier !== 'none').slice(0, 8).map((d: any) => ({ date: d.date, tier: d.tier, reason: d.reason })) };
      } catch (e: any) {
        return { names, ids, blocked: e?.body?.blocked ?? null, code: e?.body?.code ?? null, error: e?.message };
      }
    },
    card: (_i, r) => {
      if (r.error) return { fn: 'TT-01', pattern: 'glance', rule: 'show', meta: { label: 'Train together' }, empty: r.code === 'sharing_off' ? 'Turn on schedule sharing first.' : r.blocked?.length ? `${r.blocked.map((b: any) => b.name).join(', ')} ${r.blocked.length === 1 ? 'hasn’t' : 'haven’t'} turned on sharing.` : r.error,
        actions: r.blocked?.length ? [{ id: 'ask', label: 'Ask them to share', kind: 'primary', client: { action: 'send_message', args: { text: `Ask ${r.blocked.map((b: any) => b.name).join(' and ')} to share their schedule.` } } }] : r.code === 'sharing_off' ? [{ id: 'on', label: 'Turn on sharing', kind: 'primary', client: { action: 'send_message', args: { text: 'Turn on schedule sharing.' } } }] : [] };
      return r.days.length
        ? { fn: 'TT-01', pattern: 'glance', rule: 'show', meta: { label: `You and ${r.names.join(', ')}`, open: { page: 'traintogether' } }, rows: r.days.map((d: any) => ({ key: dayLabel(d.date), value: d.tier === 'exact' ? 'Same session' : d.tier === 'strong' ? 'Close match' : 'Both training', sub: d.reason ?? undefined })),
            actions: [{ id: 'plan', label: 'Plan one', kind: 'primary', client: { action: 'send_message', args: { text: `Book ${dayLabel(r.days[0].date)} with ${r.names.join(' and ')}.` } } }] }
        : { fn: 'TT-01', pattern: 'glance', rule: 'show', meta: { label: `You and ${r.names.join(', ')}` }, empty: 'No shared training days in that window.' };
    },
  }),
  tool({
    name: 'draft_sharing_nudge', kind: 'draft', fn: 'TT-02',
    description: 'Ask a friend to turn on schedule sharing so you can find days to train together.',
    input_schema: schema({ friend: { type: 'string' } }, ['friend']),
    receipt: () => ({ verb: 'Drafted', text: 'Sharing request' }),
    execute: async (input, userId) => { const { friend, candidates } = await resolveFriend(userId, str(input.friend)); return friend ? { id: friend.id, name: who(friend) } : { candidates, q: str(input.friend) }; },
    card: (_i, r) => r.candidates ? need(null, r.candidates, r.q) : ({ fn: 'TT-02', pattern: 'draft', rule: 'draft_send', meta: { label: 'Draft · nudge' }, draft: { to: r.name, audience: `Only ${r.name} sees this`, body: 'Turn on schedule sharing so we can find days to train together?' }, actions: [{ id: 'send', label: 'Send', kind: 'primary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }], pending: { actions: { send: { op: 'tt.nudge', args: { friendId: r.id, name: r.name }, status: 'sent', line: 'Sent' }, cancel: { kind: 'cancel' } } } }),
  }),
  tool({
    name: 'draft_partner_session', kind: 'draft', fn: 'TT-03',
    description: 'Plan a partner session: date, friends, note (time, gym). Sends the invites on tap.',
    input_schema: schema({ date: { type: 'string' }, friends: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } }, ['date', 'friends']),
    receipt: () => ({ verb: 'Drafted', text: 'Partner session' }),
    execute: async (input, userId) => {
      const ids: string[] = []; const names: string[] = [];
      for (const f of (input.friends as string[]) ?? []) { const { friend } = await resolveFriend(userId, String(f)); if (friend) { ids.push(friend.id); names.push(who(friend)); } }
      if (!ids.length) throw new Error('I couldn’t find those friends.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(input.date))) throw new Error('Give the date as YYYY-MM-DD.');
      return { date: str(input.date), ids, names, note: str(input.note).slice(0, 200) };
    },
    card: (_i, r) => ({ fn: 'TT-03', pattern: 'draft', rule: 'draft_send', meta: { label: 'Draft · partner session' }, draft: { to: r.names.join(', '), audience: 'They get an invite', body: r.note || undefined, attachment: { title: dayLabel(r.date) } },
      actions: [{ id: 'send', label: 'Send invites', kind: 'primary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }],
      pending: { actions: { send: { op: 'tt.pin', args: { date: r.date, memberIds: r.ids, note: r.note || undefined, names: r.names.join(', ') }, status: 'sent', line: 'Invites sent' }, cancel: { kind: 'cancel' } } } }),
  }),
  tool({
    name: 'read_partner_sessions', kind: 'read', fn: 'TT-04',
    description: 'Upcoming partner sessions and invites (who, when, status). Invites waiting on the user get I’m in / Can’t on the card.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Partner sessions' }),
    execute: async (_i, userId) => ({ pins: ((await callApi<any[]>(userId, 'GET', '/train-together/pins')) ?? []).map((p) => ({ id: p.id, date: p.date, note: p.note, status: p.status, mine: p.creatorId === userId, myResponse: p.members?.find((m: any) => m.userId === userId)?.response ?? null, with: (p.members ?? []).filter((m: any) => m.userId !== userId).map((m: any) => who(m.user)) })) }),
    card: (_i, r) => {
      const invites = r.pins.filter((p: any) => !p.mine && (!p.myResponse || p.myResponse === 'pending'));
      const cards: CardDraft[] = invites.slice(0, 2).map((p: any) => ({
        fn: 'TT-04', pattern: 'ask', rule: 'draft_send', meta: { label: `Invite · ${dayLabel(p.date)}` }, ask: { q: `Train with ${p.with.join(', ')} on ${dayLabel(p.date)}?`, options: [] }, ...(p.note ? { why: p.note } : {}),
        actions: [{ id: 'in', label: 'I’m in', kind: 'primary' }, { id: 'out', label: 'Can’t', kind: 'secondary' }],
        pending: { actions: { in: { op: 'tt.respond', args: { id: p.id, response: 'accepted' }, status: 'sent', line: 'You’re in' }, out: { op: 'tt.respond', args: { id: p.id, response: 'declined' }, status: 'sent', line: 'Declined' } } },
      }));
      if (r.pins.length) cards.push({ fn: 'TT-04', pattern: 'glance', rule: 'show', meta: { label: 'Partner sessions', open: { page: 'traintogether' } }, rows: r.pins.slice(0, 6).map((p: any) => ({ key: dayLabel(p.date), value: p.status === 'confirmed' ? 'Confirmed' : 'Waiting', sub: p.with.join(', ') })) });
      return cards.length ? cards : { fn: 'TT-04', pattern: 'glance', rule: 'show', meta: { label: 'Partner sessions' }, empty: 'Nothing planned with friends.' };
    },
  }),
  tool({
    name: 'cancel_partner_session', kind: 'confirm', fn: 'TT-05',
    description: 'Cancel a partner session you planned, or leave one you were invited to (by date).',
    input_schema: schema({ date: { type: 'string' }, id: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Partner session' }),
    execute: async (input, userId) => {
      const pins: any[] = await callApi(userId, 'GET', '/train-together/pins');
      const p = pins.find((x) => x.id === str(input.id)) ?? pins.find((x) => x.date === str(input.date)) ?? pins[0];
      if (!p) throw new Error('No partner session to cancel.');
      return { id: p.id, date: p.date, mine: p.creatorId === userId, with: (p.members ?? []).filter((m: any) => m.userId !== userId).map((m: any) => who(m.user)) };
    },
    card: (_i, r) => ({ fn: 'TT-05', pattern: 'confirm', rule: 'confirm_delete', meta: { label: `${r.mine ? 'Cancel' : 'Leave'} · ${dayLabel(r.date)}` }, lose: { items: [`${r.with.join(', ')} ${r.with.length === 1 ? 'is' : 'are'} told`] }, actions: [{ id: 'go', label: r.mine ? 'Cancel it' : 'Leave', kind: 'destructive' }, { id: 'keep', label: 'Keep', kind: 'cancel' }], pending: { actions: { go: { op: 'tt.cancel', args: { id: r.id }, status: 'deleted', line: r.mine ? 'Cancelled' : 'Left' }, keep: { kind: 'keep' } } } }),
  }),
  tool({
    name: 'propose_shared_session', kind: 'propose', fn: 'TT-06',
    description: 'Build one shared workout for a partner session (from everyone’s programs) and propose using it for the user’s day.',
    input_schema: schema({ date: { type: 'string' }, id: { type: 'string' } }),
    receipt: () => ({ verb: 'Proposed', text: 'Shared workout' }),
    execute: async (input, userId) => {
      const pins: any[] = await callApi(userId, 'GET', '/train-together/pins');
      const p = pins.find((x) => x.id === str(input.id)) ?? pins.find((x) => x.date === str(input.date));
      if (!p) throw new Error('No partner session on that day.');
      const r: any = await callApi(userId, 'POST', `/train-together/pins/${p.id}/shared-session`);
      return { id: p.id, date: p.date, session: r.session };
    },
    card: (_i, r) => ({ fn: 'TT-06', pattern: 'proposal', rule: 'propose', meta: { label: `Proposed · shared workout ${dayLabel(r.date)}` }, rows: (r.session?.exercises ?? []).slice(0, 8).map((e: any) => ({ key: e.exercise ?? e.name, value: `${e.sets} × ${e.reps}` })), why: r.session?.focus ?? 'Replaces your planned session that day.',
      actions: [{ id: 'apply', label: 'Use it', kind: 'primary' }, { id: 'keep', label: 'Keep my own day', kind: 'secondary' }], pending: { actions: { apply: { op: 'tt.shared_accept', args: { id: r.id } }, keep: { kind: 'keep' } } } }),
  }),

  // ── Diagnostics & form checks ──
  tool({
    name: 'read_diagnostics', kind: 'read', fn: 'DIA-03',
    description: 'The user’s lift diagnostics (lift, status, limiter, confidence) — or one report in detail (id): verdict, evidence, the fix, what’s missing.',
    input_schema: schema({ id: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Diagnostics' }),
    execute: async (input, userId) => {
      if (str(input.id)) { const r: any = await callApi(userId, 'GET', `/lift-diagnostics/${encodeURIComponent(str(input.id))}/report`); return { report: r.verdict, isPublic: r.isPublic }; }
      return { list: ((await callApi<any>(userId, 'GET', '/lift-diagnostics')).diagnostics ?? []).slice(0, 8) };
    },
    card: (_i, r) => {
      if (r.report) {
        const v = r.report;
        return { fn: 'DIA-03', pattern: 'glance', rule: 'show', meta: { label: `${v.lift} · diagnostic`, open: { page: 'report', params: { id: v.sessionId } } },
          hero: { value: v.limiter?.hypothesisLabel ?? 'No clear limiter', ...(v.confidence != null ? { unit: `${Math.round(v.confidence * 100)}% confident` } : {}) },
          rows: [...(v.evidence ?? []).slice(0, 3).map((e: any) => ({ key: e.tag, value: e.text })), ...(v.fix?.primary ? [{ key: 'The fix', value: `${v.fix.primary.name} · ${v.fix.primary.sets} × ${v.fix.primary.reps}` }] : [])],
          actions: [{ id: 'apply', label: 'Apply the fix', kind: 'primary', client: { action: 'send_message', args: { text: `Add the fix from my ${v.lift} diagnostic to my program.` } } }, ...(v.missingLifts?.length ? [{ id: 'more', label: 'Add numbers', kind: 'secondary' as const, client: { action: 'open_page' as const, args: { page: 'diagnostic', id: v.sessionId, action: 'addNumbers' } } }] : [])] };
      }
      return r.list.length
        ? { fn: 'DIA-03', pattern: 'glance', rule: 'show', meta: { label: 'Diagnostics', open: { page: 'diag' } }, rows: r.list.map((d: any) => ({ key: d.lift, value: d.status === 'complete' ? (d.limiter?.hypothesisLabel ?? 'Done') : 'In progress', sub: dayLabel(String(d.updatedAt).slice(0, 10)) })) }
        : { fn: 'DIA-03', pattern: 'glance', rule: 'show', meta: { label: 'Diagnostics' }, empty: 'No lift diagnostics yet.', actions: [{ id: 'start', label: 'Run one', kind: 'primary', client: { action: 'open_page', args: { page: 'diagnostic' } } }] };
    },
  }),
  tool({
    name: 'start_lift_diagnostic', kind: 'intent', fn: 'DIA-01',
    description: 'Start (or resume) a lift diagnostic for a stuck lift: bench, incline bench, deadlift, back squat or front squat. It asks for the main set, accessories, three questions and an optional video, then gives a verdict.',
    input_schema: schema({ lift: { type: 'string' }, resumeId: { type: 'string' } }),
    receipt: (i) => ({ verb: 'Started', text: `${str(i.lift) || 'Lift'} diagnostic` }),
    execute: async (input) => ({ lift: str(input.lift), resumeId: str(input.resumeId) }),
    card: (_i, r) => ({ fn: r.resumeId ? 'DIA-02' : 'DIA-01', pattern: 'handoff', rule: 'show', meta: { label: `${r.lift || 'Lift'} diagnostic` }, note: 'About 5 minutes. I’ll post the verdict here when it’s done.', handoff: { label: r.resumeId ? 'Continue' : 'Start', action: 'open_page', args: { page: 'diagnostic', lift: r.lift || undefined, id: r.resumeId || undefined } } }),
  }),
  tool({
    name: 'share_diagnostic', kind: 'draft', fn: 'DIA-06',
    description: 'Make a diagnostic report shareable and get its link (id from read_diagnostics).',
    input_schema: schema({ id: { type: 'string' } }, ['id']),
    receipt: () => ({ verb: 'Drafted', text: 'Share link' }),
    execute: async (input) => ({ id: str(input.id) }),
    card: (_i, r) => ({ fn: 'DIA-06', pattern: 'draft', rule: 'draft_send', meta: { label: 'Share report' }, draft: { to: 'Anyone with the link', audience: 'Your verdict and fix, no personal details' }, actions: [{ id: 'send', label: 'Make link', kind: 'primary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }], pending: { actions: { send: { op: 'diag.share', args: { id: r.id }, status: 'sent', line: 'Link ready' }, cancel: { kind: 'cancel' } } } }),
  }),
  tool({
    name: 'delete_diagnostic', kind: 'confirm', fn: 'DIA-07',
    description: 'Delete a lift diagnostic (id). Can’t be undone.',
    input_schema: schema({ id: { type: 'string' } }, ['id']),
    receipt: () => ({ verb: 'Read', text: 'Diagnostic' }),
    execute: async (input) => ({ id: str(input.id) }),
    card: (_i, r) => ({ fn: 'DIA-07', pattern: 'confirm', rule: 'confirm_delete', meta: { label: 'Delete diagnostic' }, lose: { items: ['The verdict, your answers and any video'], keep: 'This can’t be undone.' }, actions: [{ id: 'delete', label: 'Delete', kind: 'destructive' }, { id: 'keep', label: 'Keep', kind: 'cancel' }], pending: { actions: { delete: { op: 'diag.delete', args: { id: r.id }, status: 'deleted', line: 'Deleted' }, keep: { kind: 'keep' } } } }),
  }),
  tool({
    name: 'read_form_checks', kind: 'read', fn: 'FRM-02',
    description: 'Form-check videos: the list, or one result (id) with score, reps, what’s good, what to fix and drills.',
    input_schema: schema({ id: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Form checks' }),
    execute: async (input, userId) => {
      if (str(input.id)) return { one: await callApi(userId, 'GET', `/form-analysis/${encodeURIComponent(str(input.id))}`) };
      return { list: ((await callApi<any>(userId, 'GET', '/form-analysis')).analyses ?? []).slice(0, 8) };
    },
    card: (_i, r) => {
      if (r.one) {
        const a: any = r.one;
        if (a.status !== 'complete') return { fn: 'FRM-02', pattern: 'glance', rule: 'show', meta: { label: `Form check · ${a.exercise ?? 'video'}` }, skeleton: a.status === 'pending' ? 3 : undefined, empty: a.status === 'failed' ? (a.errorMessage ?? 'That video couldn’t be analysed.') : undefined, note: a.status === 'pending' ? 'Still analysing.' : undefined };
        const an = a.analysis ?? {};
        return { fn: 'FRM-02', pattern: 'glance', rule: 'show', meta: { label: `Form check · ${a.exercise ?? an.exercise ?? 'video'}`, open: { page: 'form', params: { id: a.id } } }, hero: { value: String(a.formScore ?? an.formScore ?? '—'), unit: `of 10 · ${a.repCount ?? an.repCount ?? '—'} reps` },
          rows: [...(an.strengths ?? []).slice(0, 2).map((s: string) => ({ key: 'Good', value: s })), ...(an.weaknesses ?? []).slice(0, 3).map((w: any) => ({ key: w.issue, value: w.cue, mark: w.severity === 'major' ? 'chg' as const : undefined }))],
          actions: an.recommendedDrills?.length ? [{ id: 'drills', label: 'Add drills to my program', kind: 'secondary', client: { action: 'send_message', args: { text: `Add ${an.recommendedDrills.map((d: any) => d.name).slice(0, 2).join(' and ')} to my program.` } } }] : [] };
      }
      return r.list.length
        ? { fn: 'FRM-03', pattern: 'glance', rule: 'show', meta: { label: 'Form checks', open: { page: 'diag' } }, rows: r.list.map((a: any) => ({ key: a.exercise ?? 'Video', value: a.status === 'complete' ? `${a.formScore ?? '—'} of 10` : a.status === 'pending' ? 'Analysing' : 'Failed', sub: dayLabel(String(a.createdAt).slice(0, 10)) })) }
        : { fn: 'FRM-03', pattern: 'glance', rule: 'show', meta: { label: 'Form checks' }, empty: 'No form checks yet.', actions: [{ id: 'start', label: 'Check my form', kind: 'primary', client: { action: 'send_message', args: { text: 'Check my form on video.' } } }] };
    },
  }),
  tool({
    name: 'start_form_check', kind: 'intent', fn: 'FRM-01',
    description: 'Open the camera to record or choose a lift video (up to 60 s) for a form check. The result is posted in the chat when it’s ready.',
    input_schema: schema({ exercise: { type: 'string' } }),
    receipt: () => ({ verb: 'Opened', text: 'Camera' }),
    execute: async (input) => ({ exercise: str(input.exercise) }),
    card: (_i, r) => ({ fn: 'FRM-01', pattern: 'capture', rule: 'handoff', meta: { label: `Form check${r.exercise ? ` · ${r.exercise}` : ''}` }, note: 'Film from the side, whole body in frame, one set.', handoff: { label: 'Record', action: 'open_camera', args: { mode: 'video', exercise: r.exercise || undefined } },
      actions: [{ id: 'cancel', label: 'Cancel', kind: 'cancel' }], pending: { answer: { op: 'capture.form_started', valueKey: 'value' }, actions: { cancel: { kind: 'cancel', line: 'Cancelled' } } } }),
  }),
  tool({
    name: 'delete_form_check', kind: 'confirm', fn: 'FRM-04',
    description: 'Delete a form-check video and its result (id).',
    input_schema: schema({ id: { type: 'string' } }, ['id']),
    receipt: () => ({ verb: 'Read', text: 'Form check' }),
    execute: async (input) => ({ id: str(input.id) }),
    card: (_i, r) => ({ fn: 'FRM-04', pattern: 'confirm', rule: 'confirm_delete', meta: { label: 'Delete form check' }, lose: { items: ['The video stills and the analysis'], keep: 'This can’t be undone.' }, actions: [{ id: 'delete', label: 'Delete', kind: 'destructive' }, { id: 'keep', label: 'Keep', kind: 'cancel' }], pending: { actions: { delete: { op: 'form.delete', args: { id: r.id }, status: 'deleted', line: 'Deleted' }, keep: { kind: 'keep' } } } }),
  }),

  // ── Plan & billing ──
  tool({
    name: 'read_subscription', kind: 'read', fn: 'BIL-01',
    description: 'The user’s plan (Free or Pro), how it’s billed (App Store, Google Play or card) and its status.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Plan' }),
    execute: async (_i, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, stripeSubStatus: true, appleOriginalTransactionId: true, googlePurchaseToken: true, googleSubExpiresAt: true } });
      const via = u?.appleOriginalTransactionId ? 'App Store' : u?.googlePurchaseToken ? 'Google Play' : u?.stripeSubStatus ? 'Card' : null;
      return { plan: u?.tier === 'pro' || u?.tier === 'enterprise' ? 'Pro' : 'Free', via, status: u?.stripeSubStatus ?? null, renews: u?.googleSubExpiresAt ?? null };
    },
    card: (_i, r) => ({ fn: 'BIL-01', pattern: 'glance', rule: 'show', meta: { label: 'Plan', open: { page: 'billing' } }, hero: { value: r.plan }, rows: [...(r.via ? [{ key: 'Billed through', value: r.via }] : []), ...(r.renews ? [{ key: 'Renews', value: dayLabel(new Date(r.renews).toISOString().slice(0, 10)) }] : [])],
      actions: r.plan === 'Pro' ? [{ id: 'manage', label: 'Manage', kind: 'secondary', client: { action: 'manage_subscription' } }] : [{ id: 'pro', label: 'Go Pro', kind: 'primary', client: { action: 'purchase' } }] }),
  }),
  tool({
    name: 'read_usage', kind: 'read', fn: 'BIL-02',
    description: 'What the user has left today on free-tier limits: AI food logs (photo, describe, scan), lift analyses, Anakin messages.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Today’s limits' }),
    execute: async (_i, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, dailyPhotoScanCount: true, dailyPhotoScanDate: true, dailyAnalysisCount: true, dailyAnalysisDate: true, agentTurnsCount: true, agentTurnsDate: true } });
      const pro = u?.tier === 'pro' || u?.tier === 'enterprise';
      const today = new Date().toISOString().slice(0, 10);
      const used = (n: number | null | undefined, d: any) => (d && new Date(d).toISOString().slice(0, 10) === today ? n ?? 0 : 0);
      return { pro, food: { used: used(u?.dailyPhotoScanCount, u?.dailyPhotoScanDate), limit: pro ? null : 7 }, analyses: { used: used(u?.dailyAnalysisCount, u?.dailyAnalysisDate), limit: pro ? null : 2 }, messages: { used: used(u?.agentTurnsCount, u?.agentTurnsDate), limit: pro ? 200 : 10 } };
    },
    card: (_i, r) => ({ fn: 'BIL-02', pattern: 'glance', rule: 'show', meta: { label: 'Today’s limits', open: { page: 'billing' } }, rows: [
      { key: 'AI food logs', value: r.food.limit ? `${r.food.used} of ${r.food.limit}` : 'Unlimited' },
      { key: 'Lift analyses', value: r.analyses.limit ? `${r.analyses.used} of ${r.analyses.limit}` : 'Unlimited' },
      { key: 'Messages to me', value: `${r.messages.used} of ${r.messages.limit}` }],
      note: 'Resets at midnight.', ...(r.pro ? {} : { actions: [{ id: 'pro', label: 'Go unlimited', kind: 'primary', client: { action: 'purchase' } }] }) }),
  }),
  ...([
    ['open_upgrade', 'BIL-03', 'The user wants Pro: opens the App Store / Play purchase sheet (a store requirement — never a card payment in chat).', 'Start free week', 'purchase', 'Unlimited food scans and analyses, new programs, and more messages to me.'],
    ['restore_purchases', 'BIL-04', 'Restore a Pro purchase made on another phone or before reinstalling.', 'Restore purchases', 'restore_purchases', 'Uses your App Store or Google Play account.'],
    ['manage_subscription', 'BIL-05', 'Manage or cancel Pro: opens the App Store, Google Play or billing portal. Cancelling keeps Pro until the period ends.', 'Manage subscription', 'manage_subscription', 'You keep Pro until the end of the period you paid for.'],
  ] as const).map(([name, fn, description, label, action, note]) => tool({
    name, kind: 'intent', fn, description, input_schema: schema({}),
    receipt: () => ({ verb: 'Opened', text: label }),
    execute: async () => ({ ok: true }),
    card: () => ({ fn, pattern: 'handoff', rule: 'handoff', meta: { label }, note, handoff: { label, action: action as any } }),
  })),

  // ── Teams & coaches ──
  tool({
    name: 'read_team', kind: 'read', fn: 'INS-01',
    description: 'The teams (institutions) the user belongs to, their role, and the coaches they can message.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Team' }),
    execute: async (_i, userId) => {
      const ms = await prisma.institutionMember.findMany({ where: { userId, active: true }, include: { institution: { select: { name: true, slug: true } } } });
      const out: any[] = [];
      for (const m of ms) {
        const coaches: any[] = await callApi<any[]>(userId, 'GET', `/institutions/${m.institution.slug}/coach-info`).catch(() => []);
        out.push({ team: m.institution.name, slug: m.institution.slug, role: m.role, coaches: coaches.map((c) => ({ id: c.id, name: c.name })) });
      }
      return { teams: out };
    },
    card: (_i, r) => r.teams.length ? { fn: 'INS-01', pattern: 'glance', rule: 'show', meta: { label: 'Your team' }, rows: r.teams.flatMap((t: any) => [{ key: t.team, value: t.role === 'coach' ? 'Coach' : 'Athlete' }, ...t.coaches.map((c: any) => ({ key: c.name ?? 'Coach', sub: 'Coach' }))]) } : { fn: 'INS-01', pattern: 'glance', rule: 'show', meta: { label: 'Team' }, empty: 'You’re not on a team.' },
  }),
  tool({
    name: 'coach_roster', kind: 'read', fn: 'INS-03',
    description: 'For coaches: the athletes on their team, or one athlete’s recent workouts, check-ins and weight (athleteUserId).',
    input_schema: schema({ athleteUserId: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Athletes' }),
    execute: async (input, userId) => {
      const m = await prisma.institutionMember.findFirst({ where: { userId, active: true, role: 'coach' }, include: { institution: { select: { slug: true, name: true } } } });
      if (!m) throw new Error('Only coaches can see a roster.');
      if (str(input.athleteUserId)) {
        const d: any = await callApi(userId, 'GET', `/institutions/${m.institution.slug}/athletes/${encodeURIComponent(str(input.athleteUserId))}`);
        return { athlete: { name: d.profile?.name, workouts: (d.workoutLogs ?? []).slice(0, 5).map((w: any) => ({ date: w.date, title: w.title })), checkins: (d.wellnessCheckins ?? []).slice(0, 3) } };
      }
      return { team: m.institution.name, athletes: ((await callApi<any[]>(userId, 'GET', `/institutions/${m.institution.slug}/athletes`)) ?? []).map((a) => ({ userId: a.userId, name: a.user?.name })) };
    },
    card: (_i, r) => r.athlete
      ? { fn: 'INS-03', pattern: 'glance', rule: 'show', meta: { label: r.athlete.name ?? 'Athlete' }, rows: r.athlete.workouts.map((w: any) => ({ key: dayLabel(w.date), value: w.title ?? 'Workout' })) }
      : { fn: 'INS-03', pattern: 'glance', rule: 'show', meta: { label: `${r.team} · athletes` }, rows: r.athletes.map((a: any) => ({ key: a.name ?? 'Athlete' })) },
  }),
];

registerToolkit(SOCIAL_TOOLS);
