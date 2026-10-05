import { describe, it, expect, beforeEach } from 'vitest';
import {
  consumeAddPhotoGrant,
  itemIdPrefix,
  LruCache,
  mealPhotoCacheKey,
  recordAddPhotoGrant,
  MAX_FREE_ADD_PHOTOS,
  ADD_PHOTO_GRANT_TTL_MS,
  _resetAddPhotoGrants,
} from '../services/food/mealPhotoCache.js';

describe('LruCache', () => {
  it('evicts least-recently-used beyond max', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1); c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });

  it('expires entries after the TTL', () => {
    const c = new LruCache<string>(10, 1000);
    c.set('k', 'v', 0);
    expect(c.get('k', 999)).toBe('v');
    expect(c.get('k', 1000)).toBeUndefined();
  });
});

describe('mealPhotoCacheKey', () => {
  const img = (s: string) => ({ base64: Buffer.from(s).toString('base64'), mimeType: 'image/jpeg' });

  it('is stable for identical bytes, sensitive to bytes/order/region/version/existing', () => {
    const k = mealPhotoCacheKey([img('a'), img('b')], [], 'global', 'v1');
    expect(mealPhotoCacheKey([img('a'), img('b')], [], 'global', 'v1')).toBe(k);
    expect(mealPhotoCacheKey([img('b'), img('a')], [], 'global', 'v1')).not.toBe(k);
    expect(mealPhotoCacheKey([img('a'), img('c')], [], 'global', 'v1')).not.toBe(k);
    expect(mealPhotoCacheKey([img('a'), img('b')], [], 'ng', 'v1')).not.toBe(k);
    expect(mealPhotoCacheKey([img('a'), img('b')], [], 'global', 'v2')).not.toBe(k);
    expect(mealPhotoCacheKey([img('a'), img('b')], [{ id: null, name: 'Rice', grams: 100 }], 'global', 'v1')).not.toBe(k);
  });

  it('ignores existingItems order and name case', () => {
    const a = mealPhotoCacheKey([img('a')], [{ id: '1', name: 'Rice', grams: 100 }, { id: '2', name: 'Egg', grams: null }], 'global', 'v');
    const b = mealPhotoCacheKey([img('a')], [{ id: '9', name: 'egg', grams: null }, { id: '8', name: 'rice', grams: 100.2 }], 'global', 'v');
    expect(a).toBe(b);
  });

  it('hashes decoded bytes, not the base64 text', () => {
    const b64 = Buffer.from('hello world, this is an image').toString('base64');
    const wrapped = b64.slice(0, 10) + '\n' + b64.slice(10);
    expect(mealPhotoCacheKey([{ base64: wrapped, mimeType: 'image/png' }], [], 'global', 'v'))
      .toBe(mealPhotoCacheKey([{ base64: b64, mimeType: 'image/png' }], [], 'global', 'v'));
  });
});

describe('add-photo grants', () => {
  beforeEach(() => _resetAddPhotoGrants());

  it('parses item id prefixes', () => {
    expect(itemIdPrefix('0123456789-3')).toBe('0123456789');
    expect(itemIdPrefix('client-made-id')).toBeNull();
    expect(itemIdPrefix(null)).toBeNull();
  });

  it('only frees calls that extend a recent scan of the same user, capped', () => {
    recordAddPhotoGrant('u1', 'abcdef0123', null, 0);
    const existing = [{ id: 'abcdef0123-0', name: 'Rice', grams: 100 }];
    expect(consumeAddPhotoGrant('u2', existing, 1)).toBeNull();
    expect(consumeAddPhotoGrant('u1', [{ id: 'fake', name: 'Rice', grams: 1 }], 1)).toBeNull();
    for (let i = 0; i < MAX_FREE_ADD_PHOTOS; i++) expect(consumeAddPhotoGrant('u1', existing, 1)).not.toBeNull();
    expect(consumeAddPhotoGrant('u1', existing, 1)).toBeNull();
  });

  it('add-photo results inherit the parent budget instead of minting a new one', () => {
    recordAddPhotoGrant('u1', 'aaaaaaaaaa', null, 0);
    const g = consumeAddPhotoGrant('u1', [{ id: 'aaaaaaaaaa-0', name: 'x', grams: null }], 1)!;
    recordAddPhotoGrant('u1', 'bbbbbbbbbb', g, 1);
    const child = [{ id: 'bbbbbbbbbb-0', name: 'y', grams: null }];
    expect(consumeAddPhotoGrant('u1', child, 2)).not.toBeNull();
    expect(consumeAddPhotoGrant('u1', child, 2)).not.toBeNull();
    expect(consumeAddPhotoGrant('u1', child, 2)).toBeNull(); // 3 used across parent + child
  });

  it('grants expire', () => {
    recordAddPhotoGrant('u1', 'abcdef0123', null, 0);
    expect(consumeAddPhotoGrant('u1', [{ id: 'abcdef0123-0', name: 'x', grams: null }], ADD_PHOTO_GRANT_TTL_MS + 1)).toBeNull();
  });
});
