import { describe, it, expect } from 'vitest';
import { Jimp } from 'jimp';
import { resizeAvatarBase64, AVATAR_MAX_DIM, AvatarImageError, readImageDimensions, assertSafeImageDimensions } from '../services/avatarImage.js';

async function makeImageB64(width: number, height: number, mime: 'image/png' | 'image/jpeg', color = 0xff0000ff) {
  const img = new Jimp({ width, height, color });
  const buf = await img.getBuffer(mime);
  return buf.toString('base64');
}

describe('resizeAvatarBase64', () => {
  it('downscales a large image to <= AVATAR_MAX_DIM and shrinks the base64', async () => {
    const input = await makeImageB64(800, 800, 'image/png');
    const out = await resizeAvatarBase64(input);

    const outImg = await Jimp.read(Buffer.from(out, 'base64'));
    expect(Math.max(outImg.bitmap.width, outImg.bitmap.height)).toBeLessThanOrEqual(AVATAR_MAX_DIM);
    expect(out.length).toBeLessThan(input.length);
  });

  it('preserves aspect ratio when downscaling a non-square image', async () => {
    const input = await makeImageB64(800, 400, 'image/png');
    const out = await resizeAvatarBase64(input);
    const outImg = await Jimp.read(Buffer.from(out, 'base64'));

    expect(outImg.bitmap.width).toBe(AVATAR_MAX_DIM);   // longest side capped
    expect(outImg.bitmap.height).toBe(AVATAR_MAX_DIM / 2);
  });

  it('does not upscale an image already smaller than the cap', async () => {
    const input = await makeImageB64(48, 48, 'image/png');
    const out = await resizeAvatarBase64(input);
    const outImg = await Jimp.read(Buffer.from(out, 'base64'));

    expect(outImg.bitmap.width).toBe(48);
    expect(outImg.bitmap.height).toBe(48);
  });

  it('accepts a data: URL prefix and returns raw base64 (no prefix)', async () => {
    const b64 = await makeImageB64(200, 200, 'image/jpeg');
    const out = await resizeAvatarBase64(`data:image/jpeg;base64,${b64}`);

    expect(out.startsWith('data:')).toBe(false);
    await Jimp.read(Buffer.from(out, 'base64')); // decodes as a valid image
  });

  it('throws on input that cannot be decoded as an image', async () => {
    await expect(resizeAvatarBase64('not-a-real-image')).rejects.toThrow();
  });
});

describe('avatar decompression-bomb guard', () => {
  function pngHeader(w: number, h: number): Buffer {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  }

  it('reads PNG, JPEG and GIF header dimensions', async () => {
    const png = Buffer.from(await makeImageB64(120, 80, 'image/png'), 'base64');
    expect(readImageDimensions(png)).toEqual({ format: 'png', width: 120, height: 80 });
    const jpg = Buffer.from(await makeImageB64(64, 32, 'image/jpeg'), 'base64');
    expect(readImageDimensions(jpg)).toEqual({ format: 'jpeg', width: 64, height: 32 });
    const gif = Buffer.from('GIF89a\x10\x00\x20\x00\x00\x00\x00', 'binary');
    expect(readImageDimensions(gif)).toEqual({ format: 'gif', width: 16, height: 32 });
  });

  it('reads WebP VP8X dimensions', () => {
    const b = Buffer.alloc(30);
    b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii');
    b.writeUIntLE(4999, 24, 3); b.writeUIntLE(99, 27, 3);
    expect(readImageDimensions(b)).toEqual({ format: 'webp', width: 5000, height: 100 });
  });

  it('rejects a PNG declaring huge dimensions before decoding', async () => {
    const bomb = pngHeader(50000, 50000).toString('base64');
    await expect(resizeAvatarBase64(bomb)).rejects.toBeInstanceOf(AvatarImageError);
    await expect(resizeAvatarBase64(bomb)).rejects.toMatchObject({ code: 'too_large', status: 413 });
  });

  it('rejects > 16 MP even when each side is under 4096', () => {
    expect(() => assertSafeImageDimensions(pngHeader(4096, 4096))).toThrow(AvatarImageError);
    expect(() => assertSafeImageDimensions(pngHeader(4000, 4000))).not.toThrow();
  });

  it('throws a typed 400 error on undecodable input', async () => {
    await expect(resizeAvatarBase64('not-a-real-image')).rejects.toMatchObject({ name: 'AvatarImageError', status: 400 });
    // Valid header, garbage body → decode_failed, not a crash.
    await expect(resizeAvatarBase64(pngHeader(10, 10).toString('base64'))).rejects.toMatchObject({ code: 'decode_failed' });
  });
});
