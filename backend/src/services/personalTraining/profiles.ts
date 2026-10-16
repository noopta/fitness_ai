// The practice's own record of each client: channel, contact details, tags
// and whether coaching is active, paused or archived. A client with no row is
// an active app client with no tags — every reader treats absence that way.

import { audit } from './drafts.js';
import { prisma } from './db.js';
import { LinkError, cleanContact, cleanTags, revokeLinks } from './links.js';
import type { Channel, ClientState } from './types.js';

export interface ProfileView {
  channel: Channel;
  tags: string[];
  state: ClientState;
  pausedUntil: Date | null;
  stateReason: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  assignedTrainerId: string | null;
}

const DEFAULT_VIEW: ProfileView = { channel: 'app', tags: [], state: 'active', pausedUntil: null, stateReason: null, contactEmail: null, contactPhone: null, assignedTrainerId: null };

const parseTags = (raw: string) => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
};

type Row = NonNullable<Awaited<ReturnType<typeof prisma.ptClientProfile.findUnique>>>;

/** A pause with an end date ends by itself; nobody has to remember to lift it. */
export function viewOf(row: Row | null | undefined, now: Date = new Date()): ProfileView {
  if (!row) return DEFAULT_VIEW;
  const expired = row.state === 'paused' && row.pausedUntil && row.pausedUntil.getTime() <= now.getTime();
  return {
    channel: row.channel === 'webLink' ? 'webLink' : 'app',
    tags: parseTags(row.tagsJson),
    state: expired ? 'active' : (row.state as ClientState),
    pausedUntil: expired ? null : row.pausedUntil,
    stateReason: expired ? null : row.stateReason,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    assignedTrainerId: row.assignedTrainerId ?? null,
  };
}

export async function loadProfiles(practiceId: string, clientIds?: string[], now: Date = new Date()): Promise<Map<string, ProfileView>> {
  const rows = await prisma.ptClientProfile.findMany({ where: { practiceId, ...(clientIds ? { clientId: { in: clientIds } } : {}) } });
  return new Map(rows.map((r) => [r.clientId, viewOf(r, now)]));
}

export async function listTags(practiceId: string): Promise<{ tag: string; count: number }[]> {
  const rows = await prisma.ptClientProfile.findMany({ where: { practiceId, state: { not: 'archived' } }, select: { tagsJson: true } });
  const counts = new Map<string, number>();
  for (const r of rows) for (const t of parseTags(r.tagsJson)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export interface ClientPatch {
  name?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  tags?: unknown;
  state?: unknown;
  pausedUntil?: unknown;
  stateReason?: unknown;
}

const STATES: ClientState[] = ['active', 'paused', 'archived'];

/**
 * Edit what the practice keeps about a client. A link client's name lives on
 * their own (login-less) account, so it can be renamed here; an app client's
 * name is theirs to change, not the trainer's.
 */
export async function patchClient(practiceId: string, trainerId: string, clientId: string, patch: ClientPatch, now: Date = new Date()) {
  const existing = await prisma.ptClientProfile.findUnique({ where: { practiceId_clientId: { practiceId, clientId } } });
  const data: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};

  if (patch.contactEmail !== undefined || patch.contactPhone !== undefined) {
    const { email, phone } = cleanContact({ email: patch.contactEmail ?? existing?.contactEmail, phone: patch.contactPhone ?? existing?.contactPhone });
    if (patch.contactEmail !== undefined) data.contactEmail = email;
    if (patch.contactPhone !== undefined) data.contactPhone = phone;
    changes.contact = true;
  }
  const tags = cleanTags(patch.tags);
  if (tags) { data.tagsJson = JSON.stringify(tags); changes.tags = tags; }

  if (patch.state !== undefined) {
    if (typeof patch.state !== 'string' || !STATES.includes(patch.state as ClientState)) throw new LinkError('state must be active, paused or archived', 400);
    const state = patch.state as ClientState;
    let pausedUntil: Date | null = null;
    if (state === 'paused' && patch.pausedUntil !== undefined && patch.pausedUntil !== null) {
      const d = typeof patch.pausedUntil === 'string' ? new Date(patch.pausedUntil) : null;
      if (!d || Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) throw new LinkError('pausedUntil must be a future date', 400);
      pausedUntil = d;
    }
    const reason = typeof patch.stateReason === 'string' ? patch.stateReason.trim().slice(0, 200) || null : null;
    Object.assign(data, { state, pausedUntil, stateReason: state === 'active' ? null : reason, stateChangedAt: now });
    changes.state = state;
  }

  if (patch.name !== undefined) {
    if (!existing || existing.channel !== 'webLink') throw new LinkError("An app client's name is set in their own account", 409);
    const name = typeof patch.name === 'string' ? patch.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 1 || name.length > 80) throw new LinkError('Name must be between 1 and 80 characters', 400);
    await prisma.user.update({ where: { id: clientId }, data: { name } });
    changes.name = true;
  }

  if (Object.keys(data).length) {
    await prisma.ptClientProfile.upsert({
      where: { practiceId_clientId: { practiceId, clientId } },
      update: data,
      create: { practiceId, clientId, ...data },
    });
  }
  // Archiving closes the door the link opened.
  if (changes.state === 'archived') await revokeLinks(practiceId, clientId, trainerId);
  if (Object.keys(changes).length) await audit({ practiceId, trainerId, clientId, action: 'client_updated', itemType: 'client', itemId: clientId, meta: changes });
}
