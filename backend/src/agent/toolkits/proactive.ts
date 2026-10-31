// Prepared work (design B1): the agent proposes next week as a diff. The
// tool turns the diff into the program the Apply would save — deterministic,
// so the card shows exactly what will change. When a coach runs the program
// (B9) the same input becomes a message for the coach, never an edit.

import { registerToolkit } from '../registry.js';
import { tool, schema, str, prisma } from './kit.js';
import { addDays } from '../../proactive/threads.js';
import { applyWeekChanges, firstAffectedAt, preparedCard, preparedExpiry, type PreparedWork, type WeekChange } from '../../proactive/prepared.js';
import { getProactivePrefs } from '../../proactive/prefs.js';
import { proactiveAvailableFor } from '../../services/featureFlags.js';

const propose_week_change = tool({
  name: 'propose_week_change', kind: 'propose', fn: 'PRO-02',
  description: 'Propose next week as a DIFF the user can apply in one tap (a recovery week before a fight, a lighter week after a rough stretch, a reshaped week around travel). changes = one row per session you change: { day: "Mon", exercise: "Back squat", from: "5×5 @ 265", to: "3×5 @ 225" }. Use the exercises actually on their program days; for non-lifting work (sparring, conditioning) describe it ("Hard rounds 6×3" → "Drilling 4×3"). Nothing changes until they tap Apply. If their coach runs the program the card becomes a message to the coach instead.',
  input_schema: schema({
    title: { type: 'string', description: 'Two or three words: "Recovery week", "Travel week".' },
    startDate: { type: 'string', description: 'YYYY-MM-DD, the first day of the week being changed.' },
    endDate: { type: 'string', description: 'YYYY-MM-DD, the last day.' },
    rationale: { type: 'string', description: 'One or two short sentences, their numbers: "23 days out. Deload now, build after."' },
    changes: { type: 'array', items: { type: 'object', properties: { day: { type: 'string' }, exercise: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['day', 'exercise', 'from', 'to'] } },
    checkBackAt: { type: 'string', description: 'YYYY-MM-DD when you will compare and report (default: the day after endDate).' },
    measureLift: { type: 'string', description: 'The lift the outcome report should measure (e.g. "Chest-supported row"). Optional.' },
    reasons: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short facts for the coach version: "6 hard sessions in 6 days".' },
  }, ['title', 'startDate', 'endDate', 'rationale', 'changes']),
  execute: async (input, userId) => {
    const changes = (Array.isArray(input.changes) ? input.changes : []).map((c: any): WeekChange => ({ day: str(c.day), exercise: str(c.exercise), from: str(c.from), to: str(c.to) })).filter((c) => c.day && c.exercise && c.to).slice(0, 8);
    if (!changes.length) throw new Error('No changes to propose.');
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true, email: true } });
    if (!u || !proactiveAvailableFor(userId, u.email)) throw new Error('Prepared weeks aren’t on for this user yet — describe the change in words and offer propose_program_edit instead.');
    if (!u?.savedProgram) throw new Error('There’s no program to change yet.');
    const program = JSON.parse(u.savedProgram);
    const { program: programNext, applied, missed } = applyWeekChanges(program, changes, 0, str(input.title, 'Change'));
    const prefs = await getProactivePrefs(userId);
    const p: PreparedWork = {
      title: str(input.title, 'Change'), startDate: str(input.startDate), endDate: str(input.endDate), rationale: str(input.rationale),
      changes, checkBackAt: str(input.checkBackAt) || addDays(str(input.endDate), 1), measureLift: str(input.measureLift) || null,
      reasons: Array.isArray(input.reasons) ? input.reasons.map(String).slice(0, 3) : [],
    };
    const now = new Date().toISOString();
    const first = firstAffectedAt(p, prefs.sessionTime);
    const expiresAt = preparedExpiry(first, now);
    const ev = await prisma.proactiveEvent.create({ data: { userId, kind: 'prepared', topic: p.title.toLowerCase(), channel: 'chat', text: `${p.title} · ${p.startDate}` } }).catch(() => null);
    return { prepared: p, applied, missed: missed.map((m) => `${m.day} ${m.exercise}`), programOwner: prefs.programOwner, expiresAt, _card: preparedCard(p, { programNext, programOwner: prefs.programOwner, prevProgram: u.savedProgram, eventId: ev?.id ?? null, expiresAt, sessionTime: prefs.sessionTime }) };
  },
  card: (_input, result) => result?._card ?? null,
  receipt: (input) => ({ verb: 'Proposed', text: `${str(input.title, 'Change')} · ${str(input.startDate)}` }),
});

registerToolkit([propose_week_change]);
