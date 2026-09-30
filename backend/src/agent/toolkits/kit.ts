// Helpers every toolkit uses: a typed tool constructor, a user-settings read,
// and small card builders.

import { PrismaClient } from '@prisma/client';
import type { AgentTool, ToolCtx } from '../types.js';
import type { CardDraft, CardRow } from '../cards/types.js';

export const prisma = new PrismaClient();

export function tool(t: AgentTool): AgentTool { return t; }

export const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v.trim() : v == null ? d : String(v).trim());
export const numOr = (v: unknown, d: number | null = null): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
export const dateArg = (v: unknown, ctx: ToolCtx): string => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ctx.today;
};

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** An error card (design §6.5): one sentence and one action. */
export function errorCard(fn: string, label: string, message: string, retry?: string): CardDraft {
  return { fn, pattern: 'glance', rule: 'show', meta: { label }, empty: message, ...(retry ? { note: retry } : {}) };
}

export function rows(list: [string, string | number | null | undefined, Partial<CardRow>?][]): CardRow[] {
  return list.filter(([, v]) => v !== undefined).map(([key, value, extra]) => ({ key, value: value == null ? '—' : String(value), ...(extra ?? {}) }));
}

export const schema = (properties: Record<string, any>, required: string[] = []) => ({ type: 'object' as const, properties, ...(required.length ? { required } : {}) });
