// What a nutrient does for you, in a sentence — for the weekly wins email.
// General, well-established roles only, always "helps"/"supports": this is
// encouragement, not medical advice. Each has an easy food top-up.

import type { GoalDirection } from './progressService.js';

interface Insight { area: string; line: string; topUp: string; lose?: string }

const INSIGHTS: Record<string, Insight> = {
  fiberG: { area: 'Fullness & gut', line: 'Fibre slows digestion, so meals keep you full for longer, and it feeds the gut bacteria tied to steadier energy.', lose: 'Fibre slows digestion, so meals keep you full for longer on fewer calories — a quiet ally in a fat-loss phase.', topUp: 'oats, berries, beans or an extra handful of veg' },
  ironMg: { area: 'Energy & focus', line: 'Iron carries oxygen to working muscles and your brain — part of what keeps energy and focus up through hard sessions.', topUp: 'lean red meat, lentils, or spinach with something rich in vitamin C' },
  magnesiumMg: { area: 'Sleep & recovery', line: 'Magnesium helps muscles relax after training and supports deeper, more restful sleep.', topUp: 'pumpkin seeds, almonds, dark chocolate or leafy greens' },
  potassiumMg: { area: 'Muscles & hydration', line: 'Potassium keeps muscle contractions and hydration on point — fewer cramps, better sessions — and helps balance blood pressure.', topUp: 'potatoes, bananas, beans or yogurt' },
  omega3G: { area: 'Brain & recovery', line: 'Omega-3s support brain health and mood, and help your body handle the inflammation that hard training brings.', topUp: 'salmon, sardines, walnuts or chia' },
  vitaminDIU: { area: 'Muscle, bones & mood', line: 'Vitamin D supports muscle function, strong bones, immunity and mood — especially helpful in the darker months.', topUp: 'eggs, fatty fish, fortified milk, or some daylight' },
  vitaminB12Mcg: { area: 'Energy & focus', line: 'B12 helps turn food into usable energy and keeps your nerves and brain sharp.', topUp: 'eggs, dairy, fish or meat' },
  zincMg: { area: 'Repair & immunity', line: 'Zinc supports muscle repair, a strong immune system and healthy hormone levels — all part of bouncing back from hard sessions.', topUp: 'beef, pumpkin seeds or chickpeas' },
  calciumMg: { area: 'Strong bones', line: 'Calcium keeps your bones strong under heavier loads and helps every muscle contraction.', topUp: 'Greek yogurt, milk, cheese or tofu' },
  folateMcg: { area: 'Energy & mood', line: 'Folate helps your body build new cells and supports steady energy and mood.', topUp: 'leafy greens, beans or avocado' },
  vitaminCMg: { area: 'Joints & immunity', line: 'Vitamin C helps build collagen for tendons and joints, and keeps your immune system ready.', topUp: 'citrus, berries, peppers or kiwi' },
  vitaminEMg: { area: 'Recovery', line: 'Vitamin E is an antioxidant that helps protect your cells from training stress.', topUp: 'almonds, sunflower seeds or avocado' },
  vitaminAIU: { area: 'Vision, skin & immunity', line: 'Vitamin A supports your vision, skin and immune system.', topUp: 'carrots, sweet potato or spinach' },
};

export interface MicroLine { key: string; label: string; area: string; amount: string; pct: number; line: string }
export interface TopUp { key: string; label: string; area: string; pct: number; foods: string; line: string }

const PRIORITY_LOSE = ['magnesiumMg', 'fiberG', 'omega3G', 'vitaminDIU', 'potassiumMg', 'zincMg', 'ironMg', 'vitaminCMg', 'calciumMg', 'folateMcg', 'vitaminB12Mcg', 'vitaminEMg', 'vitaminAIU'];
const PRIORITY = ['magnesiumMg', 'omega3G', 'vitaminDIU', 'fiberG', 'zincMg', 'potassiumMg', 'ironMg', 'calciumMg', 'vitaminCMg', 'folateMcg', 'vitaminB12Mcg', 'vitaminEMg', 'vitaminAIU'];

const fmt = (avg: number, unit: string) => `${avg >= 100 ? Math.round(avg) : Math.round(avg * 10) / 10} ${unit}`;

/** Nutrients they did well on (≥80% of target, best first) and up to two easy top-ups (<60%). Pure. */
export function microHighlights(micros: Array<{ key: string; label: string; unit: string; avg: number; target: number; pct: number }>, goal: GoalDirection): { stars: MicroLine[]; topUps: TopUp[] } {
  const known = micros.filter((m) => INSIGHTS[m.key]);
  const stars = known.filter((m) => m.pct >= 80).sort((a, b) => b.pct - a.pct).slice(0, 4).map((m) => {
    const i = INSIGHTS[m.key];
    return { key: m.key, label: m.label, area: i.area, amount: `${fmt(m.avg, m.unit)} a day (${Math.min(m.pct, 999)}% of your target)`, pct: m.pct, line: goal === 'lose' && i.lose ? i.lose : i.line };
  });
  // Top-ups in order of what matters most for the goal, not just the lowest number.
  const order = goal === 'lose' ? PRIORITY_LOSE : PRIORITY;
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? 99 : i; };
  const topUps = known.filter((m) => m.pct < 60).sort((a, b) => rank(a.key) - rank(b.key) || a.pct - b.pct).slice(0, 2)
    .map((m) => ({ key: m.key, label: m.label, area: INSIGHTS[m.key].area, pct: m.pct, foods: INSIGHTS[m.key].topUp, line: goal === 'lose' && INSIGHTS[m.key].lose ? INSIGHTS[m.key].lose! : INSIGHTS[m.key].line }));
  return { stars, topUps };
}
