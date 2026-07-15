// Triage gating rules — these are what keep the auto-fix pipeline from
// burning tokens on transient noise or spawning unbounded Claude runs.

import { describe, it, expect } from 'vitest';
import {
  triage, emptyState, parseJournalLines, branchNameFor, buildFixPrompt,
  DEFAULT_OPTS, type TriageState,
} from '../services/errorTriageCore.js';
import type { ErrorJournalRecord } from '../services/errorJournal.js';

const NOW = new Date('2026-07-15T12:00:00Z');

function rec(over: Partial<ErrorJournalRecord> = {}): ErrorJournalRecord {
  return {
    ts: NOW.toISOString(),
    source: 'http',
    classification: 'deterministic',
    fingerprint: 'abc123def0',
    message: "Cannot read properties of undefined (reading 'muscles')",
    route: '/api/train-together/overlap',
    method: 'GET',
    status: 500,
    ...over,
  };
}

describe('triage — dispatch gating', () => {
  it('dispatches a new deterministic error and records it as open', () => {
    const state = emptyState();
    const { decisions } = triage([rec()], state, NOW);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].type).toBe('dispatch');
    expect(state.dispatches['abc123def0'].status).toBe('open');
    expect(state.dailyRuns['2026-07-15']).toBe(1);
  });

  it('never dispatches transient errors', () => {
    const state = emptyState();
    const { decisions } = triage(
      [rec({ classification: 'transient', message: 'rate limit' })], state, NOW,
    );
    expect(decisions).toHaveLength(0);
    expect(state.dailyRuns['2026-07-15']).toBeUndefined();
  });

  it('collapses a burst of the same fingerprint into one dispatch', () => {
    const { decisions } = triage([rec(), rec(), rec()], emptyState(), NOW);
    expect(decisions.filter((d) => d.type === 'dispatch')).toHaveLength(1);
  });

  it('enforces the daily run cap (3/day) across distinct errors', () => {
    const records = ['a1', 'b2', 'c3', 'd4', 'e5'].map((fp) => rec({ fingerprint: fp }));
    const { decisions } = triage(records, emptyState(), NOW);
    expect(decisions.filter((d) => d.type === 'dispatch')).toHaveLength(3);
  });

  it('does not re-dispatch a fingerprint with an open fix branch; counts recurrences', () => {
    const state = emptyState();
    triage([rec()], state, NOW);
    const { decisions } = triage([rec(), rec()], state, NOW);
    expect(decisions).toHaveLength(0);
    expect(state.dispatches['abc123def0'].recurrences).toBe(2);
  });

  it('daily cap resets on a new UTC day', () => {
    const state = emptyState();
    triage(['a1', 'b2', 'c3'].map((fp) => rec({ fingerprint: fp })), state, NOW);
    const tomorrow = new Date('2026-07-16T09:00:00Z');
    const { decisions } = triage([rec({ fingerprint: 'f6' })], state, tomorrow);
    expect(decisions.filter((d) => d.type === 'dispatch')).toHaveLength(1);
  });
});

describe('triage — escalations', () => {
  it('escalates when a fixed (done) error recurs, then marks it dismissed', () => {
    const state = emptyState();
    triage([rec()], state, NOW);
    state.dispatches['abc123def0'].status = 'done'; // human merged the fix

    const { decisions } = triage([rec()], state, NOW);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].type).toBe('escalate-recurrence');
    expect(state.dispatches['abc123def0'].status).toBe('dismissed');

    // Further recurrences don't re-escalate every pass.
    expect(triage([rec()], state, NOW).decisions).toHaveLength(0);
  });

  it('escalates a transient spike past the threshold, once per cooldown', () => {
    const state = emptyState();
    const burst = Array.from({ length: DEFAULT_OPTS.transientEscalateThreshold }, () =>
      rec({ classification: 'transient', fingerprint: 'tt1', message: 'quota exceeded' }));
    const { decisions } = triage(burst, state, NOW);
    expect(decisions.filter((d) => d.type === 'escalate-transient')).toHaveLength(1);

    // Same spike again immediately → cooldown suppresses the repeat alert.
    const again = triage(burst, state, new Date(NOW.getTime() + 60_000));
    expect(again.decisions).toHaveLength(0);
  });

  it('resets the transient window after it ages out', () => {
    const state = emptyState();
    triage([rec({ classification: 'transient', fingerprint: 'tt2' })], state, NOW);
    const later = new Date(NOW.getTime() + DEFAULT_OPTS.transientWindowMs + 60_000);
    triage([rec({ classification: 'transient', fingerprint: 'tt2', ts: later.toISOString() })], state, later);
    expect(state.transients['tt2'].count).toBe(1); // old count aged out
  });
});

describe('parsing + naming + prompt', () => {
  it('parseJournalLines skips torn/garbage lines', () => {
    const good = JSON.stringify(rec());
    const parsed = parseJournalLines(`${good}\nnot json\n{"half": tru\n${good}\n`);
    expect(parsed).toHaveLength(2);
  });

  it('branchNameFor produces a safe, fingerprinted branch name', () => {
    expect(branchNameFor(rec())).toBe('fix/auto-abc123def0-api-train-together-overlap');
    expect(branchNameFor(rec({ route: undefined, op: 'chat.completions.create', provider: 'openai' })))
      .toMatch(/^fix\/auto-abc123def0-chat-completions-create$/);
  });

  it('buildFixPrompt embeds the record and the hard guardrails', () => {
    const prompt = buildFixPrompt(rec(), { serviceLog: 'journalctl tail here' });
    expect(prompt).toContain('abc123def0');
    expect(prompt).toContain('NEVER run prisma db push');
    expect(prompt).toContain('NEVER merge to main');
    expect(prompt).toContain('journalctl tail here');
  });
});
