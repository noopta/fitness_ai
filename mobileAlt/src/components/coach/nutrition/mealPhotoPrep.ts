// Meal-photo preparation: resize to ~1600 px on the long edge, JPEG ~0.8,
// base64 — enough detail for the vision model to see sides, sauces and drinks
// without shipping 12 MP over cellular.
//
// expo-image-manipulator has been in the binary since March 2026 (35dfad3), so
// both runtime 3.1.0 and 3.2.0 have it. Still: every native call is guarded,
// and a failure falls back to reading the original file (or the picker's own
// base64) so a photo is never lost to the resize step.
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

export const PHOTO_LONG_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;

export interface PreparedPhoto { uri: string; base64: string; mimeType: string }

export async function preparePhoto(
  uri: string,
  dims?: { width?: number | null; height?: number | null },
  fallbackBase64?: string | null,
  fallbackMime = 'image/jpeg',
): Promise<PreparedPhoto | null> {
  try {
    const w = Number(dims?.width) || 0;
    const h = Number(dims?.height) || 0;
    // Resize only the long edge, and only when it's larger than the target.
    const actions: ImageManipulator.Action[] = [];
    if (w > 0 && h > 0) {
      if (Math.max(w, h) > PHOTO_LONG_EDGE) {
        actions.push({ resize: w >= h ? { width: PHOTO_LONG_EDGE } : { height: PHOTO_LONG_EDGE } });
      }
    } else {
      // Unknown dimensions (camera path): constrain the width first, then
      // re-check — a portrait shot may still exceed the cap on its height.
      actions.push({ resize: { width: PHOTO_LONG_EDGE } });
    }
    let out = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: PHOTO_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true,
    });
    if (Math.max(out.width, out.height) > PHOTO_LONG_EDGE * 1.05) {
      const resize = out.width >= out.height ? { width: PHOTO_LONG_EDGE } : { height: PHOTO_LONG_EDGE };
      out = await ImageManipulator.manipulateAsync(out.uri, [{ resize }], {
        compress: PHOTO_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true,
      });
    }
    if (out.base64) return { uri: out.uri, base64: out.base64, mimeType: 'image/jpeg' };
  } catch (e) {
    console.warn('[mealPhoto] resize failed, sending original', (e as any)?.message ?? e);
  }
  if (fallbackBase64) return { uri, base64: fallbackBase64, mimeType: fallbackMime };
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
    if (b64) return { uri, base64: b64, mimeType: fallbackMime };
  } catch { /* fall through */ }
  return null;
}
