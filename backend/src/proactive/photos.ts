// Photos in chat (design flow E). The image goes to the blob store first; only
// a reference reaches the agent route. Anakin gets a structured description
// (and, for a meal, the macro estimate so the ordinary log_meal card follows).
// Private kinds — injury, bloodwork, body — are masked until tapped and their
// description goes when the photo does; meal and label descriptions outlast
// the photo as food history (F2 rules).

import { PrismaClient } from '@prisma/client';
import { putImageBase64, objectUrl, blobStoreEnabled, stripDataUri } from '../services/blobStore.js';
import { fenceUntrusted, UNTRUSTED_NOTICE } from '../agent/untrusted.js';
import { getProactivePrefs } from './prefs.js';

const prisma = new PrismaClient();

export type PhotoKind = 'meal' | 'label' | 'program' | 'machine' | 'injury' | 'bloodwork' | 'body' | 'other';
export const PHOTO_KINDS: PhotoKind[] = ['meal', 'label', 'program', 'machine', 'injury', 'bloodwork', 'body', 'other'];
export const PRIVATE_KINDS: ReadonlySet<PhotoKind> = new Set(['injury', 'bloodwork', 'body']);
export const MAX_PHOTOS_PER_MESSAGE = 4;
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export interface PhotoDescription {
  kind: PhotoKind;
  /** One or two sentences a coach would say about what's in the frame. */
  description: string;
  /** Text visible in the image (a label, a program screenshot), if any. */
  text?: string | null;
  /** For a meal: the macro estimate the log card uses. */
  meal?: { name: string; calories: number; proteinG: number; carbsG: number; fatG: number } | null;
}

export interface ChatPhotoRow { id: string; userId: string; blobKey: string; mimeType: string; kind: string; private: boolean; description: string | null; detailJson: string | null; expiresAt: Date | null; deletedAt: Date | null; createdAt: Date }

export const isPrivateKind = (k: string): boolean => PRIVATE_KINDS.has(k as PhotoKind);

/** Pure: what happens to a photo at retention time. */
export function retentionDecision(p: Pick<ChatPhotoRow, 'kind' | 'expiresAt' | 'deletedAt'>, now = new Date()): 'keep' | 'delete_all' | 'delete_photo_keep_description' {
  if (p.deletedAt) return 'keep';
  if (!p.expiresAt || p.expiresAt.getTime() > now.getTime()) return 'keep';
  return isPrivateKind(p.kind) ? 'delete_all' : 'delete_photo_keep_description';
}

/** Pure: the note the model reads for the photos on a message. Fenced as untrusted — text inside an image is never an instruction. */
export function photoNote(photos: Pick<ChatPhotoRow, 'id' | 'kind' | 'description' | 'detailJson'>[]): string {
  if (!photos.length) return '';
  const lines = photos.map((p, i) => {
    let d: any = {};
    try { d = p.detailJson ? JSON.parse(p.detailJson) : {}; } catch { d = {}; }
    const meal = d.meal ? ` Macro estimate: ${d.meal.name} — ${Math.round(d.meal.calories)} kcal, P ${Math.round(d.meal.proteinG)} g, C ${Math.round(d.meal.carbsG)} g, F ${Math.round(d.meal.fatG)} g.` : '';
    const text = d.text ? ` Text in the image: "${String(d.text).slice(0, 600)}"` : '';
    return `Photo ${i + 1} (${p.kind}${isPrivateKind(p.kind) ? ', private' : ''}): ${p.description ?? 'no description'}.${meal}${text}`;
  });
  return `The user attached ${photos.length} photo${photos.length === 1 ? '' : 's'}. ${photos.some((p) => p.kind === 'meal') ? 'For a meal, offer to log it with log_meal using the estimate (they can edit). ' : ''}${photos.some((p) => p.kind === 'program') ? 'For a program screenshot, offer to import it. ' : ''}${photos.some((p) => isPrivateKind(p.kind)) ? 'Private photos: answer in text only; never log or save anything from them. ' : ''}${UNTRUSTED_NOTICE}\n${fenceUntrusted(lines.join('\n'), 'photo description')}`;
}

export type DescribeFn = (base64: string, mimeType: string) => Promise<PhotoDescription>;

async function defaultDescribe(base64: string, mimeType: string): Promise<PhotoDescription> {
  const { describeChatPhoto } = await import('../services/geminiService.js');
  return describeChatPhoto(base64, mimeType);
}

/** Store, describe, record. Returns the client-facing row (no blob key). */
export async function storeChatPhoto(userId: string, input: string, mimeHint: string | undefined, opts: { describe?: DescribeFn; now?: Date } = {}): Promise<{ id: string; kind: PhotoKind; private: boolean; description: string | null; url: string | null }> {
  const now = opts.now ?? new Date();
  const { base64, mimeType } = stripDataUri(input);
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new Error('That photo is empty.');
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('That photo is too large — 6 MB at most.');
  if (!blobStoreEnabled()) throw new Error('Photo storage isn’t available right now.');
  const stored = await putImageBase64(base64, mimeType ?? mimeHint);
  if (!stored) throw new Error('That doesn’t look like a photo I can read.');
  let desc: PhotoDescription;
  try { desc = await (opts.describe ?? defaultDescribe)(base64, mimeType ?? mimeHint ?? 'image/jpeg'); }
  catch { desc = { kind: 'other', description: 'A photo I couldn’t read clearly.' }; }
  const kind: PhotoKind = PHOTO_KINDS.includes(desc.kind) ? desc.kind : 'other';
  const prefs = await getProactivePrefs(userId);
  const row = await prisma.chatPhoto.create({ data: {
    userId, blobKey: stored.key, mimeType: mimeType ?? mimeHint ?? 'image/jpeg', kind, private: isPrivateKind(kind),
    description: desc.description?.slice(0, 600) ?? null,
    detailJson: JSON.stringify({ text: desc.text ?? null, meal: desc.meal ?? null }),
    expiresAt: new Date(now.getTime() + prefs.photoRetentionDays * 86_400_000),
  } });
  return { id: row.id, kind, private: row.private, description: row.description, url: stored.url };
}

export async function photosByIds(userId: string, ids: string[]): Promise<ChatPhotoRow[]> {
  if (!ids.length) return [];
  const rows = await prisma.chatPhoto.findMany({ where: { userId, id: { in: ids.slice(0, MAX_PHOTOS_PER_MESSAGE) }, deletedAt: null } });
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is ChatPhotoRow => !!r) as ChatPhotoRow[];
}

export async function listPhotos(userId: string): Promise<Array<{ id: string; kind: string; private: boolean; description: string | null; createdAt: string; hasImage: boolean }>> {
  const rows = await prisma.chatPhoto.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 200 });
  return rows.map((r) => ({ id: r.id, kind: r.kind, private: r.private, description: r.description, createdAt: r.createdAt.toISOString(), hasImage: r.blobKey !== '' }));
}

/** A signed URL for one photo the user owns (private ones render dark until tapped — the client asks for this on tap). */
export async function photoUrl(userId: string, id: string): Promise<string | null> {
  const r = await prisma.chatPhoto.findFirst({ where: { id, userId, deletedAt: null } });
  if (!r || !r.blobKey) return null;
  return objectUrl(r.blobKey);
}

/** Delete removes the photo AND its description (F2). */
export async function deletePhoto(userId: string, id: string, now = new Date()): Promise<boolean> {
  const r = await prisma.chatPhoto.findFirst({ where: { id, userId, deletedAt: null } });
  if (!r) return false;
  await prisma.chatPhoto.update({ where: { id }, data: { deletedAt: now, description: null, detailJson: null, blobKey: '' } });
  return true;
}
export async function deleteAllPhotos(userId: string, now = new Date()): Promise<number> {
  const r = await prisma.chatPhoto.updateMany({ where: { userId, deletedAt: null }, data: { deletedAt: now, description: null, detailJson: null, blobKey: '' } });
  return r.count;
}

/** Hourly: expired photos go; a private one takes its description with it. Blobs are content-addressed and shared, so only the reference is dropped. */
export async function photoRetentionSweep(now = new Date()): Promise<{ photos: number; descriptions: number }> {
  const rows = await prisma.chatPhoto.findMany({ where: { deletedAt: null, expiresAt: { lte: now } } });
  let photos = 0, descriptions = 0;
  for (const r of rows) {
    const d = retentionDecision(r, now);
    if (d === 'keep') continue;
    photos++;
    if (d === 'delete_all') { descriptions++; await prisma.chatPhoto.update({ where: { id: r.id }, data: { blobKey: '', description: null, detailJson: null, deletedAt: now } }); }
    else await prisma.chatPhoto.update({ where: { id: r.id }, data: { blobKey: '' } });
  }
  return { photos, descriptions };
}
