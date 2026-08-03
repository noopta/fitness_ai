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
 * `putObject`/`publicUrl` below so swapping later is a contained change rather
 * than a rewrite.
 *
 * Disabled unless GCP_MEDIA_BUCKET is set — callers must handle a null result
 * and fall back to the existing inline-base64 path. The runtime WIF identity is
 * objectUser-only and cannot create buckets; an admin pre-creates it.
 */

import { createHash } from 'node:crypto';
import { Storage } from '@google-cloud/storage';

const PROJECT = process.env.GCP_PROJECT_ID ?? process.env.GCP_PROJECT;
const BUCKET = process.env.GCP_MEDIA_BUCKET;

/** Public base for served objects. Set to a CDN origin to front the bucket. */
const PUBLIC_BASE = process.env.MEDIA_PUBLIC_BASE ?? (BUCKET ? `https://storage.googleapis.com/${BUCKET}` : null);

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

/** sha256 of the decoded bytes — the content address. */
export function contentKey(bytes: Buffer, mimeType: string): string {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const ext = EXT_BY_MIME[mimeType] ?? 'bin';
  // Two-level fan-out keeps any single bucket "directory" listing small.
  return `img/${digest.slice(0, 2)}/${digest}.${ext}`;
}

export function publicUrl(key: string): string | null {
  return PUBLIC_BASE ? `${PUBLIC_BASE}/${key}` : null;
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
    const mimeType = (fromUri ?? mimeTypeHint ?? 'image/jpeg').toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) {
      console.warn(`[blobStore] unsupported mime ${mimeType} — leaving inline`);
      return null;
    }

    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) return null;

    const key = contentKey(bytes, mimeType);
    const url = publicUrl(key);
    if (!url) return null;

    const file = b.file(key);

    // Content addressing means an existing object is byte-identical, so the
    // upload can be skipped entirely. This is the dedup, and it costs one
    // metadata call instead of re-uploading the payload.
    const [exists] = await file.exists();
    if (exists) return { key, url, bytes: bytes.length, deduped: true };

    await file.save(bytes, {
      contentType: mimeType,
      resumable: false,
      // Safe precisely because the key is a hash of these bytes.
      metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    });

    return { key, url, bytes: bytes.length, deduped: false };
  } catch (err: any) {
    console.warn(`[blobStore] upload failed, keeping inline base64: ${err?.message ?? err}`);
    return null;
  }
}
