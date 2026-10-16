// Pure helpers for the client portal: image sizing, brand-colour contrast,
// units and dates. Kept free of the DOM so they test without a browser.

import type { MeasurementKind, ProgramBlock, ProgramItem } from '@axiom/personal-training-core';

/** Long edge a progress photo is scaled to before upload. */
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.85;

/**
 * Fit (width × height) inside a square of `maxEdge`, keeping the aspect ratio.
 * Never upscales; always returns whole pixels of at least 1.
 */
export function fitWithin(width: number, height: number, maxEdge: number = PHOTO_MAX_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** `#rgb` or `#rrggbb` → [r, g, b] in 0–255; null for anything else. */
export function parseHex(color: string | null | undefined): [number, number, number] | null {
  if (!color) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text colour to put on a brand fill: white only when the fill is dark enough
 * that white reads better than near-black. Null when the colour is unusable.
 */
export function textOn(color: string | null | undefined): '#ffffff' | '#09090b' | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const l = relativeLuminance(rgb);
  const ink = relativeLuminance([9, 9, 11]);
  return contrastRatio(l, 1) >= contrastRatio(l, ink) ? '#ffffff' : '#09090b';
}

/** CSS variables for the portal root. Falls back to the app's ink when there is no usable brand colour. */
export function accentVars(brandColor: string | null | undefined): Record<string, string> {
  const rgb = parseHex(brandColor);
  const on = textOn(brandColor);
  if (!rgb || !on) return { '--portal-accent': 'hsl(var(--foreground))', '--portal-on-accent': 'hsl(var(--background))' };
  const hex = `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return { '--portal-accent': hex, '--portal-on-accent': on };
}

/** Today (or `d`) as YYYY-MM-DD in the viewer's own timezone, not UTC. */
export function localDateISO(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const LENGTH_KINDS: MeasurementKind[] = ['waist', 'hips', 'chest', 'arm', 'thigh'];

/** The unit a client types a measurement in, from their weight preference. */
export function unitFor(kind: MeasurementKind, weightUnit: 'kg' | 'lb'): string {
  if (kind === 'bodyweight') return weightUnit;
  if (kind === 'body_fat') return '%';
  if (kind === 'resting_hr') return 'bpm';
  return weightUnit === 'kg' ? 'cm' : 'in';
}

export const MEASUREMENT_LABEL: Partial<Record<MeasurementKind, string>> = {
  bodyweight: 'Bodyweight',
  waist: 'Waist',
  hips: 'Hips',
  chest: 'Chest',
  arm: 'Arm',
  thigh: 'Thigh',
  body_fat: 'Body fat',
  resting_hr: 'Resting heart rate',
};

/** "2 minutes" from a question count — a rough read, never under a minute. */
export function checkInMinutes(questionCount: number): number {
  return Math.max(1, Math.round(questionCount / 2.5));
}

/** "14 Oct" for a YYYY-MM-DD or ISO string, read as a calendar date. */
export function formatDay(value: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(day.getTime())) return value;
  return day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "October 2026" from "2026-10". */
export function formatMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = localDateISO() === localDateISO(d);
  return today
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Trim trailing zeros off a measurement for display. */
export function formatValue(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** Strip a `data:…;base64,` prefix, leaving the bare payload. */
export function stripDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return dataUrl.startsWith('data:') && i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

// ─── Trainer program ─────────────────────────────────────────────────────────

/** "75% 1RM", "RPE 8", "RIR 2", "60 kg", "Bodyweight"; null when there is no load to show. */
export function formatLoad(load: ProgramItem['load']): string | null {
  if (!load || load.type === 'none') return null;
  const v = load.value;
  const has = typeof v === 'number' && Number.isFinite(v);
  switch (load.type) {
    case 'percent1rm': return has ? `${formatValue(v!)}% 1RM` : null;
    case 'rpe': return has ? `RPE ${formatValue(v!)}` : null;
    case 'rir': return has ? `RIR ${formatValue(v!)}` : null;
    case 'kg': return has ? `${formatValue(v!)} kg` : null;
    case 'lb': return has ? `${formatValue(v!)} lb` : null;
    case 'bodyweight': return 'Bodyweight';
    default: return null;
  }
}

/** "45s rest", "2 min rest", "2:30 rest". */
export function formatRest(sec: number | undefined): string | null {
  if (!sec || sec <= 0) return null;
  if (sec < 60) return `${sec}s rest`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return r === 0 ? `${m} min rest` : `${m}:${String(r).padStart(2, '0')} rest`;
}

/** "3 × 8-10"; an empty reps value reads as sets only. */
export function formatSetsReps(item: Pick<ProgramItem, 'sets' | 'reps'>): string {
  const reps = (item.reps ?? '').trim();
  if (!item.sets) return reps;
  return reps ? `${item.sets} × ${reps}` : `${item.sets} ${item.sets === 1 ? 'set' : 'sets'}`;
}

/** Letter per block, numbered within groups: A, B1, B2, C. */
export function itemLabels(blocks: ProgramBlock[]): string[][] {
  return blocks.map((b, bi) => {
    const letter = bi < 26 ? String.fromCharCode(65 + bi) : `${bi + 1}`;
    return b.items.length > 1 || b.kind !== 'single' ? b.items.map((_, ii) => `${letter}${ii + 1}`) : b.items.map(() => letter);
  });
}

const BLOCK_NAME: Record<ProgramBlock['kind'], string> = { single: '', superset: 'Superset', circuit: 'Circuit', amrap: 'AMRAP', emom: 'EMOM' };

/** "Superset · 3 rounds", "AMRAP · 12 min"; null for a straight set. */
export function blockHeading(block: ProgramBlock): string | null {
  if (block.kind === 'single') return null;
  const parts = [BLOCK_NAME[block.kind]];
  if ((block.kind === 'amrap' || block.kind === 'emom') && block.timeCapMin) parts.push(`${block.timeCapMin} min`);
  else if (block.rounds) parts.push(`${block.rounds} ${block.rounds === 1 ? 'round' : 'rounds'}`);
  if ((block.kind === 'superset' || block.kind === 'circuit') && block.timeCapMin) parts.push(`${block.timeCapMin} min cap`);
  return parts.join(' · ');
}

/** Which program week today falls in (0-based), clamped to the program; 0 without a start date. */
export function currentWeekIndex(startDate: string | null, weekCount: number, today: Date = new Date()): number {
  if (!startDate || weekCount <= 0) return 0;
  const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(startDate) ? `${startDate}T00:00:00` : startDate);
  if (Number.isNaN(start.getTime())) return 0;
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / 86_400_000);
  if (days < 0) return 0;
  return Math.min(weekCount - 1, Math.floor(days / 7));
}

export const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
