import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The web and mobile views read these types from the shared package; the
// backend keeps a copy because its build compiles src/ only. If one side is
// edited without the other, the API and its clients silently disagree.
const MARKER = 'export type ClientStatus =';
const read = (rel: string) => {
  const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  return text.slice(text.indexOf(MARKER));
};

describe('personal-training contract types', () => {
  it('are identical in the backend and the shared package', () => {
    const backend = read('../services/personalTraining/types.ts');
    const shared = read('../../../packages/personal-training-core/src/types.ts');
    expect(backend.length).toBeGreaterThan(1000);
    expect(backend).toBe(shared);
  });
});
