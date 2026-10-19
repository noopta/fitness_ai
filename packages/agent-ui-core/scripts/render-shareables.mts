// QA: render shareable scenes to PNG with CanvasKit (the same Skia the phone
// uses), so layouts can be inspected without a device.
//
//   backend/node_modules/.bin/tsx packages/agent-ui-core/scripts/render-shareables.mts <fixtures.json> <outDir> [photo.jpg]
//
// fixtures.json: [{ name, shareable: ShareableData, ink?, preview? }]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneFor, W, H, type Op, type Weight } from '../src/shareables/scene';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = resolve(here, '../../../mobileAlt');
const require = createRequire(join(mobile, 'package.json'));
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit.js');
const CK = await CanvasKitInit({ locateFile: (f: string) => join(dirname(require.resolve('canvaskit-wasm/bin/full/canvaskit.js')), f) });

const [fixturesPath, outDir, photoPath] = process.argv.slice(2);
const SCALE = 1080 / W;
const FILES: Record<Weight, string> = { 400: '400Regular/Inter_400Regular.ttf', 500: '500Medium/Inter_500Medium.ttf', 600: '600SemiBold/Inter_600SemiBold.ttf', 700: '700Bold/Inter_700Bold.ttf', 800: '800ExtraBold/Inter_800ExtraBold.ttf' };
const faces = Object.fromEntries(Object.entries(FILES).map(([w, f]) => [w, CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(join(mobile, 'node_modules/@expo-google-fonts/inter', f)).buffer)]));
const fonts = new Map<string, any>();
const font = (size: number, weight: Weight) => {
  const k = `${size}:${weight}`;
  if (!fonts.has(k)) { const f = new CK.Font(faces[weight], size); f.setSubpixel(true); fonts.set(k, f); }
  return fonts.get(k);
};
const width = (s: string, size: number, weight: Weight) => {
  const f = font(size, weight);
  return (f.getGlyphWidths(f.getGlyphIDs(s)) as Float32Array).reduce((a, b) => a + b, 0);
};
const measure = (s: string, size: number, weight: Weight, ls = 0) => width(s, size, weight) + Math.max(0, s.length - 1) * ls * size;

const markImg = CK.MakeImageFromEncoded(readFileSync(join(mobile, 'assets/v2/axiom-mark.png')));
const photoImg = photoPath ? CK.MakeImageFromEncoded(readFileSync(photoPath)) : null;

function color(c: string, opacity = 1) {
  const m = c.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (m) return CK.Color(+m[1], +m[2], +m[3], +m[4] * opacity);
  const col = CK.parseColorString(c);
  col[3] *= opacity;
  return col;
}
const paint = (c: string, opacity = 1, stroke?: number) => {
  const p = new CK.Paint();
  p.setAntiAlias(true);
  p.setColor(color(c, opacity));
  if (stroke != null) { p.setStyle(CK.PaintStyle.Stroke); p.setStrokeWidth(stroke); p.setStrokeCap(CK.StrokeCap.Round); p.setStrokeJoin(CK.StrokeJoin.Round); }
  return p;
};
const withShadow = (p: any, on?: boolean) => { if (on) p.setImageFilter(CK.ImageFilter.MakeDropShadow(0, 1, 3, 3, CK.Color(0, 0, 0, 0.35), null)); return p; };

function drawText(cv: any, o: Extract<Op, { t: 'text' }>) {
  const ls = (o.ls ?? 0) * o.size;
  const w = measure(o.s, o.size, o.weight, o.ls);
  const left = o.align === 'right' ? o.x - w : o.align === 'center' ? o.x - w / 2 : o.x;
  const f = font(o.size, o.weight);
  const p = withShadow(paint(o.color, o.opacity), o.shadow);
  const baseline = o.y + o.size * 0.95; // Inter: ascent ≈ 0.97 em in a 1.2 line box
  if (!ls) { cv.drawText(o.s, left, baseline, p, f); return; }
  let x = left;
  for (const ch of o.s) { cv.drawText(ch, x, baseline, p, f); x += width(ch, o.size, o.weight) + ls; }
}

function draw(cv: any, ops: Op[]) {
  for (const o of ops) {
    if (o.t === 'rect') {
      const r = CK.XYWHRect(o.x, o.y, o.w, o.h);
      const rr = o.r ? CK.RRectXY(r, o.r, o.r) : null;
      if (o.fill) { const p = paint(o.fill, o.opacity); rr ? cv.drawRRect(rr, p) : cv.drawRect(r, p); }
      if (o.stroke) { const p = paint(o.stroke, o.opacity, o.sw ?? 1); rr ? cv.drawRRect(rr, p) : cv.drawRect(r, p); }
    } else if (o.t === 'line') {
      const p = withShadow(paint(o.color, o.opacity, o.w), o.shadow);
      p.setStrokeCap(CK.StrokeCap.Butt);
      if (o.dash) p.setPathEffect(CK.PathEffect.MakeDash(o.dash, 0));
      cv.drawLine(o.x1, o.y1, o.x2, o.y2, p);
    } else if (o.t === 'poly') {
      const path = new CK.Path();
      o.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      if (o.closed) path.close();
      if (o.fill) cv.drawPath(path, paint(o.fill, o.opacity));
      if (o.color) cv.drawPath(path, withShadow(paint(o.color, o.opacity, o.w ?? 1), o.shadow));
    } else if (o.t === 'circle') {
      if (o.fill) cv.drawCircle(o.x, o.y, o.r, withShadow(paint(o.fill), o.shadow));
      if (o.stroke) cv.drawCircle(o.x, o.y, o.r, paint(o.stroke, 1, o.sw ?? 1));
    } else if (o.t === 'scrim') {
      const p = new CK.Paint();
      p.setShader(CK.Shader.MakeLinearGradient([0, o.y0], [0, o.y1], o.stops.map(([, a]) => color(o.color, a)), o.stops.map(([at]) => at), CK.TileMode.Clamp));
      cv.drawRect(CK.XYWHRect(0, o.y0, W, o.y1 - o.y0), p);
    } else if (o.t === 'text') drawText(cv, o);
    else if (o.t === 'image') {
      if (o.id === 'mark') {
        const p = new CK.Paint();
        p.setColorFilter(CK.ColorFilter.MakeBlend(color(o.ink === 'white' ? '#ffffff' : '#09090b'), CK.BlendMode.SrcIn));
        cv.drawImageRect(markImg, CK.XYWHRect(0, 0, markImg.width(), markImg.height()), CK.XYWHRect(o.x, o.y, o.w, o.h), p);
      } else if (photoImg) {
        // cover
        const iw = photoImg.width(), ih = photoImg.height(), s = Math.max(o.w / iw, o.h / ih);
        const sw = o.w / s, sh = o.h / s;
        cv.drawImageRect(photoImg, CK.XYWHRect((iw - sw) / 2, (ih - sh) / 2, sw, sh), CK.XYWHRect(o.x, o.y, o.w, o.h), new CK.Paint());
      } else {
        // stand-in photo: a mid-grey gradient (the hard case for white ink)
        const p = new CK.Paint();
        p.setShader(CK.Shader.MakeLinearGradient([0, 0], [0, H], [CK.Color(110, 105, 100), CK.Color(60, 58, 62)], null, CK.TileMode.Clamp));
        cv.drawRect(CK.XYWHRect(o.x, o.y, o.w, o.h), p);
      }
    }
  }
}

mkdirSync(outDir, { recursive: true });
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'));
for (const fx of fixtures) {
  const scene = sceneFor(fx.shareable, { measure, ink: fx.ink, preview: fx.preview, withPhoto: fx.withPhoto });
  const surface = CK.MakeSurface(1080, 1920);
  const cv = surface.getCanvas();
  cv.clear(scene.background ? color(scene.background) : CK.TRANSPARENT);
  cv.scale(SCALE, SCALE);
  draw(cv, scene.ops);
  const img = surface.makeImageSnapshot();
  writeFileSync(join(outDir, `${String(fx.name).replace(/[^\w.-]+/g, "_")}.png`), img.encodeToBytes());
  surface.delete();
  console.log(`${fx.name}: ${scene.ops.length} ops — ${scene.label}`);
}
