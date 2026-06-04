import { Jimp } from 'jimp';

// Avatars render at ~36px in the UI but were being stored straight from the
// camera (observed: 1110x1110, ~68KB base64) and embedded per user in every
// social-feed response. We cap the stored image at 96px (covers 2x/3x retina)
// and re-encode as JPEG q70 — ~96% smaller (~3KB) with no visible quality loss
// at display size, which shrinks both feed payloads and the DB.
export const AVATAR_MAX_DIM = 96;
const AVATAR_JPEG_QUALITY = 70;

/**
 * Resize/compress a base64-encoded avatar to a small JPEG.
 *
 * Accepts either a raw base64 string or a `data:image/...;base64,...` data URL,
 * and returns RAW base64 (no `data:` prefix) to match how avatars are already
 * stored and how both clients render them (they prepend the prefix when it's
 * missing). Only downscales — images already <= AVATAR_MAX_DIM keep their
 * dimensions but are still re-encoded as JPEG to normalize/compress them.
 *
 * Throws if the input can't be decoded as an image; callers decide whether to
 * fall back to the original.
 */
export async function resizeAvatarBase64(input: string): Promise<string> {
  const match = input.match(/^data:image\/\w+;base64,(.*)$/s);
  const b64 = match ? match[1] : input;
  const buf = Buffer.from(b64, 'base64');

  const img = await Jimp.read(buf);
  const longest = Math.max(img.bitmap.width, img.bitmap.height);
  if (longest > AVATAR_MAX_DIM) {
    if (img.bitmap.width >= img.bitmap.height) img.resize({ w: AVATAR_MAX_DIM });
    else img.resize({ h: AVATAR_MAX_DIM });
  }

  const out = await img.getBuffer('image/jpeg', { quality: AVATAR_JPEG_QUALITY });
  return out.toString('base64');
}
