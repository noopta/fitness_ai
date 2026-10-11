// Ingest a chain's official, published nutrition into data/chains/menus/<id>.<CC>.json.
//
//   node scripts/chains/ingest.mjs <chainId> <US|CA> [url]
//
// Facts only: item names, sizes, calories, macros and label micros the source
// STATES, plus the source URL and date. No descriptions, images or files kept.
// Fetching follows politeFetch.mjs (robots.txt, honest UA, 2 s/host, stop on
// any block). Chains in data/chains/disabled.json are never fetched.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { GoogleGenAI } from '@google/genai';
import { politeFetch, BlockedError } from './politeFetch.mjs';
import { writeMenu } from './writeMenu.mjs';

const [chainId, country, urlArg] = process.argv.slice(2);
if (!chainId || !country) { console.error('usage: ingest.mjs <chainId> <US|CA> [url]'); process.exit(2); }
const root = process.cwd();
const dataDir = path.join(root, 'data', 'chains');
const registry = JSON.parse(fs.readFileSync(path.join(dataDir, 'registry.json'), 'utf8'));
const disabled = fs.existsSync(path.join(dataDir, 'disabled.json')) ? JSON.parse(fs.readFileSync(path.join(dataDir, 'disabled.json'), 'utf8')) : [];
const chain = registry.find((c) => c.id === chainId);
if (!chain) { console.error(`unknown chain ${chainId}`); process.exit(2); }
if (disabled.includes(chainId)) { console.log(`${chainId}: disabled — skipped`); process.exit(0); }
const url = urlArg ?? chain.nutritionUrl?.[country];
if (!url) { console.log(`${chainId}.${country}: no nutrition URL — skipped`); process.exit(0); }

const MODEL = process.env.CHAIN_EXTRACT_MODEL || 'gemini-3.8-flash';
const genai = new GoogleGenAI({ vertexai: true, project: process.env.GCP_PROJECT_NUMBER ?? '656267185967', location: 'global' });

const NUM = { type: 'NUMBER', nullable: true };
const MACROS = { calories: NUM, proteinG: NUM, carbsG: NUM, fatG: NUM, fiberG: NUM, sugarG: NUM, sodiumMg: NUM, saturatedFatG: NUM, cholesterolMg: NUM };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: { type: 'ARRAY', items: { type: 'OBJECT', required: ['name', 'sizes'], properties: {
      name: { type: 'STRING' }, category: { type: 'STRING', nullable: true },
      sizes: { type: 'ARRAY', items: { type: 'OBJECT', required: ['size'], properties: { size: { type: 'STRING', description: 'Menu size as printed (Small/Medium/Large/Tall/Grande/Venti/6-inch/Footlong/Regular…), or "Regular" if only one' }, ...MACROS } } },
    } } },
    modifiers: { type: 'ARRAY', items: { type: 'OBJECT', required: ['name'], properties: {
      name: { type: 'STRING' }, group: { type: 'STRING', nullable: true, description: 'syrup | milk | sauce | topping | cheese | protein | bread | dressing | add-on | other' },
      unit: { type: 'STRING', nullable: true, description: 'what one serving is, as printed: "1 pump", "1 slice", "1 portion", "per 6-inch"' }, ...MACROS,
    } } },
  },
};
const PROMPT = `This is ${chain.name}'s official nutrition information (${country}). Extract ONLY numbers that are printed in it.
- Every menu item with its published values, one entry per size it is sold in (use the size names as printed).
- Add-ons, sauces, syrups, dressings, milk options, toppings, extra cheese/protein, breads etc. that are listed with their own values go in "modifiers" with the unit as printed.
- Calories in kcal; protein/carbs/fat/fibre/sugar/saturated fat in g; sodium and cholesterol in mg. If a value is not printed, use null — never estimate.
- Skip allergen-only tables, marketing text and anything without numbers.`;

function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|tr|li|p|div|h\d)[^>]*>/gi, '\n').replace(/<\/(td|th)>/gi, ' | ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function chunksOf(text, size = 24000) {
  const lines = text.split('\n'); const out = []; let cur = '';
  for (const l of lines) { if ((cur + l).length > size && cur) { out.push(cur); cur = ''; } cur += l + '\n'; }
  if (cur.trim()) out.push(cur);
  return out;
}

async function extract(text) {
  const r = await genai.models.generateContent({ model: MODEL, contents: `${PROMPT}\n\n---\n${text}`, config: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 60000, thinkingConfig: { thinkingLevel: 'LOW' } } });
  return JSON.parse(r.text);
}

const SIZE_WORDS = ['extra large', 'kids', 'short', 'tall', 'grande', 'venti', 'trenta', 'small', 'medium', 'large', 'regular', 'junior', 'footlong', '6 inch', 'single', 'double', 'triple', 'snack', 'value'];
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const sizeKey = (s) => { const n = ` ${norm(s).replace(/\b6\s?in(ch)?\b|\bsix inch\b/, '6 inch').replace(/\bfoot ?long\b/, 'footlong')} `; return SIZE_WORDS.find((w) => n.includes(` ${w} `)) ?? (norm(s) || 'regular'); };
const slug = (s) => norm(s).replace(/ /g, '-').slice(0, 60);
const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null);
const micros = (o) => Object.fromEntries(['fiberG', 'sugarG', 'sodiumMg', 'saturatedFatG', 'cholesterolMg'].map((k) => [k, n(o[k])]).filter(([, v]) => v != null));

let fetched;
try { fetched = await politeFetch(url); } catch (e) {
  if (e instanceof BlockedError) { console.log(`${chainId}.${country}: ${e.why} — skipped (no workaround by policy)`); process.exit(0); }
  throw e;
}
// A hub page that links the chain's nutrition PDF: follow the PDF for this country.
if (!/pdf/i.test(fetched.type) && /html/i.test(fetched.type)) {
  const html = fetched.buf.toString();
  // Links can sit in an href or in the page's embedded JSON, often protocol-relative ("//assets…").
  const links = [...new Set([...html.matchAll(/["']((?:https?:)?\/\/[^"'\s]+?\.pdf[^"'\s]*|\/[^"'\s]+?\.pdf[^"'\s]*)["']/gi)].map((m) => new URL(m[1].replace(/&amp;/g, '&').replace(/\\u002F/g, '/'), fetched.finalUrl).href))]
    .filter((h) => /nutri/i.test(h));
  const local = country === 'CA' ? links.filter((h) => /(^|[^a-z])(can|ca|canada|en-ca)([^a-z]|$)/i.test(h)) : links.filter((h) => /(^|[^a-z])(us|usa|en-us)([^a-z]|$)/i.test(h));
  const pick = (local[0] ?? links[0]);
  if (pick && htmlToText(html).length < 20000) {
    console.log(`  following linked nutrition PDF: ${pick}`);
    try { fetched = await politeFetch(pick); } catch (e) { if (e instanceof BlockedError) { console.log(`${chainId}.${country}: ${e.why} — skipped`); process.exit(0); } throw e; }
  }
}
let text;
const isPdf = /pdf/i.test(fetched.type) || fetched.buf.subarray(0, 5).toString() === '%PDF-';
if (isPdf) {
  const tmp = path.join(os.tmpdir(), `chain-${chainId}-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, fetched.buf);
  text = execFileSync('pdftotext', ['-layout', tmp, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString();
  fs.unlinkSync(tmp); // the file itself is never kept
} else if (/json/i.test(fetched.type)) text = fetched.buf.toString();
else text = htmlToText(fetched.buf.toString());
if (!(isPdf && process.env.CHAIN_PDF_MODE !== 'text') && text.replace(/\s/g, '').length < 800) { console.log(`${chainId}.${country}: page has no readable nutrition text (likely a JS app) — needs an adapter, skipped`); process.exit(0); }

// PDFs go to the model as the PDF itself (tables read as laid out — text
// conversion scrambled columns: 20–75% macro mismatches). Split into page
// ranges so long guides don't hit the output limit. Text is the fallback.
let parts = chunksOf(text);
const results = [];
if (isPdf && process.env.CHAIN_PDF_MODE !== 'text') {
  const pages = Number((execFileSync('pdfinfo', ['-'], { input: fetched.buf }).toString().match(/Pages:\s+(\d+)/) ?? [])[1] ?? 1);
  const per = 4; const ranges = [];
  for (let p = 1; p <= pages; p += per) ranges.push([p, Math.min(pages, p + per - 1)]);
  parts = ranges;
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chainpdf-'));
  const src = path.join(dirTmp, 'in.pdf'); fs.writeFileSync(src, fetched.buf);
  const pieceOf = (a, b) => {
    const piece = path.join(dirTmp, `p${a}-${b}.pdf`);
    execFileSync('pdfseparate', ['-f', String(a), '-l', String(b), src, path.join(dirTmp, 'pg-%d.pdf')]);
    const files = []; for (let p = a; p <= b; p++) files.push(path.join(dirTmp, `pg-${p}.pdf`));
    if (files.length > 1) execFileSync('pdfunite', [...files, piece]); else fs.copyFileSync(files[0], piece);
    return fs.readFileSync(piece).toString('base64');
  };
  const ask = async (data, level, note = '') => JSON.parse((await genai.models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: PROMPT + note }, { inlineData: { mimeType: 'application/pdf', data } }] }], config: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 60000, thinkingConfig: { thinkingLevel: level } } })).text);
  // Self-check: kcal should be close to 4·protein + 4·carbs + 9·fat. A chunk
  // where many rows aren't was misread (skipped or shifted columns) — redo it.
  const badRate = (r) => { let n = 0, bad = 0; for (const it of r.items ?? []) for (const z of it.sizes ?? []) { if (!(z.calories > 40)) continue; n++; const k = 4 * (z.proteinG ?? 0) + 4 * (z.carbsG ?? 0) + 9 * (z.fatG ?? 0); if (!k || Math.abs(k - z.calories) / z.calories > 0.35) bad++; } return n ? bad / n : 0; };
  const RECHECK = '\n- Read EVERY column of each row: wide tables put carbohydrates, fibre, sugars and protein to the right of fat, sodium and cholesterol. Line each number up with its column header; do not leave a printed value null.';
  const doRange = async (a, b) => {
    const data = pieceOf(a, b);
    let r;
    try { r = await ask(data, 'LOW'); }
    catch (e) {
      if (b > a) { console.log(`  pages ${a}-${b}: ${String(e.message).slice(0, 60)} — one page at a time`); for (let p = a; p <= b; p++) await doRange(p, p); return; }
      console.log(`  page ${a} failed: ${String(e.message).slice(0, 120)}`); return;
    }
    if (badRate(r) > 0.25) {
      try { const r2 = await ask(data, 'MEDIUM', RECHECK); console.log(`  pages ${a}-${b}: ${Math.round(badRate(r) * 100)}% rows inconsistent → recheck ${Math.round(badRate(r2) * 100)}%`); if (badRate(r2) < badRate(r)) r = r2; } catch { /* keep first read */ }
    }
    results.push(r);
  };
  for (const [a, b] of ranges) await doRange(a, b);
  fs.rmSync(dirTmp, { recursive: true, force: true }); // the PDF is never kept
} else {
  for (const [i, part] of parts.entries()) {
    try { results.push(await extract(part)); } catch (e) { console.log(`  chunk ${i + 1}/${parts.length} failed: ${String(e.message).slice(0, 120)}`); }
  }
}
const items = new Map(); const modifiers = new Map();
for (const r of results) {
  for (const it of r.items ?? []) {
    const id = slug(it.name); if (!id) continue;
    const sizes = (it.sizes ?? []).map((s) => ({ size: sizeKey(s.size), label: String(s.size ?? '').slice(0, 40) || undefined, calories: n(s.calories), proteinG: n(s.proteinG) ?? 0, carbsG: n(s.carbsG) ?? 0, fatG: n(s.fatG) ?? 0, micros: micros(s) })).filter((s) => s.calories != null);
    if (!sizes.length) continue;
    const cur = items.get(id);
    if (cur) { for (const s of sizes) if (!cur.sizes.some((x) => x.size === s.size)) cur.sizes.push(s); }
    else items.set(id, { id, name: String(it.name).trim().slice(0, 100), ...(it.category ? { category: String(it.category).slice(0, 40) } : {}), sizes });
  }
  for (const m of r.modifiers ?? []) {
    const id = slug(m.name); if (!id || n(m.calories) == null || modifiers.has(id)) continue;
    modifiers.set(id, { id, name: String(m.name).trim().slice(0, 80), ...(m.group ? { group: String(m.group).toLowerCase().slice(0, 20) } : {}), ...(m.unit ? { unit: String(m.unit).slice(0, 30) } : {}), per: { calories: n(m.calories), proteinG: n(m.proteinG) ?? 0, carbsG: n(m.carbsG) ?? 0, fatG: n(m.fatG) ?? 0, micros: micros(m) } });
  }
}
const sizeCounts = {};
for (const it of items.values()) for (const s of it.sizes) sizeCounts[s.size] = (sizeCounts[s.size] ?? 0) + 1;
const defaultSize = sizeCounts.medium ? 'medium' : sizeCounts.grande ? 'grande' : sizeCounts.regular ? 'regular' : undefined;
const menu = { chain: chainId, country, source: { url, fetchedAt: new Date().toISOString().slice(0, 10), note: `${isPdf ? 'PDF' : 'page'} → ${MODEL} extraction; numbers only` }, ...(defaultSize ? { defaultSize } : {}), items: [...items.values()], modifiers: [...modifiers.values()] };
if (!menu.items.length) { console.log(`${chainId}.${country}: no items with calories extracted — not written`); process.exit(0); }
// Quality gate (shared): a partial or garbled extraction never goes live — it waits in menus-review/.
writeMenu(menu);
process.exit(0);
