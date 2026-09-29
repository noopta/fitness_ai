// Home canvas — the art with the hand warp, and the orb: glow, 80 ring arcs,
// three fingertip threads and the five petal layers. A line-for-line port of
// `reference/home-canvas.reference.js` (the design's source of truth) to
// Skia, with every per-frame value on the UI thread.
//
// Frame: 402 × 874 pt, scaled by s = screenWidth / 402. Art box 440 × 440 at
// (30, −30); the hand region (image px x 90–1024, y 660–1024) is a 12 × 6
// triangle mesh warped by handDisp(t). Orb A0 = (150, 418, r 92) → A1 =
// (42, 78, r 28) by p; in brief it follows the fingertip displacement with a
// damped lag. p is the shell's shared progress. The orb stops drawing once
// docked (p > .995) — the header mark takes over, so it becomes the logo.

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, AppState } from 'react-native';
import { useSharedValue, useDerivedValue, useFrameCallback, withTiming, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import {
  Canvas, Group, Image as SkImage, Circle, Path, Rect, Vertices, ImageShader, RadialGradient, LinearGradient, BlendColor, Mask, useImage,
} from '@shopify/react-native-skia';
import { v2 } from '../theme';

const ART = require('../../../assets/v2/anakin-art.png');
const MARK = require('../../../assets/v2/axiom-mark.png');

const FRAME_W = 402;
const ART_BOX = { x: 30, y: -30, size: 440 };
const A0 = { x: 150, y: 418, r: 92 };
const A1 = { x: 42, y: 78, r: 28 };
const FT = [[96, 382], [124, 376], [159, 400]] as const;          // pt
const FT_IMG = [[153.6, 958.8], [218.8, 944.8], [300.2, 1000.6]] as const; // image px
const L0 = [0.18, 0.26, 0.36, 0.5, 0.82];
const L1 = [0, 0, 0, 0, 1];
const MESH = { x0: 90, x1: 1024, y0: 660, y1: 1024, cx: 12, cy: 6 };
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
  const img = useImage(ART);
  const mark = useImage(MARK);
  const [appActive, setAppActive] = useState(true);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active')); return () => sub.remove(); }, []);

  const p = progress;
  const artA = useSharedValue(mode === 'chat' ? 1 : 0);
  const artT = useSharedValue(mode === 'chat' ? 1 : 0);
  useEffect(() => {
    const to = mode === 'chat' ? 1 : 0;
    artA.value = withTiming(to, { duration: reduced ? 150 : v2.motion.artFade, easing: v2.motion.easeIO });
    artT.value = withTiming(to, { duration: reduced ? 150 : v2.motion.artMove, easing: v2.motion.easeIO });
  }, [mode, artA, artT, reduced]);
  const running = useSharedValue(1);
  useEffect(() => { running.value = (!focused || !appActive || reduced) ? 0 : 1; }, [focused, appActive, reduced, running]);
  const busy = useSharedValue(working ? 1 : 0);
  useEffect(() => { busy.value = working ? 1 : 0; }, [working, busy]);
  // Stop drawing entirely in chat once the transition is over.
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (mode === 'chat') { const t = setTimeout(() => setHidden(true), 1150); return () => clearTimeout(t); } setHidden(false); }, [mode]);

  // ── Per-frame state (C1, C2, C6) ─────────────────────────────────────────
  const time = useSharedValue(0);
  const mix = useSharedValue(0);
  const energy = useSharedValue(1);
  const bph = useSharedValue(0);
  const fx = useSharedValue(0), fy = useSharedValue(0);
  const artClock = useSharedValue(0);
  const ftD = useSharedValue<number[]>([0, 0, 0, 0, 0, 0]);           // fingertip displacement, pt (×s applied at use)
  const angles = useSharedValue<number[]>([]);
  const meshVerts = useSharedValue<{ x: number; y: number }[]>([]);
  const meshSeeded = React.useRef(false);

  const particles = useMemo(() => {
    const r = rng(11);
    return Array.from({ length: 80 }, () => ({ rad: 26 + r() * 52, a: r() * 6.283, sp: (0.35 + r() * 0.9) * (r() < 0.85 ? 1 : -1), tilt: (r() - 0.5) * 0.9, fl: 0.32 + r() * 0.22, sz: 0.5 + r() * 1.4, al: 0.25 + r() * 0.6 }));
  }, []);
  const ax = ART_BOX.x * s, ay = ART_BOX.y * s, A = ART_BOX.size * s, K = A / 1024;
  const mesh = useMemo(() => {
    const src: number[] = [], idx: number[] = [], tex: { x: number; y: number }[] = [];
    const { x0, x1, y0, y1, cx, cy } = MESH;
    for (let j = 0; j <= cy; j++) for (let i = 0; i <= cx; i++) { const x = x0 + ((x1 - x0) * i) / cx, y = y0 + ((y1 - y0) * j) / cy; src.push(x, y); tex.push({ x, y }); }
    for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) { const a = j * (cx + 1) + i, b = a + 1, c = a + cx + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    return { src, idx, tex };
  }, []);
  const meshSrc = mesh.src;
  if (!meshSeeded.current) {
    meshSeeded.current = true;
    const seed: { x: number; y: number }[] = [];
    for (let i = 0; i < mesh.src.length; i += 2) seed.push({ x: ax + mesh.src[i] * K, y: ay + mesh.src[i + 1] * K });
    meshVerts.value = seed;
  }

  useFrameCallback((info) => {
    'worklet';
    if (!running.value) return;
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    time.value += dt;
    const t = time.value;
    const w = busy.value;
    mix.value += (w - mix.value) * (1 - Math.exp(-dt * 2.6));
    energy.value += ((w ? 2.2 : 1) - energy.value) * (1 - Math.exp(-dt * 1.6));
    bph.value += (dt * 2 * Math.PI) / (w ? 3 : 5.2);
    // rings advance
    const next = angles.value.length === 80 ? angles.value.slice() : particles.map((q) => q.a);
    for (let i = 0; i < 80; i++) next[i] += particles[i].sp * dt * energy.value;
    angles.value = next;
    // hand displacement field (C6) at ~30 fps
    if (t - artClock.value > 0.032) {
      artClock.value = t;
      const sm = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
      const PX = 870, PY = 900;
      const th = 0.02 * Math.sin(t * 0.9) + 0.007 * Math.sin(t * 2.1 + 1);
      const tx = 5 * Math.sin(t * 0.9 + 1.6), curl = Math.sin(t * 1.35 + 0.4);
      const c = Math.cos(th), sn = Math.sin(th);
      const disp = (x: number, y: number) => {
        const wgt = sm((PX - x) / 520) * sm((x - 90) / 50) * sm((y - 660) / 90);
        const vx = x - PX, vy = y - PY;
        let dx = (c * vx - sn * vy - vx) + tx * sm((PX - x) / 400);
        let dy = (sn * vx + c * vy - vy);
        const f = sm((340 - x) / 180) * sm((y - 850) / 60); dy += curl * 7 * f; dx += curl * -2 * f;
        return [x + dx * wgt, y + dy * wgt];
      };
      const verts: { x: number; y: number }[] = [];
      for (let i = 0; i < meshSrc.length; i += 2) { const d = disp(meshSrc[i], meshSrc[i + 1]); verts.push({ x: ax + d[0] * K, y: ay + d[1] * K }); }
      meshVerts.value = verts;
      const SC = 440 / 1024;
      const tip = disp(230, 935);
      const fD = [(tip[0] - 230) * SC, (tip[1] - 935) * SC];
      const kk = 1 - Math.exp(-dt * 2.6 * 2); // the follow integrates at the art rate
      fx.value += (fD[0] * 1.1 - fx.value) * kk; fy.value += (fD[1] * 1.1 - fy.value) * kk;
      const out: number[] = [];
      for (let i = 0; i < 3; i++) { const q = disp(FT_IMG[i][0], FT_IMG[i][1]); out.push((q[0] - FT_IMG[i][0]) * SC, (q[1] - FT_IMG[i][1]) * SC); }
      ftD.value = out;
    }
  }, true);

  // ── Derived geometry (C2–C4) ─────────────────────────────────────────────
  const q = useDerivedValue(() => 1 - p.value);
  const cx = useDerivedValue(() => (A0.x + (A1.x - A0.x) * p.value + fx.value * (1 - p.value)) * s);
  const cy = useDerivedValue(() => (A0.y + (A1.y - A0.y) * p.value + fy.value * (1 - p.value)) * s);
  const S = useDerivedValue(() => (A0.r + (A1.r - A0.r) * p.value) * s);
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

  // Threads (C4)
  const threads = [0, 1, 2].map((i) => useDerivedValue(() => {
    const fxp = (FT[i][0] + ftD.value[i * 2]) * s, fyp = (FT[i][1] + ftD.value[i * 2 + 1]) * s;
    const tx = cx.value + (fxp - cx.value) * 0.35, ty = cy.value - S.value * 0.3;
    const mx = (fxp + tx) / 2 + Math.sin(time.value * 1.7 + i * 2) * 10 * s, my = (fyp + ty) / 2 + Math.cos(time.value * 1.3 + i) * 6 * s;
    return `M ${fxp.toFixed(1)} ${fyp.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`;
  }));
  const threadColors = [0, 1, 2].map((i) => useDerivedValue(() => `rgba(${rgb.value[0]},${rgb.value[1]},${rgb.value[2]},${((0.16 + 0.08 * Math.sin(time.value * 3 + i)) * q.value * Math.min(1, energy.value)).toFixed(3)})`));

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

  // Art (B1): opacity 750 ms, lift/scale 1000 ms, both on the shell's curve.
  const artOpacity = useDerivedValue(() => 1 - artA.value);
  const cxA = ax + A / 2, cyA = ay + A / 2;
  const artTransform = useDerivedValue(() => [{ translateY: -70 * artT.value * s }, { translateX: cxA }, { translateY: cyA }, { scale: 1 + 0.06 * artT.value }, { translateX: -cxA }, { translateY: -cyA }]);
  const markOpacityDone = useDerivedValue(() => (p.value > 0.995 ? 1 : 0));
  void markOpacityDone;

  if (hidden || !img) return null;
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: SW, height: SH }]} pointerEvents="none">
      <Group transform={artTransform} opacity={artOpacity}>
        {/* Review #4: two fades, intersected (left: transparent → opaque over the first 12 %; bottom: opaque to 62 %,
            transparent at 100 %). Luminance mask — the image never meets the ground in a visible edge. */}
        <Mask
          mode="luminance"
          mask={
            <Group>
              <Rect x={ax} y={ay} width={A} height={A}>
                <LinearGradient start={{ x: ax, y: 0 }} end={{ x: ax + A * 0.12, y: 0 }} colors={['black', 'white']} />
              </Rect>
              <Rect x={ax} y={ay} width={A} height={A} blendMode="multiply">
                <LinearGradient start={{ x: 0, y: ay + A * 0.62 }} end={{ x: 0, y: ay + A }} colors={['white', 'black']} />
              </Rect>
            </Group>
          }
        >
          <SkImage image={img} x={ax} y={ay} width={A} height={A} fit="contain" />
          {/* Hand warp: the 12 × 6 mesh of the hand region, textured from the same image (C6). */}
          <Vertices vertices={meshVerts} textures={mesh.tex} indices={mesh.idx} mode="triangles">
            <ImageShader image={img} fit="none" tx="clamp" ty="clamp" />
          </Vertices>
        </Mask>
      </Group>

      <Group opacity={showOrb}>
        <Circle c={glowC} r={glowR}><RadialGradient c={glowC} r={glowR} colors={glowColors} /></Circle>
        {threads.map((d, i) => <Path key={`t${i}`} path={d} style="stroke" strokeWidth={0.8 * s} color={threadColors[i]} />)}
        {ringPaths.map((d, b) => <Path key={`r${b}`} path={d} style="stroke" strokeWidth={ringMeta[b].sz * s} strokeCap="round" color={ringColors[b]} />)}
      </Group>
      {mark ? petals.map((L, i) => (
        <Group key={`p${i}`} transform={L.transform}>
          <Group opacity={L.wa}><SkImage image={mark} rect={L.rect} fit="contain"><BlendColor color="#fafafa" mode="srcIn" /></SkImage></Group>
          <Group opacity={L.ka}><SkImage image={mark} rect={L.rect} fit="contain"><BlendColor color="#09090b" mode="srcIn" /></SkImage></Group>
          <Group opacity={L.ra}><SkImage image={mark} rect={L.rect} fit="contain"><BlendColor color="#A51C30" mode="srcIn" /></SkImage></Group>
        </Group>
      )) : null}
    </Canvas>
  );
}
