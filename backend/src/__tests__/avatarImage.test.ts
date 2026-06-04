import { describe, it, expect } from 'vitest';
import { Jimp } from 'jimp';
import { resizeAvatarBase64, AVATAR_MAX_DIM } from '../services/avatarImage.js';

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
