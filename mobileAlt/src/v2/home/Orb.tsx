// The home artwork, the energy orb and the hand motion — one Skia canvas
// sized to the screen, every animated value on the UI thread.
//
// Values from `Axiom App.dc.html`, in a 402-pt frame (scaled by s):
//   art box 440×440 at (30, −30); orb at (150, 418) r 92 in brief → the
//   header mark at (42, 78) r 28 in chat; fingertips [[96,382],[124,376],
//   [159,400]]; hand bend 9·sin(1.05t)+3·sin(2.3t+1) pt, weighted wrist→fingers;
//   the orb follows the fingers with a damped lag (k = 3.2/s); glow at .95 r,
//   ~80 orbit particles at r 26–78, five logomark layers with a petal spread
//   of 8 ± 4° and a breath of 1 ± .045. Brief → chat: cubic ease-in-out over
//   750 ms while the art fades (opacity → 0, y −40).
//
// The hand is drawn as vertical column slices of the hand strip (image y
// 690–1024), each offset by dy·weight(x) — the prototype's approach until a
// layered export arrives. Time only advances while `paused` is false.
//
// Brief is dark (#2c2c2c): the orb is white, and as it flies into the header
// it becomes ink — it IS the mark. Crimson while Anakin works. The art fades
// (750 ms) and lifts/scales (1000 ms) on the same curve as the background.

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, AppState } from 'react-native';
import { useSharedValue, useDerivedValue, useFrameCallback, withTiming, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import {
  Canvas, Group, Image as SkImage, Circle, Points, Path, Rect, RadialGradient, LinearGradient, BlendColor, useImage, vec, rect,
} from '@shopify/react-native-skia';
// Inside worklets only plain object literals are used for points and rects —
// imported helpers are not worklets (that was the first-render crash).
import { v2 } from '../theme';

const ART = require('../../../assets/v2/anakin-art.png');
const MARK = require('../../../assets/v2/axiom-mark.png');

const FRAME_W = 402;
const ART_BOX = { x: 30, y: -30, size: 440 };
const A0 = { x: 150, y: 418, r: 92 };
const A1 = { x: 42, y: 78, r: 28 };
const FT = [[96, 382], [124, 376], [159, 400]] as const;
const L0 = [0.18, 0.26, 0.36, 0.5, 0.82];
const L1 = [0, 0, 0, 0, 1];
const SLICES = 32;
const STRIP = { x0: 90, x1: 1024, y0: 690 }; // image px
const WRIST_X = 860, FINGER_X = 220;

const sm = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
const INK = [9, 9, 11] as const;
const CRIMSON = [165, 28, 48] as const;

function rng(seed: number) { let x = seed; return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }

interface Props {
  mode: 'brief' | 'chat';
  /** The shell's brief → chat progress (0 → 1). */
  progress: SharedValue<number>;
  working: boolean;
  focused: boolean;
}

export function Orb({ mode, progress, working, focused }: Props) {
  const { width: SW, height: SH } = useWindowDimensions();
  const s = SW / FRAME_W;
  const reduced = useReducedMotion();
  const img = useImage(ART);
  const mark = useImage(MARK);
  const [appActive, setAppActive] = useState(true);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active')); return () => sub.remove(); }, []);

  // The orb's flight rides the shell's progress; the art has its own timings on the same curve.
  const p = progress;
  const artA = useSharedValue(mode === 'chat' ? 1 : 0);
  const artT = useSharedValue(mode === 'chat' ? 1 : 0);
  useEffect(() => {
    const to = mode === 'chat' ? 1 : 0;
    artA.value = withTiming(to, { duration: reduced ? 150 : v2.motion.artFade, easing: v2.motion.easeIO });
    artT.value = withTiming(to, { duration: reduced ? 150 : v2.motion.artMove, easing: v2.motion.easeIO });
  }, [mode, artA, artT, reduced]);
  const paused = useSharedValue(0);
  useEffect(() => { paused.value = (mode === 'chat' || !focused || !appActive || reduced) ? 1 : 0; }, [mode, focused, appActive, reduced, paused]);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (mode === 'chat') { const t = setTimeout(() => setHidden(true), 1100); return () => clearTimeout(t); } setHidden(false); }, [mode]);
  const energy = useSharedValue(1);
  const mix = useSharedValue(0);
  useEffect(() => { energy.value = withTiming(working ? 2.2 : 1, { duration: 600 }); mix.value = withTiming(working ? 1 : 0, { duration: 400 }); }, [working, energy, mix]);

  // Time advances only while running; the finger lag integrates per frame.
  const time = useSharedValue(0);
  const fd = useSharedValue(0);
  useFrameCallback((info) => {
    'worklet';
    if (paused.value) return;
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    time.value += dt;
    const dy = 9 * Math.sin(1.05 * time.value) + 3 * Math.sin(2.3 * time.value + 1);
    fd.value += (dy * 0.85 - fd.value) * (1 - Math.exp(-3.2 * dt));
  }, true);

  const dy = useDerivedValue(() => 9 * Math.sin(1.05 * time.value) + 3 * Math.sin(2.3 * time.value + 1));
  const cx = useDerivedValue(() => (A0.x + (A1.x - A0.x) * p.value) * s);
  const cy = useDerivedValue(() => (A0.y + fd.value * (1 - p.value) + (A1.y - A0.y) * p.value) * s);
  const R = useDerivedValue(() => (A0.r + (A1.r - A0.r) * p.value) * s);
  const q = useDerivedValue(() => 1 - p.value);
  const breathe = useDerivedValue(() => 1 + 0.045 * Math.sin(time.value * 2 * Math.PI / 5.2) * q.value);
  // Base tone: white (250) in the dark brief, ink (9,9,11) once it is the header mark; crimson while working.
  const tone = useDerivedValue(() => {
    const m = mix.value, pv = p.value;
    const base = [250 + (INK[0] - 250) * pv, 250 + (INK[1] - 250) * pv, 250 + (INK[2] - 250) * pv];
    return [Math.round(base[0] + (CRIMSON[0] - base[0]) * m), Math.round(base[1] + (CRIMSON[1] - base[1]) * m), Math.round(base[2] + (CRIMSON[2] - base[2]) * m)];
  });
  const colour = useDerivedValue(() => `rgb(${tone.value[0]},${tone.value[1]},${tone.value[2]})`);
  const glowColors = useDerivedValue(() => [`rgba(${tone.value[0]},${tone.value[1]},${tone.value[2]},${(0.2 * q.value).toFixed(3)})`, `rgba(${tone.value[0]},${tone.value[1]},${tone.value[2]},0)`]);
  const glowC = useDerivedValue(() => ({ x: cx.value, y: cy.value }));
  const glowR = useDerivedValue(() => R.value * 0.95);

  // Particles: one Points draw.
  const particles = useMemo(() => {
    const r = rng(11);
    return Array.from({ length: 80 }, () => ({ rad: 26 + r() * 52, a: r() * 6.283, sp: (0.35 + r() * 0.9) * (r() < 0.85 ? 1 : -1), tilt: (r() - 0.5) * 0.9, fl: 0.32 + r() * 0.22 }));
  }, []);
  const pts = useDerivedValue(() => {
    const out = [];
    const k = R.value / (A0.r * s);
    for (let i = 0; i < particles.length; i++) {
      const pt = particles[i];
      const ang = pt.a + pt.sp * time.value * energy.value;
      const rr = pt.rad * s * breathe.value * k;
      const ex = Math.cos(ang) * rr, ey = Math.sin(ang) * rr * pt.fl;
      const x = cx.value + ex * Math.cos(pt.tilt) - ey * Math.sin(pt.tilt);
      const y = cy.value + ex * Math.sin(pt.tilt) + ey * Math.cos(pt.tilt);
      out.push({ x, y });
    }
    return out;
  });
  const particleColor = useDerivedValue(() => `rgba(${tone.value[0]},${tone.value[1]},${tone.value[2]},${(0.6 * q.value).toFixed(3)})`);

  // Filaments from the fingertips to the orb.
  const threads = [0, 1, 2].map((i) => useDerivedValue(() => {
    const fx = FT[i][0] * s, fy = (FT[i][1] + fd.value) * s;
    const tx = cx.value + (fx - cx.value) * 0.35, ty = cy.value - R.value * 0.3;
    const mx = (fx + tx) / 2 + Math.sin(time.value * 1.7 + i * 2) * 10 * s, my = (fy + ty) / 2 + Math.cos(time.value * 1.3 + i) * 6 * s;
    return `M ${fx} ${fy} Q ${mx} ${my} ${tx} ${ty}`;
  }));
  const threadColor = useDerivedValue(() => `rgba(${tone.value[0]},${tone.value[1]},${tone.value[2]},${(0.2 * q.value * Math.min(1, energy.value)).toFixed(3)})`);

  // Logomark layers inside the orb.
  const markSize = useDerivedValue(() => R.value * (0.72 * q.value + p.value));
  const spread = useDerivedValue(() => (8 + 4 * Math.sin(time.value * 0.8)) * q.value);
  const layers = [0, 1, 2, 3, 4].map((i) => ({
    transform: useDerivedValue(() => {
      const sway = Math.sin(time.value * (0.55 + i * 0.11) + i * 1.3) * 3.2 * q.value;
      const rot = ((i - 4) * spread.value + sway) * Math.PI / 180;
      const Sp = markSize.value;
      return [{ translateX: cx.value - Sp * 0.06 }, { translateY: cy.value + Sp * 0.29 }, { rotate: rot }, { scale: breathe.value }];
    }),
    opacity: useDerivedValue(() => {
      const al = L0[i] + (L1[i] - L0[i]) * p.value;
      const pulse = mix.value > 0.5 && p.value > 0.5 ? 0.62 + 0.38 * Math.cos(time.value * 3.9) : 1;
      return al * pulse;
    }),
    rect: useDerivedValue(() => { const Sp = markSize.value; return { x: -0.46 * Sp, y: -0.79 * Sp, width: Sp, height: Sp }; }),
  }));

  // Art group: fades and lifts as chat opens.
  const artOpacity = useDerivedValue(() => 1 - artA.value);
  const artTransform = useDerivedValue(() => [{ translateY: -70 * artT.value }]);
  const ax = ART_BOX.x * s, ay = ART_BOX.y * s, A = ART_BOX.size * s;
  const k = A / 1024; // image px → screen pt
  const slices = useMemo(() => Array.from({ length: SLICES }, (_, i) => {
    const x0 = STRIP.x0 + ((STRIP.x1 - STRIP.x0) * i) / SLICES;
    const w = (STRIP.x1 - STRIP.x0) / SLICES;
    const xc = x0 + w / 2;
    const weight = sm((WRIST_X - xc) / (WRIST_X - FINGER_X));
    return { sx: ax + x0 * k, sw: w * k + 0.6, top: ay + STRIP.y0 * k, h: (1024 - STRIP.y0) * k + 24, weight };
  }), [ax, ay, k]);
  const sliceTransforms = slices.map((sl) => useDerivedValue(() => [{ translateY: dy.value * sl.weight * s * q.value }]));

  if (hidden || !img) return null;
  const cxA = ax + A / 2, cyA = ay + A / 2;
  const artScale = useDerivedValue(() => [{ translateX: cxA }, { translateY: cyA }, { scale: 1 + 0.06 * artT.value }, { translateX: -cxA }, { translateY: -cyA }]);
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: SW, height: SH }]} pointerEvents="none">
      <Group transform={artTransform} opacity={artOpacity}>
      <Group transform={artScale}>
        <SkImage image={img} x={ax} y={ay} width={A} height={A} fit="contain" />
        {slices.map((sl, i) => (
          <Group key={i} clip={rect(sl.sx, sl.top, sl.sw, sl.h)}>
            <Group transform={sliceTransforms[i]}>
              <SkImage image={img} x={ax} y={ay} width={A} height={A} fit="contain" />
            </Group>
          </Group>
        ))}
        {/* Mask: solid to 70 % of the art, transparent at 100 % — the dark tones blend into #2c2c2c on their own. */}
        <Rect x={ax - 2} y={ay + A * 0.7} width={A + 4} height={A * 0.3 + 2}>
          <LinearGradient start={vec(0, ay + A * 0.7)} end={vec(0, ay + A)} colors={['rgba(44,44,44,0)', v2.color.darkGround]} />
        </Rect>
      </Group>
      </Group>
      {/* Orb */}
      <Circle c={glowC} r={glowR}>
        <RadialGradient c={glowC} r={glowR} colors={glowColors} />
      </Circle>
      {threads.map((d, i) => <Path key={i} path={d} style="stroke" strokeWidth={0.8 * s} color={threadColor} />)}
      <Points points={pts} mode="points" color={particleColor} strokeWidth={1.4 * s} strokeCap="round" />
      {mark ? layers.map((L, i) => (
        <Group key={i} transform={L.transform} opacity={L.opacity}>
          <SkImage image={mark} rect={L.rect} fit="contain">
            <BlendColor color={colour} mode="srcIn" />
          </SkImage>
        </Group>
      )) : null}
    </Canvas>
  );
}

export type { SharedValue };
