// Affiliate enablement documents (outreach guide, playbook, ...).
//
// The files live in backend/data/affiliate-resources/ next to manifest.json and
// are read from the backend root at runtime (process.cwd(), same as
// data/chains — the systemd unit runs from backend/), so no build step copies
// them. To add a document: drop the PDF into that directory and add a
// manifest entry. A bad manifest fails loudly on first use instead of
// serving something unexpected.
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep, extname, basename } from 'node:path';
import { z } from 'zod';

export const RESOURCES_DIR = () =>
  resolve(process.env.AFFILIATE_RESOURCES_DIR || join(process.cwd(), 'data', 'affiliate-resources'));

const entrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must match ^[a-z0-9-]+$'),
  title: z.string().min(1),
  description: z.string().min(1),
  file: z.string().min(1),
  category: z.enum(['Outreach', 'Knowledge base']),
  updatedAt: z.string().refine(s => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s)), 'updatedAt must be an ISO date'),
  audience: z.enum(['trainer-plan', 'general']),
});
const manifestSchema = z.array(entrySchema);

export type ResourceEntry = z.infer<typeof entrySchema>;
export interface ResourceMeta extends Omit<ResourceEntry, 'file'> {
  fileName: string;
  sizeBytes: number;
}
interface LoadedResource extends ResourceMeta {
  absPath: string;
}

export class AffiliateResourcesManifestError extends Error {}

/** Parse + validate a manifest against `dir`. Exported for tests. */
export function loadManifest(dir: string = RESOURCES_DIR(), raw?: unknown): LoadedResource[] {
  const root = resolve(dir);
  let data = raw;
  if (data === undefined) {
    try {
      data = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    } catch (err: any) {
      throw new AffiliateResourcesManifestError(`affiliate resources manifest unreadable: ${err?.message ?? err}`);
    }
  }
  const parsed = manifestSchema.safeParse(data);
  if (!parsed.success) {
    throw new AffiliateResourcesManifestError(`affiliate resources manifest invalid: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const seen = new Set<string>();
  return parsed.data.map(entry => {
    if (seen.has(entry.slug)) throw new AffiliateResourcesManifestError(`duplicate slug: ${entry.slug}`);
    seen.add(entry.slug);
    const absPath = resolve(root, entry.file);
    if (!absPath.startsWith(root + sep)) {
      throw new AffiliateResourcesManifestError(`file escapes resources dir: ${entry.slug}`);
    }
    if (extname(absPath).toLowerCase() !== '.pdf') {
      throw new AffiliateResourcesManifestError(`only .pdf resources are allowed: ${entry.slug}`);
    }
    let size: number;
    try {
      const st = statSync(absPath);
      if (!st.isFile()) throw new Error('not a file');
      size = st.size;
    } catch {
      throw new AffiliateResourcesManifestError(`file missing for ${entry.slug}: ${entry.file}`);
    }
    const { file, ...meta } = entry;
    return { ...meta, fileName: basename(absPath), sizeBytes: size, absPath };
  });
}

let cache: { dir: string; items: LoadedResource[] } | null = null;
function resources(): LoadedResource[] {
  const dir = RESOURCES_DIR();
  if (!cache || cache.dir !== dir) cache = { dir, items: loadManifest(dir) };
  return cache.items;
}

/** Test hook: forget the cached manifest. */
export function resetAffiliateResourcesCache(): void {
  cache = null;
}

/** Public metadata (no filesystem paths). */
export function listResources(): ResourceMeta[] {
  return resources().map(({ absPath, ...meta }) => meta);
}

/** Absolute path + metadata for a slug, or null when unknown. */
export function resolveResourceFile(slug: string): { absPath: string; fileName: string; sizeBytes: number; title: string } | null {
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return null;
  const r = resources().find(x => x.slug === slug);
  return r ? { absPath: r.absPath, fileName: r.fileName, sizeBytes: r.sizeBytes, title: r.title } : null;
}
