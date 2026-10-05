// In-memory caches for meal-photo v2.
//
// Single-process backend (one systemd unit), so a Map-backed LRU is enough;
// a restart just costs a re-analysis. Nothing here is persisted.

import { createHash } from 'node:crypto';
import type { ExistingItemRef } from './mealPhotoSchema.js';

/** Map-backed LRU with an optional per-entry TTL. Map order = recency. */
export class LruCache<V> {
  private map = new Map<string, { value: V; expires: number }>();

  constructor(private readonly max: number, private readonly ttlMs: number = Infinity) {}

  get(key: string, now = Date.now()): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  has(key: string, now = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  set(key: string, value: V, now = Date.now()): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: now + this.ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Cache key for one analysis: sha256 over the decoded image bytes, in order,
 * plus the existingItems signature, region and a version tag (bump it when
 * the prompt/schema changes so stale answers aren't served).
 *
 * Hashing decoded bytes rather than the base64 string means a client that
 * re-encodes with different line wrapping still hits.
 */
export function mealPhotoCacheKey(
  images: Array<{ base64: string; mimeType: string }>,
  existing: ExistingItemRef[],
  region: string,
  version: string,
): string {
  const h = createHash('sha256');
  h.update(`v=${version}|r=${region}|n=${images.length}|`);
  for (const img of images) {
    h.update(Buffer.from(img.base64, 'base64'));
    h.update('|');
  }
  const sig = existing
    .map((e) => `${e.name.toLowerCase()}:${e.grams == null ? '' : Math.round(e.grams)}`)
    .sort()
    .join(';');
  h.update(`x=${sig}`);
  return h.digest('hex');
}

// ── Add-photo grants ─────────────────────────────────────────────────────────
//
// "Add photo" calls (with existingItems) don't count against the free scan
// quota. Unverified, that would be a free unlimited-scan bypass: send one fake
// existing item with every request. So the exemption only applies when the
// existingItems carry an item id this server issued to this user recently,
// and at most MAX_FREE_ADD_PHOTOS times per original scan. Anything else
// still works — it just counts as a scan.

export const ADD_PHOTO_GRANT_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_FREE_ADD_PHOTOS = 3;

const grants = new LruCache<AddPhotoGrant>(5000, ADD_PHOTO_GRANT_TTL_MS);

/** Item ids are `${prefix}-${index}`; the prefix identifies the analysis. */
export function itemIdPrefix(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = /^([a-f0-9]{10})-\d+$/.exec(id);
  return m ? m[1] : null;
}

export interface AddPhotoGrant { used: number }

/**
 * Registers the item-id prefix of an analysis. A counted scan gets a fresh
 * grant; an add-photo call passes the grant it consumed so its new items share
 * the parent's budget (otherwise each add-photo would mint 3 more free ones).
 */
export function recordAddPhotoGrant(userId: string, prefix: string, inherit?: AddPhotoGrant | null, now = Date.now()): void {
  const key = `${userId}:${prefix}`;
  if (inherit) { grants.set(key, inherit, now); return; }
  if (!grants.get(key, now)) grants.set(key, { used: 0 }, now);
}

/**
 * Consumes one free add-photo for this user if any existing item id belongs
 * to a recent analysis of theirs. Returns the grant when the call is free,
 * null when it should count as a scan.
 */
export function consumeAddPhotoGrant(userId: string, existing: ExistingItemRef[], now = Date.now()): AddPhotoGrant | null {
  for (const e of existing) {
    const prefix = itemIdPrefix(e.id);
    if (!prefix) continue;
    const g = grants.get(`${userId}:${prefix}`, now);
    if (g && g.used < MAX_FREE_ADD_PHOTOS) {
      g.used += 1;
      return g;
    }
  }
  return null;
}

export function _resetAddPhotoGrants(): void {
  grants.clear();
}
