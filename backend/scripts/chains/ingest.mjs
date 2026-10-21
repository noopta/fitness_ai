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
import { parseNutritionTables } from './tableParse.mjs';

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
// One row per printed line — the nested items → sizes → modifiers schema made
// the model return one item from a 73-row PDF (Oct 2026); flat rows read all 73.
const SCHEMA = { type: 'OBJECT', properties: { rows: { type: 'ARRAY', items: { type: 'OBJECT', required: ['name'], properties: {
  name: { type: 'STRING', description: 'The item exactly as printed on its row, including any size words in it, e.g. "Fries (Small)", "Grande Caffè Latte", "6-inch Turkey"' },
  calories: NUM, proteinG: NUM, carbsG: NUM, fatG: NUM, fiberG: NUM, sugarG: NUM, sodiumMg: NUM, saturatedFatG: NUM, transFatG: NUM, cholesterolMg: NUM,
} } } } };
const PROMPT = `This is ${chain.name}'s official nutrition information (${country}). List EVERY menu item row in it with the numbers printed on that row.
- One entry per printed row; keep the item name exactly as printed (with its size words).
- Calories in kcal; protein, carbs, fat, fibre, sugar, saturated and trans fat in g; sodium and cholesterol in mg. A value not printed is null — never estimate.
- Line each number up with its column header. Skip allergen-only tables, marketing text and rows without numbers.`;

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

// Two independent reads of the chain's own document (Oct 2026). One model read
// per page went live unchecked (Mary Brown's Taters 437 g fat — printed so in
// their own PDF; Chick-fil-A Waffle 0 g protein/carbs — misread). Now:
//   read A — the table parser (tableParse.mjs), exact, no model; when it can't
//            read the layout, a second model read at a higher thinking level
//   read B — the model
// A row is published only when both reads agree on calories, protein, carbs
// and fat (1 unit or 5%), and it then passes chainNutritionGate in writeMenu.
const RECHECK = '\n- Read EVERY column of each row: wide tables put carbohydrates, fibre, sugars and protein to the right of fat, sodium and cholesterol.';
const askPdf = async (data, level, note = '') => JSON.parse((await genai.models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: PROMPT + note }, { inlineData: { mimeType: 'application/pdf', data } }] }], config: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 60000, thinkingConfig: { thinkingLevel: level } } })).text).rows ?? [];
const askText = async (part, level, note = '') => JSON.parse((await genai.models.generateContent({ model: MODEL, contents: `${PROMPT}${note}\n\n---\n${part}`, config: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 60000, thinkingConfig: { thinkingLevel: level } } })).text).rows ?? [];

async function modelRead(level, note = '') {
  const rows = [];
  if (isPdf) {
    const pages = Number((execFileSync('pdfinfo', ['-'], { input: fetched.buf }).toString().match(/Pages:\s+(\d+)/) ?? [])[1] ?? 1);
    const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chainpdf-'));
    const src = path.join(dirTmp, 'in.pdf'); fs.writeFileSync(src, fetched.buf);
    const pieceOf = (a, b) => {
      const piece = path.join(dirTmp, `p${a}-${b}.pdf`);
      execFileSync('pdfseparate', ['-f', String(a), '-l', String(b), src, path.join(dirTmp, 'pg-%d.pdf')]);
      const files = []; for (let p = a; p <= b; p++) files.push(path.join(dirTmp, `pg-${p}.pdf`));
      if (files.length > 1) execFileSync('pdfunite', [...files, piece]); else fs.copyFileSync(files[0], piece);
      return fs.readFileSync(piece).toString('base64');
    };
    const doRange = async (a, b) => {
      try { rows.push(...await askPdf(pieceOf(a, b), level, note)); }
      catch (e) {
        if (b > a) { for (let p = a; p <= b; p++) await doRange(p, p); return; }
        console.log(`  [model ${level}] page ${a} failed: ${String(e.message).slice(0, 100)}`);
      }
    };
    for (let p = 1; p <= pages; p += 4) await doRange(p, Math.min(pages, p + 3));
    fs.rmSync(dirTmp, { recursive: true, force: true }); // the PDF is never kept
  } else {
    for (const [i, part] of chunksOf(text).entries()) {
      try { rows.push(...await askText(part, level, note)); } catch (e) { console.log(`  [model ${level}] chunk ${i + 1} failed: ${String(e.message).slice(0, 100)}`); }
    }
  }
  return rows.map((r) => ({ name: String(r.name ?? '').trim(), values: Object.fromEntries(['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sodiumMg', 'saturatedFatG', 'transFatG', 'cholesterolMg'].map((k) => [k, n(r[k])])) })).filter((r) => r.name && r.values.calories != null);
}

const parsed = isPdf ? parseNutritionTables(text).map((r) => ({ name: r.name, section: r.section, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, n(v)])) })) : [];
const useParser = parsed.length >= 5;
const readA = useParser ? parsed : await modelRead('LOW', RECHECK); // MEDIUM thinking returned 1 row of 82 (Little Caesars) — same level, column-by-column prompt
const readB = await modelRead('LOW');
const method = useParser ? 'table parser + model read' : 'two model reads';
console.log(`  read A (${useParser ? 'parser' : 'model, column-by-column'}): ${readA.length} rows · read B (model): ${readB.length} rows`);

const agree = (x, y) => x != null && y != null && Math.abs(x - y) <= Math.max(1, 0.05 * Math.max(x, y));
const CORE = ['calories', 'proteinG', 'carbsG', 'fatG'];
const key = (s) => norm(s).replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
const byKeyB = new Map(); for (const r of readB) { const k = key(r.name); if (!byKeyB.has(k)) byKeyB.set(k, []); byKeyB.get(k).push(r); }
const disagreements = []; const agreed = [];
for (const a of readA) {
  const list = byKeyB.get(key(a.name)) ?? [];
  const b = list.find((x) => CORE.every((k) => agree(a.values[k], x.values[k])));
  if (b) {
    list.splice(list.indexOf(b), 1);
    // Micros: the parser's exact value when it read one; otherwise only where both model reads agree.
    const micros = {};
    for (const k of ['fiberG', 'sugarG', 'sodiumMg', 'saturatedFatG', 'transFatG', 'cholesterolMg']) {
      if (useParser && a.values[k] != null && (b.values[k] == null || agree(a.values[k], b.values[k]))) micros[k] = a.values[k];
      else if (agree(a.values[k], b.values[k])) micros[k] = a.values[k];
    }
    agreed.push({ name: a.name, section: a.section, values: a.values, micros });
  } else disagreements.push({ name: a.name, readA: CORE.map((k) => a.values[k]), readB: list[0] ? CORE.map((k) => list[0].values[k]) : null });
}
for (const [, list] of byKeyB) for (const b of list) disagreements.push({ name: b.name, readA: null, readB: CORE.map((k) => b.values[k]) });
{
  const rev = path.join(dataDir, 'menus-review', `${chainId}.${country}.disagree.json`);
  fs.mkdirSync(path.dirname(rev), { recursive: true });
  if (disagreements.length) fs.writeFileSync(rev, JSON.stringify(disagreements, null, 1)); else if (fs.existsSync(rev)) fs.unlinkSync(rev);
  console.log(`  ${method}: ${agreed.length} rows agree, ${disagreements.length} disagree or appear in one read only (→ menus-review)`);
}

// Rows → items with sizes: "Fries (Small)", "Small Fries", "Grande Latte", "6-inch Turkey".
const SIZE_RE = /\b(extra[- ]large|x-?large|kids?|junior|short|tall|grande|venti|trenta|small|medium|large|regular|footlong|6[- ]?inch|snack|value)\b/i;
const items = new Map();
for (const r of agreed) {
  const m = r.name.match(SIZE_RE);
  const size = m ? sizeKey(m[1]) : 'regular';
  const base = (m ? r.name.replace(m[0], ' ') : r.name).replace(/[()]/g, ' ').replace(/\s*[-–,:]\s*$/, '').replace(/\s+/g, ' ').trim();
  let id = slug(base); if (!id) continue;
  let name = base;
  // The same name printed in two sections ("Pepperoni" pizza vs topping) with different numbers: name it by section.
  const clash = items.get(id)?.sizes.find((x) => x.size === size);
  if (clash && clash.calories !== r.values.calories && r.section) { name = `${base} (${r.section.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())})`; id = slug(name); }
  const it = items.get(id) ?? { id, name, ...(r.section ? { category: r.section } : {}), sizes: [] };
  if (!it.sizes.some((x) => x.size === size)) it.sizes.push({ size, label: m?.[1], calories: r.values.calories, proteinG: r.values.proteinG, carbsG: r.values.carbsG, fatG: r.values.fatG, micros: r.micros });
  items.set(id, it);
}
const modifiers = new Map();
const sizeCounts = {};
for (const it of items.values()) for (const s of it.sizes) sizeCounts[s.size] = (sizeCounts[s.size] ?? 0) + 1;
const defaultSize = sizeCounts.medium ? 'medium' : sizeCounts.grande ? 'grande' : sizeCounts.regular ? 'regular' : undefined;
const menu = { chain: chainId, country, source: { url, fetchedAt: new Date().toISOString().slice(0, 10), note: `${isPdf ? 'PDF' : 'page'} → ${method} (${MODEL}), published only where both agree; numbers only` }, ...(defaultSize ? { defaultSize } : {}), items: [...items.values()], modifiers: [...modifiers.values()] };
if (!menu.items.length) { console.log(`${chainId}.${country}: no items with calories extracted — not written`); process.exit(0); }
// Quality gate (shared): a partial or garbled extraction never goes live — it waits in menus-review/.
writeMenu(menu);
process.exit(0);
