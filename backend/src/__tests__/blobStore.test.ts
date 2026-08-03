/**
 * Content-addressed blob storage.
 *
 * The pure helpers are what matter here: the key IS a hash of the bytes, which
 * is what makes deduplication automatic and what makes `immutable` caching
 * safe. Network paths are covered only for their fail-soft contract — a broken
 * or unconfigured bucket must never take down posting, it must fall back to
 * the existing inline-base64 behaviour.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { contentKey, stripDataUri, putImageBase64, blobStoreEnabled } from '../services/blobStore.js';

const bytesOf = (s: string) => Buffer.from(s, 'utf8');

describe('stripDataUri', () => {
  it('splits a data: URI into payload and mime', () => {
    expect(stripDataUri('data:image/png;base64,AAAB')).toEqual({ base64: 'AAAB', mimeType: 'image/png' });
  });

  it('passes bare base64 through with no mime', () => {
    expect(stripDataUri('AAAB')).toEqual({ base64: 'AAAB', mimeType: null });
  });

  it('handles payloads containing newlines', () => {
    const { base64, mimeType } = stripDataUri('data:image/jpeg;base64,AA\nAB');
    expect(mimeType).toBe('image/jpeg');
    expect(base64).toBe('AA\nAB');
  });
});

describe('contentKey', () => {
  it('is the sha256 of the bytes, so identical images collide by design', () => {
    const a = contentKey(bytesOf('same-image'), 'image/jpeg');
    const b = contentKey(bytesOf('same-image'), 'image/jpeg');
    expect(a).toBe(b);

    const digest = createHash('sha256').update(bytesOf('same-image')).digest('hex');
    expect(a).toBe(`img/${digest.slice(0, 2)}/${digest}.jpg`);
  });

  it('differs for different bytes', () => {
    expect(contentKey(bytesOf('one'), 'image/jpeg')).not.toBe(contentKey(bytesOf('two'), 'image/jpeg'));
  });

  it('fans out by the first two hex chars to keep listings small', () => {
    const key = contentKey(bytesOf('x'), 'image/png');
    const digest = createHash('sha256').update(bytesOf('x')).digest('hex');
    expect(key.startsWith(`img/${digest.slice(0, 2)}/`)).toBe(true);
  });

  it('maps mime to a sane extension and falls back to .bin', () => {
    expect(contentKey(bytesOf('x'), 'image/webp').endsWith('.webp')).toBe(true);
    expect(contentKey(bytesOf('x'), 'application/octet-stream').endsWith('.bin')).toBe(true);
  });
});

describe('putImageBase64 — fail-soft contract', () => {
  // GCP_MEDIA_BUCKET is unset in tests, so the store is disabled. Callers must
  // get null and keep their inline-base64 path rather than seeing a throw.
  it('is disabled without GCP_MEDIA_BUCKET', () => {
    expect(blobStoreEnabled()).toBe(false);
  });

  it('returns null instead of throwing when disabled', async () => {
    await expect(putImageBase64('AAAB', 'image/png')).resolves.toBeNull();
  });

  it('returns null on empty input', async () => {
    await expect(putImageBase64('', 'image/png')).resolves.toBeNull();
  });
});
