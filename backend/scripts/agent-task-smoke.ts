// Live task smoke — runs one agent TASK against a real user in the isolated
// DB. Usage:
//   npx tsx scripts/agent-task-smoke.ts <taskId> "<input>" [username]
// e.g.
//   npx tsx scripts/agent-task-smoke.ts life_happened "I was traveling all week" pomelowarrior

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runAgentTask, type AgentTaskId } from '../src/agent/tasks.js';

const prisma = new PrismaClient();

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('✗ ANTHROPIC_API_KEY not set'); process.exit(1); }
  const taskId = (process.argv[2] || 'daily_tips') as AgentTaskId;
  const input = process.argv[3] || undefined;
  const username = process.argv[4] || 'pomelowarrior';

  const user = await prisma.user.findFirst({ where: { username }, select: { id: true, name: true } });
  if (!user) { console.error(`✗ user "${username}" not found`); process.exit(1); }

  console.log(`\n=== Task: ${taskId} | user: ${user.name} | input: ${input ?? '(none)'} ===\n`);
  const t0 = Date.now();
  const res = await runAgentTask(user.id, taskId, input);
  console.log(`(${Date.now() - t0}ms, ${res.iterations} iter, tools: ${res.toolsUsed.join(', ') || 'none'})\n`);
  console.log(res.reply);
  console.log('\n=== done ===\n');
}

main().catch((e) => { console.error('crashed:', e); process.exit(1); }).finally(() => prisma.$disconnect());
