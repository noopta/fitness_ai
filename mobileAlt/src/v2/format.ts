// Copy formatters. Slashes never appear in UI copy; separators are `·` or an
// em dash; units are `lb` / `kg` with a space before them. Fixed here, once,
// not per screen.

export type UnitKey = 'lbs' | 'kg';

/** "Peak/Strength" → "Peak · strength"; "Arms/Chest Emphasis" → "Arms · chest emphasis". */
export function niceLabel(s?: string | null): string {
  if (!s) return '';
  const parts = String(s).split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return String(s).trim();
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(' · ');
}

/** The first word of a phase name: "Peak/Strength" → "Peak". */
export function phaseShort(s?: string | null): string {
  if (!s) return '';
  return String(s).split(/[/·—-]/)[0].trim();
}

/** "Peak · week 12" */
export function phaseWeek(phaseName?: string | null, week?: number | null): string {
  const ph = phaseShort(phaseName);
  if (ph && week) return `${ph} · week ${week}`;
  if (ph) return ph;
  if (week) return `Week ${week}`;
  return '';
}

/** Display unit label: the app's canonical key is 'lbs' but copy says lb. */
export function unitLabel(unit: UnitKey | string): string {
  return unit === 'kg' ? 'kg' : 'lb';
}

/** "6 lb", "84.5 kg" — always a space before the unit. */
export function withUnit(value: number | string, unit: UnitKey | string): string {
  return `${value} ${unitLabel(unit)}`;
}

/** Session name for a row: short, no slashes. "Upper Body — Arms/Chest Emphasis" → "Upper · arms & chest". */
export function sessionName(raw?: string | null): string {
  if (!raw) return 'Session';
  let s = String(raw).replace(/\s*[—–-]\s*/g, ' — ');
  s = s.replace(/\s+emphasis\b/i, '').replace(/\bbody\b/i, '').replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/\//g, ' & ');
  const [head, tail] = s.split(' — ');
  const h = head.trim();
  const t = (tail ?? '').trim();
  const out = t ? `${h} · ${t.charAt(0).toLowerCase()}${t.slice(1)}` : h;
  return out.length > 28 ? `${out.slice(0, 27).trim()}…` : out;
}

export const smoothstep = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
