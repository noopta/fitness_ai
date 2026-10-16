// The practice's profile: who the trainer is (specialties, style, languages —
// also what matching will read later) and the branding clients see on their
// portal.

import { blobStoreEnabled, objectUrl, putImageBase64 } from '../blobStore.js';
import { prisma } from './db.js';
import type { PortalBranding, PracticeProfile } from './types.js';

export class PracticeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PracticeError';
    this.status = status;
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const FORMATS = ['online', 'hybrid', 'in_person'] as const;

const list = (raw: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getPracticeProfile(practiceId: string): Promise<PracticeProfile> {
  const [row, inst] = await Promise.all([
    prisma.ptPracticeProfile.findUnique({ where: { practiceId } }),
    prisma.institution.findUnique({ where: { id: practiceId }, select: { logoUrl: true, name: true } }),
  ]);
  const logoUrl = row?.logoBlobKey ? await objectUrl(row.logoBlobKey) : inst?.logoUrl ?? null;
  return {
    name: inst?.name ?? '',
    bio: row?.bio ?? '',
    specialties: list(row?.specialtiesJson),
    styleTags: list(row?.styleTagsJson),
    languages: list(row?.languagesJson),
    format: (row?.format as PracticeProfile['format']) ?? null,
    timezone: row?.timezone ?? null,
    brandColor: row?.brandColor ?? null,
    accentColor: row?.accentColor ?? null,
    logoUrl,
  };
}

const cleanList = (v: unknown, field: string, max = 12) => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new PracticeError(`${field} must be a list`, 400);
  const out = [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 40)).filter(Boolean))];
  if (out.length > max) throw new PracticeError(`At most ${max} ${field}`, 400);
  return JSON.stringify(out);
};

export async function savePracticeProfile(practiceId: string, body: Record<string, unknown>): Promise<PracticeProfile> {
  const data: Record<string, unknown> = {};
  if (body.bio !== undefined) {
    if (typeof body.bio !== 'string') throw new PracticeError('bio must be text', 400);
    data.bio = body.bio.trim().slice(0, 2000) || null;
  }
  for (const [k, col] of [['specialties', 'specialtiesJson'], ['styleTags', 'styleTagsJson'], ['languages', 'languagesJson']] as const) {
    const v = cleanList(body[k], k);
    if (v !== undefined) data[col] = v;
  }
  if (body.format !== undefined) {
    if (body.format !== null && !FORMATS.includes(body.format as any)) throw new PracticeError('format must be online, hybrid or in_person', 400);
    data.format = body.format;
  }
  if (body.timezone !== undefined) {
    if (body.timezone !== null && (typeof body.timezone !== 'string' || !validTimezone(body.timezone))) throw new PracticeError('timezone must be an IANA time zone', 400);
    data.timezone = body.timezone;
  }
  for (const k of ['brandColor', 'accentColor'] as const) {
    if (body[k] === undefined) continue;
    if (body[k] !== null && (typeof body[k] !== 'string' || !HEX.test(body[k] as string))) throw new PracticeError(`${k} must be a hex colour like #1F6FEB`, 400);
    data[k] = body[k];
  }
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 80) throw new PracticeError('Practice name must be between 2 and 80 characters', 400);
    await prisma.institution.update({ where: { id: practiceId }, data: { name } });
  }
  await prisma.ptPracticeProfile.upsert({ where: { practiceId }, update: data, create: { practiceId, ...data } });
  return getPracticeProfile(practiceId);
}

export async function saveLogo(practiceId: string, imageBase64: unknown): Promise<PracticeProfile> {
  if (!blobStoreEnabled()) throw new PracticeError('Image storage is not set up on this server', 503);
  if (typeof imageBase64 !== 'string' || imageBase64.length < 100 || imageBase64.length > 3 * 1024 * 1024) throw new PracticeError('Upload a logo image under 2 MB', 400);
  const stored = await putImageBase64(imageBase64);
  if (!stored) throw new PracticeError('That logo could not be saved. Use a PNG, JPEG or WebP image.', 400);
  await prisma.ptPracticeProfile.upsert({ where: { practiceId }, update: { logoBlobKey: stored.key }, create: { practiceId, logoBlobKey: stored.key } });
  return getPracticeProfile(practiceId);
}

export async function brandingFor(practiceId: string): Promise<PortalBranding> {
  const [profile, inst, coach] = await Promise.all([
    getPracticeProfile(practiceId),
    prisma.institution.findUnique({ where: { id: practiceId }, select: { name: true } }),
    prisma.institutionMember.findFirst({
      where: { institutionId: practiceId, role: 'coach', active: true }, orderBy: { joinedAt: 'asc' }, select: { user: { select: { name: true } } },
    }),
  ]);
  return {
    practiceName: inst?.name ?? 'Your trainer',
    trainerName: coach?.user.name?.trim() || 'Your trainer',
    logoUrl: profile.logoUrl,
    brandColor: profile.brandColor,
    accentColor: profile.accentColor,
  };
}
