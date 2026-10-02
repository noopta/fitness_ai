// Timeline grouping. Events arrive newest first; the feed is grouped by the
// viewer's local calendar day.

import { dayHeading, dayKey } from './format';
import type { TimelineEvent, TimelinePage } from './types';

export interface TimelineDay {
  key: string;
  heading: string;
  events: TimelineEvent[];
}

export function groupByDay(events: TimelineEvent[], now: Date = new Date()): TimelineDay[] {
  const days: TimelineDay[] = [];
  for (const e of events) {
    const key = dayKey(new Date(e.at));
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(e);
    else days.push({ key, heading: dayHeading(e.at, now), events: [e] });
  }
  return days;
}

/** Flatten loaded pages into one newest-first list, dropping any event a later page repeats. */
export function mergePages(pages: TimelinePage[]): TimelineEvent[] {
  const seen = new Set<string>();
  const out: TimelineEvent[] = [];
  for (const page of pages) {
    for (const e of page.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}
