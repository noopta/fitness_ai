// Error journal — the capture layer of the self-healing pipeline.
//
// Every client-visible failure (HTTP 5xx, provider call, process crash) is
// appended as one NDJSON line to a journal file OUTSIDE the repo. A cron
// triage daemon (scripts/errorTriage.mjs) reads the journal, applies gating
// rules (errorTriageCore.ts), and dispatches Claude Code to fix
// deterministic errors on a branch. Transient errors are only counted.
//
// Writes are fire-and-forget: journaling must never make an outage worse.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

export type ErrorSource = 'http' | 'provider' | 'process';
export type ErrorClass = 'transient' | 'deterministic';

export interface ErrorJournalRecord {
  ts: string;
  source: ErrorSource;
  classification: ErrorClass;
  fingerprint: string;
  message: string;
  stack?: string;
  route?: string;
  method?: string;
  status?: number;
  userId?: string;
  provider?: string;
  op?: string;
  model?: string;
  attempts?: number;
  gitSha?: string;
}

export interface JournalInput {
  source: ErrorSource;
  /** The thrown value, when there is one. Message/stack/classification derive from it. */
  error?: unknown;
  /** Explicit message when there is no error object (e.g. a handled res.status(500).json). */
  message?: string;
  route?: string;
  method?: string;
  status?: number;
  userId?: string;
  provider?: string;
  op?: string;
  model?: string;
  attempts?: number;
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE',
  'EAI_AGAIN', 'ECONNABORTED', 'ERR_SOCKET_CONNECTION_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
]);
// Provider-side statuses that a retry or the next request can plausibly clear.
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);
const TRANSIENT_MESSAGE = /rate limit|quota|overloaded|resource.?exhausted|timed?.?out|timeout|socket hang up|fetch failed|network|temporarily unavailable|service unavailable|connection (?:closed|reset|error)/i;

/**
 * Transient = a retry or the passage of time can fix it (429s, quota, network
 * blips, provider 5xx). Deterministic = a code bug a fix branch makes sense
 * for. Classification is by error *shape*, not by where it was caught: a
 * route 500 caused by an OpenAI 429 bubbling up is still transient.
 */
export function classifyError(err: unknown, fallbackMessage?: string): ErrorClass {
  const anyErr = err as any;
  const code: string | undefined = anyErr?.code ?? anyErr?.cause?.code;
  if (code && TRANSIENT_CODES.has(code)) return 'transient';
  const status: number | undefined = anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status;
  if (typeof status === 'number' && TRANSIENT_STATUSES.has(status)) return 'transient';
  const message = err instanceof Error ? err.message : (typeof err === 'string' ? err : fallbackMessage ?? '');
  if (TRANSIENT_MESSAGE.test(message)) return 'transient';
  return 'deterministic';
}

/**
 * Stable identity for "the same error". Volatile fragments (numbers, UUIDs,
 * quoted values, hex ids) are normalized out so two occurrences with
 * different record ids collapse to one fingerprint.
 */
export function computeFingerprint(source: ErrorSource, locus: string, message: string): string {
  const normalized = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/(["'`]).*?\1/g, '<str>')
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/\d+/g, '<n>')
    .slice(0, 160);
  const raw = `${source}|${locus}|${normalized}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10);
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const BEARER_RE = /bearer\s+[\w.~+/=-]+/gi;

/** Strip obvious PII/credentials before anything lands on disk or in a Claude prompt. */
export function scrubText(text: string, max = 4000): string {
  return text.replace(BEARER_RE, 'Bearer <redacted>').replace(EMAIL_RE, '<email>').slice(0, max);
}

let cachedGitSha: string | undefined | null = null;
function gitSha(): string | undefined {
  if (cachedGitSha !== null) return cachedGitSha;
  try {
    cachedGitSha = process.env.GIT_SHA
      || execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    cachedGitSha = undefined;
  }
  return cachedGitSha;
}

export function journalDir(): string {
  return process.env.ERROR_JOURNAL_DIR || '/home/ubuntu/axiom-error-journal';
}
export function journalPath(): string {
  return path.join(journalDir(), 'journal.ndjson');
}

const MAX_JOURNAL_BYTES = 20 * 1024 * 1024; // rotate at 20MB, keep one generation

function rotateIfNeeded(file: string): void {
  try {
    const st = fs.statSync(file);
    if (st.size > MAX_JOURNAL_BYTES) fs.renameSync(file, `${file}.1`);
  } catch { /* file missing — nothing to rotate */ }
}

/** Build the full record without touching disk (exported for tests). */
export function buildRecord(input: JournalInput): ErrorJournalRecord {
  const err = input.error;
  const message = scrubText(
    err instanceof Error ? err.message : (typeof err === 'string' && err) || input.message || 'unknown error',
    500,
  );
  const stack = err instanceof Error && err.stack ? scrubText(err.stack, 4000) : undefined;
  const locus = input.route
    ? `${input.method ?? ''} ${input.route}`.trim()
    : input.provider
      ? `${input.provider}:${input.op ?? ''}`
      : 'process';
  return {
    ts: new Date().toISOString(),
    source: input.source,
    classification: classifyError(err, message),
    fingerprint: computeFingerprint(input.source, locus, message),
    message,
    stack,
    route: input.route,
    method: input.method,
    status: input.status,
    userId: input.userId,
    provider: input.provider,
    op: input.op,
    model: input.model,
    attempts: input.attempts,
    gitSha: gitSha(),
  };
}

/**
 * Append one record to the journal. Never throws; failures are logged and
 * dropped — the journal is an observer, not a dependency.
 */
export function journalError(input: JournalInput): void {
  try {
    const record = buildRecord(input);
    const dir = journalDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = journalPath();
    rotateIfNeeded(file);
    fs.appendFile(file, JSON.stringify(record) + '\n', (e) => {
      if (e) console.error('[errorJournal] append failed:', e.message);
    });
  } catch (e: any) {
    console.error('[errorJournal] write failed:', e?.message ?? e);
  }
}
