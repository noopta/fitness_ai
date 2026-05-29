// Live agent smoke test — runs real agent turns against a real user in the
// ISOLATED worktree DB (port 3151 / separate dev.db). Makes real Anthropic
// API calls (a few cents). Run from backend/:
//
//   npx tsx scripts/agent-smoke.ts [username]
//
// Defaults to "pomelowarrior". Requires ANTHROPIC_API_KEY in .env. Does NOT
// touch production — uses the worktree's copied DB.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runAgentTurn } from '../src/agent/loop.js';

const prisma = new PrismaClient();

// A small script of representative turns exercising read + reasoning + a write.
const TURNS = [
  'How many calories and how much protein do I have left today?',
  'Given my goal, what should I have for dinner tonight?',
  "Remember that I train fasted in the mornings.",
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('✗ ANTHROPIC_API_KEY not set in .env — cannot make live calls.');
    process.exit(1);
  }
  const username = process.argv[2] || 'pomelowarrior';
  const user = await prisma.user.findFirst({
    where: { username },
    select: { id: true, username: true, name: true, tier: true, coachGoal: true },
  });
  if (!user) {
    console.error(`✗ user "${username}" not found in the isolated DB`);
    process.exit(1);
  }

  console.log(`\n=== Agent smoke — ${user.name} (@${user.username}, ${user.tier}) ===`);
  console.log(`Goal: ${user.coachGoal ?? '(none set)'}\n`);

  // Each turn loads + persists the rolling conversation so we exercise
  // multi-turn continuity too.
  const { loadConversation, appendTurn } = await import('../src/agent/conversation.js');

  for (const message of TURNS) {
    console.log(`\n── USER: ${message}`);
    const t0 = Date.now();
    const history = await loadConversation(user.id);
    const res = await runAgentTurn(user.id, message, history);
    await appendTurn(user.id, message, res.reply);
    const ms = Date.now() - t0;
    console.log(`── ANAKIN (${ms}ms, ${res.iterations} iter, tools: ${res.toolsUsed.join(', ') || 'none'}):`);
    console.log(res.reply);
  }
  console.log('\n=== done ===\n');
}

main()
  .catch((e) => { console.error('smoke crashed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
