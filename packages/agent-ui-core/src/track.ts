// The horizontal track — five pages, one gesture.
//
// Pure math for the shell's swipe: rubber-band at the ends, the snap decision
// on release (distance or velocity), the fractional position the tab pill and
// the header title follow, and the cross-fade of the title around the midpoint.
// All numbers mirror the prototype (Axiom App.dc.html).

export const PAGE_COUNT = 5;
export const TABS = ['Anakin', 'Training', 'Fuel', 'Feed', 'You'] as const;
export type TabName = (typeof TABS)[number];

/** Drag distance after rubber-banding at the two ends (0.3 factor). */
export function rubberBand(index: number, dx: number, width: number): number {
  const c = (index === 0 && dx > 0) || (index === PAGE_COUNT - 1 && dx < 0) ? dx * 0.3 : dx;
  return Math.max(-width, Math.min(width, c));
}

/**
 * Which page to land on when the finger lifts. Distance beyond 28% of the
 * width commits; so does a quick flick (>30px in under 260ms).
 */
export function snapTarget(index: number, drag: number, width: number, elapsedMs: number): number {
  const fast = Math.abs(drag) > 30 && elapsedMs < 260;
  let next = index;
  if (drag < -width * 0.28 || (fast && drag < 0)) next = Math.min(PAGE_COUNT - 1, index + 1);
  if (drag > width * 0.28 || (fast && drag > 0)) next = Math.max(0, index - 1);
  return next;
}

/** Fractional position 0..4 while dragging (index minus drag/width). */
export function fractionalPosition(index: number, drag: number, width: number): number {
  return width > 0 ? index - drag / width : index;
}

/** Nearest page for the header title and the tab-bar highlight. */
export function nearestPage(pos: number): number {
  return Math.max(0, Math.min(PAGE_COUNT - 1, Math.round(pos)));
}

/** Title opacity: 1 at rest, 0 at the midpoint between two pages (×2.2 curve). */
export function titleOpacity(pos: number): number {
  const n = Math.round(pos);
  return Math.max(0, 1 - Math.min(1, Math.abs(pos - n) * 2.2));
}

/** Pill translateX for a 300×56 bar with five 292/5-wide slots. */
export function pillOffset(pos: number, barWidth = 292): number {
  return Math.max(0, Math.min(PAGE_COUNT - 1, pos)) * (barWidth / PAGE_COUNT);
}

/**
 * Should a pointer movement start a horizontal drag? Needs ≥6px of travel and
 * a horizontal bias, otherwise the vertical scroll owns it.
 */
export function shouldStartDrag(dx: number, dy: number, started: boolean): 'start' | 'cancel' | 'wait' {
  if (started) return 'start';
  if (Math.abs(dx) < 6) return 'wait';
  return Math.abs(dy) > Math.abs(dx) ? 'cancel' : 'start';
}
