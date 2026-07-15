// Self-healing pipeline: capture layer. Classification decides whether an
// error can ever wake the auto-fix agent, and fingerprints decide dedup —
// both must be stable and predictable.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'err-journal-'));
process.env.ERROR_JOURNAL_DIR = TMP_DIR;

import {
  classifyError, computeFingerprint, scrubText, buildRecord, journalError, journalPath,
} from '../services/errorJournal.js';

describe('classifyError', () => {
  it('marks network errors transient', () => {
    expect(classifyError(Object.assign(new Error('connect failed'), { code: 'ECONNRESET' }))).toBe('transient');
    expect(classifyError(Object.assign(new Error('dns'), { code: 'ENOTFOUND' }))).toBe('transient');
  });

  it('marks provider 429/5xx transient (OpenAI-style status property)', () => {
    expect(classifyError(Object.assign(new Error('Rate limit reached'), { status: 429 }))).toBe('transient');
    expect(classifyError(Object.assign(new Error('upstream'), { statusCode: 503 }))).toBe('transient');
  });

  it('marks quota/timeout messages transient even without codes', () => {
    expect(classifyError(new Error('Vertex AI quota exceeded for model'))).toBe('transient');
    expect(classifyError(new Error('Request timed out after 60000ms'))).toBe('transient');
    expect(classifyError(new Error('The model is overloaded. Please try again.'))).toBe('transient');
  });

  it('marks code bugs deterministic', () => {
    expect(classifyError(new TypeError("Cannot read properties of undefined (reading 'muscles')"))).toBe('deterministic');
    expect(classifyError(new Error('Unique constraint failed on the fields: (`userId`)'))).toBe('deterministic');
  });

  it('classifies plain strings via the fallback message', () => {
    expect(classifyError(undefined, 'fetch failed')).toBe('transient');
    expect(classifyError(undefined, 'column does not exist')).toBe('deterministic');
  });
});

describe('computeFingerprint', () => {
  it('is stable across volatile fragments (ids, numbers, quoted values)', () => {
    const a = computeFingerprint('http', 'POST /api/coach', 'No workout found for id 12345 "bench"');
    const b = computeFingerprint('http', 'POST /api/coach', 'No workout found for id 99 "squat"');
    expect(a).toBe(b);
  });

  it('separates different routes and messages', () => {
    const a = computeFingerprint('http', 'POST /api/coach', 'boom');
    expect(computeFingerprint('http', 'POST /api/nutrition', 'boom')).not.toBe(a);
    expect(computeFingerprint('http', 'POST /api/coach', 'different failure')).not.toBe(a);
  });
});

describe('scrubText', () => {
  it('redacts bearer tokens and emails, truncates long text', () => {
    const out = scrubText('Authorization: Bearer abc.def-123 for anup@example.com');
    expect(out).not.toContain('abc.def-123');
    expect(out).not.toContain('anup@example.com');
    expect(scrubText('x'.repeat(9000)).length).toBeLessThanOrEqual(4000);
  });
});

describe('buildRecord / journalError', () => {
  it('derives message, stack, classification, and locus from the error', () => {
    const rec = buildRecord({
      source: 'provider',
      error: Object.assign(new Error('Rate limit reached'), { status: 429 }),
      provider: 'openai', op: 'chat.completions.create', attempts: 3,
    });
    expect(rec.classification).toBe('transient');
    expect(rec.provider).toBe('openai');
    expect(rec.stack).toContain('Error: Rate limit reached');
    expect(rec.fingerprint).toMatch(/^[0-9a-f]{10}$/);
  });

  it('appends one parseable NDJSON line per call', async () => {
    journalError({ source: 'http', message: 'HTTP 500', route: '/api/test', method: 'GET', status: 500 });
    await vi.waitFor(() => {
      const lines = fs.readFileSync(journalPath(), 'utf8').trim().split('\n');
      const rec = JSON.parse(lines[lines.length - 1]);
      expect(rec.route).toBe('/api/test');
      expect(rec.source).toBe('http');
      expect(rec.classification).toBe('deterministic');
    });
  });

  it('never throws even when the journal dir is unwritable', () => {
    const prev = process.env.ERROR_JOURNAL_DIR;
    // A "directory" nested under a regular file — mkdirSync fails with
    // ENOTDIR immediately. (Do NOT use a /proc path here: Node's recursive
    // mkdir busy-loops on procfs instead of throwing.)
    const blocker = path.join(TMP_DIR, 'blocker-file');
    fs.writeFileSync(blocker, 'x');
    process.env.ERROR_JOURNAL_DIR = path.join(blocker, 'journal');
    expect(() => journalError({ source: 'process', message: 'x' })).not.toThrow();
    process.env.ERROR_JOURNAL_DIR = prev;
  });
});
