// Runs every agent task once against a real user (isolated DB) and prints a
// compact result for each. Live Anthropic calls — a few cents total.
//   npx tsx scripts/agent-task-smoke-all.ts [username]

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runAgentTask, type AgentTaskId } from '../src/agent/tasks.js';

const prisma = new PrismaClient();

const CASES: Array<{ id: AgentTaskId; input?: string }> = [
  { id: 'program_adjustment', input: 'My arms feel behind — can we add some direct arm volume without blowing up my schedule?' },
  { id: 'plateau', input: 'My bench has been stuck at the same weight for about 6 weeks.' },
  { id: 'meal_suggestions' },
  { id: 'daily_tips' },
  { id: 'weekly_review' },
  { id: 'injury_intake', input: 'My left knee has been aching during squats the last few sessions.' },
  { id: 'research_apply', input: 'Does training to failure actually matter for hypertrophy?' },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('✗ ANTHROPIC_API_KEY not set'); process.exit(1); }
  const username = process.argv[2] || 'pomelowarrior';
  const user = await prisma.user.findFirst({ where: { username }, select: { id: true, name: true } });
  if (!user) { console.error(`✗ user "${username}" not found`); process.exit(1); }

  console.log(`\n############ Running all tasks for ${user.name} ############\n`);
  for (const c of CASES) {
    const t0 = Date.now();
    try {
      const res = await runAgentTask(user.id, c.id, c.input);
      const ms = Date.now() - t0;
      console.log(`\n================ ${c.id} ================`);
      if (c.input) console.log(`INPUT: ${c.input}`);
      console.log(`(${ms}ms · ${res.iterations} iter · tools: ${res.toolsUsed.join(', ') || 'none'})`);
      console.log('---');
      console.log(res.reply);
    } catch (e: any) {
      console.log(`\n================ ${c.id} ================`);
      console.log(`✗ FAILED: ${e?.message ?? e}`);
    }
  }
  console.log('\n############ done ############\n');
}

main().catch((e) => { console.error('crashed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
