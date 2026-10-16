/**
 * In-memory debug log — readable from the Settings debug panel.
 * Survives the JS session; cleared on app restart.
 * Use iapLog() / iapWarn() / iapError() instead of console in IAP code.
 */

import { log } from './log';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;       // HH:MM:SS
  level: LogLevel;
  tag: string;
  msg: string;
}

const MAX_ENTRIES = 200;
const entries: LogEntry[] = [];
const listeners: Array<() => void> = [];

function timestamp(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

export function addLog(level: LogLevel, tag: string, ...args: unknown[]): void {
  const msg = args
    .map(a => (typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a)))
    .join(' ');
  const entry: LogEntry = { ts: timestamp(), level, tag, msg };

  if (entries.length >= MAX_ENTRIES) entries.shift();
  entries.push(entry);

  // Mirror to console so Metro still shows them — dev only: release builds
  // would otherwise write purchase/receipt details to the device log.
  const prefix = `[${tag}]`;
  if (level === 'error') log.error(prefix, msg);
  else if (level === 'warn') log.warn(prefix, msg);
  else log.info(prefix, msg);

  listeners.forEach(fn => fn());
}

export function getLogs(): readonly LogEntry[] {
  return entries;
}

export function clearLogs(): void {
  entries.length = 0;
  listeners.forEach(fn => fn());
}

export function subscribeToLogs(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i !== -1) listeners.splice(i, 1);
  };
}

// ─── Convenience helpers for IAP ─────────────────────────────────────────────
export const iapLog   = (...a: unknown[]) => addLog('info',  'IAP', ...a);
export const iapWarn  = (...a: unknown[]) => addLog('warn',  'IAP', ...a);
export const iapError = (...a: unknown[]) => addLog('error', 'IAP', ...a);
