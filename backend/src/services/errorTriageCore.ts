// Triage core — pure decision logic for the self-healing pipeline.
//
// scripts/errorTriage.mjs (cron, every 5 min) feeds new journal records
// through triage() and acts on the returned decisions. Keeping this logic
// pure (no fs, no network, injectable clock) makes the gating rules unit
// testable, which matters: these rules are what keep a bad night from
// spawning 40 Claude runs.
//
// Rules (agreed 2026-07-15):
//   · Deterministic errors only get dispatched — transient errors (429s,
//     quota, network) are counted and escalate to Telegram past a threshold.
//   · Max 3 Claude runs per UTC day, one open fix branch per fingerprint.
//   · A fingerprint recurring after its fix branch was merged escalates
//     instead of re-dispatching.

import type { ErrorJournalRecord } from './errorJournal.js';

export interface DispatchEntry {
  branch: string;
  dispatchedAt: string;
  /** open = fix branch awaiting review · done = human marked merged · dismissed = human rejected */
  status: 'open' | 'done' | 'dismissed';
  recurrences: number;
  lastSeen?: string;
  sample?: Pick<ErrorJournalRecord, 'message' | 'route' | 'provider' | 'op'>;
}

export interface TransientEntry {
  count: number;
  windowStart: string;
  lastEscalatedAt?: string;
  sample?: string;
}

export interface TriageState {
  /** Byte offset into journal.ndjson already processed. */
  offset: number;
  dispatches: Record<string, DispatchEntry>;
  /** UTC date string -> number of Claude runs dispatched that day. */
  dailyRuns: Record<string, number>;
  transients: Record<string, TransientEntry>;
}

export function emptyState(): TriageState {
  return { offset: 0, dispatches: {}, dailyRuns: {}, transients: {} };
}

export type Decision =
  | { type: 'dispatch'; record: ErrorJournalRecord; branch: string }
  | { type: 'escalate-transient'; fingerprint: string; count: number; sample: string }
  | { type: 'escalate-recurrence'; fingerprint: string; record: ErrorJournalRecord; branch: string };

export interface TriageOpts {
  maxRunsPerDay: number;
  transientEscalateThreshold: number;
  transientWindowMs: number;
  transientEscalateCooldownMs: number;
}

export const DEFAULT_OPTS: TriageOpts = {
  maxRunsPerDay: 3,
  transientEscalateThreshold: 10,
  transientWindowMs: 60 * 60 * 1000,      // 1h counting window
  transientEscalateCooldownMs: 6 * 60 * 60 * 1000, // re-alert at most every 6h
};

/** Tolerant NDJSON parse — a torn last line or garbage never kills a pass. */
export function parseJournalLines(text: string): ErrorJournalRecord[] {
  const out: ErrorJournalRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (rec && typeof rec.fingerprint === 'string' && rec.classification) out.push(rec);
    } catch { /* torn write — skip */ }
  }
  return out;
}

export function branchNameFor(record: ErrorJournalRecord): string {
  const hint = (record.route ?? record.op ?? record.source)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return `fix/auto-${record.fingerprint}${hint ? `-${hint}` : ''}`;
}

/**
 * Process new records against state; returns decisions and the mutated
 * state (state is updated in place and returned for convenience).
 */
export function triage(
  records: ErrorJournalRecord[],
  state: TriageState,
  now: Date = new Date(),
  opts: TriageOpts = DEFAULT_OPTS,
): { decisions: Decision[]; state: TriageState } {
  const decisions: Decision[] = [];
  const today = now.toISOString().slice(0, 10);
  // Only one dispatch per fingerprint per *pass* too — a burst of the same
  // new error in one batch is still one bug.
  const dispatchedThisPass = new Set<string>();

  for (const record of records) {
    const fp = record.fingerprint;

    if (record.classification === 'transient') {
      const entry = state.transients[fp] ?? { count: 0, windowStart: record.ts, sample: record.message };
      // Reset the window if the last one has aged out.
      if (now.getTime() - Date.parse(entry.windowStart) > opts.transientWindowMs) {
        entry.count = 0;
        entry.windowStart = record.ts;
      }
      entry.count += 1;
      entry.sample = record.message;
      const cooledDown = !entry.lastEscalatedAt
        || now.getTime() - Date.parse(entry.lastEscalatedAt) > opts.transientEscalateCooldownMs;
      if (entry.count >= opts.transientEscalateThreshold && cooledDown) {
        decisions.push({ type: 'escalate-transient', fingerprint: fp, count: entry.count, sample: entry.sample ?? '' });
        entry.lastEscalatedAt = now.toISOString();
        entry.count = 0;
        entry.windowStart = record.ts;
      }
      state.transients[fp] = entry;
      continue;
    }

    // Deterministic from here on.
    const existing = state.dispatches[fp];
    if (existing) {
      existing.recurrences += 1;
      existing.lastSeen = record.ts;
      if (existing.status === 'done') {
        // The fix was merged but the error came back — the fix didn't hold.
        decisions.push({ type: 'escalate-recurrence', fingerprint: fp, record, branch: existing.branch });
        existing.status = 'dismissed'; // stop re-escalating every pass; human re-triages
      }
      // status 'open' or 'dismissed': counted, no new dispatch.
      continue;
    }

    if (dispatchedThisPass.has(fp)) continue;

    const runsToday = state.dailyRuns[today] ?? 0;
    if (runsToday >= opts.maxRunsPerDay) continue; // journaled + SMS'd already; just no agent

    const branch = branchNameFor(record);
    decisions.push({ type: 'dispatch', record, branch });
    dispatchedThisPass.add(fp);
    state.dailyRuns[today] = runsToday + 1;
    state.dispatches[fp] = {
      branch,
      dispatchedAt: now.toISOString(),
      status: 'open',
      recurrences: 0,
      sample: { message: record.message, route: record.route, provider: record.provider, op: record.op },
    };
  }

  return { decisions, state };
}

/** The prompt handed to the headless Claude Code fixer run. */
export function buildFixPrompt(record: ErrorJournalRecord, context: { recentJournal?: string; serviceLog?: string }): string {
  const lines = [
    'You are the automated fixer for the Axiom fitness backend (Express + Prisma + TypeScript).',
    'A production error was journaled. Investigate the root cause and fix it.',
    '',
    '== ERROR RECORD ==',
    JSON.stringify(record, null, 2),
  ];
  if (context.recentJournal) {
    lines.push('', '== RECENT JOURNAL ENTRIES (same fingerprint) ==', context.recentJournal);
  }
  if (context.serviceLog) {
    lines.push('', '== RECENT SERVICE LOG (journalctl) ==', context.serviceLog);
  }
  lines.push(
    '',
    '== INSTRUCTIONS ==',
    '1. You are in a dedicated git worktree on a fresh fix branch off main. backend/node_modules is symlinked from the main checkout.',
    '2. Reproduce the failure path by reading the code — start from the stack trace / route.',
    '3. Make the smallest correct fix. Add or update a unit test that would have caught this.',
    '4. Run the backend test suite: cd backend && npm test. All tests must pass.',
    '5. Commit with a clear message explaining root cause and fix, then push the branch: git push -u origin HEAD.',
    '6. End your final message with a 3-6 line summary: ROOT CAUSE, FIX, RISK. It will be sent to the maintainer on Telegram.',
    '',
    '== HARD RULES ==',
    '- NEVER run prisma db push/migrate, systemctl, or anything that touches the production database or service.',
    '- NEVER merge to main. Your output is a pushed branch for human review.',
    '- If the error is not fixable from code (bad env var, external outage, data issue), do NOT force a code change — write a diagnosis instead, commit nothing, and say so in the summary.',
  );
  return lines.join('\n');
}
