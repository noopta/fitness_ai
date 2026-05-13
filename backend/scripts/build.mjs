// Build script — replaces `tsc` because the EC2 box has too little RAM to run
// the TypeScript compiler. esbuild does the same TS → JS transpile in ~150ms
// and ~50MB RAM. Type-checking is separately enforced via `npm run typecheck`
// (still uses tsc --noEmit, which we only run in dev / pre-deploy).
//
// Output shape matches the previous `tsc` output: one `.js` per `.ts`, mirror
// of the `src/` tree, ESM format, node target. Existing systemd unit
// (`node dist/index.js`) doesn't need to change.

import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist');

function collectTsFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      found.push(...collectTsFiles(p));
    } else if (s.isFile() && p.endsWith('.ts') && !p.endsWith('.test.ts')) {
      found.push(p);
    }
  }
  return found;
}

const entryPoints = collectTsFiles(SRC);
console.log(`[build] compiling ${entryPoints.length} files`);

rmSync(OUT, { recursive: true, force: true });

const t0 = Date.now();
await build({
  entryPoints,
  outdir: OUT,
  outbase: SRC,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Don't bundle — keep the per-file tree so node_modules resolution works
  // identically to the tsc output and Prisma's native bits load correctly.
  bundle: false,
  sourcemap: false,
  logLevel: 'info',
});
console.log(`[build] done in ${Date.now() - t0}ms`);
