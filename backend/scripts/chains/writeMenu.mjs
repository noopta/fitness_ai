// Shared writer: quality gate, then data/chains/menus (live) or menus-review.
import fs from 'node:fs';
import path from 'node:path';
export function writeMenu(menu, { minItems = 8 } = {}) {
  const dataDir = path.join(process.cwd(), 'data', 'chains');
  let mismatch = 0; let sizesN = 0;
  for (const it of menu.items) for (const s of it.sizes) { sizesN++; const k = 4 * s.proteinG + 4 * s.carbsG + 9 * s.fatG; if (s.calories > 40 && k > 0 && Math.abs(k - s.calories) / s.calories > 0.35) mismatch++; }
  const ok = menu.items.length >= minItems && mismatch / Math.max(1, sizesN) <= 0.15;
  const out = path.join(dataDir, ok ? 'menus' : 'menus-review', `${menu.chain}.${menu.country}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(menu, null, 1));
  if (ok) { const stale = path.join(dataDir, 'menus-review', `${menu.chain}.${menu.country}.json`); if (fs.existsSync(stale)) fs.unlinkSync(stale); }
  console.log(`${menu.chain}.${menu.country}: ${ok ? 'LIVE' : 'REVIEW'} ${menu.items.length} items, ${sizesN} sizes, ${(menu.modifiers ?? []).length} modifiers, ${mismatch} macro mismatches → ${path.relative(process.cwd(), out)}`);
  return ok;
}
export const SIZE_OF = (name) => { const m = String(name).toLowerCase().match(/\b(kids|small|medium|large|regular|junior|snack)\b/); return m ? m[1] : 'regular'; };
export const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null; };
