// A small .xlsx reader for the spreadsheet import. An .xlsx file is a zip of
// XML parts; this reads the cell values of every sheet and nothing else (no
// formulas, styles or merged ranges). Inflation uses the browser's own
// DecompressionStream, so there is no library to ship.
//
// Dates are the one thing that needs the styles part: Excel stores a date as
// a day count and only the cell's number format says it is a date. Those
// cells come out as YYYY-MM-DD so day/month order is never ambiguous.

const MAX_ROWS = 20_001; // one past the server's limit, so the server reports the truncation
const MAX_COLS = 60;
const MAX_PART_BYTES = 80 * 1024 * 1024;

export class XlsxError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new XlsxError('This browser cannot open .xlsx files');
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(data).catch(() => {});
  void writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PART_BYTES) throw new XlsxError('Sheet too large');
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** The named parts of a zip, as text. Reads the central directory, so data descriptors and odd local headers do not matter. */
export async function unzipText(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66_000); i--) {
    if (u32(bytes, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new XlsxError('Not a zip file');
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const names = new TextDecoder();
  const out = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) throw new XlsxError('Damaged zip file');
    const method = u16(bytes, at + 10);
    const size = u32(bytes, at + 20);
    const nameLen = u16(bytes, at + 28);
    const local = u32(bytes, at + 42);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLen)).replace(/^\//, '');
    at += 46 + nameLen + u16(bytes, at + 30) + u16(bytes, at + 32);
    if (!wanted(name)) continue;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const raw = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new XlsxError('Unsupported compression');
    out.set(name, new TextDecoder('utf-8').decode(method === 0 ? raw : await inflateRaw(raw)));
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m)
    // Excel escapes control characters as _x000D_.
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => { const c = parseInt(hex, 16); return c === 10 || c === 13 ? '\n' : c < 32 ? '' : String.fromCharCode(c); });

const attr = (attrs: string, name: string): string | undefined => attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`))?.[1];

// Tags may carry a namespace prefix (<x:c>) depending on what wrote the file.
const T = '(?:\\w+:)?';
const all = (text: string, re: RegExp) => Array.from(text.matchAll(re));
const element = (name: string) => new RegExp(`<${T}${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${T}${name}>)`, 'g');
const textRuns = (xml: string) =>
  all(xml.replace(new RegExp(`<${T}rPh\\b[\\s\\S]*?</${T}rPh>`, 'g'), ''), new RegExp(`<${T}t\\b[^>]*?(?:/>|>([\\s\\S]*?)</${T}t>)`, 'g'))
    .map((m) => decodeXml(m[1] ?? '')).join('');

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFormat = (code: string) => /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/general/i.test(code);

/** For each cell style index: does its number format show a date? */
function dateStyles(styles: string | undefined): boolean[] {
  if (!styles) return [];
  const custom = new Map<number, boolean>();
  for (const m of all(styles, element('numFmt'))) {
    custom.set(Number(attr(m[1], 'numFmtId')), isDateFormat(decodeXml(attr(m[1], 'formatCode') ?? '')));
  }
  const cellXfs = styles.match(new RegExp(`<${T}cellXfs\\b[^>]*>([\\s\\S]*?)</${T}cellXfs>`))?.[1] ?? '';
  return all(cellXfs, element('xf')).map((m) => {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    return custom.get(id) ?? BUILTIN_DATE_FORMATS.has(id);
  });
}

function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

const pad = (n: number) => String(n).padStart(2, '0');
function serialToDate(serial: number, date1904: boolean): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial + (date1904 ? 1462 : 0)) * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function readSheet(xml: string, shared: string[], dates: boolean[], date1904: boolean): string[][] {
  const rows: string[][] = [];
  let next = 0;
  for (const rowMatch of all(xml, element('row'))) {
    const r = Number(attr(rowMatch[1], 'r'));
    const index = Number.isInteger(r) && r > 0 ? r - 1 : next;
    next = index + 1;
    if (index >= MAX_ROWS) break;
    const row: string[] = [];
    let col = 0;
    for (const c of all(rowMatch[2] ?? '', element('c'))) {
      const ref = attr(c[1], 'r');
      const at = ref ? columnIndex(ref) : col;
      col = at + 1;
      if (at < 0 || at >= MAX_COLS) continue;
      const type = attr(c[1], 't') ?? 'n';
      const inner = c[2] ?? '';
      const v = inner.match(new RegExp(`<${T}v\\b[^>]*>([\\s\\S]*?)</${T}v>`))?.[1];
      let value = '';
      if (type === 'inlineStr') value = textRuns(inner);
      else if (v === undefined) value = '';
      else if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'str') value = decodeXml(v);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'e') value = '';
      else if (type === 'd') value = v.slice(0, 10);
      else {
        const num = Number(v);
        if (!Number.isFinite(num)) value = v;
        else if (dates[Number(attr(c[1], 's') ?? -1)] && num >= 1) value = serialToDate(num, date1904);
        // Strip binary floating-point noise (82.50000000000001).
        else value = String(parseFloat(num.toPrecision(12)));
      }
      if (value) { while (row.length < at) row.push(''); row[at] = value.trim(); }
    }
    // Rows keep their place so "row 12" in a warning is row 12 in Excel.
    while (rows.length < index) rows.push([]);
    rows[index] = row;
  }
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

export async function readXlsx(bytes: Uint8Array): Promise<{ name: string; rows: string[][] }[]> {
  const parts = await unzipText(bytes, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const workbook = parts.get('xl/workbook.xml');
  if (!workbook) throw new XlsxError('Not an Excel workbook');

  const targets = new Map<string, string>();
  for (const m of all(parts.get('xl/_rels/workbook.xml.rels') ?? '', element('Relationship'))) {
    const target = (attr(m[1], 'Target') ?? '').replace(/^\/?(xl\/)?/, '');
    targets.set(attr(m[1], 'Id') ?? '', `xl/${target}`);
  }
  const shared = all(parts.get('xl/sharedStrings.xml') ?? '', element('si')).map((m) => textRuns(m[2] ?? ''));
  const dates = dateStyles(parts.get('xl/styles.xml'));
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*date1904\s*=\s*"(1|true)"/.test(workbook);

  const sheets: { name: string; rows: string[][] }[] = [];
  for (const m of all(workbook, element('sheet'))) {
    const part = parts.get(targets.get(attr(m[1], 'r:id') ?? attr(m[1], 'id') ?? '') ?? '');
    if (!part) continue; // chart sheets and the like
    const rows = readSheet(part, shared, dates, date1904);
    if (rows.length) sheets.push({ name: decodeXml(attr(m[1], 'name') ?? `Sheet ${sheets.length + 1}`), rows });
  }
  return sheets;
}
