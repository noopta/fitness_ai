// Formatting shared by the web and React Native views.

import type { EngagementTrend } from './types';

const DAY_MS = 86_400_000;

export function initials(name: string | null | undefined, email?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  if (email) return email[0].toUpperCase();
  return '?';
}

/** Local calendar-day key, so "today" follows the viewer's time zone. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function shortDate(d: Date, now: Date = new Date()): string {
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "Today", "Yesterday", "3 days ago", then a short date past a week. */
export function relativeDay(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diff = dayDiff(d, now);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return shortDate(d, now);
}

/** Day-group heading for the timeline feed: "Today", "Yesterday", "Mon 28 Sep". */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = dayDiff(d, now);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${WEEKDAYS[d.getDay()]} ${shortDate(d, now)}`;
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Polyline points for a sparkline (handoff §5: polyline only, no axes or fill).
 * The scale is fixed at 0–max so two clients' lines are comparable at a glance;
 * `pad` keeps the round caps inside the box.
 */
export function sparklinePoints(series: number[], width: number, height: number, max = 10, pad = 2, min = 0): string {
  if (series.length === 0) return '';
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = series.length > 1 ? innerW / (series.length - 1) : 0;
  const span = max - min;
  return series
    .map((v, i) => {
      const clamped = Math.max(min, Math.min(max, v));
      const x = series.length > 1 ? pad + i * step : width / 2;
      // A flat domain (every value equal) draws through the middle rather than dividing by zero.
      const y = span > 0 ? pad + innerH - ((clamped - min) / span) * innerH : height / 2;
      return `${round1(x)},${round1(y)}`;
    })
    .join(' ');
}

/**
 * Domain for a sparkline of real measurements (an e1RM series): the data's
 * own range with a little headroom, so a 2 kg change is visible rather than
 * flattened against zero.
 */
export function seriesDomain(series: number[]): [number, number] {
  if (series.length === 0) return [0, 1];
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const padding = Math.max((hi - lo) * 0.15, hi * 0.02, 1);
  return [lo - padding, hi + padding];
}

/** "6 PM", "9 AM" — for hour pickers. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Text alternative for a sparkline (handoff §10). */
export function engagementAltText(trend: EngagementTrend, weeks: number): string {
  const word = trend === 'rising' ? 'rising' : trend === 'falling' ? 'falling' : 'steady';
  return `Engagement ${word} over ${weeks} weeks`;
}
