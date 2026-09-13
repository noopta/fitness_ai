import type { SetEntry, VideoResult } from './types';
import { COPY } from './copy';

export interface RichSegment {
  text: string;
  em?: boolean;
  strong?: boolean;
}

/** Parse Anakin's markup: **strong** and *emphasis*. Anything else is literal. */
export function parseRich(input: string): RichSegment[] {
  const out: RichSegment[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m.index > last) out.push({ text: input.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], strong: true });
    else out.push({ text: m[2], em: true });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ text: input.slice(last) });
  return out;
}

export function plainText(input: string): string {
  return parseRich(input).map((s) => s.text).join('');
}

/** "225 lb · 3 × 5" */
export function formatSet(set: SetEntry): string {
  const w = Number.isInteger(set.weight) ? String(set.weight) : set.weight.toFixed(1);
  return `${w} ${set.unit} · ${set.sets} × ${set.reps}`;
}

/** The three measurements on a video card, only for values the clip produced. */
export function videoMeasurements(r: VideoResult): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (r.stickingPointSec != null) rows.push({ label: COPY.stickingPoint, value: `${round1(r.stickingPointSec)}s` });
  if (r.elbowFlareDeg != null) rows.push({ label: COPY.elbowFlare, value: `${Math.round(r.elbowFlareDeg)}°` });
  if (r.barDriftCm != null) rows.push({ label: COPY.barDrift, value: `${Math.round(r.barDriftCm)}cm` });
  return rows;
}

/** Parses a numeric field the way both composers accept input: "225", "102.5", "102,5". */
export function parseNumber(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isValidSet(weight: string, sets: string, reps: string): boolean {
  const w = parseNumber(weight);
  const s = parseNumber(sets);
  const r = parseNumber(reps);
  return w !== null && w <= 1500 && s !== null && Number.isInteger(s) && s <= 20 && r !== null && Number.isInteger(r) && r <= 50;
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
