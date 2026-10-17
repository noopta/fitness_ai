// Create/update the code-first affiliates and print their setup links.
// Idempotent: affiliates are matched by email; re-running changes nothing that
// already matches. Saeed and Kavi are CHECKED only (their codes are already
// live and are never changed here) — a mismatch is a warning, not an edit.
//
//   cd backend && AMARA_EMAIL=... UMAR_EMAIL=... FRONTEND_URL=https://axiomtraining.io \
//     DATABASE_URL="file:/path/to.db" npx tsx scripts/seedAffiliates.ts [--dry-run]
//
// Setup-link tokens are credentials: stdout shows only their last 4 chars.
// The full links are on the admin affiliates page.
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { affiliateSetupLink } from '../src/services/affiliateService.js';

const prisma = new PrismaClient();

const DISCOUNT_RATE = 0.2;
const COMMISSION_RATE = 0.4;

interface Managed { name: string; emailEnv: string; defaultEmail?: string; referralCode: string }
interface Checked { name: string; email: string; referralCode: string }

/** Created or updated by this script. */
const MANAGED: Managed[] = [
  // Emails confirmed 2026-10-17. Env vars still override if ever needed.
  { name: 'Amarachi Okorafor', emailEnv: 'AMARA_EMAIL', defaultEmail: 'amarachiokorafor18@gmail.com', referralCode: 'AMARACHI' },
  // Umar's existing affiliate row carries the placeholder name "Demby By" and
  // code EXCLUSIVE26; this run renames it and moves it to UMAR10.
  { name: 'Umar', emailEnv: 'UMAR_EMAIL', defaultEmail: 'faruqanjo@gmail.com', referralCode: 'UMAR10' },
];

/** Already live: verify only, never modified. */
const CHECKED: Checked[] = [
  { name: 'Saeed', email: 'saeed.abiissa@gmail.com', referralCode: 'SAEED10' },
  { name: 'Kavi', email: 'kavi765@gmail.com', referralCode: 'KAVI10' },
];

function maskSetupLink(link: string): string {
  return link.replace(/token=([^&#]+)/, (_m, t: string) => `token=${'*'.repeat(Math.max(0, t.length - 4))}${t.slice(-4)}`);
}

function linkLine(token: string | null | undefined): string {
  return token ? maskSetupLink(affiliateSetupLink(token)) : '(no setup token — invite them from the admin page)';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const tag = dryRun ? '[dry-run] ' : '';
  let created = 0, updated = 0, unchanged = 0, skipped = 0, warnings = 0;

  for (const m of MANAGED) {
    const email = (process.env[m.emailEnv] || m.defaultEmail || '').trim().toLowerCase();
    if (!email) {
      console.log(`skip   ${m.name} (${m.referralCode}): ${m.emailEnv} is not set`);
      skipped++;
      continue;
    }
    const existing = await prisma.affiliate.findUnique({ where: { email } });
    const codeOwner = await prisma.affiliate.findUnique({ where: { referralCode: m.referralCode } });
    if (codeOwner && codeOwner.email !== email) {
      console.warn(`WARN   ${m.name}: code ${m.referralCode} already belongs to another affiliate (${codeOwner.name}); skipped`);
      warnings++; skipped++;
      continue;
    }

    if (!existing) {
      const inviteToken = randomUUID();
      if (!dryRun) {
        await prisma.affiliate.create({
          data: {
            name: m.name, email, referralCode: m.referralCode,
            discountRate: DISCOUNT_RATE, commissionRate: COMMISSION_RATE,
            active: true, onboarded: false, inviteToken,
          },
        });
      }
      console.log(`${tag}create ${m.name} <${email}> code ${m.referralCode}  setup: ${dryRun ? '(token minted on the real run)' : linkLine(inviteToken)}`);
      created++;
      continue;
    }

    // Name is only set on create; an existing (fuller) name is kept.
    const want = { name: m.name, referralCode: m.referralCode, discountRate: DISCOUNT_RATE, commissionRate: COMMISSION_RATE, active: true };
    const diff: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(want)) if ((existing as any)[k] !== v) diff[k] = v;
    // A setup link needs a token; mint one only when there is none.
    const needsToken = !existing.inviteToken;
    const inviteToken = existing.inviteToken ?? (dryRun ? null : randomUUID());
    if (needsToken && inviteToken) diff.inviteToken = inviteToken;

    const changes = Object.keys(diff).filter(k => k !== 'inviteToken');
    if (!changes.length && !needsToken) {
      console.log(`ok     ${m.name} <${email}> code ${m.referralCode}  setup: ${linkLine(existing.inviteToken)}`);
      unchanged++;
      continue;
    }
    if (!dryRun) await prisma.affiliate.update({ where: { id: existing.id }, data: diff });
    const what = [...changes.map(k => `${k}: ${JSON.stringify((existing as any)[k])} → ${JSON.stringify(diff[k])}`), ...(needsToken ? ['new setup token'] : [])];
    console.log(`${tag}update ${m.name} <${email}> ${what.join(', ')}  setup: ${inviteToken ? linkLine(inviteToken) : '(token minted on the real run)'}`);
    updated++;
  }

  for (const c of CHECKED) {
    const a = await prisma.affiliate.findUnique({ where: { email: c.email } });
    if (!a) {
      console.warn(`WARN   ${c.name} <${c.email}>: no affiliate with that email (expected code ${c.referralCode})`);
      warnings++;
      continue;
    }
    const problems: string[] = [];
    if (a.referralCode !== c.referralCode) problems.push(`code is ${a.referralCode}, expected ${c.referralCode} (NOT changed)`);
    if (!a.active) problems.push('inactive — the checkout code field will say "Code not recognised" until activated');
    if (problems.length) { console.warn(`WARN   ${c.name} <${c.email}>: ${problems.join('; ')}`); warnings++; }
    console.log(`check  ${c.name} <${c.email}> code ${a.referralCode}  setup: ${linkLine(a.inviteToken)}`);
  }

  console.log(`done${dryRun ? ' (dry run, nothing written)' : ''}: ${created} created, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped, ${warnings} warning(s)`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
