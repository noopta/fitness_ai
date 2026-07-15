# Self-Healing Error Pipeline

Every client-visible failure is journaled; deterministic code bugs are handed
to a headless Claude Code run that produces a **fix branch for human review**.
Nothing is ever auto-merged or auto-deployed.

```
Express 5xx (middleware + res.json hook) ─┐
LLM provider calls (prototype hooks,      ├─► journal.ndjson ─► errorTriage.mjs ─► claude -p ─► fix/auto-* branch
  retry transient, journal terminal)      │   (NDJSON, PII-      (cron */5min:      (worktree,     + Telegram summary
uncaught / unhandledRejection ────────────┘    scrubbed)          gate + dispatch)   no secrets)
```

## Components

| File | Role |
|---|---|
| `src/services/errorJournal.ts` | Capture: classify (transient/deterministic), fingerprint, scrub, append NDJSON to `/home/ubuntu/axiom-error-journal/journal.ndjson` (20MB rotation). Never throws. |
| `src/services/llmInstrumentation.ts` | Layer 1: patches OpenAI + GoogleGenAI SDK **prototypes** once at boot — every client instance in the codebase gets retry-on-transient (2 retries, backoff) + journaling. `createAndPoll` is journal-only (non-idempotent). |
| `src/index.ts` | Wires capture: `res.json` hook (catches routes that self-handle 500s), error middleware (full stack), process handlers. Existing SMS/PostHog alerting unchanged. |
| `src/services/errorTriageCore.ts` | Pure gating logic (unit-tested): deterministic-only dispatch, **max 3 Claude runs/UTC-day**, one open branch per fingerprint, transient spike escalation (≥10/hr, 6h cooldown), recurrence-after-merge escalation. |
| `scripts/errorTriage.mjs` | Cron daemon: reads journal from a byte offset, dispatches headless `claude -p` in a fresh worktree off `origin/main`, pushes `fix/auto-<fingerprint>-<route>`, sends the summary to Telegram (reuses the bridge's token/chat id). Single-flight lock, 30-min run timeout. |

## Enabling (deploy steps)

1. Deploy this branch (normal runbook: build → rsync dist → restart).
2. Install the cron:
   ```
   */5 * * * * cd /home/ubuntu/fitness_ai_repo/backend && node scripts/errorTriage.mjs >> /home/ubuntu/axiom-error-journal/triage.log 2>&1
   ```
3. That's it — journal dir is auto-created; Telegram creds come from
   `/home/ubuntu/claude-telegram-bridge/.env`.

## Operating it

- **After merging a fix branch:** `node scripts/errorTriage.mjs mark <fingerprint> done`
  (enables recurred-after-fix escalation). Rejecting it: `mark <fingerprint> dismissed`.
- **Env overrides:** `ERROR_JOURNAL_DIR`, `AUTOFIX_TELEGRAM_TOKEN` / `AUTOFIX_TELEGRAM_CHAT_ID`,
  `AUTOFIX_REPO`, `AUTOFIX_WORKTREES`, `CLAUDE_BIN`.
- **State/dedup** lives in `triage-state.json` next to the journal; delete it to reset.

## Safety properties

- The fixer worktree has **no `.env`** — no prod secrets, no `DATABASE_URL`, so the
  prod DB is unreachable. Allowed tools exclude `npx` (blocks `prisma db push`) and
  any service control; prompt hard-rules forbid merge/deploy.
- Transient provider failures (429/quota/network/5xx) are retried in-process and
  never wake the agent — they escalate to Telegram past a spike threshold.
- Journaling is fire-and-forget and can never take a request down with it.
