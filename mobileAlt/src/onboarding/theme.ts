import { Dimensions, Easing } from 'react-native';

// ─── Canvas baseline + scale (spec §03) ──────────────────────────────────────
// Reference frame is 393×852 (iPhone 15 logical). Derive a single scale factor
// from device width so fixed sizes track on every screen; clamp to keep tiny
// and huge devices sane.
export const BASE_W = 393;
export const BASE_H = 852;
const { width } = Dimensions.get('window');
export const S = Math.min(Math.max(width / BASE_W, 0.85), 1.15);
export const s = (n: number) => Math.round(n * S);

// ─── Schemes (spec §4.1) ─────────────────────────────────────────────────────
// Dark is default. Light swaps the dither inks rather than CSS-filter-
// inverting the whole canvas (which would corrupt photos). The scene chrome
// itself is always white-on-photo — the scrim guarantees legibility — so the
// scheme tokens are only for any solid-bg UI like a test harness.
export const SCHEMES = {
  Dark: {
    bg: '#070708',
    fg: '#ffffff',
    fgMuted: 'rgba(255,255,255,0.62)',
    fgSubtle: 'rgba(255,255,255,0.45)',
    fgFaint: 'rgba(255,255,255,0.34)',
    line: 'rgba(255,255,255,0.10)',
    card: 'rgba(255,255,255,0.07)',
    chipBorder: 'rgba(255,255,255,0.20)',
    statusBar: 'light' as const,
    invertInk: false,
  },
  Light: {
    bg: '#ffffff',
    fg: '#09090b',
    fgMuted: '#52525b',
    fgSubtle: '#71717a',
    fgFaint: '#a1a1aa',
    line: '#e4e4e7',
    card: '#ffffff',
    chipBorder: 'rgba(0,0,0,0.12)',
    statusBar: 'dark' as const,
    invertInk: true,
  },
} as const;
export type SchemeName = keyof typeof SCHEMES;

// ─── Color washes (spec §4.2) ────────────────────────────────────────────────
// Each wash sets the deep BG (instant fallback before Skia decodes), the two
// inks the dither paints with (RGB 0–255), and the accent for the eyebrow tick
// + light bloom.
export const WASHES = {
  Ember: { deep: '#160605', darkInk: [22, 7, 6] as const,    lightInk: [240, 205, 194] as const, accent: '#e0352b' },
  Steel: { deep: '#070d13', darkInk: [7, 13, 19] as const,   lightInk: [201, 223, 240] as const, accent: '#6aa6dc' },
  Ash:   { deep: '#08080a', darkInk: [11, 11, 13] as const,  lightInk: [230, 230, 234] as const, accent: '#fafafa' },
} as const;
export type WashName = keyof typeof WASHES;

// Shipped default — one wash per scene (mirrors spec §10 "Wash" column).
export const AUTO_WASH: WashName[] = ['Ember', 'Ember', 'Steel', 'Ash', 'Steel', 'Ember', 'Ember'];

// ─── Semantic + brand (spec §4.3) ────────────────────────────────────────────
export const SEMANTIC = {
  brand: '#e0352b',
  live:  '#22c55e',
  flag:  '#f59e0b',
  ink:   '#09090b',
} as const;

// ─── Motion presets (spec §07) ───────────────────────────────────────────────
// Cinematic is the shipped default. blur is a px start-value used only as a
// hint — RN has no cheap per-view blur, so Reveal drops it (fade+translate
// alone reads correctly per spec note).
export const MOTION = {
  Restrained: { dur: 420, stagger: 70,  y: 12, blur: 0,  scale: 1.0,   ease: Easing.bezier(0.25, 0.1, 0.25, 1), count: 1.0 },
  Cinematic:  { dur: 760, stagger: 140, y: 26, blur: 7,  scale: 0.985, ease: Easing.bezier(0.16, 1,   0.3,  1), count: 1.5 },
  Bold:       { dur: 640, stagger: 105, y: 46, blur: 11, scale: 0.93,  ease: Easing.bezier(0.16, 1,   0.3,  1), count: 1.3 },
} as const;
export type MotionName = keyof typeof MOTION;
export const DEFAULT_MOTION: MotionName = 'Cinematic';

// ─── Grain presets (spec §05) ────────────────────────────────────────────────
export const GRAIN = { Fine: 1.25, Medium: 1.75, Coarse: 2.6 } as const;
export type GrainName = keyof typeof GRAIN;
export const DEFAULT_GRAIN: GrainName = 'Fine';

// ─── Type tokens (spec §4.4) ─────────────────────────────────────────────────
// Sans uses the system font (Inter substitute). Mono uses SF Mono / Menlo on
// iOS via the 'Menlo' family; on Android we let RN fall back to monospace.
export const TYPE = {
  sans: undefined as undefined,            // system; map to 'Inter' if/when bundled
  mono: 'Menlo' as const,                  // iOS-safe; Android falls back
  // Roles (spec §4.4 table)
  headlineBase: 46,                        // override per scene
  body:         14.5,
  eyebrow:      11,
  heroNumber:   96,
  statNumber:   34,
  chrome:       11,
  sourceNote:   10,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Per spec §4.1: in Light scheme the dither inks swap polarity. The shader is
// bitonal so swapping (dark↔light) reads as black-stipple-on-white over a
// photo — the same figure resolves.
export function pickInks(wash: WashName, scheme: SchemeName) {
  const w = WASHES[wash];
  const invert = SCHEMES[scheme].invertInk;
  const dark = invert ? w.lightInk : w.darkInk;
  const light = invert ? w.darkInk : w.lightInk;
  return {
    darkInk:  [dark[0] / 255, dark[1] / 255, dark[2] / 255] as [number, number, number],
    lightInk: [light[0] / 255, light[1] / 255, light[2] / 255] as [number, number, number],
  };
}
