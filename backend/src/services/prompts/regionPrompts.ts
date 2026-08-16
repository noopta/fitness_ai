// Region-aware prompt blocks for meal parsing.
//
// ─── The problem ─────────────────────────────────────────────────────────────
// Every meal-parsing prompt in llmService.ts is implicitly North American. It
// names Osmow's, McDonald's and Chipotle; it anchors photo portions to "a
// standard 10-inch plate" and "a 6oz grilled breast"; it recognises UberEats
// and DoorDash; and it offers kefir, kimchi and Greek yoghurt as the examples
// of fermented food.
//
// For a user in Lagos or Banjul every one of those anchors is wrong, and two of
// them are actively harmful:
//
//   * Portions. A swallow (eba, amala, fufu) is 200-350 g and shares the plate
//     with soup. Anchoring to a 10-inch plate with a protein-starch-vegetable
//     split misreads the meal structurally, not marginally.
//   * Fermented foods. The gut pillar counts `fermentedFoods`. A user eating
//     iru, ogi and ugba daily scores ZERO, because the model was only ever
//     shown European examples.
//
// ─── The design ──────────────────────────────────────────────────────────────
// `regionPromptBlock` returns an EMPTY STRING for the 'global' region. That is
// deliberate and load-bearing: every existing prompt stays byte-identical for
// existing users, so no current behaviour can drift and no prompt snapshot test
// can break. The regional text is purely additive.

import { westAfricanDishNames } from '../../data/westAfricanDishes.js';

export type FoodRegion = 'global' | 'ng' | 'gm' | 'wa';

export type PromptKind = 'text' | 'photo' | 'recipe' | 'order' | 'micros';

const VALID_REGIONS: readonly FoodRegion[] = ['global', 'ng', 'gm', 'wa'];

/** Coerce any stored/user-supplied value to a usable region. */
export function normalizeFoodRegion(value: unknown): FoodRegion {
  if (typeof value !== 'string') return 'global';
  const v = value.trim().toLowerCase();
  return (VALID_REGIONS as readonly string[]).includes(v) ? (v as FoodRegion) : 'global';
}

export function isWestAfrican(region: FoodRegion): boolean {
  return region === 'ng' || region === 'gm' || region === 'wa';
}

/** Country label used in the prompt's opening line. */
function regionLabel(region: FoodRegion): string {
  if (region === 'ng') return 'Nigeria';
  if (region === 'gm') return 'The Gambia';
  return 'West Africa';
}

/** The dish vocabulary the model should recognise, drawn from the curated table. */
function dishVocabulary(region: FoodRegion): string {
  const key = region === 'ng' ? 'NG' : region === 'gm' ? 'GM' : 'WA';
  return westAfricanDishNames(key as 'NG' | 'GM' | 'WA').join(', ');
}

// Cooking fats. Red palm oil is not a detail — it dominates the fat, the
// saturated fat and essentially all of the vitamin A in most soups and stews.
const FATS = `COOKING FATS: red palm oil (epo pupa) and groundnut oil are the defaults, not olive or canola. Red palm oil is ~100% fat, heavily saturated, and one of the richest natural sources of provitamin A — a soup cooked in it is far higher in fat and vitamin A than a Western equivalent.`;

// Portion anchors. These must OVERRIDE the US anchors already in the prompt,
// so the wording is explicitly corrective rather than merely additional.
const PORTIONS = `PORTIONS — use these instead of any US anchors:
- a wrap of eba / amala / fufu / pounded yam ≈ 200 g (small 130 g, large 300 g)
- a ladle of soup ≈ 150 g; a bowl of soup ≈ 250 g
- a plate of jollof or fried rice ≈ 300 g; a takeaway pack ≈ 400 g
- a derica cup of cooked rice ≈ 250 g; a mudu is a ~1 kg DRY grain market measure
- half a tuber of yam ≈ 500 g gross (~85% edible)
- a ball of moi moi ≈ 120 g; a ball of akara ≈ 30 g; a stick of suya ≈ 60 g
- a cup of pap/kunu/zobo ≈ 250 g
A meal is commonly a swallow PLUS a soup, served together. Count both: the swallow is usually the larger share of the calories.`;

// Fermented foods drive the gut pillar's `fermentedFoods` array. Without this
// list the pillar reads zero for West African users indefinitely.
const FERMENTED = `FERMENTED FOODS — these are fermented and MUST be counted in "fermentedFoods": ogi / akamu / pap (fermented maize), iru / dawadawa / netetou (fermented locust bean), ogiri, ugba / ukpaka (fermented oil bean), garri and fufu / akpu (fermented cassava), wara / warankasi, nono and fura da nono (soured milk), kenkey, palm wine, kunu. Do not restrict yourself to kefir/kimchi/yoghurt.`;

// Plant diversity drives the 30-plants pillar; these are commonly miscounted or
// missed entirely because the model doesn't recognise the names as plants.
const PLANTS = `PLANT DIVERSITY — count these as distinct plant species in "plants": ugu / fluted pumpkin leaf, waterleaf, bitterleaf (onugbu), scent leaf (efirin), ewedu / jute leaf, afang / okazi leaf, oha leaf, okra, egusi (melon seed), ogbono seed, groundnut, locust bean, garden egg, bitter tomato (jakhatu), moringa, sorrel/hibiscus (zobo), cocoyam, plantain, cassava, millet, sorghum, fonio.`;

function textBlock(region: FoodRegion): string {
  return `
═══ REGIONAL CONTEXT: ${regionLabel(region)} ═══
This user eats primarily ${regionLabel(region)}n food. Most meals are home-cooked or bought from street vendors and local buka/chop-house restaurants — very little is packaged.

DISHES you should recognise by name: ${dishVocabulary(region)}.

${PORTIONS}

${FATS}

${FERMENTED}

${PLANTS}

LOCAL CHAINS worth recognising alongside international ones: Chicken Republic, Mr Biggs, The Place, Kilimanjaro, Sweet Sensation, Tantalizers, Domino's Nigeria.

Spelling varies widely — egusi/agusi, moi moi/moin moin, garri/gari, benachin/benechin, domoda/domada. Match on sound, not exact spelling.`;
}

function photoBlock(region: FoodRegion): string {
  return `
═══ REGIONAL CONTEXT: ${regionLabel(region)} ═══
This is most likely ${regionLabel(region)}n food. IGNORE any instruction to assume a 10-inch Western dinner plate: assume an enamel or melamine plate, a communal serving bowl, or a takeaway pack.

DISHES you should recognise on sight: ${dishVocabulary(region)}.

A very common plate is a SWALLOW (a smooth pale mound — eba is yellow-cream, amala dark brown, pounded yam white) served beside a dark oily SOUP. Report both components.

${PORTIONS}

${FATS}

${FERMENTED}

${PLANTS}`;
}

function recipeBlock(region: FoodRegion): string {
  return `
═══ REGIONAL CONTEXT: ${regionLabel(region)} ═══
Quantities are commonly given in local measures rather than pounds or cans: a derica cup (~250 g cooked rice), a mudu (~1 kg dry grain), a cooking spoon of palm oil (~30 g), a paint rubber (~4 kg), a congo (~2 kg), "half a tuber" of yam (~500 g gross).

${FATS}

Recognise these ingredients: egusi (melon seed), ogbono, iru/dawadawa, crayfish, stockfish, ponmo (cow skin), ugu, waterleaf, bitterleaf, scent leaf, ewedu, okazi, palm-fruit concentrate, groundnut paste, garri, elubo (yam flour), semovita.`;
}

function orderBlock(region: FoodRegion): string {
  return `
═══ REGIONAL CONTEXT: ${regionLabel(region)} ═══
This screenshot is likely from a ${regionLabel(region)}n delivery app: Chowdeck, Glovo, Bolt Food, Jumia Food, Gokada or Heyfood — not only UberEats/DoorDash. Prices appear in ₦ (naira) or D (dalasi); do not extract prices.

Common vendors: Chicken Republic, Mr Biggs, The Place, Kilimanjaro, Sweet Sensation, and independent buka/chop houses.

DISHES you should recognise in the item list: ${dishVocabulary(region)}.

${PORTIONS}`;
}

function microsBlock(region: FoodRegion): string {
  return `
═══ REGIONAL CONTEXT: ${regionLabel(region)} ═══
This is a ${regionLabel(region)}n food. Two things dominate its micronutrient profile:
- Red palm oil, if present, contributes very large amounts of vitamin A (provitamin A carotenoids) and vitamin E, plus most of the saturated fat.
- Dark leafy greens (ugu, waterleaf, bitterleaf, afang) contribute iron, calcium, folate and vitamin C well above Western salad greens.
Ground melon seed (egusi), ogbono and groundnut contribute magnesium, zinc and omega-6.
Estimate for the dish AS EATEN, including its cooking oil.`;
}

/**
 * Regional guidance to append to a meal-parsing prompt.
 *
 * Returns '' for the 'global' region so existing prompts are unchanged.
 */
export function regionPromptBlock(region: FoodRegion, kind: PromptKind): string {
  if (!isWestAfrican(region)) return '';
  switch (kind) {
    case 'text': return textBlock(region);
    case 'photo': return photoBlock(region);
    case 'recipe': return recipeBlock(region);
    case 'order': return orderBlock(region);
    case 'micros': return microsBlock(region);
    default: return '';
  }
}
