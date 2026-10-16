// Pure helpers behind the coach-platform views: how contraindications group
// and colour, what a body part refuses, which unit a measurement is typed in,
// and how large a photo is after downscaling. No React, no I/O, so each is
// tested on its own.

import type { BodyPartMeta, Client, ClientGoal, Contraindication, Measurement, MeasurementKind, Tone } from '@axiom/personal-training-core';

export type UnitPreference = 'metric' | 'imperial';

// ── Contraindications ────────────────────────────────────────────────────────

export type ContraGroup = 'review' | 'not_cleared' | 'modified' | 'cleared';
export const CONTRA_GROUPS: ContraGroup[] = ['review', 'not_cleared', 'modified', 'cleared'];

/** Ids starting `inferred:` are readings of the client's own words, not rows yet. They can only be confirmed. */
export const isInferred = (c: Pick<Contraindication, 'id'>) => !!c.id?.startsWith('inferred:');

/** Older contraindications carry only `active`; read them as not cleared while active. */
export const clearanceOf = (c: Contraindication) => c.clearance ?? (c.active ? 'not_cleared' : 'cleared');

/** Which section a record sits in. Anything the trainer has not looked at comes first, whatever its clearance. */
export function contraGroupOf(c: Contraindication): ContraGroup {
  if (!c.active || clearanceOf(c) === 'cleared') return 'cleared';
  if (c.needsReview) return 'review';
  return clearanceOf(c);
}

/** Non-empty groups in reading order. */
export function groupContraindications(list: Contraindication[]): { group: ContraGroup; items: Contraindication[] }[] {
  return CONTRA_GROUPS
    .map((group) => ({ group, items: list.filter((c) => contraGroupOf(c) === group) }))
    .filter((g) => g.items.length > 0);
}

/**
 * The header chip for a record: red while not cleared, amber once modified,
 * and nothing for cleared or resolved ones. `review` adds the amber marker.
 */
export function contraChip(c: Contraindication): { tone: Extract<Tone, 'red' | 'amber'>; review: boolean } | null {
  if (!c.active || clearanceOf(c) === 'cleared') return null;
  return { tone: clearanceOf(c) === 'modified' ? 'amber' : 'red', review: !!c.needsReview };
}

/** "knee_extension" → "Knee extension". */
export const patternLabel = (key: string) => {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * What a record refuses and what it only warns on — the same rule the server
 * enforces, mirrored so the trainer can see the effect of a clearance before
 * saving. The server stays the judge; this is the explanation.
 */
export function refusalsFor(
  c: Pick<Contraindication, 'bodyPart' | 'severity' | 'extraBlocks' | 'allow' | 'active'> & { clearance?: Contraindication['clearance'] },
  meta: BodyPartMeta | undefined,
): { refused: string[]; warned: string[] } {
  const clearance = c.clearance ?? 'not_cleared';
  const block = new Set<string>();
  const warn = new Set<string>();
  if (c.active === false || clearance === 'cleared') return { refused: [], warned: [] };
  if (meta) {
    if (clearance === 'not_cleared') {
      meta.primary.forEach((p) => block.add(p));
      meta.secondary.forEach((p) => block.add(p));
    } else {
      // Modified: a severe one keeps its direct patterns refused.
      meta.primary.forEach((p) => (c.severity === 'severe' ? block : warn).add(p));
      meta.secondary.forEach((p) => warn.add(p));
    }
  }
  for (const p of c.extraBlocks ?? []) { block.add(p); warn.delete(p); }
  for (const p of c.allow ?? []) { block.delete(p); warn.delete(p); }
  return { refused: Array.from(block), warned: Array.from(warn).filter((p) => !block.has(p)) };
}

// ── Units ────────────────────────────────────────────────────────────────────

const LENGTH_KINDS = new Set<MeasurementKind>(['waist', 'hips', 'chest', 'arm', 'thigh', 'calf', 'neck']);
export const MEASUREMENT_KINDS: MeasurementKind[] = ['bodyweight', 'waist', 'hips', 'chest', 'arm', 'thigh', 'calf', 'neck', 'body_fat', 'resting_hr', 'custom'];

/** Units a measurement can be typed in, the trainer's own first. Custom measurements have none. */
export function unitOptions(kind: MeasurementKind, pref: UnitPreference): string[] {
  if (kind === 'bodyweight') return pref === 'metric' ? ['kg', 'lb'] : ['lb', 'kg'];
  if (LENGTH_KINDS.has(kind)) return pref === 'metric' ? ['cm', 'in'] : ['in', 'cm'];
  if (kind === 'body_fat') return ['%'];
  if (kind === 'resting_hr') return ['bpm'];
  return [''];
}

export const defaultUnit = (kind: MeasurementKind, pref: UnitPreference) => unitOptions(kind, pref)[0];

/** The unit a goal's numbers are typed and shown in. The server reads them in the trainer's display unit. */
export function goalUnit(metric: string, pref: UnitPreference): string {
  if (metric === 'bodyweight' || metric.startsWith('e1rm:')) return pref === 'metric' ? 'kg' : 'lb';
  if (metric === 'sessions_per_week') return 'sessions';
  if (metric.startsWith('measurement:')) return defaultUnit(metric.slice(12) as MeasurementKind, pref);
  return '';
}

/**
 * The trainer's unit as the server applied it to this client's records.
 * Server data wins because it was converted with the preference on the
 * account; null when nothing returned says either way.
 */
export function inferUnitPreference(measurements: Pick<Measurement, 'unit'>[] = [], goals: Pick<ClientGoal, 'unit'>[] = []): UnitPreference | null {
  for (const { unit } of [...measurements, ...goals]) {
    if (unit === 'kg' || unit === 'cm') return 'metric';
    if (unit === 'lb' || unit === 'lbs' || unit === 'in') return 'imperial';
  }
  return null;
}

// ── Photos ───────────────────────────────────────────────────────────────────

/** Scale (w, h) down to fit inside a max × max square, keeping the aspect ratio. Never scales up. */
export function fitWithin(width: number, height: number, max = 1600): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Read an image file, downscale it to fit `max` and re-encode it, returning
 * a data URL. JPEG for photos (much smaller); PNG keeps a logo's transparency.
 */
export async function downscaleImage(file: File, { max = 1600, type = 'image/jpeg', quality = 0.85 }: { max?: number; type?: 'image/jpeg' | 'image/png'; quality?: number } = {}): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable image'));
      el.src = url;
    });
    const size = fitWithin(img.naturalWidth, img.naturalHeight, max);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.width, size.height); }
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return canvas.toDataURL(type, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Roster ───────────────────────────────────────────────────────────────────

/** Tags across the given clients, most used first, for the roster's chips. */
export function tagCounts(clients: Pick<Client, 'tags'>[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of clients) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return Array.from(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export const hasTag = (c: Pick<Client, 'tags'>, tag: string | null) => !tag || (c.tags ?? []).includes(tag);

/** True for a hex colour the server accepts. */
export const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/** Today as YYYY-MM-DD in the viewer's own time zone. */
export function localDate(d: Date = new Date()): string {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}
