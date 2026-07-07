// Train Together — find days to lift with friends without anyone changing
// their program. See services/trainTogetherService.ts for the matching logic.
//
// Consent model: schedules are only visible through the overlap finder when
// BOTH sides have User.scheduleSharing on and the friendship is accepted.
// What's exposed is deliberately minimal: session type + rest days. Never
// lifts, weights, or logs.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendPushToUser, sendPushToUsers } from '../services/notificationService.js';
import { cacheDelete, cacheClearByPrefix } from '../services/cacheService.js';
import {
  upcomingDates,
  loadUserCalendar,
  computeOverlap,
  groupTier,
  matchReason,
  prettyMuscles,
  buildSharedSession,
  type ParticipantCalendar,
  type ResolvedDay,
} from '../services/trainTogetherService.js';

const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

const router = Router();
const prisma = new PrismaClient();

router.use('/train-together', requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function acceptedFriendIds(userId: string): Promise<Set<string>> {
  const friendships = await prisma.friendship.findMany({
    where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return new Set(friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId)));
}

function displayName(u: { name: string | null; username: string | null }): string {
  return u.name || u.username || 'A friend';
}

const prettyDate = (date: string) =>
  new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York',
  });

// ─── Consent ──────────────────────────────────────────────────────────────────

// PUT /api/train-together/sharing { enabled: boolean }
router.put('/train-together/sharing', wrap(async (req, res) => {
  const schema = z.object({ enabled: z.boolean() });
  const { enabled } = schema.parse(req.body);
  await prisma.user.update({ where: { id: req.user!.id }, data: { scheduleSharing: enabled } });
  res.json({ scheduleSharing: enabled });
}));

// GET /api/train-together/sharing
router.get('/train-together/sharing', wrap(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { scheduleSharing: true },
  });
  res.json({ scheduleSharing: user?.scheduleSharing ?? false });
}));

// ─── Friend picker ────────────────────────────────────────────────────────────

// GET /api/train-together/friends — accepted friends annotated with why they
// can/can't be selected, so the picker can render disabled rows with reasons.
router.get('/train-together/friends', wrap(async (req, res) => {
  const userId = req.user!.id;
  const ids = await acceptedFriendIds(userId);
  const friends = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true, name: true, username: true, avatarBase64: true,
      scheduleSharing: true, splitLabel: true, savedProgram: true,
    },
  });
  res.json(friends.map((f) => ({
    id: f.id,
    name: f.name,
    username: f.username,
    avatarBase64: f.avatarBase64,
    splitLabel: f.splitLabel,
    sharing: f.scheduleSharing,
    hasProgram: !!f.savedProgram,
    selectable: f.scheduleSharing && !!f.savedProgram,
  })));
}));

// ─── Overlap finder ───────────────────────────────────────────────────────────

// GET /api/train-together/overlap?friendIds=a,b&weeks=2
router.get('/train-together/overlap', wrap(async (req, res) => {
  const userId = req.user!.id;
  const friendIds = String(req.query.friendIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const weeks = Math.min(4, Math.max(1, parseInt(String(req.query.weeks ?? '2'), 10) || 2));

  if (friendIds.length === 0 || friendIds.length > 8) {
    return res.status(400).json({ error: 'Select between 1 and 8 friends' });
  }

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { scheduleSharing: true, savedProgram: true, splitLabel: true, name: true, username: true },
  });
  if (!me?.scheduleSharing) {
    return res.status(403).json({ error: 'Turn on schedule sharing to use the overlap finder', code: 'sharing_off' });
  }
  if (!me.savedProgram) {
    return res.status(400).json({ error: 'You need an active program first', code: 'no_program' });
  }

  const friendSet = await acceptedFriendIds(userId);
  const notFriends = friendIds.filter((id) => !friendSet.has(id));
  if (notFriends.length) {
    return res.status(403).json({ error: 'You can only sync with accepted friends' });
  }

  const friends = await prisma.user.findMany({
    where: { id: { in: friendIds } },
    select: { id: true, name: true, username: true, scheduleSharing: true, savedProgram: true, splitLabel: true },
  });
  const blocked = friends.filter((f) => !f.scheduleSharing || !f.savedProgram);
  if (blocked.length) {
    return res.status(403).json({
      error: 'Some friends are not sharing a schedule',
      blocked: blocked.map((f) => ({
        id: f.id,
        name: displayName(f),
        reason: !f.scheduleSharing ? 'not_sharing' : 'no_program',
      })),
    });
  }

  const dates = upcomingDates(weeks * 7);
  const allIds = [userId, ...friendIds];
  const calendars = await Promise.all(allIds.map((id) => loadUserCalendar(id, dates)));
  const participants: ParticipantCalendar[] = allIds.map((id, i) => ({
    userId: id,
    days: calendars[i]!,
  }));

  // Active pins in the window so the calendar can flag already-planned days.
  const pins = await prisma.partnerWorkout.findMany({
    where: {
      date: { in: dates },
      status: { in: ['pending', 'confirmed', 'changed'] },
      members: { some: { userId, response: { not: 'declined' } } },
    },
    select: { id: true, date: true, status: true },
  });

  const nameById = new Map<string, { name: string | null; username: string | null; splitLabel: string | null }>();
  nameById.set(userId, { name: me.name, username: me.username, splitLabel: me.splitLabel });
  for (const f of friends) nameById.set(f.id, { name: f.name, username: f.username, splitLabel: f.splitLabel });

  res.json({
    dates,
    participants: allIds.map((id) => ({
      userId: id,
      isMe: id === userId,
      name: displayName(nameById.get(id)!),
      splitLabel: nameById.get(id)!.splitLabel,
    })),
    days: computeOverlap(participants, dates),
    pins,
  });
}));

// ─── Nudge ("Ask" pill in the picker) ─────────────────────────────────────────

// POST /api/train-together/nudge { friendId } — one share request push to a
// friend who hasn't turned on schedule sharing.
router.post('/train-together/nudge', wrap(async (req, res) => {
  const userId = req.user!.id;
  const schema = z.object({ friendId: z.string().min(1) });
  const { friendId } = schema.parse(req.body);

  const friendSet = await acceptedFriendIds(userId);
  if (!friendSet.has(friendId)) return res.status(403).json({ error: 'Not an accepted friend' });

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
  await sendPushToUser(
    friendId,
    'Train together?',
    `${displayName(me!)} wants to compare training schedules — turn on sharing to see your overlap`,
    { type: 'train_together_nudge' },
  );
  res.json({ sent: true });
}));

// ─── Pins ─────────────────────────────────────────────────────────────────────

const createPinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memberIds: z.array(z.string().min(1)).min(1).max(8),
  note: z.string().max(200).optional(),
});

// POST /api/train-together/pins — plan to train together on a date.
router.post('/train-together/pins', wrap(async (req, res) => {
  const userId = req.user!.id;
  const { date, memberIds, note } = createPinSchema.parse(req.body);

  const friendSet = await acceptedFriendIds(userId);
  const invitees = [...new Set(memberIds.filter((id) => id !== userId))];
  if (invitees.length === 0) return res.status(400).json({ error: 'Pick at least one friend' });
  if (invitees.some((id) => !friendSet.has(id))) {
    return res.status(403).json({ error: 'You can only plan with accepted friends' });
  }

  // Score the day as pinned so the break-watcher has a baseline premise.
  const allIds = [userId, ...invitees];
  const calendars = await Promise.all(allIds.map((id) => loadUserCalendar(id, [date])));
  const days: ResolvedDay[] = calendars.map(
    (c) => c?.[0] ?? { date, rest: true, label: null, focusKey: null, muscles: [] },
  );
  const tier = groupTier(days);

  const pin = await prisma.partnerWorkout.create({
    data: {
      date,
      creatorId: userId,
      note: note ?? null,
      pinnedTier: tier,
      status: 'pending',
      members: {
        create: allIds.map((id) => ({
          userId: id,
          response: id === userId ? 'accepted' : 'pending',
        })),
      },
    },
    include: { members: true },
  });

  const creator = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
  const myDay = days[0];
  const context = !myDay.rest && myDay.label ? ` — ${myDay.label} day` : '';
  await sendPushToUsers(
    invitees,
    'Train together?',
    `${displayName(creator!)} wants to train together ${prettyDate(date)}${context}`,
    { type: 'partner_workout_invite', partnerWorkoutId: pin.id },
  );

  res.status(201).json(pin);
}));

// GET /api/train-together/pins — my upcoming pins (+ last 7 days).
router.get('/train-together/pins', wrap(async (req, res) => {
  const userId = req.user!.id;
  const from = upcomingDates(1, new Date(Date.now() - 7 * 86_400_000))[0];
  const pins = await prisma.partnerWorkout.findMany({
    where: {
      date: { gte: from },
      status: { not: 'cancelled' },
      members: { some: { userId, response: { not: 'declined' } } },
    },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, username: true, avatarBase64: true } } },
      },
    },
    orderBy: { date: 'asc' },
  });
  res.json(pins);
}));

// GET /api/train-together/pins/:id — full pin detail: members (+users), each
// member's session for the pin date, current tier + reason, shared session.
router.get('/train-together/pins/:id', wrap(async (req, res) => {
  const userId = req.user!.id;
  const pin = await prisma.partnerWorkout.findUnique({
    where: { id: req.params.id },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, username: true, avatarBase64: true, splitLabel: true } } },
      },
    },
  });
  if (!pin) return res.status(404).json({ error: 'Not found' });
  if (!pin.members.some((m) => m.userId === userId)) {
    return res.status(403).json({ error: 'Not a member of this plan' });
  }

  const calendars = await Promise.all(pin.members.map((m) => loadUserCalendar(m.userId, [pin.date])));
  const days = calendars.map((c, i) =>
    c?.[0] ?? { date: pin.date, rest: true, label: null, focusKey: null, muscles: [] as string[] },
  );
  const tier = groupTier(days);

  res.json({
    id: pin.id,
    date: pin.date,
    creatorId: pin.creatorId,
    note: pin.note,
    status: pin.status,
    pinnedTier: pin.pinnedTier,
    tier,
    reason: matchReason(days, tier),
    sharedSession: pin.sharedSessionJson ? JSON.parse(pin.sharedSessionJson) : null,
    sharedFits: pin.sharedFitJson ? JSON.parse(pin.sharedFitJson) : null,
    members: pin.members.map((m, i) => ({
      userId: m.userId,
      response: m.response,
      sharedResponse: m.sharedResponse,
      sharedRespondedAt: m.sharedRespondedAt,
      user: m.user,
      session: { rest: days[i].rest, label: days[i].label, muscles: prettyMuscles(days[i].muscles) },
    })),
    createdAt: pin.createdAt,
  });
}));

// POST /api/train-together/pins/:id/shared-session — "Build us a shared
// workout" (spec §10). Generates once (deterministic, from the members' OWN
// programmed exercises for that date) and stores it on the pin.
router.post('/train-together/pins/:id/shared-session', wrap(async (req, res) => {
  const userId = req.user!.id;
  const pin = await prisma.partnerWorkout.findUnique({
    where: { id: req.params.id },
    include: { members: { include: { user: { select: { id: true, name: true, username: true } } } } },
  });
  if (!pin) return res.status(404).json({ error: 'Not found' });
  if (!pin.members.some((m) => m.userId === userId)) {
    return res.status(403).json({ error: 'Not a member of this plan' });
  }

  if (pin.sharedSessionJson) {
    return res.json({
      session: JSON.parse(pin.sharedSessionJson),
      fits: pin.sharedFitJson ? JSON.parse(pin.sharedFitJson) : {},
    });
  }

  const calendars = await Promise.all(pin.members.map((m) => loadUserCalendar(m.userId, [pin.date])));
  const inputs = pin.members.map((m, i) => ({
    userId: m.userId,
    name: m.user.name || m.user.username || 'Friend',
    day: calendars[i]?.[0] ?? { date: pin.date, rest: true, label: null, focusKey: null, muscles: [] as string[] },
  }));
  const built = buildSharedSession(inputs);
  if (!built) return res.status(400).json({ error: 'No programmed exercises to build from that day' });

  await prisma.partnerWorkout.update({
    where: { id: pin.id },
    data: {
      sharedSessionJson: JSON.stringify(built.session),
      sharedFitJson: JSON.stringify(built.fits),
    },
  });
  res.json(built);
}));

// POST /api/train-together/pins/:id/shared-session/respond
// { response: 'accepted' | 'declined' } — accepting writes a ScheduleOverride
// for THIS member on the pin date only. Declining changes nothing; the pin
// stands.
router.post('/train-together/pins/:id/shared-session/respond', wrap(async (req, res) => {
  const userId = req.user!.id;
  const schema = z.object({ response: z.enum(['accepted', 'declined']) });
  const { response } = schema.parse(req.body);

  const pin = await prisma.partnerWorkout.findUnique({
    where: { id: req.params.id },
    include: { members: true },
  });
  if (!pin) return res.status(404).json({ error: 'Not found' });
  const membership = pin.members.find((m) => m.userId === userId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this plan' });
  if (!pin.sharedSessionJson) return res.status(400).json({ error: 'No shared session generated yet' });

  await prisma.partnerWorkoutMember.update({
    where: { id: membership.id },
    data: { sharedResponse: response, sharedRespondedAt: new Date() },
  });

  if (response === 'accepted') {
    await prisma.scheduleOverride.upsert({
      where: { userId_date: { userId, date: pin.date } },
      create: { userId, date: pin.date, sessionJson: pin.sharedSessionJson, reason: 'Shared session (Train Together)' },
      update: { sessionJson: pin.sharedSessionJson, reason: 'Shared session (Train Together)' },
    });
    // Same cache busts as any schedule mutation, so Today reflects it.
    cacheClearByPrefix(`today:${userId}:`);
    cacheClearByPrefix(`schedule:${userId}:`);
    cacheClearByPrefix(`dashboard:${userId}:`);
    cacheDelete(`userctx:${userId}`);
  }

  res.json({ sharedResponse: response });
}));

// POST /api/train-together/pins/:id/respond { response: 'accepted' | 'declined' }
router.post('/train-together/pins/:id/respond', wrap(async (req, res) => {
  const userId = req.user!.id;
  const schema = z.object({ response: z.enum(['accepted', 'declined']) });
  const { response } = schema.parse(req.body);

  const pin = await prisma.partnerWorkout.findUnique({
    where: { id: req.params.id },
    include: { members: true },
  });
  if (!pin) return res.status(404).json({ error: 'Not found' });
  const membership = pin.members.find((m) => m.userId === userId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this plan' });
  if (pin.status === 'cancelled') return res.status(400).json({ error: 'This plan was cancelled' });

  await prisma.partnerWorkoutMember.update({
    where: { id: membership.id },
    data: { response },
  });

  const others = pin.members.filter((m) => m.userId !== userId);
  const responder = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });

  // Re-confirming a 'changed' pin: any acceptance moves it back to confirmed.
  // Fresh pin: confirmed once every member has accepted. All invitees
  // declining kills it.
  const updatedMembers = pin.members.map((m) => (m.id === membership.id ? { ...m, response } : m));
  const everyoneAccepted = updatedMembers.every((m) => m.response === 'accepted');
  const allInviteesDeclined = updatedMembers
    .filter((m) => m.userId !== pin.creatorId)
    .every((m) => m.response === 'declined');

  let status = pin.status;
  if (allInviteesDeclined) status = 'cancelled';
  else if (everyoneAccepted) status = 'confirmed';
  if (status !== pin.status) {
    await prisma.partnerWorkout.update({ where: { id: pin.id }, data: { status } });
  }

  if (response === 'accepted' && status === 'confirmed') {
    await sendPushToUsers(
      others.map((m) => m.userId),
      'Training plan confirmed',
      `${displayName(responder!)} is in for ${prettyDate(pin.date)}`,
      { type: 'partner_workout_confirmed', partnerWorkoutId: pin.id },
    );
  } else if (response === 'accepted' && userId !== pin.creatorId) {
    // Group pin, not yet fully confirmed — the host still hears about every
    // acceptance as it lands.
    const waiting = updatedMembers.filter((m) => m.response === 'pending').length;
    await sendPushToUser(
      pin.creatorId,
      'Training plan update',
      `${displayName(responder!)} is in for ${prettyDate(pin.date)}${waiting ? ` — waiting on ${waiting} more` : ''}`,
      { type: 'partner_workout_accepted', partnerWorkoutId: pin.id },
    );
  } else if (response === 'declined') {
    await sendPushToUser(
      pin.creatorId,
      'Training plan update',
      `${displayName(responder!)} can't make ${prettyDate(pin.date)}`,
      { type: 'partner_workout_declined', partnerWorkoutId: pin.id },
    );
  }

  res.json({ status, response });
}));

// DELETE /api/train-together/pins/:id — creator cancels; a member leaves.
router.delete('/train-together/pins/:id', wrap(async (req, res) => {
  const userId = req.user!.id;
  const pin = await prisma.partnerWorkout.findUnique({
    where: { id: req.params.id },
    include: { members: true },
  });
  if (!pin) return res.status(404).json({ error: 'Not found' });

  if (pin.creatorId === userId) {
    await prisma.partnerWorkout.update({ where: { id: pin.id }, data: { status: 'cancelled' } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
    await sendPushToUsers(
      pin.members.filter((m) => m.userId !== userId).map((m) => m.userId),
      'Training plan cancelled',
      `${displayName(user!)} cancelled ${prettyDate(pin.date)}`,
      { type: 'partner_workout_cancelled', partnerWorkoutId: pin.id },
    );
    return res.json({ status: 'cancelled' });
  }

  const membership = pin.members.find((m) => m.userId === userId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this plan' });
  await prisma.partnerWorkoutMember.update({
    where: { id: membership.id },
    data: { response: 'declined' },
  });
  return res.json({ status: pin.status, left: true });
}));

export default router;
