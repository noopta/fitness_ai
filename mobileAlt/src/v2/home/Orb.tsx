// Transition orb — the glow, 80 ring arcs and five petal layers that fly from
// the video's orb to the header logo (home video spec §3–4; ring/glow code
// from review #3 §C3). The engraving art, hand warp, fingertip follow and
// threads are gone: the video carries the character now.
//
// Frame 402 × 874 pt, scaled by s = screenWidth / 402. A0 = (146, 405, r 70),
// the orb in the video → A1 = (42, 78, r 28), the header mark, by p (the
// shell's shared progress). The canvas is invisible in brief (opacity
// min(1, p × 5)) and does no per-frame work while p = 0. Once docked
// (p > .995) the header mark takes over, so the orb becomes the logo.

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, AppState } from 'react-native';
import { useSharedValue, useDerivedValue, useFrameCallback, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import { Canvas, Group, Image as SkImage, Circle, Path, RadialGradient, BlendColor, useImage } from '@shopify/react-native-skia';

const MARK = require('../../../assets/v2/axiom-mark.png');

const FRAME_W = 402;
const A0 = { x: 146, y: 405, r: 70 };
const A1 = { x: 42, y: 78, r: 28 };
const L0 = [0.18, 0.26, 0.36, 0.5, 0.82];
const L1 = [0, 0, 0, 0, 1];
const WHITE = [250, 250, 250] as const, INK = [9, 9, 11] as const, CRIMSON = [165, 28, 48] as const;

function rng(seed: number) { let x = seed; return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }

interface Props { mode: 'brief' | 'chat'; progress: SharedValue<number>; working: boolean; focused: boolean }

class OrbBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn('[v2] home canvas failed; rendering without it', err); }
  render() { return this.state.failed ? null : this.props.children; }
}
export function Orb(props: Props) { return <OrbBoundary><Canvas_ {...props} /></OrbBoundary>; }

function Canvas_({ mode, progress, working, focused }: Props) {
  const { width: SW, height: SH } = useWindowDimensions();
  const s = SW / FRAME_W;
  const reduced = useReducedMotion();
  const mark = useImage(MARK);
  const [appActive, setAppActive] = useState(true);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active')); return () => sub.remove(); }, []);

  const p = progress;
  const running = useSharedValue(1);
  useEffect(() => { running.value = (!focused || !appActive || reduced) ? 0 : 1; }, [focused, appActive, reduced, running]);
  const busy = useSharedValue(working ? 1 : 0);
  useEffect(() => { busy.value = working ? 1 : 0; }, [working, busy]);
  // Stop drawing entirely in chat once the transition is over.
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (mode === 'chat') { const t = setTimeout(() => setHidden(true), 1150); return () => clearTimeout(t); } setHidden(false); }, [mode]);

  // ── Per-frame state (C1–C3) — only while the orb is in flight or docking ──
  const time = useSharedValue(0);
  const mix = useSharedValue(0);
  const energy = useSharedValue(1);
  const bph = useSharedValue(0);
  const angles = useSharedValue<number[]>([]);

  const particles = useMemo(() => {
    const r = rng(11);
    return Array.from({ length: 80 }, () => ({ rad: 26 + r() * 52, a: r() * 6.283, sp: (0.35 + r() * 0.9) * (r() < 0.85 ? 1 : -1), tilt: (r() - 0.5) * 0.9, fl: 0.32 + r() * 0.22, sz: 0.5 + r() * 1.4, al: 0.25 + r() * 0.6 }));
  }, []);

  useFrameCallback((info) => {
    'worklet';
    // In brief the canvas is invisible: no per-frame work at all.
    if (!running.value || p.value <= 0) return;
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    time.value += dt;
    const w = busy.value;
    mix.value += (w - mix.value) * (1 - Math.exp(-dt * 2.6));
    energy.value += ((w ? 2.2 : 1) - energy.value) * (1 - Math.exp(-dt * 1.6));
    bph.value += (dt * 2 * Math.PI) / (w ? 3 : 5.2);
    const next = angles.value.length === 80 ? angles.value.slice() : particles.map((q) => q.a);
    for (let i = 0; i < 80; i++) next[i] += particles[i].sp * dt * energy.value;
    angles.value = next;
  }, true);

  // ── Derived geometry (C2–C4) ─────────────────────────────────────────────
  const q = useDerivedValue(() => 1 - p.value);
  // Cubic ease-in-out on the flight path (spec §4).
  const e = useDerivedValue(() => { const t = p.value; return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; });
  const cx = useDerivedValue(() => (A0.x + (A1.x - A0.x) * e.value) * s);
  const cy = useDerivedValue(() => (A0.y + (A1.y - A0.y) * e.value) * s);
  const S = useDerivedValue(() => (A0.r + (A1.r - A0.r) * e.value) * s);
  // Fades in over the video's orb in the first ~190 ms, so the hand-off is invisible.
  const canvasOpacity = useDerivedValue(() => Math.min(1, p.value * 5));
  const breathe = useDerivedValue(() => 1 + 0.05 * Math.sin(bph.value) * q.value);
  const rgb = useDerivedValue(() => {
    const m = mix.value;
    return [Math.round(WHITE[0] + (CRIMSON[0] - WHITE[0]) * m), Math.round(WHITE[1] + (CRIMSON[1] - WHITE[1]) * m), Math.round(WHITE[2] + (CRIMSON[2] - WHITE[2]) * m)];
  });
  const glowC = useDerivedValue(() => ({ x: cx.value, y: cy.value }));
  const glowR = useDerivedValue(() => S.value * 0.95);
  const glowColors = useDerivedValue(() => [`rgba(${rgb.value[0]},${rgb.value[1]},${rgb.value[2]},${(0.2 * q.value).toFixed(3)})`, `rgba(${rgb.value[0]},${rgb.value[1]},${rgb.value[2]},0)`]);
  const showOrb = useDerivedValue(() => (q.value > 0.01 ? 1 : 0));

  // Rings (C3): each particle is a short arc on its own tilted, flattened orbit. Batched into four
  // stroked paths by width so the canvas draws 4 paths, not 80 nodes.
  const BUCKETS = 4;
  const ringPaths = Array.from({ length: BUCKETS }, (_, b) => useDerivedValue(() => {
    const ang = angles.value; if (ang.length !== 80 || q.value <= 0.01) return '';
    const k = S.value / (A0.r * s), br = breathe.value;
    let d = '';
    for (let i = b; i < 80; i += BUCKETS) {
      const pt = particles[i];
      const rr = pt.rad * s * br * k;
      const a1 = ang[i], a0 = a1 - 0.22 * Math.sign(pt.sp);
      const ct = Math.cos(pt.tilt), st = Math.sin(pt.tilt);
      for (let j = 0; j <= 5; j++) {
        const a = a0 + ((a1 - a0) * j) / 5;
        const ex = Math.cos(a) * rr, ey = Math.sin(a) * rr * pt.fl;      // scale(1, fl)
        const x = cx.value + ex * ct - ey * st, y = cy.value + ex * st + ey * ct; // rotate(tilt) → translate
        d += (j === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      }
    }
    return d;
  }));
  const ringMeta = useMemo(() => Array.from({ length: BUCKETS }, (_, b) => {
    const ps = particles.filter((_, i) => i % BUCKETS === b);
    return { sz: ps.reduce((a, x) => a + x.sz, 0) / ps.length, al: ps.reduce((a, x) => a + x.al, 0) / ps.length };
  }), [particles]);
  const ringColors = ringMeta.map((m) => useDerivedValue(() => `rgba(${rgb.value[0]},${rgb.value[1]},${rgb.value[2]},${(m.al * q.value).toFixed(3)})`));

  // Petals (C4): five layers, each drawn in up to three tints (white · ink · crimson) whose alphas cross-fade with p and mix.
  const Sp = useDerivedValue(() => S.value * (0.72 * q.value + p.value));
  const spread = useDerivedValue(() => (8 + 4 * Math.sin(time.value * 0.8)) * q.value);
  const petals = [0, 1, 2, 3, 4].map((i) => {
    const transform = useDerivedValue(() => {
      const sway = Math.sin(time.value * (0.55 + i * 0.11) + i * 1.3) * 3.2 * q.value;
      const rot = ((i - 4) * spread.value + sway) * Math.PI / 180;
      return [{ translateX: cx.value - Sp.value * 0.06 }, { translateY: cy.value + Sp.value * 0.29 }, { rotate: rot }, { scale: breathe.value }];
    });
    const rect = useDerivedValue(() => ({ x: -0.46 * Sp.value, y: -0.79 * Sp.value, width: Sp.value, height: Sp.value }));
    const al = useDerivedValue(() => L0[i] + (L1[i] - L0[i]) * p.value);
    const wa = useDerivedValue(() => al.value * q.value * (1 - mix.value * 0.85));
    const ka = useDerivedValue(() => al.value * p.value * (1 - mix.value));
    const ra = useDerivedValue(() => al.value * mix.value * (p.value > 0.5 ? 0.62 + 0.38 * Math.cos(time.value * 3.9) : 1));
    return { transform, rect, wa, ka, ra };
  });

  if (hidden || !mark) return null;
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: SW, height: SH }]} pointerEvents="none">
      <Group opacity={canvasOpacity}>
      <Group opacity={showOrb}>
        <Circle c={glowC} r={glowR}><RadialGradient c={glowC} r={glowR} colors={glowColors} /></Circle>
        {ringPaths.map((d, b) => <Path key={`r${b}`} path={d} style="stroke" strokeWidth={ringMeta[b].sz * s} strokeCap="round" color={ringColors[b]} />)}
      </Group>
      {petals.map((L, i) => (
        <Group key={`p${i}`} transform={L.transform}>
          <Group opacity={L.wa}><SkImage image={mark} rect={L.rect} fit="contain"><BlendColor color="#fafafa" mode="srcIn" /></SkImage></Group>
          <Group opacity={L.ka}><SkImage image={mark} rect={L.rect} fit="contain"><BlendColor color="#09090b" mode="srcIn" /></SkImage></Group>
          <Group opacity={L.ra}><SkImage image={mark} rect={L.rect} fit="contain"><BlendColor color="#A51C30" mode="srcIn" /></SkImage></Group>
        </Group>
      ))}
      </Group>
    </Canvas>
  );
}
