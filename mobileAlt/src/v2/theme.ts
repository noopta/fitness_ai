// Axiom Design System v2 — agent-first tokens.
//
// Mirrors design-system-v2/tokens/{colors,type,motion}.css from the handoff.
// Kept under its own namespace so v1 screens (src/constants/theme.ts) are
// untouched; v2 code imports from here only.

import { Easing } from 'react-native-reanimated';
import type { TextStyle } from 'react-native';

const NUM: TextStyle = { fontVariant: ['tabular-nums'] };

export const v2 = {
  color: {
    white: '#ffffff',
    ink: '#09090b',
    muted: '#71717a',
    placeholder: '#a1a1aa',
    hairline: '#e4e4e7',
    surface: '#f4f4f5',
    /** Crimson = the agent acting, or the one primary action. Never status, never chrome. */
    crimson: '#A51C30',
    /** Macro chart encoding only — ring stroke and numerals, never in a row. */
    macro: { protein: '#3b82f6', carbs: '#f59e0b', fat: '#ec4899', fiber: '#22c55e' },
    /** The camera is the only dark surface. (Home is white; the engraving is vignetted onto it.) */
    /** Home brief ground. */
    darkGround: '#2c2c2c',
    darkInk: '#fafafa',
    darkMuted: '#a1a1aa',
    darkHairline: 'rgba(255,255,255,.16)',
    darkInputLine: 'rgba(255,255,255,.2)',
    cameraGround: '#09090b',
    tabBarLight: 'rgba(255,255,255,.82)',
    tabBarDark: 'rgba(58,58,58,.72)',
    scrim: 'rgba(0,0,0,.5)',
  },
  font: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
  },
  type: {
    display: { fontSize: 88, lineHeight: 88, letterSpacing: -3.5 },     // -.04em
    displaySm: { fontSize: 72, lineHeight: 72, letterSpacing: -2.2 },   // -.03em
    hero: { fontSize: 64, lineHeight: 64, letterSpacing: -2.56 },       // -.04em
    headline: { fontSize: 34, lineHeight: 39, letterSpacing: -0.68 },   // -.02em
    headlineSm: { fontSize: 30, lineHeight: 34.5, letterSpacing: -0.6 },
    read: { fontSize: 24, lineHeight: 30, letterSpacing: -0.48 },       // -.02em
    readSm: { fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },      // -.01em
    row: { fontSize: 17, lineHeight: 22, letterSpacing: 0 },
    body: { fontSize: 15, lineHeight: 23, letterSpacing: 0 },           // 1.55
    caption: { fontSize: 13, lineHeight: 19.5, letterSpacing: 0 },      // 1.5
    eyebrow: { fontSize: 11, lineHeight: 14, letterSpacing: 1.32 },     // +.12em
  },
  space: {
    gutter: 28,
    safeTop: 62,
    tabBarClearance: 112,
    rowY: 15,
    rowH: 52,
    grid: 4,
  },
  radius: { sheet: 28, thumb: 20, pill: 999 },
  motion: {
    easeEnter: Easing.bezier(0.16, 1, 0.3, 1),
    easeTrack: Easing.bezier(0.2, 0.9, 0.25, 1),
    /** Brief ↔ chat: background 850 ms, art opacity 750 ms, art transform 1000 ms, all on this curve. */
    easeIO: Easing.bezier(0.65, 0, 0.35, 1),
    briefChat: 850,
    artFade: 750,
    artMove: 1000,
    press: 200,
    enter: 450,
    exit: 300,
    layout: 600,
    track: 520,
    push: 450,
    pulse: 1600,
    stagger: 90,
    /** Receipt lines stream one per ~420ms; text at ~3 chars / 16ms. */
    receiptGap: 420,
    streamStep: 16,
    streamChars: 3,
  },
  tabBar: { width: 300, height: 56, bottom: 28, icon: 22, stroke: 1.75 },
  shadow: {
    push: { shadowColor: '#000', shadowOpacity: 0.34, shadowRadius: 30, shadowOffset: { width: -20, height: 0 }, elevation: 12 },
    tabBar: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  },
} as const;

export type MacroKey = keyof typeof v2.color.macro;

/** Text style helpers — always Inter, tabular numerals where digits line up. */
export const T: Record<string, TextStyle> = {
  eyebrow: { fontFamily: v2.font.bold, ...v2.type.eyebrow, textTransform: 'uppercase' as const, color: v2.color.muted },
  headline: { fontFamily: v2.font.bold, ...v2.type.headline, color: v2.color.ink },
  headlineSm: { fontFamily: v2.font.bold, ...v2.type.headlineSm, color: v2.color.ink },
  read: { fontFamily: v2.font.semibold, ...v2.type.read, color: v2.color.ink },
  readSm: { fontFamily: v2.font.medium, ...v2.type.readSm, color: v2.color.ink },
  row: { fontFamily: v2.font.medium, ...v2.type.row, color: v2.color.ink },
  rowStrong: { fontFamily: v2.font.semibold, ...v2.type.row, color: v2.color.ink },
  body: { fontFamily: v2.font.regular, ...v2.type.body, color: v2.color.ink },
  bodyMuted: { fontFamily: v2.font.regular, ...v2.type.body, color: v2.color.muted },
  caption: { fontFamily: v2.font.regular, ...v2.type.caption, color: v2.color.muted },
  captionStrong: { fontFamily: v2.font.semibold, ...v2.type.caption, color: v2.color.muted },
  num: NUM,
  hero: { fontFamily: v2.font.bold, ...v2.type.hero, color: v2.color.ink, ...NUM },
  display: { fontFamily: v2.font.bold, ...v2.type.display, color: v2.color.ink, ...NUM },
  displaySm: { fontFamily: v2.font.bold, ...v2.type.displaySm, color: v2.color.ink, ...NUM },
};
