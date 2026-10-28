// Catalog fields for an exercise the catalog doesn't know ("landmine
// meadows-style row", "sled drag backwards"), so it can be swapped FROM and
// ranked like any other. The model fills the same fields as catalog.ts, from
// fixed lists; the result is validated and clamped, then cached by name —
// classified once, the same answer every time after.

import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { chatComplete } from '../chatClient.js';
import { ALL_REGIONS, ALL_PATTERNS, ALL_JOINTS, ALL_ENERGY, ALL_EQUIPMENT, type ExerciseProfile, type Region } from './catalog.js';
import { normalizeName, resolveProfile } from './match.js';

const prisma = new PrismaClient();

const Schema = z.object({
  mod: z.enum(['strength', 'power', 'cardio', 'mobility']),
  pattern: z.enum(ALL_PATTERNS as [string, ...string[]]),
  m: z.record(z.string(), z.number()),
  prof: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]),
  load: z.number(), demand: z.number(), skill: z.number(),
  joints: z.record(z.string(), z.number()),
  energy: z.array(z.string()).min(1),
  eq: z.enum(ALL_EQUIPMENT as [string, ...string[]]),
  uni: z.boolean().optional(),
});

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Validate + clamp a model answer into an ExerciseProfile, or null if unusable. */
export function toProfile(name: string, raw: unknown): ExerciseProfile | null {
  const r = Schema.safeParse(raw);
  if (!r.success) return null;
  const v = r.data;
  const m: Partial<Record<Region, number>> = {};
  for (const [k, w] of Object.entries(v.m)) if ((ALL_REGIONS as string[]).includes(k) && w > 0) m[k as Region] = w;
  const total = Object.values(m).reduce((a, b) => a + (b ?? 0), 0);
  if (!total) return null;
  for (const k of Object.keys(m) as Region[]) m[k] = Math.round((m[k]! / total) * 100) / 100;
  const joints: ExerciseProfile['joints'] = {};
  for (const [k, w] of Object.entries(v.joints)) if ((ALL_JOINTS as string[]).includes(k) && w >= 1) joints[k as keyof typeof joints] = clamp(w, 1, 3);
  const energy = v.energy.filter((e) => (ALL_ENERGY as string[]).includes(e)) as ExerciseProfile['energy'];
  if (!energy.length) return null;
  return {
    name: name.trim().replace(/\s+/g, ' '),
    mod: v.mod, pattern: v.pattern as ExerciseProfile['pattern'], m,
    prof: v.mod === 'cardio' || v.mod === 'mobility' ? null : v.prof,
    load: clamp(v.load, 1, 5), demand: clamp(v.demand, 1, 5), skill: clamp(v.skill, 1, 5),
    joints, energy, eq: v.eq as ExerciseProfile['eq'], ...(v.uni ? { uni: true } : {}),
  };
}

const PROMPT = (name: string) => `Describe this exercise for an exercise-substitution engine. Exercise: "${name}"

Respond with JSON only, using ONLY these values:
{
  "mod": "strength" | "power" | "cardio" | "mobility",
  "pattern": one of ${ALL_PATTERNS.join(', ')},
  "m": { region: weight } — the muscle regions it trains, weights summing to 1. Regions: ${ALL_REGIONS.join(', ')},
  "prof": 0 (hardest when the muscle is shortened) | 1 (mid-range) | 2 (hardest in the stretched position) | null for cardio/mobility,
  "load": 1-5 (how heavy it can realistically be loaded: leg press 5, lateral raise 1),
  "demand": 1-5 (systemic fatigue: deadlift 5, curl 1),
  "skill": 1-5 (technique needed),
  "joints": { joint: 1-3 } stress on these joints, only where meaningful: ${ALL_JOINTS.join(', ')},
  "energy": array of ${ALL_ENERGY.join(', ')},
  "eq": one of ${ALL_EQUIPMENT.join(', ')},
  "uni": true if done one side at a time
}`;

/** Cached profiles for these names (normalized name → profile). */
export async function loadClassified(names: string[]): Promise<Map<string, ExerciseProfile>> {
  const keys = [...new Set(names.map(normalizeName).filter(Boolean))];
  const out = new Map<string, ExerciseProfile>();
  if (!keys.length) return out;
  try {
    const rows = await (prisma as any).exerciseProfileCache.findMany({ where: { name: { in: keys } } });
    for (const r of rows) { try { out.set(r.name, JSON.parse(r.json)); } catch { /* skip */ } }
  } catch { /* table missing: nothing cached */ }
  return out;
}

/**
 * The profile for a name: the catalog, else the cache, else classified now
 * (and cached). Null when the model is unavailable or answers badly — the
 * caller then offers search and "Ask Anakin" instead of ranked swaps.
 */
export async function profileFor(name: string, opts: { timeoutMs?: number } = {}): Promise<ExerciseProfile | null> {
  const known = resolveProfile(name);
  if (known) return known;
  const key = normalizeName(name);
  if (!key) return null;
  const cached = (await loadClassified([name])).get(key);
  if (cached) return cached;
  try {
    const res = await chatComplete({ messages: [{ role: 'user', content: PROMPT(name) }], response_format: { type: 'json_object' }, temperature: 0 }, { timeoutMs: opts.timeoutMs ?? 8000 });
    const profile = toProfile(name, JSON.parse(res.choices[0]?.message?.content || '{}'));
    if (!profile) return null;
    await (prisma as any).exerciseProfileCache.upsert({ where: { name: key }, create: { name: key, json: JSON.stringify(profile) }, update: {} }).catch(() => {});
    return profile;
  } catch (err: any) {
    console.warn('[swap] classify failed:', err?.message ?? err);
    return null;
  }
}
