// Small formatting helpers shared by card builders. Copy rules (design):
// units "lb"/"kg" with a space, no "~", no slashes, tabular numbers.

export type UnitPref = 'metric' | 'imperial';
const KG_PER_LB = 0.45359237;

export function kgTo(unit: UnitPref, kg: number | null | undefined): number | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  return unit === 'metric' ? kg : kg / KG_PER_LB;
}
export function toKg(unit: UnitPref, v: number): number {
  return unit === 'metric' ? v : v * KG_PER_LB;
}
export function unitWord(unit: UnitPref): 'kg' | 'lb' { return unit === 'metric' ? 'kg' : 'lb'; }

/** 83.9 kg → "84 kg" / 185.0 lb → "185 lb"; decimals only when they carry. */
export function weight(unit: UnitPref, kg: number | null | undefined, opts: { unit?: boolean; dp?: number } = {}): string {
  const v = kgTo(unit, kg);
  if (v == null) return '—';
  const dp = opts.dp ?? (unit === 'metric' ? 1 : 0);
  const rounded = Number(v.toFixed(dp));
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(dp);
  return opts.unit === false ? s : `${s} ${unitWord(unit)}`;
}
/** Body weight keeps one decimal in both units (182.4 lb). */
export function bodyWeight(unit: UnitPref, kg: number | null | undefined): string {
  return weight(unit, kg, { dp: 1 });
}

export function num(n: number | null | undefined, dp = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n.toFixed(dp)).toLocaleString('en-US', { maximumFractionDigits: dp });
}

export function clockTime(d: Date, tz: string): string {
  try {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(' AM', ' am').replace(' PM', ' pm');
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** "2026-09-23" → "Tue 23 Sep". */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
}

/** Today's date in the user's timezone as YYYY-MM-DD. */
export function todayIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function plural(n: number, one: string, many = `${one}s`): string { return `${n} ${n === 1 ? one : many}`; }
export function titleCase(s: string): string { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }
