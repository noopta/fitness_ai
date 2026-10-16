// Full structured export (handoff gap #4): the incumbents' moat is that a
// trainer's business is locked in their tool. Everything Axiom holds about a
// practice's clients comes out here, as one JSON document or as CSV tables,
// so leaving is as easy as arriving. Only what the practice is entitled to:
// its clients' training data, its own notes and records, and its messages
// with them — never another practice's.

import { bodyWeightKg } from '../weightUnits.js';
import { prisma } from './db.js';
import { PROSPECT_PREFIX, loadClients } from './roster.js';

const parse = (raw: string | null | undefined) => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
};

export async function practiceExport(practiceId: string, now: Date = new Date()) {
  const [practice, clients, coaches] = await Promise.all([
    prisma.institution.findUnique({ where: { id: practiceId }, select: { id: true, name: true, slug: true, createdAt: true } }),
    loadClients(practiceId, { includeProspects: true, includeArchived: true, now }),
    prisma.institutionMember.findMany({ where: { institutionId: practiceId, role: 'coach' }, select: { userId: true } }),
  ]);
  const userIds = clients.filter((c) => !c.id.startsWith(PROSPECT_PREFIX)).map((c) => c.id);
  const allIds = clients.map((c) => c.id);
  const coachIds = coaches.map((c) => c.userId);
  const inPractice = { practiceId, clientId: { in: allIds } };

  const [workouts, weights, meals, notes, contras, goals, measurements, photos, checkIns, reports, intakes, targets, convos, imported, importedWeights, prospects] = await Promise.all([
    prisma.workoutLog.findMany({ where: { userId: { in: userIds } }, orderBy: { createdAt: 'asc' }, select: { id: true, userId: true, date: true, title: true, exercises: true, notes: true, duration: true, createdAt: true } }),
    prisma.bodyWeightLog.findMany({ where: { userId: { in: userIds } }, orderBy: { createdAt: 'asc' } }),
    prisma.mealEntry.findMany({ where: { userId: { in: userIds } }, orderBy: { createdAt: 'asc' }, select: { userId: true, date: true, name: true, mealType: true, calories: true, proteinG: true, carbsG: true, fatG: true } }),
    prisma.ptNote.findMany({ where: inPractice, orderBy: { createdAt: 'asc' } }),
    prisma.ptContraindication.findMany({ where: inPractice, orderBy: { createdAt: 'asc' } }),
    prisma.ptGoal.findMany({ where: inPractice }),
    prisma.ptMeasurement.findMany({ where: inPractice, orderBy: { at: 'asc' } }),
    prisma.ptProgressPhoto.findMany({ where: inPractice, select: { clientId: true, date: true, pose: true, note: true, source: true } }),
    prisma.ptCheckIn.findMany({ where: { ...inPractice, status: 'submitted' }, orderBy: { submittedAt: 'asc' } }),
    prisma.ptReport.findMany({ where: { ...inPractice, status: 'sent' } }),
    prisma.ptIntake.findMany({ where: inPractice }),
    prisma.ptNutritionTarget.findMany({ where: inPractice }),
    prisma.directConversation.findMany({
      where: { OR: [{ participantAId: { in: coachIds }, participantBId: { in: userIds } }, { participantBId: { in: coachIds }, participantAId: { in: userIds } }] },
      select: { id: true, participantAId: true, participantBId: true },
    }),
    prisma.ptImportedWorkout.findMany({ where: { practiceId }, orderBy: { at: 'asc' } }),
    prisma.ptImportedWeight.findMany({ where: { practiceId }, orderBy: { at: 'asc' } }),
    prisma.ptProspect.findMany({ where: { practiceId }, select: { id: true, userId: true } }),
  ]);
  const messages = convos.length
    ? await prisma.message.findMany({ where: { conversationId: { in: convos.map((c) => c.id) } }, orderBy: { createdAt: 'asc' }, select: { conversationId: true, senderId: true, body: true, createdAt: true } })
    : [];
  const convoClient = new Map(convos.map((c) => [c.id, userIds.includes(c.participantAId) ? c.participantAId : c.participantBId]));
  const prospectOwner = new Map(prospects.map((p) => [p.id, p.userId ?? `${PROSPECT_PREFIX}${p.id}`]));

  const group = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  };
  const gWorkouts = group(workouts, (w) => w.userId);
  const gWeights = group(weights, (w) => w.userId);
  const gMeals = group(meals, (m) => m.userId);
  const gNotes = group(notes, (n) => n.clientId);
  const gContras = group(contras, (c) => c.clientId);
  const gGoals = group(goals, (g) => g.clientId);
  const gMeas = group(measurements, (m) => m.clientId);
  const gPhotos = group(photos, (p) => p.clientId);
  const gCheck = group(checkIns, (c) => c.clientId);
  const gReports = group(reports, (r) => r.clientId);
  const gIntake = new Map(intakes.map((i) => [i.clientId, i]));
  const gTargets = new Map(targets.map((t) => [t.clientId, t]));
  const gMsgs = group(messages, (m) => convoClient.get(m.conversationId) ?? '');
  const gImported = group(imported, (w) => prospectOwner.get(w.prospectId) ?? '');
  const gImportedW = group(importedWeights, (w) => prospectOwner.get(w.prospectId) ?? '');

  return {
    format: 'axiom-practice-export',
    version: 1,
    exportedAt: now.toISOString(),
    practice,
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      contactEmail: c.contactEmail ?? null,
      contactPhone: c.contactPhone ?? null,
      channel: c.channel,
      status: c.status,
      state: c.state ?? 'active',
      tags: c.tags ?? [],
      joinedAt: c.joinedAt,
      contraindications: (gContras.get(c.id) ?? []).map(({ practiceId: _p, clientId: _c, ...r }) => r),
      clientReportedInjuries: c.contraindications.filter((x) => x.id?.startsWith('inferred:')).map((x) => x.label),
      goals: (gGoals.get(c.id) ?? []).map(({ practiceId: _p, clientId: _c, ...r }) => r),
      measurements: (gMeas.get(c.id) ?? []).map((m) => ({ kind: m.kind, label: m.label, value: m.value, unit: m.unit, date: m.date, source: m.source })),
      bodyweights: (gWeights.get(c.id) ?? []).map((w) => ({ date: w.date, weightKg: bodyWeightKg(w) })),
      workouts: [
        ...(gWorkouts.get(c.id) ?? []).map((w) => ({ date: w.date, title: w.title, exercises: parse(w.exercises), notes: w.notes, durationMin: w.duration, source: 'logged' })),
        ...(gImported.get(c.id) ?? []).map((w) => ({ date: w.date, title: w.title, exercises: parse(w.exercises), notes: w.notes, durationMin: null, source: 'imported' })),
      ],
      importedBodyweights: (gImportedW.get(c.id) ?? []).map((w) => ({ date: w.date, weightKg: w.weightKg })),
      meals: (gMeals.get(c.id) ?? []).map(({ userId: _u, ...m }) => m),
      nutritionTargets: gTargets.get(c.id) ? { calories: gTargets.get(c.id)!.calories, proteinG: gTargets.get(c.id)!.proteinG, carbsG: gTargets.get(c.id)!.carbsG, fatG: gTargets.get(c.id)!.fatG } : null,
      checkIns: (gCheck.get(c.id) ?? []).map((k) => ({ dueAt: k.dueAt, submittedAt: k.submittedAt, questions: parse(k.questionsJson), answers: parse(k.answersJson), summary: k.summary })),
      intake: gIntake.get(c.id) ? { status: gIntake.get(c.id)!.status, answers: parse(gIntake.get(c.id)!.answersJson), transcript: parse(gIntake.get(c.id)!.transcriptJson) } : null,
      notes: (gNotes.get(c.id) ?? []).map((n) => ({ body: n.body, createdAt: n.createdAt })),
      reports: (gReports.get(c.id) ?? []).map((r) => ({ month: r.month, narrative: r.narrative, coachNote: r.coachNote, stats: parse(r.statsJson), sentAt: r.sentAt })),
      progressPhotos: (gPhotos.get(c.id) ?? []).map(({ clientId: _c, ...p }) => p),
      messages: (gMsgs.get(c.id) ?? []).map((m) => ({ at: m.createdAt, fromClient: m.senderId === c.id, body: m.body })),
    })),
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    // Leading = + - @ would be read as a formula by a spreadsheet.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export type CsvTable = 'clients' | 'workouts' | 'measurements' | 'contraindications';

export function exportCsv(data: Awaited<ReturnType<typeof practiceExport>>, table: CsvTable): string {
  if (table === 'clients') {
    return toCsv([
      ['client_id', 'name', 'email', 'contact_email', 'phone', 'channel', 'status', 'state', 'tags', 'joined_at', 'injuries'],
      ...data.clients.map((c) => [c.id, c.name, c.email, c.contactEmail, c.contactPhone, c.channel, c.status, c.state, c.tags.join('; '), c.joinedAt,
        [...c.contraindications.filter((x) => !x.archivedAt).map((x) => `${x.condition} (${x.clearance})`), ...c.clientReportedInjuries].join('; ')]),
    ]);
  }
  if (table === 'workouts') {
    const rows: (string | number | null)[][] = [['client_id', 'client', 'date', 'session', 'exercise', 'sets', 'reps', 'weight_kg', 'rpe', 'source']];
    for (const c of data.clients) for (const w of c.workouts) {
      const ex = Array.isArray(w.exercises) ? w.exercises : [];
      if (!ex.length) rows.push([c.id, c.name, w.date, w.title, null, null, null, null, null, w.source]);
      for (const e of ex as any[]) rows.push([c.id, c.name, w.date, w.title, e?.name ?? null, e?.sets ?? null, e?.reps ?? null, e?.weightKg ?? null, e?.rpe ?? null, w.source]);
    }
    return toCsv(rows);
  }
  if (table === 'measurements') {
    const rows: (string | number | null)[][] = [['client_id', 'client', 'date', 'kind', 'value', 'unit', 'source']];
    for (const c of data.clients) {
      for (const w of c.bodyweights) if (w.weightKg) rows.push([c.id, c.name, w.date, 'bodyweight', Math.round(w.weightKg * 10) / 10, 'kg', 'client']);
      for (const w of c.importedBodyweights) rows.push([c.id, c.name, w.date, 'bodyweight', Math.round(w.weightKg * 10) / 10, 'kg', 'imported']);
      for (const m of c.measurements) rows.push([c.id, c.name, m.date, m.label ?? m.kind, m.value, m.unit, m.source]);
    }
    return toCsv(rows);
  }
  return toCsv([
    ['client_id', 'client', 'body_part', 'side', 'condition', 'severity', 'clearance', 'source', 'onset_date', 'notes', 'archived'],
    ...data.clients.flatMap((c) => c.contraindications.map((x) => [c.id, c.name, x.bodyPart, x.side, x.condition, x.severity, x.clearance, x.source, x.onsetDate, x.notes, x.archivedAt ? 'yes' : ''])),
  ]);
}
