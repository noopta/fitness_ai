// Read A for a nutrition PDF: a plain parser, no model (Oct 2026).
//
// `pdftotext -layout` keeps a nutrition table's columns lined up by character
// position. We find the header rows (the ones naming Calories, Fat, Carbs,
// Protein…), work out where each column sits, and give every number in a row
// to the column it sits under. Deterministic and exact where the layout is
// clean; where it isn't, rows are skipped, never guessed. The model read
// (read B) must agree with this before an item is published.

const KEYS = [
  ['transFatG', /\btrans\b/],
  ['saturatedFatG', /\bsat(urated)?\b|\bsat\.|satur/],
  ['cholesterolMg', /chol/],
  ['sodiumMg', /sodium|\bna\b/],
  ['fiberG', /fib(re|er)|dietary|dietry/],
  ['sugarG', /sugar/],
  ['proteinG', /prot/],
  ['carbsG', /carb/],
  ['fatG', /\bfat\b|lipid|\btotal fat/],
  ['calories', /calor|kcal|energy/],
];
const NUM = /^(?:<\s*)?\d+(?:[.,]\d+)?$/;

/** Words with their character spans on one line. */
function tokens(line) {
  const out = [];
  for (const m of line.matchAll(/\S+/g)) out.push({ text: m[0], start: m.index, end: m.index + m[0].length, mid: m.index + m[0].length / 2 });
  return out;
}

const UNIT = /^\(?(k?cal|kj|g|mg|mcg|µg|%|%dv|iu)\)?$/i;

/**
 * Column centres for a header line and the lines under it. When a units row
 * ("(g) (kcal) (mg)…") sits under the header, each unit marks one column
 * exactly — header words go to the nearest unit (Mary Brown's prints "Trans
 * Fat Cholesterol" with single spaces). Otherwise phrases split on 2+ spaces.
 */
function headerColumns(header, below) {
  const unitLine = below.slice(0, 3).find((l) => tokens(l).filter((t) => UNIT.test(t.text)).length >= 4);
  let centers;
  if (unitLine) centers = tokens(unitLine).filter((t) => UNIT.test(t.text)).map((t) => ({ start: t.start, end: t.end, mid: t.mid, words: [t.text] }));
  else centers = [...header.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, mid: m.index + m[0].length / 2, words: [] }));
  const wordLines = [header, ...(unitLine ? below.slice(0, below.indexOf(unitLine) + 1) : [])];
  for (const l of wordLines) for (const w of tokens(l)) {
    if (UNIT.test(w.text) && l === unitLine) continue;
    let best = null; let d = Infinity;
    for (const c of centers) { const dd = Math.abs(c.mid - w.mid); if (dd < d) { d = dd; best = c; } }
    if (best && d <= 14) { best.words.push(w.text); best.start = Math.min(best.start, w.start); best.end = Math.max(best.end, w.end); }
  }
  const cols = [];
  cols.ordered = [];
  for (const c of centers) {
    const label = c.words.join(' ').toLowerCase();
    if (/calories\s+from\s+fat|fat\s+cal/.test(label)) continue;
    if (/%|daily value|\bdv\b/.test(label) && !/calor|kcal/.test(label)) continue;
    // Several nutrient words in one label (a merged phrase): the word nearest the centre wins below.
    const key = KEYS.find(([, re]) => re.test(label))?.[0];
    const dup = key && cols.some((x) => x.key === key);
    if (key && !dup) cols.push({ key, start: c.start, end: c.end, mid: c.mid, label });
    if (unitLine) cols.ordered.push(key && !dup ? key : null);
  }
  return cols;
}

const isHeaderLine = (l) => { const t = l.toLowerCase(); return /calor|kcal/.test(t) && [/fat/, /carb/, /prot/, /sodium/].filter((r) => r.test(t)).length >= 2; };

/**
 * Parse every table in the layout text. Returns rows: { name, values: { calories, fatG, … } }.
 * `minCols`: a table needs calories, fat, carbs and protein columns to be read at all.
 */
export function parseNutritionTables(text) {
  const lines = text.split('\n');
  const rows = [];
  let cols = null;
  let pendingName = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeaderLine(line)) {
      const c = headerColumns(line, lines.slice(i + 1, i + 4));
      cols = ['calories', 'fatG', 'carbsG', 'proteinG'].every((k) => c.some((x) => x.key === k)) ? c : null;
      pendingName = '';
      continue;
    }
    if (!cols) continue;
    const toks = tokens(line);
    const firstCol = Math.min(...cols.map((c) => c.start)) - 6;
    const nums = toks.filter((t) => NUM.test(t.text.replace(/[*†‡]+$/, '')) && t.mid >= firstCol);
    if (nums.length < 4) {
      // A name that wraps onto its own line before (or after) the numbers.
      const words = toks.filter((t) => t.end < firstCol).map((t) => t.text).join(' ').trim();
      if (words && !/^[A-Z &]+$/.test(words) && rows.length && !nums.length && lines[i - 1] && tokens(lines[i - 1]).filter((t) => NUM.test(t.text)).length >= 4) rows[rows.length - 1].name += ` ${words}`;
      else pendingName = words && nums.length === 0 ? words : '';
      continue;
    }
    const name = (toks.filter((t) => t.end <= nums[0].start).map((t) => t.text).join(' ').replace(/\s+\d+(\.\d+)?\s*(g|oz|ml|serving|servings|piece|pieces|each)?$/i, '').trim() || pendingName).trim();
    pendingName = '';
    if (!name) continue;
    const values = {};
    // Column ORDER is stable across pages even when pdftotext shifts positions
    // (Mary Brown's page 2 continues the table narrower, with no header):
    // the last N numbers in the row are the header's N unit columns, in order.
    const ord = cols.ordered ?? [];
    const allNums = toks.filter((t) => NUM.test(t.text.replace(/[*†‡]+$/, '')));
    if (ord.length >= 4 && allNums.length >= ord.length) {
      const tail = allNums.slice(-ord.length);
      tail.forEach((t, k) => { if (ord[k]) values[ord[k]] = Number(t.text.replace(/^<\s*/, '').replace(',', '.').replace(/[*†‡]+$/, '')); });
      const nm = toks.filter((t) => t.end <= tail[0].start).map((t) => t.text).join(' ');
      const clean = nm.replace(/\s+\d+(\.\d+)?\s*(serving|servings|piece|pieces|container|containers|each|order|cup|cups|packet|packets|pkt|portion|portions|slice|slices|oz|g)\b.*$/i, '').trim();
      if (clean && values.calories != null) rows.push({ name: clean, values });
      pendingName = '';
      continue;
    }
    for (const t of nums) {
      // Nearest column centre, within half the gap to the next column.
      let best = null; let bestD = Infinity;
      for (const c of cols) { const d = Math.abs(t.mid - c.mid); if (d < bestD) { best = c; bestD = d; } }
      const span = Math.max(4, (best.end - best.start) / 2 + 4);
      if (best && bestD <= span && values[best.key] == null) values[best.key] = Number(t.text.replace(/^<\s*/, '').replace(',', '.').replace(/[*†‡]+$/, ''));
    }
    if (values.calories != null) rows.push({ name: name.replace(/\s{2,}.*$/, '').trim(), values });
  }
  return rows;
}
