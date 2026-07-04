// Formatting helpers shared across the card templates.

import { ShareableWorkout } from './types';
import { LB_PER_KG } from '../../../context/UnitsContext';

// Render a backend-built ShareableWorkout in the sharer's unit. The backend
// carries canonical kg (volumeKg, per-exercise weightKg, pr.valueKg/deltaKg)
// alongside the legacy lb fields, so for a metric sharer we reformat straight
// from kg — no lb→kg round-trip and no string re-parsing. Integer kg keeps the
// cards' clean numeric style. Imperial sharers get the lb payload untouched.
// The regex path is a fallback only for older payloads that lack the kg fields.
export function displayShareable(data: ShareableWorkout, unit: 'kg' | 'lbs'): ShareableWorkout {
  if (unit !== 'kg') return { ...data, volumeUnit: 'lb' };

  const lbToKgInt = (lb: number) => Math.round(lb / LB_PER_KG);
  // Fallback: convert the "<n> lb" fragment inside a pre-formatted string.
  const convert = (s: string) =>
    s.replace(/([+-]?)(\d+(?:\.\d+)?)\s*lb\b/gi, (_m, sign, n) => `${sign}${lbToKgInt(parseFloat(n))} kg`);

  const detailKg = (ex: ShareableWorkout['exercises'][number]): string => {
    // Prefer structured kg fields; fall back to rewriting the lb string.
    if (ex.sets != null && ex.reps != null) {
      const head = `${ex.sets} × ${ex.reps}`;
      return ex.bodyweight || ex.weightKg == null || ex.weightKg <= 0
        ? head
        : `${head} · ${Math.round(ex.weightKg)} kg`;
    }
    return convert(ex.detail);
  };

  return {
    ...data,
    volumeLb: data.volumeKg != null ? Math.round(data.volumeKg) : lbToKgInt(data.volumeLb),
    volumeUnit: 'kg',
    exercises: data.exercises.map((ex) => ({ ...ex, detail: detailKg(ex) })),
    pr: data.pr
      ? {
          ...data.pr,
          value: String(data.pr.valueKg != null ? data.pr.valueKg : lbToKgInt(parseFloat(data.pr.value))),
          unit: 'kg',
          delta: data.pr.deltaKg != null ? `+${data.pr.deltaKg} kg` : convert(data.pr.delta),
        }
      : null,
  };
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 24150 → "24,150" */
export function formatVolume(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function parts(iso: string): { wd: string; mo: string; day: number; h: number; m: number; ap: string } {
  const d = new Date(iso);
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { wd: WD[d.getDay()], mo: MO[d.getMonth()], day: d.getDate(), h, m: d.getMinutes(), ap };
}

/** ISO → "Wed · Jun 18 · 7:42 PM" */
export function formatLoggedAt(iso: string): string {
  const p = parts(iso);
  return `${p.wd} · ${p.mo} ${p.day} · ${p.h}:${String(p.m).padStart(2, '0')} ${p.ap}`;
}

/** ISO → "Wed · Jun 18" (card caption eyebrow) */
export function formatDateEyebrow(iso: string): string {
  const p = parts(iso);
  return `${p.wd} · ${p.mo} ${p.day}`;
}

/** ISO → uppercase monospaced receipt date, "WED · JUN 18 · 7:42 PM" */
export function formatReceiptDate(iso: string): string {
  return formatLoggedAt(iso).toUpperCase();
}

/** 58 → "58 min"; 0/undefined → "—" */
export function formatDuration(min: number): string {
  return min && min > 0 ? `${min} min` : '—';
}

/** Join non-empty caption parts with " · ". */
export function joinCaption(...segs: Array<string | null | undefined>): string {
  return segs.filter((s) => s && s.trim()).join('  ·  ');
}
