/**
 * READ-ONLY audit of weight-unit data integrity. Mutates nothing.
 *
 * Surfaces how many logged workout rows have weights that are implausible as
 * kilograms (a strong signal they were logged on web pre-fix, where lbs were
 * stored in the kg field — see UNITS.md). Use this to size the historical
 * impact before deciding on any per-user, human-reviewed correction.
 *
 * Run:  npx tsx scripts/auditWeightUnits.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// A barbell load above this many "kg" is implausible for almost all lifters and
// suggests the value is really pounds (e.g. a 315 "kg" bench = 694 lb).
const IMPLAUSIBLE_KG = 300;

async function main() {
  const logs = await prisma.workoutLog.findMany({ select: { id: true, userId: true, exercises: true } });
  let totalRows = 0;
  let withWeight = 0;
  let implausible = 0;
  const usersAffected = new Set<string>();

  for (const log of logs) {
    totalRows++;
    let exs: any[] = [];
    try { exs = JSON.parse(log.exercises); } catch { continue; }
    for (const ex of exs) {
      const w = Number(ex?.weightKg);
      const setW = Array.isArray(ex?.setEntries)
        ? ex.setEntries.map((s: any) => Number(s?.weightKg)).filter(Number.isFinite)
        : [];
      const maxW = Math.max(w || 0, ...setW, 0);
      if (maxW > 0) withWeight++;
      if (maxW > IMPLAUSIBLE_KG) { implausible++; usersAffected.add(log.userId); }
    }
  }

  const prefs = await prisma.user.groupBy({ by: ['unitPreference'], _count: true }).catch(() => []);

  console.log('── Weight-unit audit (read-only) ──');
  console.log(`workout logs scanned:        ${totalRows}`);
  console.log(`exercise entries w/ weight:  ${withWeight}`);
  console.log(`entries > ${IMPLAUSIBLE_KG}kg (likely lbs): ${implausible}`);
  console.log(`distinct users affected:     ${usersAffected.size}`);
  console.log('unitPreference distribution:', prefs);
  console.log('\nNote: implausible rows are a HEURISTIC, not proof. Do not auto-convert —');
  console.log('mobile rows in the same field are already true kg. See UNITS.md.');

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
