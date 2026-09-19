// Normalize a picked photo before it ever reaches a card (spec §6).
//
// WHY THIS EXISTS — the "photo rotates after saving" bug:
// Camera-roll photos carry an EXIF `Orientation` tag. The sensor writes pixels in
// its own fixed order and records "…but display this rotated 90° CW" in metadata.
// React Native's <Image> honours that tag, so the PREVIEW looks upright. The
// capture path does not agree: `captureRef` rasterizes through a different decode,
// so the exported PNG comes out rotated relative to what the user just approved.
// Same file, two readers, two answers.
//
// Re-encoding through expo-image-manipulator resolves it at the source. The
// manipulator decodes applying the orientation, then writes a NEW file from those
// pixels — upright, with no Orientation tag left to disagree about. Every
// downstream consumer (preview, crop gestures, capture) now sees the same image.
//
// This also does the resize §6 asks for: long edge to 1920, so a 4000px iPhone
// photo isn't dragged through the crop gestures and the capture raster.
//
// Uses the contextual `ImageManipulator.manipulate()` API — `manipulateAsync` is
// deprecated as of SDK 55.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Spec §6: long edge resized to 1920 before the photo reaches the card. */
export const MAX_EDGE = 1920;

/** JPEG quality for the re-encode. High enough to be invisible behind a scrim. */
const QUALITY = 0.92;

export interface NormalizedPhoto {
  uri: string;
  width: number;
  height: number;
  /** False when normalization failed and we fell back to the original URI. */
  normalized: boolean;
}

/**
 * Bake EXIF orientation into the pixels and cap the long edge at 1920.
 *
 * Never throws: if the manipulator is unavailable the original URI is returned
 * with `normalized: false`, so a failure here degrades to today's behaviour
 * rather than blocking the user from sharing at all.
 */
export async function normalizePickedPhoto(
  uri: string,
  sourceWidth?: number,
  sourceHeight?: number,
): Promise<NormalizedPhoto> {
  try {
    const ctx = ImageManipulator.manipulate(uri);

    // Resize only when we know the source is oversized. Dimensions from the
    // picker are pre-EXIF, so a portrait photo tagged 90° reports landscape
    // numbers — but max(w,h) is rotation-invariant, which is all we need here.
    if (sourceWidth && sourceHeight) {
      const longEdge = Math.max(sourceWidth, sourceHeight);
      if (longEdge > MAX_EDGE) {
        // Constrain the longer axis; the manipulator derives the other from ratio.
        ctx.resize(
          sourceWidth >= sourceHeight ? { width: MAX_EDGE } : { height: MAX_EDGE },
        );
      }
    }

    // renderAsync() applies the queued work AND the orientation; saveAsync()
    // writes the upright pixels to a fresh cache file with no EXIF carried over.
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY });

    return {
      uri: saved.uri,
      width: saved.width ?? rendered.width,
      height: saved.height ?? rendered.height,
      normalized: true,
    };
  } catch (err) {
    // Older binaries without the native module, unreadable HEIC, out of disk —
    // all land here. Sharing still works; the photo just keeps its old behaviour.
    console.warn('[share] photo normalize failed, using original', err);
    return {
      uri,
      width: sourceWidth ?? 0,
      height: sourceHeight ?? 0,
      normalized: false,
    };
  }
}
