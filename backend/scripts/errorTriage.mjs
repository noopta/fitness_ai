#!/usr/bin/env node
// Self-healing triage daemon.
//
// Cron (every 5 min):
//   */5 * * * * cd /home/ubuntu/fitness_ai_repo/backend && node scripts/errorTriage.mjs >> /home/ubuntu/axiom-error-journal/triage.log 2>&1
//
// Reads new error-journal records, runs the gating rules
// (dist/services/errorTriageCore.js — build the backend first), and for each
// dispatch decision: creates a worktree off origin/main, runs headless
// Claude Code with restricted tools to produce a fix branch, pushes it, and
// delivers a summary to Telegram. Transient spikes and post-fix recurrences
// escalate to Telegram instead.
//
// Guardrails: single-flight lock, deterministic-only dispatch, max runs/day
// (in core), 30-min hard timeout per run, no .env in the worktree (the agent
// never sees prod secrets or the prod DB), never merges — output is a branch.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────
const REPO = process.env.AUTOFIX_REPO || '/home/ubuntu/fitness_ai_repo';
const JOURNAL_DIR = process.env.ERROR_JOURNAL_DIR || '/home/ubuntu/axiom-error-journal';
const JOURNAL_FILE = path.join(JOURNAL_DIR, 'journal.ndjson');
const STATE_FILE = path.join(JOURNAL_DIR, 'triage-state.json');
const LOCK_DIR = path.join(JOURNAL_DIR, 'triage.lock');
const WORKTREE_ROOT = process.env.AUTOFIX_WORKTREES || '/home/ubuntu/autofix-worktrees';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
const LOCK_STALE_MS = 90 * 60 * 1000;
// Tools the fixer may use. No npx (blocks prisma db push), no systemctl, no
// unrestricted bash. npm covers test/build; git covers commit/push.
const ALLOWED_TOOLS = [
  'Read', 'Grep', 'Glob', 'Edit', 'Write', 'MultiEdit', 'TodoWrite',
  'Bash(npm:*)', 'Bash(node:*)', 'Bash(git:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)',
].join(',');

// Telegram credentials: reuse the claude-telegram-bridge's .env so there is
// exactly one place these live.
const BRIDGE_ENV = process.env.AUTOFIX_BRIDGE_ENV || '/home/ubuntu/claude-telegram-bridge/.env';

const core = await import(path.join(__dirname, '../dist/services/errorTriageCore.js'));

const log = (...a) => console.log(`[triage ${new Date().toISOString()}]`, ...a);

// ── Telegram ────────────────────────────────────────────────────────────
function telegramCreds() {
  let token = process.env.AUTOFIX_TELEGRAM_TOKEN;
  let chatId = process.env.AUTOFIX_TELEGRAM_CHAT_ID;
  if ((!token || !chatId) && fs.existsSync(BRIDGE_ENV)) {
    const env = fs.readFileSync(BRIDGE_ENV, 'utf8');
    token ||= env.match(/^TELEGRAM_TOKEN=(.+)$/m)?.[1]?.trim();
    chatId ||= env.match(/^ALLOWED_CHAT_IDS=([^,\n]+)/m)?.[1]?.trim();
  }
  return token && chatId ? { token, chatId } : null;
}

async function sendTelegram(text) {
  const creds = telegramCreds();
  if (!creds) { log('telegram creds missing — message dropped:', text.slice(0, 120)); return; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: creds.chatId, text: text.slice(0, 3900) }),
    });
    if (!res.ok) log('telegram send failed:', res.status, await res.text());
  } catch (e) {
    log('telegram send error:', e.message);
  }
}

// ── State + lock ────────────────────────────────────────────────────────
function loadState() {
  try {
    return { ...core.emptyState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return core.emptyState();
  }
}
function saveState(state) {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function acquireLock() {
  try {
    fs.mkdirSync(LOCK_DIR);
    fs.writeFileSync(path.join(LOCK_DIR, 'pid'), String(process.pid));
    return true;
  } catch {
    try {
      const age = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
      if (age > LOCK_STALE_MS) {
        log('stealing stale lock (age', Math.round(age / 60000), 'min)');
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        return acquireLock();
      }
    } catch { /* raced */ }
    return false;
  }
}
const releaseLock = () => fs.rmSync(LOCK_DIR, { recursive: true, force: true });

// ── Claude dispatch ─────────────────────────────────────────────────────
function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function serviceLogTail() {
  try {
    return sh('journalctl -u fitness-ai.service -n 120 --no-pager 2>/dev/null | tail -c 8000');
  } catch { return ''; }
}

function recentJournalFor(fingerprint) {
  try {
    const text = fs.readFileSync(JOURNAL_FILE, 'utf8');
    return core.parseJournalLines(text)
      .filter((r) => r.fingerprint === fingerprint)
      .slice(-5)
      .map((r) => JSON.stringify(r))
      .join('\n');
  } catch { return ''; }
}

function runClaude(prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, [
      '-p', prompt,
      '--output-format', 'json',
      '--allowedTools', ALLOWED_TOOLS,
    ], { cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => {
      log('claude run timed out — killing');
      child.kill('SIGKILL');
    }, RUN_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      let summary = '';
      try {
        const parsed = JSON.parse(out);
        summary = parsed.result ?? '';
      } catch {
        summary = out.slice(-1500);
      }
      resolve({ code, summary, stderr: err.slice(-800) });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, summary: '', stderr: e.message });
    });
  });
}

async function dispatchFix(decision) {
  const { record, branch } = decision;
  const dir = path.join(WORKTREE_ROOT, record.fingerprint);
  log(`dispatching fix for ${record.fingerprint} → ${branch}`);

  fs.mkdirSync(WORKTREE_ROOT, { recursive: true });
  fs.rmSync(dir, { recursive: true, force: true });
  try { sh(`git -C ${REPO} worktree remove --force ${dir}`); } catch { /* not a worktree */ }
  try { sh(`git -C ${REPO} branch -D ${branch}`); } catch { /* no leftover branch */ }

  sh(`git -C ${REPO} fetch origin main`);
  sh(`git -C ${REPO} worktree add ${dir} -b ${branch} origin/main`);
  // Share node_modules; the branch is off main so the Prisma client matches.
  fs.symlinkSync(path.join(REPO, 'backend/node_modules'), path.join(dir, 'backend/node_modules'));

  const prompt = core.buildFixPrompt(record, {
    recentJournal: recentJournalFor(record.fingerprint),
    serviceLog: serviceLogTail(),
  });

  const { code, summary, stderr } = await runClaude(prompt, dir);

  // Verify + guarantee the push (the agent is told to push; belt-and-braces).
  let pushed = false, diffstat = '';
  try {
    const ahead = sh(`git -C ${dir} log origin/main..HEAD --oneline`);
    if (ahead) {
      try { sh(`git -C ${dir} push -u origin ${branch}`); } catch { /* agent already pushed */ }
      pushed = true;
      diffstat = sh(`git -C ${dir} diff origin/main...HEAD --stat | tail -3`);
    }
  } catch (e) {
    log('push/diff check failed:', e.message);
  }

  // Branch (if any) is pushed; the worktree itself is disposable.
  try { sh(`git -C ${REPO} worktree remove --force ${dir}`); } catch { /* leave for inspection */ }

  const status = pushed ? `✅ fix branch pushed: ${branch}` : '⚠️ no commits produced (diagnosis only)';
  await sendTelegram([
    `🤖 Auto-fix run — ${record.fingerprint}`,
    `${record.source} · ${record.route ?? record.op ?? ''} · "${record.message.slice(0, 100)}"`,
    status,
    diffstat,
    '',
    summary.slice(0, 2500),
    code !== 0 ? `\n(exit ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''})` : '',
    '',
    pushed ? 'Review + merge via normal runbook. Nothing was deployed.' : '',
  ].filter(Boolean).join('\n'));

  return pushed;
}

// ── Manual state control ────────────────────────────────────────────────
// After merging (or rejecting) a fix branch, record it so recurrence
// detection works:  node scripts/errorTriage.mjs mark <fingerprint> done|dismissed
function handleMarkCommand() {
  const [cmd, fp, status] = process.argv.slice(2);
  if (cmd !== 'mark') return false;
  if (!fp || !['done', 'dismissed'].includes(status)) {
    console.error('usage: errorTriage.mjs mark <fingerprint> done|dismissed');
    process.exit(2);
  }
  const state = loadState();
  const entry = state.dispatches[fp];
  if (!entry) { console.error(`no dispatch recorded for ${fp}`); process.exit(1); }
  entry.status = status;
  saveState(state);
  console.log(`${fp} → ${status} (branch ${entry.branch})`);
  process.exit(0);
}

// ── Main pass ───────────────────────────────────────────────────────────
async function main() {
  if (handleMarkCommand()) return;
  if (!fs.existsSync(JOURNAL_FILE)) return; // nothing journaled yet
  if (!acquireLock()) { log('another pass is running — skipping'); return; }

  try {
    const state = loadState();
    const stat = fs.statSync(JOURNAL_FILE);
    // Rotation shrank the file → start over from 0.
    if (stat.size < state.offset) state.offset = 0;
    if (stat.size === state.offset) return; // nothing new

    const fd = fs.openSync(JOURNAL_FILE, 'r');
    const buf = Buffer.alloc(stat.size - state.offset);
    fs.readSync(fd, buf, 0, buf.length, state.offset);
    fs.closeSync(fd);
    // Only consume complete lines; a torn tail is re-read next pass.
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return;
    state.offset += Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');

    const records = core.parseJournalLines(text.slice(0, lastNl + 1));
    log(`processing ${records.length} new record(s)`);
    const { decisions } = core.triage(records, state);
    saveState(state); // persist gating decisions before slow dispatch work

    for (const d of decisions) {
      if (d.type === 'dispatch') {
        try {
          await dispatchFix(d);
        } catch (e) {
          log('dispatch failed:', e.message);
          await sendTelegram(`🤖⚠️ Auto-fix dispatch failed for ${d.record.fingerprint}: ${e.message.slice(0, 300)}`);
        }
      } else if (d.type === 'escalate-transient') {
        await sendTelegram(`📈 Transient error spike — ${d.count}x in the last hour\n${d.fingerprint}: "${d.sample.slice(0, 200)}"\nNo dispatch (not a code bug). Check provider status / quotas.`);
      } else if (d.type === 'escalate-recurrence') {
        await sendTelegram(`🔁 Error RECURRED after its fix was merged\n${d.fingerprint} (branch ${d.branch})\n"${d.record.message.slice(0, 200)}"\nMarked dismissed — needs human re-triage.`);
      }
    }
    saveState(state);
  } finally {
    releaseLock();
  }
}

main().catch((e) => { console.error('[triage] fatal:', e); releaseLock(); process.exit(1); });
