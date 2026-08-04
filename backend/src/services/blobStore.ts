/**
 * Content-addressed blob storage for user images.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Images were stored as base64 inside JSON columns and shipped inline in API
 * responses. Two costs, both measured against prod on 2026-08-03:
 *
 *   1. Size. Base64 is 33% larger than the bytes it encodes, and the same
 *      avatar was re-serialized per post AND per comment: a 35-item feed page
 *      carried 53 blobs of which 3 were distinct. That saturated the shared
 *      HTTP/2 connection and made every other tab appear to hang.
 *   2. Cacheability — the deeper cost. A URL gets an ETag, a CDN edge copy and
 *      a 304 on every later load. Bytes embedded in a JSON body are re-sent in
 *      full, to every client, forever. No amount of gzip fixes that.
 *
 * ── Content addressing ───────────────────────────────────────────────────────
 * The object key is sha256(bytes). Two consequences worth stating plainly:
 *
 *   - Deduplication is automatic and global. The same avatar uploaded by ten
 *     users is one object. The 53-copies-of-3-images problem cannot recur at
 *     the storage layer.
 *   - The key can never point at different bytes, so responses are safe to
 *     serve `immutable, max-age=1y`. This is the property base64-in-JSON can
 *     never have.
 *
 * ── Vendor ───────────────────────────────────────────────────────────────────
 * GCS, because the auth path is already proven here: @google-cloud/storage is
 * a dependency, keyless WIF from EC2 already works (see geminiService.getBucket
 * and podcast/gcsArchive), and GCP credits cover it. The only real argument for
 * Cloudflare R2 is egress (~$0.12/GB on GCS vs $0), which does not bite until
 * far more traffic than this app has. Everything vendor-specific is confined to
 * `bucket()`/`objectUrl()` below so swapping later is a contained change rather
 * than a rewrite.
 *
 * Disabled unless GCP_MEDIA_BUCKET is set — callers must handle a null result
 * and fall back to the existing inline-base64 path. The runtime WIF identity is
 * objectUser-only and cannot create buckets; an admin pre-creates it.
 */

import { createHash } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { cacheGet, cacheSet } from './cacheService.js';

const PROJECT = process.env.GCP_PROJECT_ID ?? process.env.GCP_PROJECT;
const BUCKET = process.env.GCP_MEDIA_BUCKET;

/**
 * Set only if the bucket is made publicly readable and fronted by a CDN. Left
 * unset the bucket stays private and objects are served via signed URLs, which
 * is the default because posts carry `visibility: 'friends'` — a public bucket
 * would quietly downgrade that to "public to anyone with the link", and links
 * leak via logs, referrers and screenshots.
 */
const PUBLIC_BASE = process.env.MEDIA_PUBLIC_BASE ?? null;

/**
 * Signed URLs are minted for the V4 maximum of 7 days and cached, rather than
 * per-request with a short expiry.
 *
 * This matters: the whole point of moving images out of JSON is that a URL can
 * be cached by the client and the edge. A URL that rotates every few minutes is
 * re-downloaded every time and throws that away. Handing every client the SAME
 * url for days restores ordinary HTTP caching while keeping the object private.
 */
const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Re-sign a day early so a cached URL is never handed out near expiry. */
const SIGNED_URL_CACHE_MS = 6 * 24 * 60 * 60 * 1000;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

let _storage: Storage | null = null;
function bucket() {
  if (!BUCKET) return null;
  if (!_storage) _storage = new Storage({ projectId: PROJECT });
  return _storage.bucket(BUCKET);
}

export function blobStoreEnabled(): boolean {
  return !!BUCKET;
}

/** Strip a `data:` URI prefix if present and return the raw base64 payload. */
export function stripDataUri(input: string): { base64: string; mimeType: string | null } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(input);
  if (m) return { base64: m[2], mimeType: m[1] };
  return { base64: input, mimeType: null };
}

/**
 * Identify an image from its magic bytes.
 *
 * Never trust a caller-supplied mime here. Post payloads store raw base64 with
 * no `data:` prefix, so the previous default of "assume JPEG" silently labelled
 * PNGs as `image/jpeg` — the bytes served fine (decoders sniff), but the
 * Content-Type and the key's extension were both wrong. The bytes themselves
 * are the only reliable source.
 */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** sha256 of the decoded bytes — the content address. */
export function contentKey(bytes: Buffer, mimeType: string): string {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const ext = EXT_BY_MIME[mimeType] ?? 'bin';
  // Two-level fan-out keeps any single bucket "directory" listing small.
  return `img/${digest.slice(0, 2)}/${digest}.${ext}`;
}

/**
 * A durable URL for an object.
 *
 * With MEDIA_PUBLIC_BASE set (public bucket + CDN) this is a plain static URL.
 * Otherwise it mints a 7-day V4 signed URL and caches it, so repeat callers
 * and every client share one cacheable URL. Returns null if the store is off
 * or signing fails, and callers fall back to inline base64.
 *
 * Signing note: the runtime uses Workload Identity Federation with no private
 * key, so signing goes through the IAM signBlob API. That requires the service
 * account to hold roles/iam.serviceAccountTokenCreator ON ITSELF — granted
 * 2026-08-04. Without it every call fails with
 * "Permission 'iam.serviceAccounts.signBlob' denied".
 */
export async function objectUrl(key: string): Promise<string | null> {
  if (PUBLIC_BASE) return `${PUBLIC_BASE}/${key}`;

  const b = bucket();
  if (!b) return null;

  const cacheKey = `blob_url:${key}`;
  const cached = cacheGet<string>(cacheKey);
  if (cached) return cached;

  try {
    const [url] = await b.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    cacheSet(cacheKey, url, SIGNED_URL_CACHE_MS);
    return url;
  } catch (err: any) {
    console.warn(`[blobStore] could not sign ${key}: ${err?.message ?? err}`);
    return null;
  }
}

export interface StoredBlob {
  key: string;
  url: string;
  bytes: number;
  deduped: boolean;
}

/**
 * Store a base64 image and return its content-addressed URL.
 *
 * Returns null (never throws) when the store is disabled, the input is not a
 * supported image, or the upload fails — callers keep their existing base64
 * path in that case, so enabling this can't take the feature down.
 */
export async function putImageBase64(
  input: string,
  mimeTypeHint?: string,
): Promise<StoredBlob | null> {
  const b = bucket();
  if (!b || !input) return null;

  try {
    const { base64, mimeType: fromUri } = stripDataUri(input);
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) return null;

    // Sniff first — a data: prefix or caller hint is a claim, the bytes are
    // evidence. Falling back to a hint let PNGs get stored as image/jpeg.
    const mimeType = (sniffImageMime(bytes) ?? fromUri ?? mimeTypeHint ?? '').toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) {
      console.warn(`[blobStore] unrecognised image data (${mimeType || 'unknown'}) — leaving inline`);
      return null;
    }

    const key = contentKey(bytes, mimeType);
    const file = b.file(key);

    // Content addressing means an existing object is byte-identical, so the
    // upload can be skipped entirely. This is the dedup, and it costs one
    // metadata call instead of re-uploading the payload.
    const [exists] = await file.exists();
    if (exists) {
      const existingUrl = await objectUrl(key);
      return existingUrl ? { key, url: existingUrl, bytes: bytes.length, deduped: true } : null;
    }

    await file.save(bytes, {
      contentType: mimeType,
      resumable: false,
      // Safe precisely because the key is a hash of these bytes.
      metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    });

    const url = await objectUrl(key);
    return url ? { key, url, bytes: bytes.length, deduped: false } : null;
  } catch (err: any) {
    console.warn(`[blobStore] upload failed, keeping inline base64: ${err?.message ?? err}`);
    return null;
  }
}
