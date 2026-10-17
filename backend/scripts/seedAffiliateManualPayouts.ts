// Record payouts already made to affiliates outside Stripe (UGC fees etc.).
// Idempotent: each row carries a fixed `reference`; a row whose reference
// already exists for that affiliate is left alone. Affiliates are looked up by
// email; missing affiliates are skipped.
//
//   cd backend && DATABASE_URL="file:/path/to.db" npx tsx scripts/seedAffiliateManualPayouts.ts [--dry-run]
import { PrismaClient } from '@prisma/client';
// Raw-SQL storage: works even when the installed Prisma client predates the
// AffiliateManualPayout model.
import { findManualPayoutByReference, insertManualPayoutRow } from '../src/services/affiliateExtrasRepo.js';

const prisma = new PrismaClient();

const PAID_ON = new Date('2026-10-17T12:00:00Z');
const DESCRIPTION = 'Paid to date (recorded 2026-10-17)';

interface SeedRow {
  email: string;
  reference: string;
  kind: 'ugc' | 'discretionary';
  description: string;
  amountCents: number;
  status: 'paid' | 'pending';
  note?: string;
}

const ROWS: SeedRow[] = [
  { email: 'kavi765@gmail.com', reference: 'AXM-2026-10-17-UGC', kind: 'ugc', description: DESCRIPTION, amountCents: 14000, status: 'paid' },
  { email: 'saeed.abiissa@gmail.com', reference: 'AXM-2026-10-17-UGC', kind: 'ugc', description: DESCRIPTION, amountCents: 16000, status: 'paid' },
  {
    email: 'saeed.abiissa@gmail.com', reference: 'AXM-2026-10-17-BONUS', kind: 'discretionary',
    description: 'Discretionary bonus', amountCents: 0, status: 'pending', note: 'Discretionary bonus — amount to confirm',
  },
  { email: 'amarachiokorafor18@gmail.com', reference: 'AXM-2026-10-17-UGC', kind: 'ugc', description: DESCRIPTION, amountCents: 7500, status: 'paid' },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  let created = 0, existing = 0, skipped = 0;
  for (const row of ROWS) {
    const affiliate = await prisma.affiliate.findUnique({ where: { email: row.email } });
    if (!affiliate) {
      console.log(`skip  ${row.email}: no affiliate with that email`);
      skipped++;
      continue;
    }
    const found = await findManualPayoutByReference(affiliate.id, row.reference);
    if (found) {
      console.log(`exists ${affiliate.name} <${row.email}> ${row.reference}`);
      existing++;
      continue;
    }
    const amount = `CA$${(row.amountCents / 100).toFixed(2)}`;
    if (dryRun) {
      console.log(`would create ${affiliate.name} <${row.email}> ${row.kind} ${amount} ${row.status}`);
      continue;
    }
    await insertManualPayoutRow(affiliate.id, {
      kind: row.kind,
      description: row.description,
      amountCents: row.amountCents,
      currency: 'CAD',
      status: row.status,
      paidAt: row.status === 'paid' ? PAID_ON : null,
      reference: row.reference,
      note: row.note ?? null,
    });
    console.log(`create ${affiliate.name} <${row.email}> ${row.kind} ${amount} ${row.status}`);
    created++;
  }
  console.log(`done: ${created} created, ${existing} already present, ${skipped} skipped${dryRun ? ' (dry run)' : ''}`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
