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

// ── Units the user actually used (Oct 2026) ─────────────────────────────────
// Weights used to be read in the account's unit, so "I'm 170" (lb) from a
// user whose account said metric saved 170 kg. Tools that take a weight now
// take the unit the user wrote, and a body weight far from the last known one
// is checked before it's saved.

/** Schema field: the unit the user wrote. */
export const UNIT_FIELD = { type: 'string', enum: ['lb', 'kg'], description: 'The unit the USER used for these numbers ("lb" or "kg") — from their words, not their settings. If they gave a bare number, use their usual unit.' };

/** 'metric' | 'imperial' from the tool's unit field, else the account's. */
export function unitArg(v: unknown, fallback: 'metric' | 'imperial'): 'metric' | 'imperial' {
  const s = str(v).toLowerCase();
  if (/^(kg|kgs|kilo|kilos|kilograms?|metric)$/.test(s)) return 'metric';
  if (/^(lb|lbs|pounds?|imperial)$/.test(s)) return 'imperial';
  return fallback;
}

/**
 * Pure: a body weight to question before saving — outside 30–300 kg, or more
 * than 12% from the last known weight (a lb/kg mix-up is ~2.2×). Returns the
 * question to ask, or null when it's plausible.
 */
export function implausibleBodyWeight(kg: number, lastKg: number | null, unit: 'metric' | 'imperial'): string | null {
  const show = (x: number) => (unit === 'metric' ? `${Math.round(x * 10) / 10} kg` : `${Math.round(x * 2.20462)} lb`);
  const other = (x: number) => (unit === 'metric' ? `${Math.round(x * 2.20462)} lb` : `${Math.round(x * 10) / 10} kg`);
  if (!(kg >= 30 && kg <= 300)) return `${show(kg)} is outside a plausible body weight — check the number and the unit (did they mean ${other(kg)}?).`;
  if (lastKg && Math.abs(kg - lastKg) / lastKg > 0.12) {
    return `${show(kg)} is ${Math.round(Math.abs(kg - lastKg) / lastKg * 100)}% from their last known weight (${show(lastKg)}). Ask them to confirm the number and unit; if they meant it, call again with confirmed: true.`;
  }
  return null;
}
