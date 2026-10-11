// Run ingest.mjs for every registry chain/country with a nutrition URL.
//   node scripts/chains/ingestAll.mjs [--only id,id] [--workers 4]
// Priority chains first. One chain per worker; politeFetch keeps 2 s/host.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = process.cwd();
const reg = JSON.parse(fs.readFileSync(path.join(root, 'data/chains/registry.json'), 'utf8'));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const only = arg('--only')?.split(',');
const workers = Number(arg('--workers') ?? 4);
const PRIORITY = ['starbucks', 'tim-hortons', 'mcdonalds', 'a-and-w-canada', 'chick-fil-a', 'wendys', 'burger-king', 'dunkin', 'harveys', 'mary-browns', 'booster-juice', 'chipotle', 'taco-bell', 'popeyes', 'kfc', 'five-guys', 'panera-bread', 'pizza-pizza', 'swiss-chalet', 'freshii', 'osmows', 'second-cup', 'dairy-queen', 'arbys', 'domino-s', 'pizza-hut'];
const jobs = [];
for (const c of reg) for (const cc of ['CA', 'US']) if (c.nutritionUrl?.[cc] && (!only || only.includes(c.id))) jobs.push({ id: c.id, cc });
jobs.sort((a, b) => ((PRIORITY.indexOf(a.id) + 1 || 999) - (PRIORITY.indexOf(b.id) + 1 || 999)));
console.log(`${jobs.length} chain/country jobs, ${workers} workers`);
const run = (j) => new Promise((resolve) => {
  const p = spawn(process.execPath, ['scripts/chains/ingest.mjs', j.id, j.cc], { cwd: root, env: process.env });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  const kill = setTimeout(() => p.kill('SIGKILL'), 15 * 60 * 1000);
  p.on('close', (code) => { clearTimeout(kill); const line = out.split('\n').filter((l) => l.startsWith(`${j.id}.`) || /Error|failed/.test(l)).slice(-1)[0] ?? `${j.id}.${j.cc}: exit ${code}`; console.log(line.slice(0, 220)); resolve(); });
});
const queue = [...jobs];
await Promise.all(Array.from({ length: workers }, async () => { while (queue.length) await run(queue.shift()); }));
console.log('done');
