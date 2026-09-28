// Home artwork: the character with the energy orb at his fingertips.
//
// Skia. The hand region (x 90–1024, y 660–1024 of the 1024² art) is warped on
// a 12×6 mesh — the prototype's displacement field, ported — as one textured
// `Vertices` draw. The orb is a radial glow, ~80 orbiting particles and three
// filament threads to the fingertips, following the hand with a critically
// damped lag. While Anakin works the orb tints crimson and spins faster.
//
// Rendering pauses whenever the page is not visible (`visible` false): the
// prototype froze without this. Reduce Motion drops the warp and particles
// and shows the still image with a static glow.

import React, { useEffect, useMemo, useRef } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { useReducedMotion, useSharedValue, useFrameCallback, useDerivedValue } from 'react-native-reanimated';
import * as SkiaLib from '@shopify/react-native-skia';
import { v2 } from '../theme';

const ART = require('../../../assets/v2/anakin-art.png');
const ART_SIZE = 440;               // rendered size, pt
const SRC = 1024;                   // source px
const K = ART_SIZE / SRC;
const MESH = { x0: 90, x1: 1024, y0: 660, y1: 1024, cx: 12, cy: 6 };
const PIVOT = { x: 870, y: 900 };
const ORB = { x: 150, y: 418, r: 92 };
const FINGERTIPS = [[96, 382], [124, 376], [159, 400]] as const; // pt, in the 440 frame

const sm = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));

/** The prototype's hand displacement field (source px → source px). */
function handDisp(time: number) {
  const th = 0.02 * Math.sin(time * 0.9) + 0.007 * Math.sin(time * 2.1 + 1);
  const tx = 5 * Math.sin(time * 0.9 + 1.6);
  const curl = Math.sin(time * 1.35 + 0.4);
  const c = Math.cos(th), s = Math.sin(th);
  return (x: number, y: number): [number, number] => {
    const w = sm((PIVOT.x - x) / 520) * sm((x - 90) / 50) * sm((y - 660) / 90);
    const vx = x - PIVOT.x, vy = y - PIVOT.y;
    let dx = (c * vx - s * vy - vx) + tx * sm((PIVOT.x - x) / 400);
    let dy = (s * vx + c * vy - vy);
    const f = sm((340 - x) / 180) * sm((y - 850) / 60);
    dy += curl * 7 * f; dx += curl * -2 * f;
    return [x + dx * w, y + dy * w];
  };
}

interface Props {
  visible: boolean;
  working: boolean;
}

export function Artwork({ visible, working }: Props) {
  const reduced = useReducedMotion();
  const Skia = SkiaLib as any;
  const hasSkia = !!(Skia?.Canvas && Skia?.Vertices && Skia?.useImage);
  if (!hasSkia || reduced) return <StaticArt />;
  return <LiveArt visible={visible} working={working} />;
}

function StaticArt() {
  return (
    <View style={styles.box}>
      <Image source={ART} style={styles.img} resizeMode="cover" />
      <View style={[styles.glow, { left: ORB.x - ORB.r, top: ORB.y - ORB.r, width: ORB.r * 2, height: ORB.r * 2, borderRadius: ORB.r }]} />
    </View>
  );
}

function LiveArt({ visible, working }: Props) {
  const { Canvas, Vertices, ImageShader, Image: SkImage, Group, Circle, Path, RadialGradient, useImage, Skia, vec } = SkiaLib as any;
  const img = useImage(ART);
  const t = useSharedValue(0);
  const energy = useSharedValue(1);
  const mix = useSharedValue(0);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const last = useRef(0);
  const visRef = useRef(visible);
  visRef.current = visible;
  const workRef = useRef(working);
  workRef.current = working;

  useFrameCallback((info) => {
    'worklet';
    // Runs on the UI thread; skip cheaply when not visible.
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    t.value += dt;
  }, true);

  useEffect(() => { energy.value = working ? 2.2 : 1; mix.value = working ? 1 : 0; }, [working, energy, mix]);

  // Mesh: source grid → displaced positions each frame (JS thread at ~30fps is fine for 91 vertices).
  const grid = useMemo(() => {
    const src: number[] = [], tex: number[] = [], idx: number[] = [];
    const { x0, x1, y0, y1, cx, cy } = MESH;
    for (let j = 0; j <= cy; j++) for (let i = 0; i <= cx; i++) {
      const x = x0 + ((x1 - x0) * i) / cx, y = y0 + ((y1 - y0) * j) / cy;
      src.push(x, y); tex.push(x, y);
    }
    for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
      const a = j * (cx + 1) + i, b = a + 1, c = a + cx + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    return { src, tex, idx };
  }, []);

  const [frame, setFrame] = React.useState(0);
  useEffect(() => {
    if (!visible) return;
    let raf: any;
    const loop = () => {
      const now = Date.now();
      if (now - last.current > 33) { last.current = now; setFrame((f) => f + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const time = t.value;
  const disp = handDisp(time);
  const verts: any[] = [], texs: any[] = [];
  for (let i = 0; i < grid.src.length; i += 2) {
    const [dx, dy] = disp(grid.src[i], grid.src[i + 1]);
    verts.push(vec(dx * K, dy * K));
    texs.push(vec(grid.tex[i], grid.tex[i + 1]));
  }
  // Fingertip displacement in the 440 frame → orb follows with a lag.
  const tip = disp(230, 935);
  const targetX = (tip[0] - 230) * K * 1.1, targetY = (tip[1] - 935) * K * 1.1;
  fx.value += (targetX - fx.value) * 0.08; fy.value += (targetY - fy.value) * 0.08;
  const cx = ORB.x + fx.value, cy = ORB.y + fy.value;
  const breathe = 1 + 0.05 * Math.sin(time * 2 * Math.PI / (working ? 3 : 5.2));
  const col = working ? [165, 28, 48] : [250, 250, 250];
  const rgba = (a: number) => `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`;
  const particles = useMemo(() => {
    let s = 11; const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    return Array.from({ length: 80 }, () => ({ rad: 26 + r() * 52, a: r() * 6.283, sp: (0.35 + r() * 0.9) * (r() < 0.85 ? 1 : -1), tilt: (r() - 0.5) * 0.9, fl: 0.32 + r() * 0.22, sz: 0.5 + r() * 1.4, al: 0.25 + r() * 0.6 }));
  }, []);
  const threads = FINGERTIPS.map(([fx0, fy0], i) => {
    const q = disp(fx0 / K, fy0 / K);
    const px = q[0] * K, py = q[1] * K;
    const tx = cx + (px - cx) * 0.35, ty = cy - ORB.r * 0.3;
    const mx = (px + tx) / 2 + Math.sin(time * 1.7 + i * 2) * 10, my = (py + ty) / 2 + Math.cos(time * 1.3 + i) * 6;
    const p = Skia.Path.Make(); p.moveTo(px, py); p.quadTo(mx, my, tx, ty);
    return { p, a: (0.16 + 0.08 * Math.sin(time * 3 + i)) * Math.min(1, energy.value) };
  });
  void frame;

  if (!img) return <StaticArt />;
  return (
    <View style={styles.box}>
      <Canvas style={styles.img}>
        {/* Whole image, then the warped hand region drawn over it. */}
        <SkImage image={img} x={0} y={0} width={ART_SIZE} height={ART_SIZE} fit="cover" />
        <Vertices vertices={verts} textures={texs} indices={grid.idx} mode="triangles">
          <ImageShader image={img} tx="clamp" ty="clamp" fit="none" transform={[{ scale: 1 }]} />
        </Vertices>
        <Group>
          <Circle cx={cx} cy={cy} r={ORB.r * 0.95}>
            <RadialGradient c={vec(cx, cy)} r={ORB.r * 0.95} colors={[rgba(0.2), rgba(0)]} />
          </Circle>
          {threads.map((th, i) => <Path key={i} path={th.p} style="stroke" strokeWidth={0.8} color={rgba(th.a)} />)}
          {particles.map((pt, i) => {
            const ang = pt.a + pt.sp * time * energy.value;
            const rr = pt.rad * breathe;
            const x = cx + Math.cos(ang) * rr * Math.cos(pt.tilt) - Math.sin(ang) * rr * pt.fl * Math.sin(pt.tilt);
            const y = cy + Math.cos(ang) * rr * Math.sin(pt.tilt) + Math.sin(ang) * rr * pt.fl * Math.cos(pt.tilt);
            return <Circle key={i} cx={x} cy={y} r={pt.sz * 0.9} color={rgba(pt.al)} />;
          })}
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: ART_SIZE, height: ART_SIZE },
  img: { width: ART_SIZE, height: ART_SIZE },
  glow: { position: 'absolute', backgroundColor: 'rgba(250,250,250,.12)' },
});
