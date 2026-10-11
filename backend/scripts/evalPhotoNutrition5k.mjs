// Nutrition5k photo scoreboard through the production pipeline (see eval/nutrition5k/README.md).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const set = JSON.parse(fs.readFileSync(path.join(root, 'eval/nutrition5k/test-40.json'), 'utf8'));
const imgDir = path.join(root, '.runtime/n5k');
fs.mkdirSync(imgDir, { recursive: true });
for (const d of set) {
  const f = path.join(imgDir, `${d.id}.png`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(await (await fetch(`https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset/imagery/realsense_overhead/${d.id}/rgb.png`)).arrayBuffer()));
}
const { analyzeMealPhotoItems } = await import(path.join(root, 'dist/services/llmService.js'));
const { resolveItems, sumItems } = await import(path.join(root, 'dist/services/food/mealPhotoItems.js'));
const label = process.argv[2] ?? 'run';
const allIngr = [...new Set(set.flatMap((d) => d.ingredients))];
const hintsFor = (d) => process.env.HINTS === 'own' ? [...d.ingredients, ...allIngr.filter((x) => !d.ingredients.includes(x)).slice(0, 12)] : process.env.HINTS === 'decoy' ? allIngr.filter((x) => !d.ingredients.includes(x)).slice(0, 16) : undefined;
const rows = []; const queue = [...set];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const d = queue.shift(); const t = Date.now();
    try {
      const h = hintsFor(d);
      const raw = await analyzeMealPhotoItems([{ base64: fs.readFileSync(path.join(imgDir, `${d.id}.png`)).toString('base64'), mimeType: 'image/png' }], h ? { userFoods: h } : {});
      const res = await resolveItems(raw.items, 'x'); const tot = sumItems(res.items);
      rows.push({ ms: Date.now() - t, kcal: tot.calories, p: tot.proteinG, grams: res.items.reduce((n, i) => n + (i.grams ?? 0), 0), tk: d.kcal, tp: d.protein, tm: d.mass });
    } catch (e) { rows.push({ err: String(e.message) }); }
  }
}));
const ok = rows.filter((r) => !r.err); const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const ape = ok.map((r) => Math.abs(r.kcal - r.tk) / r.tk).sort((a, b) => a - b);
console.log(`${label}: n=${ok.length}/${rows.length} kcal MAPE ${(100 * mean(ape)).toFixed(1)}% median ${(100 * ape[Math.floor(ape.length / 2)]).toFixed(1)}% within20% ${ape.filter((e) => e <= 0.2).length} bias ${(100 * mean(ok.map((r) => (r.kcal - r.tk) / r.tk))).toFixed(1)}% protein MAE ${mean(ok.map((r) => Math.abs(r.p - r.tp))).toFixed(1)} g mass APE ${(100 * mean(ok.map((r) => Math.abs(r.grams - r.tm) / r.tm))).toFixed(1)}%`);
process.exit(0);
