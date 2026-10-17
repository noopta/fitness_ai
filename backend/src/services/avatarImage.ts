import { Jimp } from 'jimp';

// Avatars render at ~36px in the UI but were being stored straight from the
// camera (observed: 1110x1110, ~68KB base64) and embedded per user in every
// social-feed response. We cap the stored image at 96px (covers 2x/3x retina)
// and re-encode as JPEG q70 — ~96% smaller (~3KB) with no visible quality loss
// at display size, which shrinks both feed payloads and the DB.
export const AVATAR_MAX_DIM = 96;
const AVATAR_JPEG_QUALITY = 70;

// Decompression-bomb ceiling (Oct 2026 audit H3). Jimp's PNG decoder has no
// pixel cap, so a ~100 KB PNG declaring 50k×50k allocates ~10 GB of RGBA and
// OOM-kills the process. We read the declared dimensions from the container
// header BEFORE decoding and refuse anything over these limits.
export const AVATAR_MAX_INPUT_SIDE = 4096;
export const AVATAR_MAX_INPUT_PIXELS = 16_000_000;

/**
 * Typed error for an avatar we refuse to process. `status` is the HTTP status
 * the caller should answer with; `message` is safe to show to the user.
 * Callers must NOT fall back to storing the original bytes on this error.
 */
export class AvatarImageError extends Error {
  readonly status: number;
  readonly code: 'unsupported_format' | 'too_large' | 'decode_failed';
  constructor(code: AvatarImageError['code'], message: string, status = 400) {
    super(message);
    this.name = 'AvatarImageError';
    this.code = code;
    this.status = status;
  }
}

export interface ImageDims { format: 'png' | 'jpeg' | 'webp' | 'gif'; width: number; height: number }

/**
 * Read the declared pixel dimensions from a PNG (IHDR), JPEG (SOFn), WebP
 * (VP8/VP8L/VP8X) or GIF (logical screen) header without decoding pixels.
 * Returns null when the format is unrecognised or the header is truncated.
 */
export function readImageDimensions(buf: Buffer): ImageDims | null {
  if (buf.length < 10) return null;
  // PNG: 8-byte signature, then the IHDR chunk (len, 'IHDR', w, h).
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk markers until a Start-Of-Frame.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }           // fill byte
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any SOF
      const len = buf.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { format: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP then a VP8 / VP8L / VP8X chunk.
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { format: 'webp', width: w, height: h };
    }
    if (chunk === 'VP8L') {
      if (buf[20] !== 0x2f) return null;
      const b = buf.readUInt32LE(21);
      return { format: 'webp', width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') {
      // Frame tag (3 bytes) + start code 9d 01 2a, then 14-bit w/h.
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
      return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    return null;
  }
  // GIF87a / GIF89a logical screen descriptor.
  const sig = buf.toString('ascii', 0, 6);
  if (sig === 'GIF87a' || sig === 'GIF89a') {
    return { format: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  return null;
}

/** Throws AvatarImageError unless the header declares acceptable dimensions. */
export function assertSafeImageDimensions(buf: Buffer): ImageDims {
  const dims = readImageDimensions(buf);
  if (!dims) throw new AvatarImageError('unsupported_format', 'Unsupported or corrupt image. Use a PNG, JPEG or WebP.');
  if (
    !dims.width || !dims.height ||
    dims.width > AVATAR_MAX_INPUT_SIDE || dims.height > AVATAR_MAX_INPUT_SIDE ||
    dims.width * dims.height > AVATAR_MAX_INPUT_PIXELS
  ) {
    throw new AvatarImageError('too_large', `Image dimensions too large (max ${AVATAR_MAX_INPUT_SIDE}×${AVATAR_MAX_INPUT_SIDE}).`, 413);
  }
  return dims;
}

/**
 * Resize/compress a base64-encoded avatar to a small JPEG.
 *
 * Accepts either a raw base64 string or a `data:image/...;base64,...` data URL,
 * and returns RAW base64 (no `data:` prefix) to match how avatars are already
 * stored and how both clients render them (they prepend the prefix when it's
 * missing). Only downscales — images already <= AVATAR_MAX_DIM keep their
 * dimensions but are still re-encoded as JPEG to normalize/compress them.
 *
 * Throws AvatarImageError (with `.status`) when the header is unrecognised,
 * declares oversize dimensions, or the image cannot be decoded. Callers must
 * reject the upload on this error — never store the original bytes.
 */
export async function resizeAvatarBase64(input: string): Promise<string> {
  const match = input.match(/^data:image\/[\w.+-]+;base64,(.*)$/s);
  const b64 = match ? match[1] : input;
  const buf = Buffer.from(b64, 'base64');

  assertSafeImageDimensions(buf);

  let img: Awaited<ReturnType<typeof Jimp.read>>;
  try {
    img = await Jimp.read(buf);
  } catch {
    throw new AvatarImageError('decode_failed', 'Could not read that image. Try a different photo.');
  }
  const longest = Math.max(img.bitmap.width, img.bitmap.height);
  if (longest > AVATAR_MAX_DIM) {
    if (img.bitmap.width >= img.bitmap.height) img.resize({ w: AVATAR_MAX_DIM });
    else img.resize({ h: AVATAR_MAX_DIM });
  }

  const out = await img.getBuffer('image/jpeg', { quality: AVATAR_JPEG_QUALITY });
  return out.toString('base64');
}
