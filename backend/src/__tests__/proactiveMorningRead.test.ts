// Nov 2026 overhaul: relevance of receipts, the fixed priority, the symptom
// fallback, and the new evidence (thread quotes, rehab/injuries, micronutrient
// gaps, logging, plan adherence).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const R = await import('../proactive/reasoner.js');
const E = await import('../proactive/evidence.js');

const today = '2026-11-02';
const sleep = { id: 'sleep_short', verb: 'Checked' as const, text: 'Under 6 h sleep on 3 of the last 4 nights', topics: ['sleep', 'fatigue', 'recovery'], area: 'recovery' as const };
const protein = { id: 'protein_short', verb: 'Checked' as const, text: 'Protein short on 4 of the last 5 logged days', topics: ['nutrition', 'protein', 'recovery'], area: 'fuel' as const };
const achilles = { id: 'thread_ach', verb: 'Read' as const, text: '“Achilles is stiff in the mornings” · you, Oct 28', topics: ['symptom', 'achilles', 'stiff'], area: 'body' as const };
const stopped = { id: 'thread_stop', verb: 'Read' as const, text: '“Stopped early, felt off” · you, Oct 30', topics: ['question', 'stopped', 'early'], area: 'training' as const };
const evidence = [sleep, protein, achilles, stopped];
const threads = [{ id: 'ach', status: 'open', kind: 'symptom', title: 'Achilles stiffness' }, { id: 'stop', status: 'open', kind: 'question', title: 'Stopped the session early' }];
const due = threads.map(({ id, kind, title }) => ({ id, kind, title }));

describe('evidence relevance', () => {
  it('drops a sleep receipt under a question about stopping a session early; the thread quote stands in', () => {
    const out = R.verifyCandidates({ candidates: [{ kind: 'followup', threadId: 'stop', topic: 'stopped early', question: 'You stopped Thursday early. Want me to trim tomorrow so it fits?', primary: 'Trim it', evidence: ['sleep_short'], pushWhyNow: null, area: 'training' }] }, evidence, threads);
    expect(out[0].evidence).toEqual(['thread_stop']);
  });
  it('keeps a receipt whose topic the question names; drops an item left with none', () => {
    expect(R.verifyCandidates({ candidates: [{ kind: 'checkin', threadId: null, topic: 'protein', question: 'Protein has been short. Want two easy add-ons?', primary: 'Show me', evidence: ['protein_short'], pushWhyNow: null, area: 'fuel' }] }, evidence, threads)[0].evidence).toEqual(['protein_short']);
    expect(R.verifyCandidates({ candidates: [{ kind: 'checkin', threadId: null, topic: 'hydration', question: 'Drinking enough water?', primary: 'Yes', evidence: ['protein_short'], pushWhyNow: null, area: 'fuel' }] }, evidence, threads)).toEqual([]);
  });
  it('a thread quote only backs its own thread', () => {
    expect(R.evidenceRelevant(achilles, { topic: 'achilles', question: 'How is it?', threadId: 'ach' })).toBe(true);
    expect(R.evidenceRelevant(achilles, { topic: 'achilles', question: 'How is it?', threadId: 'stop' })).toBe(false);
  });
});

describe('fixed priority and the symptom fallback', () => {
  it('a due symptom comes before protein, whatever order the model gave', () => {
    const out = R.verifyCandidates({ candidates: [
      { kind: 'checkin', threadId: null, topic: 'protein', question: 'Protein has been short. Want two easy add-ons?', primary: 'Show me', evidence: ['protein_short'], pushWhyNow: null, area: 'fuel' },
      { kind: 'followup', threadId: 'ach', topic: 'achilles', question: 'How is the Achilles this morning? If it is stiff I will swap the jumps.', primary: 'Tell you', evidence: [], pushWhyNow: null, area: 'training' },
    ] }, evidence, threads, { due });
    expect(out.map((c) => c.topic)).toEqual(['achilles', 'protein']);
    expect(out[0].evidence).toEqual(['thread_ach']);
  });
  it('a due symptom the model left out is asked about anyway, with its own quote', () => {
    const out = R.verifyCandidates({ candidates: [{ kind: 'checkin', threadId: null, topic: 'protein', question: 'Protein has been short. Want two easy add-ons?', primary: 'Show me', evidence: ['protein_short'], pushWhyNow: null, area: 'fuel' }] }, evidence, threads, { due });
    expect(out[0]).toMatchObject({ kind: 'followup', threadId: 'ach', evidence: ['thread_ach'], pushWhyNow: null });
    expect(out[0].question).toMatch(/achilles stiffness/i);
    expect(out[0].question.length).toBeLessThanOrEqual(160);
  });
  it('no fallback when an item already covers their body; never two fallbacks', () => {
    const two = [...threads, { id: 'jolt', status: 'open', kind: 'symptom', title: 'Sharp jolt' }];
    const ev = [...evidence, { id: 'thread_jolt', verb: 'Read' as const, text: '“a sharp jolt” · you', topics: ['symptom', 'sharp', 'jolt'], area: 'body' as const }];
    const dueTwo = two.map(({ id, kind, title }) => ({ id, kind, title }));
    const covered = R.verifyCandidates({ candidates: [{ kind: 'followup', threadId: 'ach', topic: 'achilles', question: 'How is the Achilles now?', primary: 'Tell you', evidence: [], pushWhyNow: null, area: 'training' }] }, ev, two, { due: dueTwo });
    expect(covered.map((c) => c.threadId)).toEqual(['ach']);
    expect(R.verifyCandidates({ candidates: [] }, ev, two, { due: dueTwo }).map((c) => c.threadId)).toEqual(['ach']);
  });
  it('one item per topic', () => {
    const p = { kind: 'checkin', threadId: null, topic: 'protein', question: 'Protein has been short. Want two easy add-ons?', primary: 'Show me', evidence: ['protein_short'], pushWhyNow: null, area: 'fuel' };
    expect(R.verifyCandidates({ candidates: [p, { ...p, question: 'Protein again?' }] }, evidence, threads)).toHaveLength(1);
  });
});

describe('new evidence', () => {
  it('thread quotes for open threads', () => {
    const out = E.threadEvidence([{ id: 't1', kind: 'symptom', title: 'Achilles stiffness', status: 'open', eventDate: null, sourceQuote: 'Achilles is stiff in the mornings', sourceAt: new Date('2026-11-01T09:00:00Z') }, { id: 't2', kind: 'question', title: 'x', status: 'resolved', eventDate: null, sourceQuote: 'y', sourceAt: null }], today);
    expect(out).toEqual([{ id: 'thread_t1', verb: 'Read', text: '“Achilles is stiff in the mornings” · you, yesterday', topics: ['symptom', 'achilles', 'stiffness'], area: 'body' }]);
  });
  it('the rehab plan with its week since surgery, and injuries on file', () => {
    const out = E.bodyEvidence({ area: 'Achilles tendon repair', side: 'left', surgeryDate: '2026-09-01' }, ['Left Achilles rupture, surgery Sept 1', 'left achilles rupture, surgery sept 1'], today);
    expect(out[0]).toMatchObject({ id: 'rehab_plan', text: 'Left Achilles tendon repair rehab · week 9 since surgery', area: 'body' });
    expect(out.filter((x) => x.id.startsWith('injury_'))).toHaveLength(1);
  });
  it('a micronutrient under half its target on most logged days; too few days says nothing', () => {
    const days = ['27', '28', '29', '30', '31'].map((d) => ({ date: `2026-10-${d}`, totals: { vitaminDIU: 120, ironMg: 15 } }));
    const targets = [{ key: 'vitaminDIU', label: 'Vitamin D', target: 600 }, { key: 'ironMg', label: 'Iron', target: 8 }];
    expect(E.microGapEvidence(days, targets, today).map((x) => x.text)).toEqual(['Vitamin D under half your target on 5 of 5 logged days']);
    expect(E.microGapEvidence(days.slice(0, 3), targets, today)).toEqual([]);
  });
  it('a day counts for micronutrients only when entries with real data carry most of its calories; all-zero blobs are not data', () => {
    const real = (c: number) => JSON.stringify({ vitaminCMg: c, ironMg: 2, zincMg: 1, calciumMg: 50 });
    const zeros = JSON.stringify({ vitaminCMg: 0, ironMg: 0, zincMg: 0, calciumMg: 0, fiberG: 0 });
    const rows = [
      { date: '2026-11-01', nutrientsJson: real(30), calories: 500 }, { date: '2026-11-01', nutrientsJson: real(20), calories: 400 }, { date: '2026-11-01', nutrientsJson: null, calories: 100 },
      { date: '2026-11-02', nutrientsJson: real(30), calories: 200 }, { date: '2026-11-02', nutrientsJson: zeros, calories: 579 },
    ];
    expect(E.microDaysFrom(rows, ['vitaminCMg'])).toEqual([{ date: '2026-11-01', totals: { vitaminCMg: 50 } }]);
  });
  it('meal logging that dropped off, and sessions missed against the plan', () => {
    const steady = Array.from({ length: 12 }, (_, i) => ({ date: `2026-10-${String(13 + i).padStart(2, '0')}`, proteinG: 100, kcal: 2000 }));
    expect(E.loggingEvidence([...steady, { date: '2026-10-31', proteinG: 90, kcal: 1800 }], today)?.text).toBe('Meals logged on 1 of the last 7 days');
    expect(E.loggingEvidence(steady.slice(0, 3), today)).toBeNull();
    const w = (date: string) => ({ date, title: 'Lift', exercises: '[]' });
    expect(E.adherenceEvidence([w('2026-10-21'), w('2026-10-23'), w('2026-10-25'), w('2026-10-30')], 4, today)?.text).toBe('1 session in the last 7 days · plan has 4');
    expect(E.adherenceEvidence([w('2026-10-30'), w('2026-11-01')], 4, today)).toBeNull();
  });
  it('injuries come from both the profile and the constraints text', () => {
    expect(R.injuryLines({ injuries: [{ text: 'Left Achilles rupture' }] }, 'Post-surgery, no jumping yet')).toEqual(['Left Achilles rupture', 'Post-surgery, no jumping yet']);
    expect(R.injuryLines(null, 'Prefer mornings')).toEqual([]);
    expect(R.injuryLines({ injuries: [{ text: 'Left knee injury last year but has healed' }] }, 'wrist pain, fully healed')).toEqual([]);
  });
});

describe('thread receipts order and voice', () => {
  it('symptoms first, then soonest check-back; Anakin\'s own question says "I asked"', () => {
    const t = (id: string, kind: string, checkBackAt: string, sourceRole = 'user') => ({ id, kind, title: id, status: 'open', eventDate: null, sourceQuote: `q ${id}`, sourceAt: null, sourceRole, checkBackAt });
    const out = E.threadEvidence([t('goal', 'goal', '2026-12-01'), t('ask', 'question', '2026-11-01', 'assistant'), t('pain', 'symptom', '2026-11-02')], today);
    expect(out.map((x) => x.id)).toEqual(['thread_pain', 'thread_ask', 'thread_goal']);
    expect(out[1].text).toBe('“q ask” · I asked');
  });
});
