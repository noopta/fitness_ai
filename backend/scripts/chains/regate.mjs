// Re-run the quality gate over every menu already on disk (live and review),
// e.g. after the gate changes. Moves files between menus/ and menus-review/.
//   node scripts/chains/regate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { writeMenu } from './writeMenu.mjs';
const dataDir = path.join(process.cwd(), 'data', 'chains');
for (const dir of ['menus', 'menus-review']) {
  const d = path.join(dataDir, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json'))) writeMenu(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
}
