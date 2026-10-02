// The model's part of an import is only the mapping, and whatever it returns
// is coerced against the real sheet before it is used.

import { describe, it, expect } from 'vitest';
import { proposeMappings, redact, type CreateMessage } from '../services/personalTraining/importMapping.js';
import { extract } from '../services/personalTraining/importParse.js';

const DEFAULTS = { unit: 'kg' as const, dateOrder: 'dmy' as const };
// Headers the rules cannot place: another language, under a title block.
const grid = { name: 'Registro', rows: [
  ['Estudio Mensah — registro 2026', '', '', '', ''],
  ['Persona', 'Fecha', 'Ejercicio', 'Series x reps', 'Carga'],
  ['Maya Okafor', '3/9/2026', 'Sentadilla', '3x5', '80'],
  ['Maya Okafor', '10/9/2026', 'Sentadilla', '3x5', '82,5'],
] };
const reply = (sheets: unknown): CreateMessage => async () => ({ content: [{ type: 'tool_use', name: 'submit_mapping', input: { sheets } }] });

describe('model-proposed mapping', () => {
  it('lets the model place columns the rules could not, and the code still does the extraction', async () => {
    const rulesOnly = await proposeMappings([grid], DEFAULTS);
    expect(rulesOnly).toMatchObject({ by: 'rules', mappings: [{ kind: 'ignore' }] });

    const { mappings, by } = await proposeMappings([grid], DEFAULTS, reply([
      { sheet: 'Registro', kind: 'workouts', headerRow: 1, columns: { client: 0, date: 1, exercise: 2, reps: 3, weight: 4 }, clientFrom: 'column', unit: 'kg', dateOrder: 'dmy' },
    ]));
    expect(by).toBe('model');
    const out = extract([grid], mappings, '2026-10-02');
    expect(out.clients[0].workouts).toEqual([
      { date: '2026-09-03', exercises: [{ name: 'Sentadilla', sets: 3, reps: '5', weightKg: 80 }] },
      { date: '2026-09-10', exercises: [{ name: 'Sentadilla', sets: 3, reps: '5', weightKg: 82.5 }] },
    ]);
  });

  it('coerces what the model returns: unknown fields, out-of-range columns and wrong sheets are dropped', async () => {
    const { mappings } = await proposeMappings([grid], DEFAULTS, reply([
      { sheet: 'Registro', kind: 'workouts', headerRow: 40, columns: { client: 0, date: 1, exercise: 2, weight: 99, salary: 3 }, clientFrom: 'column', unit: 'stone', dateOrder: 'dmy' },
      { sheet: 'Not a sheet', kind: 'clients', headerRow: 0, columns: { client: 0 }, clientFrom: 'column', unit: 'kg', dateOrder: 'dmy' },
    ]));
    expect(mappings).toHaveLength(1);
    expect(mappings[0].columns).toEqual({ client: 0, date: 1, exercise: 2 });
    expect(mappings[0].unit).toBe('kg');
    expect(mappings[0].headerRow).toBe(1); // 40 is outside the sheet; the rules' guess stands
  });

  it('falls back to the rules when the model fails or returns nothing', async () => {
    const failing: CreateMessage = async () => { throw new Error('overloaded'); };
    expect((await proposeMappings([grid], DEFAULTS, failing)).by).toBe('rules');
    expect((await proposeMappings([grid], DEFAULTS, async () => ({ content: [{ type: 'text', text: 'sorry' }] }))).by).toBe('rules');
  });

  it('sends the model only a sample, with contact details masked', async () => {
    let sent = '';
    const capture: CreateMessage = async (req: any) => { sent = req.messages[0].content; return { content: [] }; };
    const big = { name: 'Clients', rows: [['Name', 'Email', 'Phone'], ...Array.from({ length: 200 }, (_, i) => [`Client ${i}`, `c${i}@mail.com`, '+1 (555) 010-9999'])] };
    await proposeMappings([big], DEFAULTS, capture);
    expect(sent).not.toContain('@mail.com');
    expect(sent).not.toContain('010-9999');
    expect(sent).toContain('someone@example.com');
    expect(sent).toContain('Client 12');
    expect(sent).not.toContain('Client 14'); // only the first rows are sent
    expect(redact('3/9/2026')).toBe('3/9/2026'); // a date is not a phone number
  });
});
