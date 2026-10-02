// Proposing how a spreadsheet should be read. The rules in importParse.ts
// handle sheets with recognisable headers; a model handles the rest — odd
// header wording, another language, a header buried under a title block.
//
// The model only ever returns a MAPPING (which column is which). It never
// returns data: extraction is done by code from the cells themselves, and the
// trainer reviews the result before anything is imported.

import Anthropic from '@anthropic-ai/sdk';
import { fieldsFor, suggestMapping, validateMapping, type Grid } from './importParse.js';
import type { SheetMapping } from './types.js';

const MODEL = process.env.PERSONAL_TRAINING_AGENT_MODEL || process.env.AGENT_MODEL || 'claude-sonnet-5';
const SAMPLE_ROWS = 14;
const MAX_SHEETS_TO_MODEL = 12;

export type CreateMessage = (req: Record<string, unknown>) => Promise<{ content: any[] }>;

let client: Anthropic | null = null;
const defaultCreate: CreateMessage = (req) => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client.messages.create(req as any, { timeout: 45_000 }) as any;
};

export function modelMappingAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.PERSONAL_TRAINING_LLM !== '0' && process.env.NODE_ENV !== 'test' && !process.env.VITEST;
}

/** Contact details are not needed to recognise a column, so they are not sent. */
export function redact(cell: string): string {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell)) return 'someone@example.com';
  if (/^\+?[\d\s().-]{8,}$/.test(cell) && cell.replace(/\D/g, '').length >= 8 && !/^\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}$/.test(cell)) return '000 000 0000';
  return cell.length > 60 ? `${cell.slice(0, 57)}…` : cell;
}

const FIELD_HELP = `Fields (give the zero-based column index for each one the sheet has; omit the rest):
- client: the client's name          - email, phone, goal, injuries, notes: details about a client
- date: the date of a session or weigh-in
- exercise: the exercise or lift name - sets, reps, weight (the load lifted), rpe
- sessionTitle: a name for the session ("Lower", "Day 2", "Push")
- bodyweight: the client's own body weight`;

const SYSTEM = `You read a personal trainer's spreadsheet and say how each sheet is laid out, so that a program can extract the data. You never extract or restate the data yourself.

For every sheet decide:
- kind: "workouts" (training log: exercises with sets, reps and loads), "bodyweight" (weigh-ins over time), "clients" (one row per client with their details), or "ignore" (anything else: pricing, schedules, templates with no logged data, pivot tables whose dates run across the columns).
- headerRow: the zero-based row index of the column headers. Title rows and blank rows above the header are common.
- columns: which column holds which field.
- clientFrom: "sheetName" when the sheet has no client-name column because the whole sheet belongs to one client and is named after them; otherwise "column".
- unit: "kg" or "lb" for the weights in that sheet, from the headers or the values. If nothing indicates it, use the default given.
- dateOrder: "dmy", "mdy" or "ymd" for dates written with numbers. If the values do not settle it, use the default given.

${FIELD_HELP}

Be conservative: if you cannot tell what a column is, leave it out. If a sheet does not clearly hold client, training or weigh-in data, mark it "ignore".`;

const TOOL = {
  name: 'submit_mapping',
  description: 'Report how each sheet is laid out.',
  input_schema: {
    type: 'object',
    properties: {
      sheets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sheet: { type: 'string', description: 'The sheet name exactly as given.' },
            kind: { type: 'string', enum: ['clients', 'workouts', 'bodyweight', 'ignore'] },
            headerRow: { type: 'integer', minimum: 0 },
            columns: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
            clientFrom: { type: 'string', enum: ['column', 'sheetName'] },
            unit: { type: 'string', enum: ['kg', 'lb'] },
            dateOrder: { type: 'string', enum: ['dmy', 'mdy', 'ymd'] },
          },
          required: ['sheet', 'kind', 'headerRow', 'columns', 'clientFrom', 'unit', 'dateOrder'],
        },
      },
    },
    required: ['sheets'],
  },
};

/**
 * The model's answer as a list of sheets. It usually arrives as the array the
 * tool asks for, but sometimes as that array (or the whole `{ sheets }` object)
 * encoded again as a JSON string, so both are unwrapped.
 */
export function proposedSheets(input: unknown): any[] {
  let value: unknown = input;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { return []; }
    } else if (Array.isArray(value)) {
      return value.filter((v) => v && typeof v === 'object');
    } else if (value && typeof value === 'object') {
      value = (value as { sheets?: unknown }).sheets;
    } else {
      return [];
    }
  }
  return [];
}

export async function proposeMappings(
  grids: Grid[],
  defaults: { unit: 'kg' | 'lb'; dateOrder: 'dmy' | 'mdy' },
  create?: CreateMessage,
): Promise<{ mappings: SheetMapping[]; by: 'model' | 'rules' }> {
  const rules = grids.map((g) => suggestMapping(g, defaults));
  if (!create && !modelMappingAvailable()) return { mappings: rules, by: 'rules' };

  try {
    const described = grids.slice(0, MAX_SHEETS_TO_MODEL).map((g) => ({
      sheet: g.name,
      rowCount: g.rows.length,
      firstRows: g.rows.slice(0, SAMPLE_ROWS).map((r) => r.slice(0, 30).map(redact)),
    }));
    const res = await (create ?? defaultCreate)({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'submit_mapping' },
      messages: [{
        role: 'user',
        content: `Defaults when the sheet does not say: unit ${defaults.unit}, dateOrder ${defaults.dateOrder}.\n\nSheets (each row is an array; index 0 is the first column):\n${JSON.stringify(described)}`,
      }],
    });
    const call = (res.content ?? []).find((b: any) => b.type === 'tool_use');
    const proposed = proposedSheets(call?.input);
    if (proposed.length === 0) {
      console.warn('[personal-training] import mapping: the model returned nothing usable; using rules');
      return { mappings: rules, by: 'rules' };
    }

    // Everything the model said is coerced against the real grid; whatever it got wrong or left out falls back to the rules.
    const mappings = grids.map((g, i) => {
      const raw = proposed.find((p) => p?.sheet === g.name);
      if (!raw) return rules[i];
      const known = new Set<string>(fieldsFor(raw.kind) ?? []);
      const columns = Object.fromEntries(Object.entries(raw.columns ?? {}).filter(([f]) => known.has(f)));
      return validateMapping({ ...raw, columns }, g, rules[i]);
    });
    return { mappings, by: 'model' };
  } catch (err) {
    console.warn('[personal-training] import mapping fell back to rules:', (err as Error)?.message);
    return { mappings: rules, by: 'rules' };
  }
}
