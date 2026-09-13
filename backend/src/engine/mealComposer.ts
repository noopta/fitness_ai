/**
 * Assemble whole meals out of the ingredient catalogue.
 *
 * The finder used to answer "what nutrient-dense foods are near you", which is
 * not the question anyone asks at 4pm. Nobody eats 30 g of pumpkin seeds and
 * calls it dinner. The question is "what do I EAT", and the answer has to be a
 * plate: a protein, something starchy, something green, with the amounts, the
 * total, where to buy it and roughly how to cook it.
 *
 * Composition is deterministic and runs in-process. No model call, because this
 * sits in the request path and the measured budget there is tens of
 * milliseconds, not seconds — and because the same remaining-macros should
 * always produce the same plate rather than a different invention each refresh.
 *
 * Everything here works on the curated FOOD_SOURCES table, so every component
 * carries USDA-grade composition. That is what lets a composed meal state exact
 * macros while a restaurant dish can only ever estimate them.
 */

import type { FoodSource } from './nutritionRecommendations.js';
import { FOOD_SOURCES } from './nutritionRecommendations.js';
import { scoreAgainstGap, type GapVector } from './nutritionGap.js';

export type SlotId = 'protein' | 'grain' | 'starch' | 'veg' | 'green' | 'fat' | 'dairy' | 'legume';

/**
 * Slot → catalogue categories that can fill it.
 *
 * Ordered by how central the category is to that role, because ties are broken
 * by order: a 'Lean protein' is a more expected centre of a plate than an
 * 'Organ meat', even when the liver scores better on iron.
 */
const SLOT_CATEGORIES: Record<SlotId, string[]> = {
  protein: ['Lean protein', 'Fatty fish', 'Whole protein', 'Shellfish', 'Red meat', 'Plant protein', 'Organ meat'],
  grain: ['Whole grain'],
  starch: ['Starchy veg', 'Whole grain'],
  veg: ['Veg', 'Leafy green', 'Fermented veg'],
  green: ['Leafy green', 'Veg'],
  fat: ['Nut', 'Seed', 'Nut butter'],
  dairy: ['Dairy', 'Fermented dairy', 'Plant dairy'],
  legume: ['Legume', 'Plant protein'],
};

export interface MealArchetype {
  id: string;
  /** `${protein} with ${starch} and ${veg}` — filled from the chosen components. */
  nameTemplate: string;
  slots: SlotId[];
  /** Slots that may be dropped if nothing good fits, in drop-priority order. */
  optional?: SlotId[];
  prepMinutes: number;
  /** One line per step; component names are substituted in. */
  steps: string[];
  /** Skip this archetype when fewer than this many kcal remain. */
  minKcal?: number;
}

/**
 * The archetypes.
 *
 * Deliberately a small set of things people actually cook on a weeknight rather
 * than a recipe database. Each one has to survive being read by someone standing
 * in a supermarket with 25 minutes and no plan.
 */
export const ARCHETYPES: MealArchetype[] = [
  {
    id: 'plate',
    nameTemplate: '{protein} with {starch} and {veg}',
    slots: ['protein', 'starch', 'veg'],
    prepMinutes: 25,
    minKcal: 450,
    steps: [
      'Season the {protein} and cook it through — 4–5 minutes a side in a hot pan, or 15 minutes in a 200°C oven.',
      'Cook the {starch} to packet timing; start it first if it takes longer than the protein.',
      'Steam or roast the {veg} until just tender, about 5–8 minutes.',
      'Plate together and season. Salt and acid at the end does most of the work.',
    ],
  },
  {
    id: 'bowl',
    nameTemplate: '{protein} and {grain} bowl with {veg}',
    slots: ['protein', 'grain', 'veg', 'fat'],
    optional: ['fat'],
    prepMinutes: 25,
    minKcal: 500,
    steps: [
      'Cook the {grain} to packet timing.',
      'Cook the {protein} while the grain simmers.',
      'Warm or raw, add the {veg} — keep it crunchy for contrast.',
      'Build the bowl grain-first, top with the protein and {fat}, and dress it.',
    ],
  },
  {
    id: 'stirfry',
    nameTemplate: '{protein} stir-fry with {veg} and {grain}',
    slots: ['protein', 'veg', 'grain'],
    prepMinutes: 20,
    minKcal: 450,
    steps: [
      'Start the {grain} first — it takes the longest and needs no attention.',
      'Get a pan properly hot, then sear the {protein} in one layer and set it aside.',
      'Stir-fry the {veg} hard and fast, 3–4 minutes, then return the protein.',
      'Finish with soy, garlic and something acidic off the heat.',
    ],
  },
  {
    id: 'salad',
    nameTemplate: '{green} salad with {protein} and {fat}',
    slots: ['green', 'protein', 'fat', 'legume'],
    optional: ['legume'],
    prepMinutes: 12,
    minKcal: 300,
    steps: [
      'Cook the {protein} if it needs it; leftovers or tinned work just as well.',
      'Build on the {green}, add the {legume} and the {protein}.',
      'Top with {fat} and dress properly — undressed salad is why people stop eating salad.',
    ],
  },
  {
    id: 'skillet',
    nameTemplate: '{protein} and {veg} skillet',
    slots: ['protein', 'veg', 'starch'],
    optional: ['starch'],
    prepMinutes: 18,
    minKcal: 400,
    steps: [
      'Soften the {veg} in a wide pan, 5 minutes.',
      'Add the {starch} if you are using it and let it take on colour.',
      'Add the {protein} and cook through, then season hard.',
    ],
  },
  {
    id: 'quick',
    nameTemplate: '{dairy} with {fat}',
    slots: ['dairy', 'fat'],
    prepMinutes: 3,
    steps: [
      'Combine the {dairy} and {fat} in a bowl.',
      'That is the whole thing — this one exists for when there are few calories left and a gap still to close.',
    ],
  },
  {
    id: 'stew',
    nameTemplate: '{legume} and {veg} stew',
    slots: ['legume', 'veg', 'green'],
    optional: ['green'],
    prepMinutes: 30,
    minKcal: 400,
    steps: [
      'Soften the {veg} with onion and garlic.',
      'Add the {legume} with stock and simmer 20 minutes.',
      'Stir the {green} through at the very end so it keeps its colour.',
    ],
  },
];

export interface MealComponent {
  food: FoodSource;
  slot: SlotId;
  /** Servings of the catalogue portion. 1, 1.5 or 2 — never a fake 1.37. */
  multiplier: number;
  kcal: number;
  provides: Record<string, number>;
}

export interface ComposedMeal {
  id: string;
  /** Component set, used to drop archetypes that landed on the same plate. */
  signature: string;
  archetypeId: string;
  name: string;
  components: MealComponent[];
  kcal: number;
  provides: Record<string, number>;
  prepMinutes: number;
  steps: string[];
}

/**
 * How far each slot may be scaled up.
 *
 * Without per-slot caps the greedy picker maxes everything: it proposed 4 tbsp
 * of ground flaxseed and 4 cups of spinach, because more of a nutrient-dense
 * food always scores better against a gap. Protein is the one thing people
 * genuinely do double; condiment-scale foods are not.
 */
const SLOT_MAX_MULTIPLIER: Record<SlotId, number> = {
  protein: 2,
  grain: 1.5,
  starch: 1.5,
  veg: 1.5,
  green: 1.5,
  fat: 1,      // nobody eats four tablespoons of flaxseed
  dairy: 1.5,
  legume: 1.5,
};

/**
 * Foods that belong in a category but not in a particular slot.
 *
 * Bread is a whole grain, but "cook the whole grain bread to packet timing" and
 * "start the bread first, it takes the longest" are both nonsense. The category
 * is right and the ROLE is wrong, which no amount of scoring will catch.
 */
const SLOT_EXCLUSIONS: Partial<Record<SlotId, string[]>> = {
  grain: ['Whole grain bread'],
  starch: ['Whole grain bread'],
};

/** Reserve per still-unfilled slot, so early picks cannot eat the whole budget. */
const SLOT_KCAL_RESERVE = 90;

const MULTIPLIERS = [1, 1.5, 2] as const;

const scale = (provides: Record<string, number>, m: number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(provides)) out[k] = v * m;
  return out;
};

const sumInto = (acc: Record<string, number>, add: Record<string, number>) => {
  for (const [k, v] of Object.entries(add)) acc[k] = (acc[k] ?? 0) + v;
};

/** Foods eligible for a slot, in category-priority order. */
function slotPool(slot: SlotId, foods: FoodSource[]): FoodSource[] {
  const cats = SLOT_CATEGORIES[slot];
  const excluded = SLOT_EXCLUSIONS[slot] ?? [];
  return foods
    .filter(f => cats.includes(f.category) && !excluded.includes(f.name))
    .sort((a, b) => cats.indexOf(a.category) - cats.indexOf(b.category));
}

/**
 * Pick the component that best closes what is still missing.
 *
 * Greedy and slot-by-slot rather than a global optimisation over every
 * combination. The search space is large, the request budget is milliseconds,
 * and greedy-against-the-residual-gap produces plates that are recognisably
 * sensible — which matters more here than being provably optimal, since the
 * user is going to cook one of them and not compare all 40,000.
 */
function pickForSlot(
  slot: SlotId,
  foods: FoodSource[],
  gap: GapVector,
  used: Set<string>,
  kcalBudget: number,
): MealComponent | null {
  let best: MealComponent | null = null;
  let bestScore = 0;

  const maxM = SLOT_MAX_MULTIPLIER[slot] ?? 1;

  for (const food of slotPool(slot, foods)) {
    if (used.has(food.name)) continue;

    for (const m of MULTIPLIERS) {
      if (m > maxM) continue;
      const kcal = food.kcal * m;
      // A component that alone blows the remaining calories is not a component.
      if (kcal > kcalBudget) continue;

      const provides = scale(food.provides, m);
      const { score } = scoreAgainstGap({ ...provides, kcal }, gap);
      // Prefer the smaller portion on a tie: scaling up is something the user
      // can do, inventing a need for 2x is not.
      if (score > bestScore * 1.02) {
        bestScore = score;
        best = { food, slot, multiplier: m, kcal, provides };
      }
    }
  }
  return best;
}

/** "1 medium" x2 -> "2 medium"; "150 g" x1.5 -> "225 g". */
export function servingText(food: FoodSource, multiplier: number): string {
  const s = food.serving;
  if (multiplier === 1) return s;

  const grams = /^(\d+(?:\.\d+)?)\s*g\b/.exec(s);
  if (grams) return s.replace(grams[1], String(Math.round(Number(grams[1]) * multiplier)));

  const leading = /^(\d+(?:\.\d+)?)\s+(.*)$/.exec(s);
  if (leading) {
    const n = Number(leading[1]) * multiplier;
    return `${Number.isInteger(n) ? n : n.toFixed(1)} ${leading[2]}`;
  }
  return `${multiplier}x ${s}`;
}

function fillName(template: string, byySlot: Map<SlotId, MealComponent>): string {
  let out = template;
  for (const [slot, comp] of byySlot) {
    out = out.replace(`{${slot}}`, comp.food.name.toLowerCase());
  }
  // Any slot that went unfilled leaves a placeholder; strip it and tidy up.
  out = stripPlaceholders(out);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Remove placeholders for slots that were never filled.
 *
 * Has to take the surrounding connective with it. Dropping the optional legume
 * from "add the {legume} and the {protein}" naively left "add the and the
 * chicken breast" — the placeholder is gone and the sentence is broken, which
 * is worse than leaving it in because it looks like a rendering bug.
 */
function stripPlaceholders(text: string): string {
  return text
    // "the {slot} and the" -> "the"   /   "{slot} and " -> ""
    .replace(/\bthe\s+\{[a-z]+\}\s+and\s+the\b/g, 'the')
    .replace(/\s*\band\s+the\s+\{[a-z]+\}/g, '')
    .replace(/\s*\bwith\s+the\s+\{[a-z]+\}/g, '')
    .replace(/\s*\b(?:and|with)\s+\{[a-z]+\}/g, '')
    .replace(/\bthe\s+\{[a-z]+\}/g, '')
    .replace(/\{[a-z]+\}/g, '')
    .replace(/\s+([,.])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function fillSteps(steps: string[], bySlot: Map<SlotId, MealComponent>): string[] {
  return steps
    // Drop any step that is entirely about a slot we did not fill.
    .filter(step => {
      const refs = [...step.matchAll(/\{([a-z]+)\}/g)].map(m => m[1] as SlotId);
      return refs.length === 0 || refs.some(r => bySlot.has(r));
    })
    .map(step => {
      let out = step;
      for (const [slot, comp] of bySlot) out = out.replace(new RegExp(`\\{${slot}\\}`, 'g'), comp.food.name.toLowerCase());
      // A leftover placeholder means an optional slot inside a mixed step.
      return stripPlaceholders(out);
    });
}

export interface ComposeOptions {
  /** Calories the meal must fit inside. */
  kcalBudget: number;
  /** Restrict the catalogue — the diet filter has already run over this. */
  foods?: FoodSource[];
  /** Cap on how long the user is willing to spend cooking. */
  maxPrepMinutes?: number;
}

/**
 * Build one candidate meal per archetype.
 *
 * Returns at most one meal per archetype, so the list reads as genuinely
 * different dinners rather than five variations on chicken and rice.
 */
export function composeMeals(gap: GapVector, opts: ComposeOptions): ComposedMeal[] {
  const foods = opts.foods ?? FOOD_SOURCES;
  const kcalBudget = Math.max(150, opts.kcalBudget);
  const out: ComposedMeal[] = [];

  for (const arch of ARCHETYPES) {
    if (arch.minKcal && kcalBudget < arch.minKcal) continue;
    if (opts.maxPrepMinutes != null && arch.prepMinutes > opts.maxPrepMinutes) continue;

    const bySlot = new Map<SlotId, MealComponent>();
    const used = new Set<string>();
    const totals: Record<string, number> = {};
    let kcal = 0;
    // Residual gap: each pick is chosen against what the previous picks left
    // unclosed, which is what stops a plate being three sources of the same
    // nutrient.
    let residual: GapVector = new Map(gap);

    for (let i = 0; i < arch.slots.length; i++) {
      const slot = arch.slots[i];
      // Hold back room for the slots still to come, or the protein takes the
      // whole budget and the plate arrives with no vegetable on it.
      const slotsLeftAfter = arch.slots.length - i - 1;
      const reserve = slotsLeftAfter * SLOT_KCAL_RESERVE;
      const remainingKcal = kcalBudget - kcal - reserve;
      if (remainingKcal <= 40) break;

      const pick = pickForSlot(slot, foods, residual, used, remainingKcal);
      if (!pick) {
        // A required slot we cannot fill kills the archetype; an optional one
        // is simply dropped.
        if (!arch.optional?.includes(slot)) { bySlot.clear(); break; }
        continue;
      }

      bySlot.set(slot, pick);
      used.add(pick.food.name);
      sumInto(totals, pick.provides);
      kcal += pick.kcal;

      // Entries are GapEntry records, not bare numbers: keep the label and
      // weight, decrement only what is still owed, and drop satisfied keys —
      // a zero-remaining entry would still attract score.
      const next: GapVector = new Map();
      for (const [key, entry] of residual) {
        const left = entry.remaining - (pick.provides[key] ?? 0);
        if (left > 0) next.set(key, { ...entry, remaining: left });
      }
      residual = next;
    }

    // A "meal" of one item is just an ingredient wearing a hat.
    if (bySlot.size < 2) continue;

    // Two archetypes landing on the same ingredients is one meal with two
    // names, not two options. Keep the first — archetype order is preference
    // order.
    const signature = [...bySlot.values()].map(c => `${c.food.name}x${c.multiplier}`).sort().join('|');
    if (out.some(m => m.signature === signature)) continue;

    totals.kcal = kcal;
    out.push({
      signature,
      id: `meal:${arch.id}:${[...bySlot.values()].map(c => c.food.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).join('+')}`,
      archetypeId: arch.id,
      name: fillName(arch.nameTemplate, bySlot),
      components: [...bySlot.values()],
      kcal: Math.round(kcal),
      provides: totals,
      prepMinutes: arch.prepMinutes,
      steps: fillSteps(arch.steps, bySlot),
    });
  }

  return out;
}
