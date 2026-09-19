// Capture half of the share pipeline (spec §7-8). Rasterizes the card ref at the
// 1080px export raster (1080×1920 story / 1080×1080 square).
//
// Delivery lives in shareTargets.ts — this file only produces pixels.

import { captureRef } from 'react-native-view-shot';
import { EXPORT_WIDTH, refFor } from './tokens';
import { ShareTemplate } from './types';

export async function captureCard(ref: React.RefObject<any>, template: ShareTemplate): Promise<string | null> {
  if (!ref.current) return null;
  const ref0 = refFor(template);
  const height = Math.round(EXPORT_WIDTH * (ref0.h / ref0.w));
  return captureRef(ref, { format: 'png', quality: 1, width: EXPORT_WIDTH, height, result: 'tmpfile' });
}

/**
 * Capture the card as base64 as well as a file, for targets that need the bytes
 * inline (clipboard). Two rasterizations rather than a file read, because
 * expo-file-system's base64 read is the slower path for a ~1-2MB PNG and this
 * keeps the capture parameters identical for both outputs.
 */
export async function captureCardBase64(
  ref: React.RefObject<any>,
  template: ShareTemplate,
): Promise<string | null> {
  if (!ref.current) return null;
  const ref0 = refFor(template);
  const height = Math.round(EXPORT_WIDTH * (ref0.h / ref0.w));
  return captureRef(ref, { format: 'png', quality: 1, width: EXPORT_WIDTH, height, result: 'base64' });
}
