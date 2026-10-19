// Draws a shareable scene (packages/agent-ui-core/src/shareables/scene.ts)
// with Skia: a Picture for the on-screen preview, an offscreen 1080 × 1920
// surface for the PNG that gets shared. Same ops, same Inter, same measure —
// so the preview and the export can't disagree. Mirrors the CanvasKit QA
// renderer (packages/agent-ui-core/scripts/render-shareables.mts).

import {
  Skia, PaintStyle, StrokeCap, StrokeJoin, BlendMode, TileMode,
  type SkCanvas, type SkTypeface, type SkImage, type SkFont, type SkPaint, type SkPicture,
} from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system/legacy';
import { SHARE_W, SHARE_H, type ShareOp, type ShareScene, type ShareWeight, type ShareMeasure } from '@axiom/agent-ui-core';

export type Faces = Record<ShareWeight, SkTypeface>;
export interface SceneImages { mark: SkImage | null; photo: SkImage | null }

export const EXPORT_W = 1080;
export const EXPORT_H = 1920;

const fontCache = new WeakMap<SkTypeface, Map<number, SkFont>>();
function font(faces: Faces, size: number, weight: ShareWeight): SkFont {
  const face = faces[weight];
  let m = fontCache.get(face);
  if (!m) { m = new Map(); fontCache.set(face, m); }
  let f = m.get(size);
  if (!f) { f = Skia.Font(face, size); f.setSubpixel(true); m.set(size, f); }
  return f;
}
const width = (faces: Faces, s: string, size: number, weight: ShareWeight) => {
  const f = font(faces, size, weight);
  return f.getGlyphWidths(f.getGlyphIDs(s)).reduce((a, b) => a + b, 0);
};

/** The scene builders' measure, from the same typefaces the canvas draws with. */
export const makeMeasure = (faces: Faces): ShareMeasure => (s, size, weight, ls = 0) => width(faces, s, size, weight) + Math.max(0, s.length - 1) * ls * size;

function color(c: string, opacity = 1) {
  const col = Skia.Color(c);
  if (opacity !== 1) col[3] *= opacity;
  return col;
}
function paint(c: string, opacity = 1, stroke?: number): SkPaint {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(color(c, opacity));
  if (stroke != null) { p.setStyle(PaintStyle.Stroke); p.setStrokeWidth(stroke); p.setStrokeCap(StrokeCap.Round); p.setStrokeJoin(StrokeJoin.Round); }
  return p;
}
const SHADOW = () => Skia.ImageFilter.MakeDropShadow(0, 1, 3, 3, Skia.Color('rgba(0,0,0,0.35)'), null);
const shadowed = (p: SkPaint, on?: boolean) => { if (on) p.setImageFilter(SHADOW()); return p; };

function drawText(cv: SkCanvas, faces: Faces, measure: ShareMeasure, o: Extract<ShareOp, { t: 'text' }>) {
  const ls = (o.ls ?? 0) * o.size;
  const w = measure(o.s, o.size, o.weight, o.ls);
  const left = o.align === 'right' ? o.x - w : o.align === 'center' ? o.x - w / 2 : o.x;
  const f = font(faces, o.size, o.weight);
  const p = shadowed(paint(o.color, o.opacity), o.shadow);
  const baseline = o.y + o.size * 0.95;
  if (!ls) { cv.drawText(o.s, left, baseline, p, f); return; }
  let x = left;
  for (const ch of o.s) { cv.drawText(ch, x, baseline, p, f); x += width(faces, ch, o.size, o.weight) + ls; }
}

/** Draw ops in design space (300 × 533); the caller has already scaled the canvas. */
export function drawOps(cv: SkCanvas, ops: ShareOp[], faces: Faces, images: SceneImages) {
  const measure = makeMeasure(faces);
  for (const o of ops) {
    switch (o.t) {
      case 'rect': {
        const r = Skia.XYWHRect(o.x, o.y, o.w, o.h);
        const rr = o.r ? Skia.RRectXY(r, o.r, o.r) : null;
        if (o.fill) { const p = paint(o.fill, o.opacity); rr ? cv.drawRRect(rr, p) : cv.drawRect(r, p); }
        if (o.stroke) { const p = paint(o.stroke, o.opacity, o.sw ?? 1); rr ? cv.drawRRect(rr, p) : cv.drawRect(r, p); }
        break;
      }
      case 'line': {
        const p = shadowed(paint(o.color, o.opacity, o.w), o.shadow);
        p.setStrokeCap(StrokeCap.Butt);
        if (o.dash) p.setPathEffect(Skia.PathEffect.MakeDash(o.dash, 0));
        cv.drawLine(o.x1, o.y1, o.x2, o.y2, p);
        break;
      }
      case 'poly': {
        const path = Skia.Path.Make();
        o.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
        if (o.closed) path.close();
        if (o.fill) cv.drawPath(path, paint(o.fill, o.opacity));
        if (o.color) cv.drawPath(path, shadowed(paint(o.color, o.opacity, o.w ?? 1), o.shadow));
        break;
      }
      case 'circle':
        if (o.fill) cv.drawCircle(o.x, o.y, o.r, shadowed(paint(o.fill), o.shadow));
        if (o.stroke) cv.drawCircle(o.x, o.y, o.r, paint(o.stroke, 1, o.sw ?? 1));
        break;
      case 'text':
        drawText(cv, faces, measure, o);
        break;
      case 'scrim': {
        const p = Skia.Paint();
        p.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: o.y0 }, { x: 0, y: o.y1 }, o.stops.map(([, a]) => color(o.color, a)), o.stops.map(([at]) => at), TileMode.Clamp));
        cv.drawRect(Skia.XYWHRect(0, o.y0, SHARE_W, o.y1 - o.y0), p);
        break;
      }
      case 'image': {
        if (o.id === 'mark') {
          if (!images.mark) break;
          const p = Skia.Paint();
          p.setColorFilter(Skia.ColorFilter.MakeBlend(Skia.Color(o.ink === 'white' ? '#ffffff' : '#09090b'), BlendMode.SrcIn));
          cv.drawImageRect(images.mark, Skia.XYWHRect(0, 0, images.mark.width(), images.mark.height()), Skia.XYWHRect(o.x, o.y, o.w, o.h), p);
        } else if (images.photo) {
          // Cover: crop the photo's centre to the frame.
          const iw = images.photo.width(), ih = images.photo.height(), s = Math.max(o.w / iw, o.h / ih);
          const sw = o.w / s, sh = o.h / s;
          cv.drawImageRect(images.photo, Skia.XYWHRect((iw - sw) / 2, (ih - sh) / 2, sw, sh), Skia.XYWHRect(o.x, o.y, o.w, o.h), Skia.Paint());
        } else {
          // No photo yet: a neutral ground so white ink reads in the preview.
          const p = Skia.Paint();
          p.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 0, y: SHARE_H }, [Skia.Color('#6e6964'), Skia.Color('#3c3a3e')], null, TileMode.Clamp));
          cv.drawRect(Skia.XYWHRect(o.x, o.y, o.w, o.h), p);
        }
        break;
      }
    }
  }
}

/** A Picture of the scene at `width` points wide (the preview). */
export function scenePicture(scene: ShareScene, faces: Faces, images: SceneImages, width: number): SkPicture {
  const rec = Skia.PictureRecorder();
  const scale = width / SHARE_W;
  const cv = rec.beginRecording(Skia.XYWHRect(0, 0, width, SHARE_H * scale));
  cv.save();
  cv.scale(scale, scale);
  if (scene.background) cv.drawRect(Skia.XYWHRect(0, 0, SHARE_W, SHARE_H), paint(scene.background));
  drawOps(cv, scene.ops, faces, images);
  cv.restore();
  return rec.finishRecordingAsPicture();
}

/**
 * Render the scene at 1080 × 1920 and write it to a PNG in the cache.
 * Transparent where the scene has no background (an overlay with no photo).
 */
export async function exportScenePng(scene: ShareScene, faces: Faces, images: SceneImages, name: string): Promise<string> {
  const surface = Skia.Surface.MakeOffscreen(EXPORT_W, EXPORT_H);
  if (!surface) throw new Error('Could not make the image.');
  const cv = surface.getCanvas();
  cv.clear(scene.background ? Skia.Color(scene.background) : Skia.Color('transparent'));
  cv.save();
  cv.scale(EXPORT_W / SHARE_W, EXPORT_W / SHARE_W);
  drawOps(cv, scene.ops, faces, images);
  cv.restore();
  surface.flush();
  const img = surface.makeImageSnapshot();
  const b64 = img.encodeToBase64();
  const uri = `${FileSystem.cacheDirectory}axiom-${name.replace(/[^\w-]+/g, '_')}-${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

/** Decode a picked photo (already EXIF-normalised) into a Skia image. */
export async function loadPhoto(uri: string): Promise<SkImage | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    return Skia.Image.MakeImageFromEncoded(data);
  } catch {
    return null;
  }
}
