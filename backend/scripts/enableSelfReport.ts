// Turn the "log people you referred before you had a code" dashboard card on
// (or off) for one affiliate. Idempotent; raw SQL so it works whatever Prisma
// client is installed (the column must already be pushed).
//
//   cd backend && DATABASE_URL="file:/path/to.db" npx tsx scripts/enableSelfReport.ts --email someone@example.com [--off]
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find(a => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

async function main() {
  const email = (argValue('--email') ?? '').trim().toLowerCase();
  const enable = !process.argv.includes('--off');
  if (!email || !email.includes('@')) {
    console.error('usage: npx tsx scripts/enableSelfReport.ts --email <affiliate email> [--off]');
    process.exitCode = 2;
    return;
  }

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT "id", "name", "referralCode", "active", "selfReportEnabled" FROM "Affiliate" WHERE lower("email") = ?`,
    email,
  )) as Array<Record<string, any>>;
  const a = rows[0];
  if (!a) {
    console.error(`no affiliate with email ${email}`);
    process.exitCode = 1;
    return;
  }

  const current = Number(a.selfReportEnabled) === 1 || a.selfReportEnabled === true;
  const label = `${a.name} <${email}> ${a.referralCode}`;
  if (current === enable) {
    console.log(`unchanged ${label}: selfReportEnabled already ${enable}`);
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE "Affiliate" SET "selfReportEnabled" = ?, "updatedAt" = ? WHERE "id" = ?`,
      enable ? 1 : 0, Date.now(), a.id,
    );
    console.log(`updated ${label}: selfReportEnabled ${current} -> ${enable}`);
  }
  const isActive = Number(a.active) === 1 || a.active === true;
  if (enable && !isActive) console.warn(`note: ${label} is not active — the card stays hidden until they are`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
