// Program rescue sweep — the conversion-funnel backstop.
//
// July's funnel showed the single biggest leak was users who completed the
// full coach intake but never generated a program (9 completed intake, only
// 3 generated). The client now resumes them at Build Your Program and
// auto-starts generation, but this sweep guarantees the payoff server-side:
// any user whose intake has been sitting finished with no program for
// RESCUE_AFTER_MS gets their program generated from the saved profile and a
// push telling them it's ready. The 30-minute delay keeps the sweep from
// racing a user who is actively finishing the flow in-app.
import { PrismaClient } from '@prisma/client';
import { generateTrainingProgram } from './llmService.js';
import { sendPushToUser } from './notificationService.js';
import { cacheDelete } from './cacheService.js';

const prisma = new PrismaClient();

const RESCUE_AFTER_MS = 30 * 60 * 1000;
const MAX_PER_SWEEP = 5;
const MAX_ATTEMPTS = 3;

// In-memory attempt counter so a user whose profile reliably breaks
// generation doesn't burn LLM spend every sweep. Resets on restart, which
// doubles as a slow retry.
const attempts = new Map<string, number>();

// Mirrors the private goal inference in routes/coach.ts (kept local to avoid
// importing a route module into a service).
function inferGoal(trainingPreference?: string, primaryGoal?: string): string {
  const pref = (trainingPreference || '').toLowerCase();
  if (['strength', 'hypertrophy', 'athletic', 'mixed'].includes(pref)) return pref;
  const goal = (primaryGoal || '').toLowerCase();
  if (goal.includes('strength') || goal.includes('strong')) return 'strength';
  if (goal.includes('muscle') || goal.includes('hypertro') || goal.includes('size')) return 'hypertrophy';
  if (goal.includes('athletic') || goal.includes('power') || goal.includes('sport')) return 'athletic';
  return 'strength';
}

function clampDays(raw: unknown): number {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? Math.min(6, Math.max(2, n)) : 4;
}

function isTestAccount(email: string | null): boolean {
  const e = (email || '').toLowerCase();
  return e.includes('axiom.test') || e.includes('pomelo') || e.includes('cis3760') || e.includes('@example.com');
}

// A draft is only promotable if it looks like a real program — mirrors the
// client's validity check (a `phases` array with at least one entry).
function parseDraft(raw: string | null): any | null {
  if (!raw) return null;
  try {
    const prog = JSON.parse(raw);
    if (prog && typeof prog === 'object' && Array.isArray(prog.phases) && prog.phases.length > 0) {
      return prog;
    }
  } catch { /* corrupt draft — fall through to regeneration */ }
  return null;
}

export async function runProgramRescueSweep(): Promise<{ rescued: number; failed: number }> {
  const cutoff = new Date(Date.now() - RESCUE_AFTER_MS);
  const stranded = await prisma.user.findMany({
    where: {
      savedProgram: null,
      updatedAt: { lt: cutoff },
      // Two stranded shapes: (a) they generated a program but never tapped
      // Save — promote the stored draft, no LLM spend; (b) they finished the
      // intake but never generated — generate from the saved profile.
      OR: [
        { draftProgram: { not: null } },
        { coachOnboardingDone: true, coachProfile: { not: null } },
      ],
    },
    select: {
      id: true, email: true, coachProfile: true, trainingAge: true,
      equipment: true, weightKg: true, heightCm: true, draftProgram: true,
    },
    take: 50,
  });

  let rescued = 0;
  let failed = 0;
  for (const user of stranded) {
    if (rescued + failed >= MAX_PER_SWEEP) break;
    if (isTestAccount(user.email)) continue;
    if ((attempts.get(user.id) ?? 0) >= MAX_ATTEMPTS) continue;

    let profile: any = {};
    try { profile = user.coachProfile ? JSON.parse(user.coachProfile) : {}; } catch { /* tolerate */ }

    try {
      // Prefer the draft they already generated in-app — it reflects their
      // exact picker choices and costs nothing to promote.
      let program = parseDraft(user.draftProgram);
      if (!program) {
        // No usable draft. Without an intake profile there is nothing to
        // generate from — skip rather than produce a generic program.
        if (!user.coachProfile) continue;
        const goal = inferGoal(profile?.trainingPreference, profile?.primaryGoal);
        program = await generateTrainingProgram({
          goal,
          daysPerWeek: clampDays(profile?.frequency),
          durationWeeks: 8,
          trainingAge: user.trainingAge,
          equipment: user.equipment,
          primaryLimiter: null,
          selectedLift: null,
          accessories: [],
          coachProfile: user.coachProfile,
          diagnosticSignals: null,
          gender: profile?.gender ?? null,
        });
      }

      // Guard against a race: if they generated in-app while we worked, keep theirs.
      const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { savedProgram: true } });
      if (fresh?.savedProgram) continue;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          savedProgram: JSON.stringify(program),
          programStartDate: new Date(),
          draftProgram: null,
          draftProgramAt: null,
        },
      });
      cacheDelete(`program:${user.id}`);

      await sendPushToUser(
        user.id,
        'Your program is ready',
        'We built your personalized training program from your intake. Open Axiom to see it.',
        { type: 'program_rescued' },
      ).catch(() => { /* push is best-effort; the program is saved regardless */ });

      rescued++;
      attempts.delete(user.id);
      console.log(`[program-rescue] generated program for ${user.email}`);
    } catch (err) {
      failed++;
      attempts.set(user.id, (attempts.get(user.id) ?? 0) + 1);
      console.error(`[program-rescue] generation failed for ${user.email}:`, err);
    }
  }

  if (rescued || failed) console.log(`[program-rescue] sweep done: ${rescued} rescued, ${failed} failed`);
  return { rescued, failed };
}
