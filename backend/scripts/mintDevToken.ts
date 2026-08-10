/**
 * Mint a short-lived JWT for local device testing.
 *
 * DEV ONLY. This prints a working bearer token to stdout, so it is only safe
 * because running it already requires JWT_SECRET and read access to the local
 * database — anyone who can run it can already sign tokens by hand. Never wire
 * this into a route, a CI job, or anything that logs its output.
 *
 * Defaults to a 12h expiry so a token left in a phone's browser history stops
 * working the same day.
 *
 *   npx tsx scripts/mintDevToken.ts                    # first user with meals
 *   npx tsx scripts/mintDevToken.ts --email me@x.com
 *   npx tsx scripts/mintDevToken.ts --hours 2
 *   npx tsx scripts/mintDevToken.ts --quiet            # token only, for scripts
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const QUIET = process.argv.includes('--quiet');

async function main() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET is not set — source backend/.env first.');
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  const email = arg('--email');
  const hours = Number(arg('--hours') ?? 12);

  const select = { id: true, email: true, tier: true, savedProgram: true } as const;
  const user = email
    ? await prisma.user.findFirst({ where: { email: { contains: email } }, select })
    // No email given: pick someone who has actually logged meals, otherwise the
    // finder has no gap to reason about and the page looks broken.
    : await prisma.user.findFirst({ where: { mealEntries: { some: {} } }, select });

  if (!user) {
    console.error(email ? `No user matching "${email}".` : 'No user with logged meals.');
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, tier: user.tier },
    secret,
    { expiresIn: `${hours}h` },
  );

  if (QUIET) {
    console.log(token);
  } else {
    const meals = await prisma.mealEntry.count({ where: { userId: user.id } });
    console.error(`user: ${user.email} | tier: ${user.tier} | meals: ${meals} | program: ${user.savedProgram ? 'yes' : 'no'} | expires in ${hours}h`);
    console.log(token);
  }

  await prisma.$disconnect();
}

main();
