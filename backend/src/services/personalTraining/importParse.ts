// Reading a trainer's own client spreadsheet. Pure: a grid of cell text in,
// clients with their sessions and bodyweight out.
//
// The structure of the sheet is never known in advance, so reading it is two
// separate steps. A MAPPING says which sheet holds what and which column is
// which — proposed by rules here (or by a model, see importMapping.ts) and
// then corrected by the trainer. EXTRACTION applies that mapping with plain
// code, so every number that ends up in Axiom was copied from a cell, never
// rewritten by a model.

import type { ImportField, ImportSheetKind, SheetMapping } from './types.js';

export interface Grid { name: string; rows: string[][] }

export const LIMITS = { sheets: 30, rowsPerSheet: 20_000, columns: 60, cellChars: 400, clients: 500 };

/** Trim an upload to the limits and to plain strings; returns what was dropped so it can be reported. */
export function sanitiseGrids(input: unknown): { grids: Grid[]; dropped: string[] } {
  const dropped: string[] = [];
  const sheets = Array.isArray(input) ? input : [];
  if (sheets.length > LIMITS.sheets) dropped.push(`Only the first ${LIMITS.sheets} sheets were read`);
  const grids: Grid[] = [];
  for (const s of sheets.slice(0, LIMITS.sheets)) {
    const name = typeof s?.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : `Sheet ${grids.length + 1}`;
    const raw: unknown[] = Array.isArray(s?.rows) ? s.rows : [];
    if (raw.length > LIMITS.rowsPerSheet) dropped.push(`"${name}": only the first ${LIMITS.rowsPerSheet} rows were read`);
    const rows = raw.slice(0, LIMITS.rowsPerSheet).map((r) =>
      (Array.isArray(r) ? r : []).slice(0, LIMITS.columns).map((c) => (c === null || c === undefined ? '' : String(c).trim().slice(0, LIMITS.cellChars))),
    );
    // Trailing blank rows are common in exports and carry nothing.
    while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
    if (rows.length) grids.push({ name, rows });
  }
  return { grids, dropped };
}

// ── Proposing a mapping by rules ─────────────────────────────────────────────

const HEADER_PATTERNS: [ImportField, RegExp][] = [
  // Order matters: "body weight" must be claimed before "weight", "exercise name" before "name".
  ['bodyweight', /body\s*-?\s*weight|\bbw\b|weigh[\s-]?in|\bmass\b|scale/i],
  ['exercise', /exercise|movement|\blift\b|\bmove\b/i],
  ['email', /e-?mail/i],
  ['phone', /phone|mobile|\bcell\b|whats\s?app/i],
  ['goal', /\bgoals?\b|objective|target/i],
  ['injuries', /injur|limitation|medical|condition|contraindication/i],
  ['rpe', /\brpe\b|\brir\b|effort/i],
  ['sets', /\bsets?\b/i],
  ['reps', /\breps?\b|repetition/i],
  ['weight', /weight|\bload\b|\bkgs?\b|\blbs?\b|pounds|kilo/i],
  ['date', /\bdate\b|\bday\b|\bwhen\b|session date/i],
  ['sessionTitle', /session|workout|split|routine|\bblock\b/i],
  ['client', /client|athlete|member|trainee|\bname\b|participant|\bwho\b/i],
  ['notes', /note|comment|remark|feedback/i],
];

const FIELDS_BY_KIND: Record<ImportSheetKind, ImportField[]> = {
  clients: ['client', 'email', 'phone', 'goal', 'injuries', 'notes', 'bodyweight'],
  workouts: ['client', 'date', 'exercise', 'sets', 'reps', 'weight', 'rpe', 'sessionTitle', 'notes'],
  bodyweight: ['client', 'date', 'bodyweight'],
  ignore: [],
};
export const fieldsFor = (kind: ImportSheetKind) => FIELDS_BY_KIND[kind];

function matchHeaders(row: string[]): Partial<Record<ImportField, number>> {
  const columns: Partial<Record<ImportField, number>> = {};
  row.forEach((cell, i) => {
    if (!cell || cell.length > 40) return;
    const field = HEADER_PATTERNS.find(([f, re]) => columns[f] === undefined && re.test(cell))?.[0];
    if (field) columns[field] = i;
  });
  return columns;
}

/** The row most likely to be the header: the one in the first ten with the most recognised column names. */
export function findHeaderRow(rows: string[][]): { headerRow: number; columns: Partial<Record<ImportField, number>> } {
  let best = { headerRow: 0, columns: {} as Partial<Record<ImportField, number>>, score: -1 };
  rows.slice(0, 10).forEach((row, i) => {
    const columns = matchHeaders(row);
    const score = Object.keys(columns).length;
    if (score > best.score) best = { headerRow: i, columns, score };
  });
  return { headerRow: best.headerRow, columns: best.columns };
}

const NUMERIC_DATE = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/;

/** Work out day/month order from the dates themselves; fall back to the trainer's locale habit. */
export function detectDateOrder(cells: string[], fallback: 'dmy' | 'mdy'): SheetMapping['dateOrder'] {
  let dmy = 0;
  let mdy = 0;
  for (const c of cells) {
    const m = c.match(NUMERIC_DATE);
    if (!m) continue;
    if (m[1].length === 4) return 'ymd';
    if (Number(m[1]) > 12) dmy += 1;
    else if (Number(m[2]) > 12) mdy += 1;
  }
  return dmy > mdy ? 'dmy' : mdy > dmy ? 'mdy' : fallback;
}

export function suggestMapping(grid: Grid, defaults: { unit: 'kg' | 'lb'; dateOrder: 'dmy' | 'mdy' }): SheetMapping {
  const { headerRow, columns } = findHeaderRow(grid.rows);
  // A "weight" column with no exercise beside it is a weigh-in log, not training.
  if (columns.exercise === undefined && columns.bodyweight === undefined && columns.weight !== undefined && columns.date !== undefined) {
    columns.bodyweight = columns.weight;
    delete columns.weight;
  }
  const kind: ImportSheetKind =
    columns.exercise !== undefined ? 'workouts'
    : columns.bodyweight !== undefined && columns.date !== undefined ? 'bodyweight'
    : columns.client !== undefined || columns.email !== undefined ? 'clients'
    : 'ignore';

  const header = grid.rows[headerRow] ?? [];
  const loadHeader = `${header[columns.weight ?? -1] ?? ''} ${header[columns.bodyweight ?? -1] ?? ''}`;
  const body = grid.rows.slice(headerRow + 1, headerRow + 60);
  const loadCells = body.map((r) => `${r[columns.weight ?? -1] ?? ''} ${r[columns.bodyweight ?? -1] ?? ''}`).join(' ');
  const unit = /\blbs?\b|pounds/i.test(loadHeader) ? 'lb' : /\bkgs?\b|kilo/i.test(loadHeader) ? 'kg'
    : /\d\s*(lbs?|pounds)\b/i.test(loadCells) ? 'lb' : /\d\s*kgs?\b/i.test(loadCells) ? 'kg' : defaults.unit;

  const mapped: Partial<Record<ImportField, number>> = {};
  for (const f of FIELDS_BY_KIND[kind]) if (columns[f] !== undefined) mapped[f] = columns[f];
  return {
    sheet: grid.name,
    kind,
    headerRow,
    columns: mapped,
    // No name column on a training or weigh-in sheet: one sheet per client, named after them.
    clientFrom: kind !== 'ignore' && kind !== 'clients' && mapped.client === undefined ? 'sheetName' : 'column',
    unit,
    dateOrder: detectDateOrder(body.map((r) => r[columns.date ?? -1] ?? ''), defaults.dateOrder),
  };
}

/** Coerce a mapping from a model or a request into a valid one for this grid; anything unusable falls back to `base`. */
export function validateMapping(raw: any, grid: Grid, base: SheetMapping): SheetMapping {
  const kinds: ImportSheetKind[] = ['clients', 'workouts', 'bodyweight', 'ignore'];
  const kind = kinds.includes(raw?.kind) ? (raw.kind as ImportSheetKind) : base.kind;
  const width = Math.max(0, ...grid.rows.slice(0, 50).map((r) => r.length));
  const headerRow = Number.isInteger(raw?.headerRow) && raw.headerRow >= 0 && raw.headerRow < Math.min(grid.rows.length, 50) ? raw.headerRow : base.headerRow;
  const columns: Partial<Record<ImportField, number>> = {};
  const source = raw?.columns && typeof raw.columns === 'object' ? raw.columns : base.columns;
  const used = new Set<number>();
  for (const f of FIELDS_BY_KIND[kind]) {
    const i = source[f];
    if (Number.isInteger(i) && i >= 0 && i < width && !used.has(i)) { columns[f] = i; used.add(i); }
  }
  return {
    sheet: grid.name,
    kind,
    headerRow,
    columns,
    clientFrom: raw?.clientFrom === 'sheetName' || (kind !== 'clients' && columns.client === undefined && kind !== 'ignore') ? 'sheetName' : 'column',
    unit: raw?.unit === 'lb' || raw?.unit === 'kg' ? raw.unit : base.unit,
    dateOrder: ['dmy', 'mdy', 'ymd'].includes(raw?.dateOrder) ? raw.dateOrder : base.dateOrder,
  };
}

// ── Reading cells ────────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number): string | null => {
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || y > 2100 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** A calendar date as YYYY-MM-DD, or null when the cell is not one. */
export function parseDate(cell: string, order: SheetMapping['dateOrder']): string | null {
  const text = cell.trim();
  if (!text) return null;
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) return iso(+isoMatch[1], +isoMatch[2], +isoMatch[3]);
  const n = text.match(NUMERIC_DATE);
  if (n) {
    if (n[1].length === 4) return iso(+n[1], +n[2], +n[3]);
    return order === 'mdy' ? iso(+n[3], +n[1], +n[2]) : iso(+n[3], +n[2], +n[1]);
  }
  // "3 Sep 2026", "Sep 3, 2026", "September 3 2026", "Thu 3 Sep 26"
  const named = text.toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([a-z]{3,9})\.?,?[\s\-/]+(\d{2,4})|([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/);
  if (named) {
    const [day, mon, year] = named[1] ? [named[1], named[2], named[3]] : [named[5], named[4], named[6]];
    const m = MONTHS.indexOf(mon.slice(0, 3));
    if (m >= 0) return iso(+year, m + 1, +day);
  }
  // A bare Excel serial (days since 1899-12-30) when the reader left a date cell as a number.
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial > 32_000 && serial < 73_000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  return null;
}

const KG_PER_LB = 0.45359237;

/** A load in kilograms. A unit written in the cell wins over the sheet's unit. Bodyweight movements and blanks are null. */
export function parseWeightKg(cell: string, unit: 'kg' | 'lb'): number | null {
  const text = cell.trim().toLowerCase().replace(/,/g, '.');
  if (!text || /^(bw|body\s?weight|-|n\/?a|x)$/.test(text)) return null;
  const m = text.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 2000) return null;
  // "60kg" has no word boundary before the unit, so the unit is matched as "not preceded by a letter".
  const inLb = /(?<![a-z])lbs?\b|pounds|#/.test(text) ? true : /(?<![a-z])kgs?\b|kilo/.test(text) ? false : unit === 'lb';
  return Math.round((inLb ? value * KG_PER_LB : value) * 100) / 100;
}

/** Sets and reps from their cells; "3x5" in either cell fills both. */
export function parseSetsReps(setsCell: string, repsCell: string): { sets: number | null; reps: string } {
  const combined = `${setsCell} ${repsCell}`.toLowerCase().match(/(\d{1,2})\s*[x×]\s*(\d{1,3}(?:\s*-\s*\d{1,3})?)/);
  if (combined) return { sets: Number(combined[1]), reps: combined[2].replace(/\s/g, '') };
  const sets = setsCell.trim().match(/^\d{1,2}$/) ? Number(setsCell.trim()) : null;
  const reps = repsCell.trim().toLowerCase().match(/^\d{1,3}(?:\s*-\s*\d{1,3})?$|^amrap$|^max$|^\d{1,3}\s*(s|sec|secs|seconds|min|mins)$/) ? repsCell.trim().replace(/\s/g, '') : '';
  return { sets, reps };
}

export const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Extraction ───────────────────────────────────────────────────────────────

export interface ExtractedExercise { name: string; sets: number; reps: string; weightKg: number | null; rpe?: number }
export interface ExtractedWorkout { date: string; title?: string; notes?: string; exercises: ExtractedExercise[] }
export interface ExtractedClient {
  key: string; name: string; email: string | null; phone?: string; goal?: string; injuries?: string; notes?: string;
  workouts: ExtractedWorkout[];
  weights: { date: string; weightKg: number }[];
}
export interface Extracted { clients: ExtractedClient[]; assumptions: string[]; warnings: string[]; skippedRows: number }

export function extract(grids: Grid[], mappings: SheetMapping[], today: string): Extracted {
  const clients = new Map<string, ExtractedClient & { byDate: Map<string, { title?: string; notes: string[]; ex: Map<string, ExtractedExercise & { rows: number }> }>; weightByDate: Map<string, number> }>();
  const assumptions: string[] = [];
  const skipped = new Map<string, { count: number; examples: string[] }>();
  let skippedRows = 0;
  const skip = (reason: string, where: string) => {
    skippedRows += 1;
    const s = skipped.get(reason) ?? { count: 0, examples: [] };
    s.count += 1;
    if (s.examples.length < 3) s.examples.push(where);
    skipped.set(reason, s);
  };
  const client = (name: string) => {
    const key = nameKey(name);
    let c = clients.get(key);
    if (!c) {
      c = { key, name: name.trim().replace(/\s+/g, ' '), email: null, workouts: [], weights: [], byDate: new Map(), weightByDate: new Map() };
      clients.set(key, c);
    }
    return c;
  };

  for (const mapping of mappings) {
    const grid = grids.find((g) => g.name === mapping.sheet);
    if (!grid || mapping.kind === 'ignore') continue;
    const col = mapping.columns;
    const cell = (row: string[], f: ImportField) => (col[f] === undefined ? '' : (row[col[f]!] ?? '').trim());
    const rows = grid.rows.slice(mapping.headerRow + 1);
    const where = (i: number) => `"${grid.name}" row ${mapping.headerRow + 2 + i}`;
    let filledDown = false;
    let lastName = '';
    let lastDate: string | null = null;
    let lastTitle = '';

    if (mapping.kind !== 'clients') {
      if (col.weight !== undefined || col.bodyweight !== undefined) assumptions.push(`"${grid.name}": weights read as ${mapping.unit === 'lb' ? 'pounds' : 'kilograms'} unless a cell says otherwise`);
      if (col.date !== undefined && mapping.dateOrder !== 'ymd') assumptions.push(`"${grid.name}": dates like 3/4/2026 read as ${mapping.dateOrder === 'dmy' ? 'day/month/year' : 'month/day/year'}`);
      if (mapping.clientFrom === 'sheetName') assumptions.push(`"${grid.name}": the sheet name is taken as the client's name`);
    }

    rows.forEach((row, i) => {
      if (row.every((c) => c === '')) return;

      // Who. Sheets with merged or "only on the first line" cells leave the name blank on later rows.
      let name = mapping.clientFrom === 'sheetName' ? grid.name : cell(row, 'client');
      let filled = false;
      if (!name && mapping.kind !== 'clients' && lastName) { name = lastName; filled = true; }
      if (!name) return skip('no client name', where(i));
      if (name.length > 80 || /^\d+$/.test(name)) return skip('client name is not a name', where(i));
      lastName = name;
      if (!clients.has(nameKey(name)) && clients.size >= LIMITS.clients) return skip(`more than ${LIMITS.clients} clients`, where(i));
      const c = client(name);

      if (mapping.kind === 'clients') {
        const email = cell(row, 'email').toLowerCase();
        if (email && EMAIL.test(email)) c.email = email;
        else if (email) skip('email is not valid (client still imported)', where(i)), (skippedRows -= 1);
        for (const f of ['phone', 'goal', 'injuries', 'notes'] as const) if (cell(row, f)) c[f] = cell(row, f);
        const bw = col.bodyweight !== undefined ? parseWeightKg(cell(row, 'bodyweight'), mapping.unit) : null;
        if (bw && bw >= 25 && bw <= 350) c.weightByDate.set(today, bw);
        return;
      }

      // When. A date written once per session and left blank below it is filled down too.
      let date = parseDate(cell(row, 'date'), mapping.dateOrder);
      // Not in a weigh-in log, though: a weight with no date there is a total or average line, not a weigh-in.
      if (!date && !cell(row, 'date') && lastDate && mapping.kind !== 'bodyweight') { date = lastDate; filled = true; }
      if (!date) return skip(cell(row, 'date') ? 'date could not be read' : 'no date', where(i));
      if (date > today) return skip('date is in the future', where(i));
      lastDate = date;

      if (mapping.kind === 'bodyweight') {
        const kg = parseWeightKg(cell(row, 'bodyweight'), mapping.unit);
        if (!kg) return skip('bodyweight could not be read', where(i));
        if (kg < 25 || kg > 350) return skip('bodyweight is outside a plausible range', where(i));
        c.weightByDate.set(date, kg);
        if (filled) filledDown = true;
        return;
      }

      const exercise = cell(row, 'exercise');
      if (!exercise) return skip('no exercise name', where(i));
      // Only a row that was actually used counts as an assumption worth reporting.
      if (filled) filledDown = true;
      const day: { title?: string; notes: string[]; ex: Map<string, ExtractedExercise & { rows: number }> } = c.byDate.get(date) ?? { notes: [], ex: new Map() };
      c.byDate.set(date, day);
      const title = cell(row, 'sessionTitle') || (lastDate === date ? lastTitle : '');
      if (title && !day.title) day.title = title.slice(0, 80);
      lastTitle = title;
      if (cell(row, 'notes')) day.notes.push(cell(row, 'notes'));

      const { sets, reps } = parseSetsReps(cell(row, 'sets'), cell(row, 'reps'));
      const weightKg = col.weight !== undefined ? parseWeightKg(cell(row, 'weight'), mapping.unit) : null;
      const rpeText = cell(row, 'rpe').replace(',', '.');
      const rpe = /^\d{1,2}(\.\d)?$/.test(rpeText) && Number(rpeText) <= 10 ? Number(rpeText) : undefined;
      const key = exercise.toLowerCase().replace(/\s+/g, ' ');
      const seen = day.ex.get(key);
      if (!seen) {
        day.ex.set(key, { name: exercise.replace(/\s+/g, ' ').slice(0, 80), sets: sets ?? 1, reps, weightKg, ...(rpe !== undefined ? { rpe } : {}), rows: 1 });
      } else {
        // The same lift again that day: either one row per set, or a second block. Either way it adds sets,
        // and the heaviest row is the one that describes the lift.
        seen.sets += sets ?? 1;
        seen.rows += 1;
        if ((weightKg ?? 0) > (seen.weightKg ?? 0)) { seen.weightKg = weightKg; if (reps) seen.reps = reps; if (rpe !== undefined) seen.rpe = rpe; }
        else if (!seen.reps && reps) seen.reps = reps;
      }
    });
    if (filledDown) assumptions.push(`"${grid.name}": blank name or date cells were filled from the row above`);
  }

  // A tab called "Sarah K" and a client-list row "Sarah Kim" are one person. Merge only when the shorter
  // name abbreviates exactly one fuller name, and say so, so the trainer can see it on the review screen.
  const abbreviates = (short: string[], full: string[]) =>
    short.length <= full.length && short[0] === full[0] && short.join(' ') !== full.join(' ')
    && short.every((t, i) => full[i].startsWith(t.replace(/\.$/, '')));
  for (const key of [...clients.keys()].sort((a, b) => a.length - b.length)) {
    const short = clients.get(key)!;
    if (short.email) continue;
    const fuller = [...clients.keys()].filter((k) => k !== key && abbreviates(key.split(' '), k.split(' ')));
    if (fuller.length !== 1) continue;
    const full = clients.get(fuller[0])!;
    for (const [date, d] of short.byDate) {
      const existing = full.byDate.get(date);
      if (!existing) full.byDate.set(date, d);
      else for (const [k, e] of d.ex) if (!existing.ex.has(k)) existing.ex.set(k, e);
    }
    for (const [date, kg] of short.weightByDate) if (!full.weightByDate.has(date)) full.weightByDate.set(date, kg);
    for (const f of ['phone', 'goal', 'injuries', 'notes'] as const) if (!full[f] && short[f]) full[f] = short[f];
    clients.delete(key);
    assumptions.push(`"${short.name}" and "${full.name}" were read as the same person`);
  }

  const out: ExtractedClient[] = [...clients.values()].map(({ byDate, weightByDate, ...c }) => ({
    ...c,
    workouts: [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, d]) => ({
      date,
      ...(d.title ? { title: d.title } : {}),
      ...(d.notes.length ? { notes: [...new Set(d.notes)].join(' · ').slice(0, 500) } : {}),
      exercises: [...d.ex.values()].map(({ rows: _rows, ...e }) => e),
    })),
    weights: [...weightByDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, weightKg]) => ({ date, weightKg })),
  }));
  out.sort((a, b) => a.name.localeCompare(b.name));

  const warnings = [...skipped.entries()].map(([reason, s]) =>
    `${s.count} ${s.count === 1 ? 'row' : 'rows'} skipped: ${reason} (${s.examples.join(', ')}${s.count > s.examples.length ? ', and more' : ''})`);
  for (const m of mappings) {
    if (m.kind === 'ignore') warnings.push(`"${m.sheet}" was not read: no client, training or bodyweight columns were recognised`);
    else if (m.kind === 'workouts' && m.columns.date === undefined) warnings.push(`"${m.sheet}" has no date column mapped, so its sessions cannot be placed in time`);
  }
  return { clients: out, assumptions: [...new Set(assumptions)], warnings, skippedRows };
}

/** One line describing a session, for the review screen. */
export function summariseWorkout(w: ExtractedWorkout, fmt: (kg: number) => string): string {
  const parts = w.exercises.slice(0, 3).map((e) => `${e.name}${e.sets && e.reps ? ` ${e.sets}×${e.reps}` : ''}${e.weightKg ? ` at ${fmt(e.weightKg)}` : ''}`);
  if (w.exercises.length > 3) parts.push(`${w.exercises.length - 3} more`);
  return parts.join(' · ');
}
