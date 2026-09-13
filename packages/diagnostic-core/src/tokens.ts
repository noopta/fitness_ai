// §2 values, restated once for both view layers. These already exist in the
// Axiom system (web index.css zinc scale, mobile theme.ts) — nothing new is
// introduced; this just pins the element specs so RN and web can't drift.

export const DX = {
  color: {
    ink: '#09090b',
    muted: '#71717a', // floor for interactive text — never #a1a1aa on a control
    body: '#3f3f46',
    body2: '#52525b',
    disabled: '#a1a1aa', // non-interactive only: chevrons, placeholders, bullets
    border: '#e4e4e7',
    surface: '#f4f4f5',
    white: '#ffffff',
    inverseBody: 'rgba(255,255,255,0.72)',
    error: '#dc2626', // "Didn't send" label only
    scrim: 'rgba(0,0,0,0.5)',
  },
  anakinBubble: { maxWidth: '88%', padV: 15, padH: 16, radius: [16, 16, 16, 4], fontSize: 14, lineHeight: 1.6 },
  userBubble: { maxWidth: '80%', padV: 13, padH: 16, radius: [16, 16, 4, 16], fontSize: 14, lineHeight: 1.5, weight: '500' },
  chip: { fontSize: 13, weight: '600', padV: 9, padH: 14, gap: 7 },
  card: { radius: 16, radiusLarge: 18, pad: 18, padLarge: 20 },
  verdictShadow: { x: 0, y: 6, blur: 20, spread: -14, color: 'rgba(0,0,0,0.18)' },
  numeric: { fontSize: 26, weight: '700', letterSpacing: -0.035, labelSize: 10, labelWeight: '600', labelTracking: 0.08 },
  send: { size: 46, icon: 18, stroke: 2.2, disabledOpacity: 0.35 },
  motion: {
    bubbleMs: 240,
    bubbleRise: 10,
    cardMs: 300,
    sheetMs: 320,
    sheetEasing: [0.16, 1, 0.3, 1] as const,
    typingMs: 1200,
    typingOffsets: [0, 200, 400],
    reportFadeMs: 300,
    shareConfirmMs: 2600,
  },
  sheetRadius: 24,
  composerBg: 'rgba(255,255,255,0.94)',
} as const;
