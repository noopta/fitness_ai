// A program from the user's own coach, saved exactly as written (Oct 2026).
//
// Until now the only way to put a program in was propose_new_program, which
// WRITES a program — so a fighter pasting his S&C coach's split would have had
// it rewritten. This transcribes instead: pasted text, or photos/screenshots
// of a sheet, become the app's program structure with every exercise, set,
// rep, load and note kept verbatim. Nothing added, nothing "improved";
// anything unreadable is listed as unclear, not guessed. The program is marked
// source: 'coach' — progression suggestions only observe it.

import { client, SAFETY_SETTINGS } from './geminiService.js';

export const TRANSCRIBE_MODEL = process.env.COACH_IMPORT_MODEL || 'gemini-3.8-flash';

export interface CoachExercise { exercise: string; sets: number; reps: string; intensity: string; notes?: string }
export interface CoachDay { day: string; focus: string; warmup: string[]; exercises: CoachExercise[]; cooldown: string[] }
export interface CoachPhase { phaseName: string; durationWeeks: number; weeksLabel: string; trainingDays: CoachDay[]; progressionNotes: string[] }
export interface CoachProgram { name: string; coach: string | null; phases: CoachPhase[]; notes: string[]; unclear: string[] }

const SYSTEM = `You transcribe a training program written by the athlete's own strength & conditioning coach into JSON. You are a transcriber, not a coach.
Rules:
- Keep EVERYTHING exactly as written: exercise names, sets, reps (as text: "5", "3-5", "AMRAP", "30s"), loads/intensity ("RPE 8", "75%", "135 lb", "bodyweight", "tempo 3-1-1"), rest, notes, day names and order.
- Add nothing. No warm-ups, cool-downs, exercises, progressions or notes the coach didn't write. Don't fix, reorder or "improve" anything.
- Each distinct block/phase/week range the coach wrote is a phase; if they wrote one week to repeat, that is one phase (durationWeeks = how many weeks they said, else 1).
- Non-lifting sessions they listed (MMA, sparring, running, conditioning) are days too: put them in as exercises with sets 1, reps = the duration or distance, intensity = the effort as written.
- sets must be a number: "3x5" → sets 3, reps "5"; a single set or a timed block → 1.
- Anything you can't read or that is ambiguous goes in "unclear" (quote it) — never guess.
- Coach-wide notes (rest periods, how to progress, when to deload) go in "notes", verbatim.`;

const SCHEMA: any = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' }, coach: { type: 'STRING', nullable: true },
    phases: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      phaseName: { type: 'STRING' }, durationWeeks: { type: 'INTEGER' }, weeksLabel: { type: 'STRING' },
      progressionNotes: { type: 'ARRAY', items: { type: 'STRING' } },
      trainingDays: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        day: { type: 'STRING' }, focus: { type: 'STRING' },
        warmup: { type: 'ARRAY', items: { type: 'STRING' } }, cooldown: { type: 'ARRAY', items: { type: 'STRING' } },
        exercises: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
          exercise: { type: 'STRING' }, sets: { type: 'INTEGER' }, reps: { type: 'STRING' }, intensity: { type: 'STRING' }, notes: { type: 'STRING', nullable: true },
        }, required: ['exercise', 'sets', 'reps', 'intensity'] } },
      }, required: ['day', 'focus', 'exercises'] } },
    }, required: ['phaseName', 'durationWeeks', 'trainingDays'] } },
    notes: { type: 'ARRAY', items: { type: 'STRING' } }, unclear: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['name', 'phases', 'notes', 'unclear'],
};

/** Transcribe a coach's program from pasted text and/or photos of it. */
export async function transcribeCoachProgram(input: { text?: string | null; images?: { base64: string; mimeType: string }[]; coach?: string | null }): Promise<CoachProgram> {
  const text = String(input.text ?? '').slice(0, 60_000);
  const images = (input.images ?? []).slice(0, 8);
  if (!text.trim() && !images.length) throw new Error('Paste the program or add a photo of it.');
  const res = await client().models.generateContent({
    model: TRANSCRIBE_MODEL,
    config: { systemInstruction: SYSTEM, responseMimeType: 'application/json', responseSchema: SCHEMA, safetySettings: SAFETY_SETTINGS, temperature: 0 },
    contents: [{ role: 'user', parts: [
      { text: `${input.coach ? `Coach: ${input.coach}\n` : ''}Transcribe this program exactly.${text ? `\n\n${text}` : ''}` },
      ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.base64 } })),
    ] }],
  });
  return normalizeCoachProgram(JSON.parse(res.text ?? '{}'), input.coach ?? null);
}

/** Pure: clean the model's JSON (types, empties) without changing any content. */
export function normalizeCoachProgram(raw: any, coach: string | null): CoachProgram {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(s).filter(Boolean) : []);
  const phases: CoachPhase[] = (Array.isArray(raw?.phases) ? raw.phases : []).map((p: any, i: number) => ({
    phaseName: s(p?.phaseName) || `Block ${i + 1}`,
    durationWeeks: Math.max(1, Math.min(52, Math.round(Number(p?.durationWeeks) || 1))),
    weeksLabel: s(p?.weeksLabel),
    progressionNotes: arr(p?.progressionNotes),
    trainingDays: (Array.isArray(p?.trainingDays) ? p.trainingDays : []).map((d: any, k: number) => ({
      day: s(d?.day) || `Day ${k + 1}`, focus: s(d?.focus), warmup: arr(d?.warmup), cooldown: arr(d?.cooldown),
      exercises: (Array.isArray(d?.exercises) ? d.exercises : []).filter((e: any) => s(e?.exercise)).map((e: any) => ({
        exercise: s(e.exercise), sets: Math.max(1, Math.min(50, Math.round(Number(e.sets) || 1))), reps: s(e.reps) || '1', intensity: s(e.intensity), ...(s(e.notes) ? { notes: s(e.notes) } : {}),
      })),
    })).filter((d: CoachDay) => d.exercises.length || d.warmup.length),
  })).filter((p: CoachPhase) => p.trainingDays.length);
  // Week labels follow the coach's order when they didn't write any.
  let wk = 1;
  for (const p of phases) { if (!p.weeksLabel) p.weeksLabel = p.durationWeeks > 1 ? `Weeks ${wk}-${wk + p.durationWeeks - 1}` : `Week ${wk}`; wk += p.durationWeeks; }
  return { name: s(raw?.name) || 'Coach program', coach: s(raw?.coach) || coach, phases, notes: arr(raw?.notes), unclear: arr(raw?.unclear) };
}

/** Pure: the app's program shape, marked as the coach's (adaptation observes, never edits). */
export function toSavedProgram(p: CoachProgram, opts: { goal?: string | null } = {}) {
  const durationWeeks = p.phases.reduce((n, ph) => n + ph.durationWeeks, 0);
  const daysPerWeek = Math.max(...p.phases.map((ph) => ph.trainingDays.length), 1);
  return {
    source: 'coach' as const,
    coachName: p.coach,
    importedAt: new Date().toISOString(),
    name: p.name,
    goal: opts.goal ?? p.name,
    daysPerWeek,
    durationWeeks,
    phases: p.phases.map((ph, i) => ({ phaseNumber: i + 1, phaseName: ph.phaseName, rationale: 'From your coach.', durationWeeks: ph.durationWeeks, weeksLabel: ph.weeksLabel, trainingDays: ph.trainingDays, progressionNotes: ph.progressionNotes, deloadProtocol: '' })),
    autoregulationRules: [],
    trackingMetrics: [],
    coachNotes: p.notes,
  };
}

/** Pure: a short, faithful readback for the preview card ("Mon · Squat 5×3 @ RPE 8, Bench 4×6…"). */
export function previewLines(p: CoachProgram, max = 7): { key: string; value: string; sub?: string }[] {
  const first = p.phases[0];
  if (!first) return [];
  return first.trainingDays.slice(0, max).map((d) => ({
    key: d.day,
    value: d.focus || `${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'}`,
    sub: d.exercises.slice(0, 4).map((e) => `${e.exercise} ${e.sets}×${e.reps}${e.intensity ? ` @ ${e.intensity}` : ''}`).join(', ') + (d.exercises.length > 4 ? '…' : ''),
  }));
}
