// A user's own correction of a looked-up item sticks — for that user. When
// someone fixes the calories on a meal that was one looked-up item ("Starbucks
// Caramel Protein Latte Grande: from starbucks.com"), their numbers win the
// next time they log it. Kept per user on purpose: their drink may be
// customized differently from everyone else's. Corrections are logged too, so
// repeated ones across users can be reviewed and fixed at the source.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { norm, productRecall } from './nameSearch.js';
import { mentionsBrand } from './brandedLookup.js';

export interface Override { what: string; calories: number; proteinG: number; carbsG: number; fatG: number; at: string; times: number }

const FILE = () => process.env.FOOD_OVERRIDES_PATH || join(process.cwd(), '.runtime', 'food-overrides.json');
let data: Record<string, Record<string, Override>> | null = null;

function load(): Record<string, Record<string, Override>> {
  if (data) return data;
  try { data = JSON.parse(readFileSync(FILE(), 'utf8')); } catch { data = {}; }
  return data!;
}
function save() {
  try { mkdirSync(dirname(FILE()), { recursive: true }); writeFileSync(FILE(), JSON.stringify(data ?? {})); } catch { /* best effort */ }
}
export function _resetOverridesForTests() { data = {}; }

/** The one looked-up item a meal's notes describe ("X: from Y"), or null if it's several. */
export function singleLookedUpItem(notes: string | null | undefined): string | null {
  const segs = (notes ?? '').split(' · ')[0].split('; ').filter((s) => /: from /.test(s));
  return segs.length === 1 ? segs[0].split(': from ')[0].trim() : null;
}

/** Remember a user's correction of a single looked-up item. */
export function recordOverride(userId: string, what: string, m: { calories: number; proteinG: number; carbsG: number; fatG: number }) {
  const all = load();
  const mine = (all[userId] ??= {});
  const key = norm(what);
  mine[key] = { what, calories: Math.round(m.calories), proteinG: m.proteinG, carbsG: m.carbsG, fatG: m.fatG, at: new Date().toISOString(), times: (mine[key]?.times ?? 0) + 1 };
  save();
}

/** The user's correction for this item, if they've made one. Same brand, same words both ways. */
export function findOverride(userId: string, item: { brand: string; product: string; size: string | null }): Override | null {
  const mine = load()[userId];
  if (!mine) return null;
  const want = [item.brand, item.product, item.size].filter(Boolean).join(' ');
  for (const o of Object.values(mine)) {
    if (!mentionsBrand(o.what, item.brand)) continue;
    if (productRecall({ brand: item.brand, product: want }, o.what) >= 0.8 && productRecall({ brand: item.brand, product: o.what }, want) >= 0.8) return o;
  }
  return null;
}
