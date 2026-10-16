// Lightweight lead capture (handoff gap #13): a practice's opt-in public
// page with a short form and an optional free consult slot, a list of who
// asked and what happened next, and one click to make a lead a client.
// Deliberately not a CRM (handoff §7): no pipelines, sequences or scoring.

import { audit } from './drafts.js';
import { prisma } from './db.js';
import { createLinkClient } from './links.js';
import { getPracticeProfile } from './practice.js';
import { openSlots } from './scheduling.js';
import { sendPushToUser } from '../notificationService.js';
import type { LeadView, PublicPractice, Slot } from './types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;
export const LEAD_PREFIX = 'lead:';

export class LeadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'LeadError';
    this.status = status;
  }
}

async function practiceBySlug(slug: string) {
  const inst = await prisma.institution.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, active: true } });
  if (!inst?.active) return null;
  const profile = await prisma.ptPracticeProfile.findUnique({ where: { practiceId: inst.id }, select: { publicPage: true } });
  return profile?.publicPage ? inst : null;
}

export async function publicPractice(slug: string): Promise<PublicPractice> {
  const inst = await practiceBySlug(slug);
  if (!inst) throw new LeadError('Not found', 404);
  const [profile, coach, windows] = await Promise.all([
    getPracticeProfile(inst.id),
    prisma.institutionMember.findFirst({ where: { institutionId: inst.id, role: 'coach', active: true }, orderBy: { joinedAt: 'asc' }, select: { user: { select: { name: true } } } }),
    prisma.ptAvailability.count({ where: { practiceId: inst.id, active: true } }),
  ]);
  return {
    slug: inst.slug, name: inst.name, trainerName: coach?.user.name?.trim() || inst.name,
    bio: profile.bio, specialties: profile.specialties, styleTags: profile.styleTags, languages: profile.languages, format: profile.format,
    brandColor: profile.brandColor, accentColor: profile.accentColor, logoUrl: profile.logoUrl, offersConsults: windows > 0,
  };
}

export async function publicSlots(slug: string): Promise<Slot[]> {
  const inst = await practiceBySlug(slug);
  if (!inst) throw new LeadError('Not found', 404);
  return openSlots(inst.id, { days: 14 });
}

/** A lead from the public form. A filled-in honeypot is accepted silently and dropped. */
export async function submitLead(slug: string, body: Record<string, unknown>, now: Date = new Date()) {
  const inst = await practiceBySlug(slug);
  if (!inst) throw new LeadError('Not found', 404);
  if (typeof body.website === 'string' && body.website.trim()) return { ok: true };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (name.length < 2) throw new LeadError('Tell us your name', 400);
  const email = typeof body.email === 'string' && EMAIL_RE.test(body.email.trim()) ? body.email.trim().toLowerCase().slice(0, 255) : null;
  const phone = typeof body.phone === 'string' && /^\+?[0-9 ()-]{7,20}$/.test(body.phone.trim()) ? body.phone.trim() : null;
  if (!email && !phone) throw new LeadError('Leave an email or phone number so the trainer can reply', 400);
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);

  const lead = await prisma.ptLead.create({ data: { practiceId: inst.id, name, email, phone, goal: text(body.goal, 300), message: text(body.message, 1000) } });
  // A free consult, if they picked one of the offered slots.
  if (typeof body.consultAt === 'string') {
    const slot = (await openSlots(inst.id, { days: 14, now })).find((s) => s.startsAt === new Date(body.consultAt as string).toISOString());
    if (slot) {
      try {
        const b = await prisma.ptBooking.create({
          data: { practiceId: inst.id, trainerId: slot.trainerId, clientId: `${LEAD_PREFIX}${lead.id}`, startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), slotKey: `${slot.trainerId}|${slot.startsAt}`, source: 'portal', location: slot.location, notes: `Free consult: ${name}` },
        });
        await prisma.ptLead.update({ where: { id: lead.id }, data: { status: 'consult_booked', consultAt: b.startsAt, bookingId: b.id } });
      } catch { /* the slot went in the meantime; the lead still stands */ }
    }
  }
  const coaches = await prisma.institutionMember.findMany({ where: { institutionId: inst.id, role: 'coach', active: true }, select: { userId: true } });
  for (const c of coaches) {
    await prisma.ptNotification.upsert({
      where: { trainerId_sourceKey: { trainerId: c.userId, sourceKey: `lead:${lead.id}` } }, update: {},
      create: { practiceId: inst.id, trainerId: c.userId, eventType: 'newLead', tier: 'immediate', title: `New enquiry from ${name}`, body: lead.goal ?? 'From your public page', sourceKey: `lead:${lead.id}`, at: now },
    }).catch(() => {});
    sendPushToUser(c.userId, `New enquiry from ${name}`, lead.goal ?? 'From your public page', { type: 'pt_lead' }).catch(() => {});
  }
  return { ok: true };
}

type Row = Awaited<ReturnType<typeof prisma.ptLead.findMany>>[number];
export function leadView(l: Row, now: Date = new Date()): LeadView {
  const stale = l.status === 'new' && now.getTime() - l.createdAt.getTime() > DAY_MS;
  const due = !!l.followUpAt && l.followUpAt <= now && !['won', 'lost'].includes(l.status);
  return {
    id: l.id, name: l.name, email: l.email, phone: l.phone, goal: l.goal, message: l.message, source: l.source as LeadView['source'],
    status: l.status as LeadView['status'], ...(l.consultAt ? { consultAt: l.consultAt.toISOString() } : {}), clientId: l.clientId, notes: l.notes,
    ...(l.followUpAt ? { followUpAt: l.followUpAt.toISOString() } : {}), createdAt: l.createdAt.toISOString(), needsFollowUp: stale || due,
  };
}

export async function listLeads(practiceId: string) {
  const rows = await prisma.ptLead.findMany({ where: { practiceId }, orderBy: { createdAt: 'desc' }, take: 300 });
  const now = new Date();
  return rows.map((r) => leadView(r, now)).sort((a, b) => Number(b.needsFollowUp) - Number(a.needsFollowUp));
}

export async function addLead(practiceId: string, trainerId: string, body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (name.length < 2) throw new LeadError('Name is required', 400);
  const row = await prisma.ptLead.create({
    data: {
      practiceId, name, source: 'manual',
      email: typeof body.email === 'string' && EMAIL_RE.test(body.email.trim()) ? body.email.trim().toLowerCase() : null,
      phone: typeof body.phone === 'string' ? body.phone.trim().slice(0, 20) || null : null,
      goal: typeof body.goal === 'string' ? body.goal.trim().slice(0, 300) || null : null,
      notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) || null : null,
    },
  });
  await audit({ practiceId, trainerId, action: 'lead_added', itemType: 'lead', itemId: row.id });
  return leadView(row);
}

export async function updateLead(practiceId: string, trainerId: string, id: string, body: Record<string, unknown>) {
  const row = await prisma.ptLead.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId) throw new LeadError('Lead not found', 404);
  const data: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!['new', 'contacted', 'consult_booked', 'won', 'lost'].includes(body.status as string)) throw new LeadError('Unknown status', 400);
    data.status = body.status;
    if (body.status === 'contacted' && !row.contactedAt) data.contactedAt = new Date();
  }
  if (body.notes !== undefined) data.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) || null : null;
  if (body.followUpAt !== undefined) data.followUpAt = typeof body.followUpAt === 'string' && !Number.isNaN(Date.parse(body.followUpAt)) ? new Date(body.followUpAt) : null;
  const updated = await prisma.ptLead.update({ where: { id }, data });
  await audit({ practiceId, trainerId, action: 'lead_updated', itemType: 'lead', itemId: id, meta: { status: updated.status } });
  return leadView(updated);
}

/** Make a lead a link client. Their consult booking becomes theirs. */
export async function convertLead(practiceId: string, trainerId: string, id: string) {
  const row = await prisma.ptLead.findUnique({ where: { id } });
  if (!row || row.practiceId !== practiceId) throw new LeadError('Lead not found', 404);
  if (row.clientId) throw new LeadError('Already a client', 409);
  const { clientId, link } = await createLinkClient(practiceId, trainerId, { name: row.name, email: row.email ?? undefined, phone: row.phone ?? undefined });
  await prisma.ptBooking.updateMany({ where: { practiceId, clientId: `${LEAD_PREFIX}${row.id}` }, data: { clientId } });
  if (row.goal) await prisma.ptNote.create({ data: { practiceId, trainerId, clientId, body: `From their enquiry: ${row.goal}${row.message ? `\n${row.message}` : ''}` } });
  await prisma.ptLead.update({ where: { id }, data: { status: 'won', clientId } });
  await audit({ practiceId, trainerId, clientId, action: 'lead_converted', itemType: 'lead', itemId: id });
  return { clientId, link };
}
