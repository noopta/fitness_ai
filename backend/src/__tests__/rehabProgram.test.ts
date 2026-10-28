// Research-based rehab programs (Oct 2026): only with clearance, limits,
// progression criteria and sources; saved like a coach's program for review
// with the physio.
import { describe, it, expect } from 'vitest';
import { rehabProblem, rehabMeta, postOpWeek, rehabCard } from '../services/rehab/program.js';

const good = {
  area: 'Achilles tendon (surgical repair)', side: 'right', surgeryDate: '2026-10-10', clearedOn: '2026-10-26', clearedBy: 'orthopedic surgeon', clearedFor: 'start physio, weight-bearing in the boot',
  program: 'Phase 1 (weeks 3-6): Mon/Wed/Fri — seated active plantarflexion 3x15, isometric calf holds in boot 5x30s, hip abduction 3x12, upper body push 4x8. Phase 2 (weeks 7-12): ...',
  limits: ['No dorsiflexion past neutral before week 12', 'No running or jumping before week 16 and criteria met'],
  criteria: ['Full weight-bearing in the boot without pain', '20 single-leg heel raises before running'],
  sources: [{ title: 'Accelerated rehabilitation after Achilles repair: systematic review', year: '2024' }, { title: 'Clinical practice guideline: Achilles tendon rupture', year: '2024', url: 'https://example.org/cpg' }],
};

describe('rehabProblem', () => {
  it('accepts a complete, cleared, sourced program', () => { expect(rehabProblem(good)).toBeNull(); });
  it('needs clearance', () => { expect(rehabProblem({ ...good, clearedOn: '', clearedFor: '' })).toMatch(/cleared/); });
  it('needs hard limits and criteria', () => {
    expect(rehabProblem({ ...good, limits: [] })).toMatch(/limits/);
    expect(rehabProblem({ ...good, criteria: [' '] })).toMatch(/criteria/);
  });
  it('needs at least two sources — research first', () => { expect(rehabProblem({ ...good, sources: [good.sources[0]] })).toMatch(/two sources/); });
  it('needs the program written out', () => { expect(rehabProblem({ ...good, program: 'calf raises' })).toMatch(/Write the program/); });
  it('rejects a bad date', () => { expect(rehabProblem({ ...good, surgeryDate: 'Oct 10' })).toMatch(/YYYY-MM-DD/); });
});

describe('rehabMeta / postOpWeek', () => {
  it('cleans and keeps only http(s) urls', () => {
    const m = rehabMeta({ ...good, sources: [...good.sources, { title: 'x', url: 'javascript:alert(1)' }] });
    expect(m.sources[2].url).toBeNull();
    expect(m.sources[1].url).toBe('https://example.org/cpg');
    expect(m.surgeryDate).toBe('2026-10-10');
  });
  it('week since surgery', () => {
    expect(postOpWeek('2026-10-10', '2026-10-10')).toBe(1);
    expect(postOpWeek('2026-10-10', '2026-10-28')).toBe(3);
    expect(postOpWeek('2026-10-10', '2026-10-01')).toBeNull();
    expect(postOpWeek(null, '2026-10-28')).toBeNull();
  });
});

describe('rehabCard', () => {
  it('leads with the plan, shows limits and criteria, sources, and the physio-review line; apply activates the program', () => {
    const meta = rehabMeta(good);
    const card: any = rehabCard(meta, { name: 'Achilles rehab', weeks: 24, days: 4, rows: [{ key: 'Mon', value: 'Calf + upper' }] }, { phases: [] }, 3);
    expect(card.meta.label).toBe('Rehab · Achilles tendon (surgical repair) · week 3 post-op');
    expect(card.rows.map((r: any) => r.key)).toEqual(['Mon', 'Limit', 'Limit', 'Move on when', 'Move on when']);
    expect(card.why).toMatch(/Built from 2 sources/);
    expect(card.note).toMatch(/physio/);
    expect(card.note).toMatch(/isn’t medical advice/);
    expect(card.pending.actions.apply.op).toBe('program.activate');
  });
});
