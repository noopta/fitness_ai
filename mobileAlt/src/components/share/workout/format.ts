// Formatting helpers shared across the card templates.

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
