/**
 * Hard dietary filtering for the Food Finder.
 *
 * This module is deliberately not part of scoring. A suggestion that violates an
 * allergy is not a worse-ranked option, it is a dangerous one, and no amount of
 * macro fit may outweigh it. Everything here therefore returns a verdict, not a
 * weight, and the ranker applies it before it ranks.
 *
 * The hardest honesty problem lives here. For a USDA ingredient we know exactly
 * what the food is. For a dish at an independent restaurant we know a NAME — we
 * do not know whether the kitchen finishes it in butter or fries it in the same
 * oil as the shrimp. Silently treating "no peanut in the name" as "peanut-free"
 * would be the single most harmful thing this feature could do.
 *
 * So there are three verdicts, not two:
 *   allow        — positively checked against known composition
 *   exclude      — a restriction or allergen is matched; never shown
 *   unverifiable — we cannot know from a dish name alone; shown only with an
 *                  explicit warning, and never at all for a declared allergen
 */

export type DietVerdict = 'allow' | 'exclude' | 'unverifiable';

export interface DietProfile {
  restrictions: string[];
  allergies: string[];
  dislikes: string[];
}

export interface DietDecision {
  verdict: DietVerdict;
  /** User-facing reason, always phrased as what WE know, not what the kitchen does. */
  reason?: string;
  /** Which rule fired, for tests and debugging. */
  rule?: string;
}

/** Keyword sets are folded: lowercase, diacritics stripped, non-alphanumerics to spaces. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Word-boundary match on a folded haystack, so "hammy" never matches "ham". */
function hasTerm(haystack: string, term: string): boolean {
  return new RegExp(`(^| )${term.replace(/ /g, ' ')}( |$)`).test(haystack);
}

function hasAny(haystack: string, terms: readonly string[]): string | null {
  for (const t of terms) if (hasTerm(haystack, t)) return t;
  return null;
}

// ---------------------------------------------------------------------------
// Allergens
// ---------------------------------------------------------------------------

/**
 * The "big nine" plus sesame, keyed the way users declare them. Terms are the
 * things that actually appear in dish names and ingredient names, including the
 * non-obvious ones — "worcestershire" is anchovy, "surimi" is fish, "tahini" is
 * sesame. Missing one of those is how a filter quietly fails.
 */
export const ALLERGEN_TERMS: Record<string, readonly string[]> = {
  peanut: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'satay', 'arachis'],
  'tree-nut': [
    'almond', 'almonds', 'cashew', 'cashews', 'walnut', 'walnuts', 'pecan', 'pecans',
    'pistachio', 'pistachios', 'hazelnut', 'hazelnuts', 'macadamia', 'brazil nut',
    'praline', 'marzipan', 'nutella', 'frangipane', 'pesto',
  ],
  shellfish: [
    'shrimp', 'prawn', 'prawns', 'crab', 'lobster', 'crayfish', 'langoustine',
    'scallop', 'scallops', 'clam', 'clams', 'mussel', 'mussels', 'oyster', 'oysters',
    'squid', 'calamari', 'octopus', 'krill', 'shellfish', 'seafood',
  ],
  fish: [
    'fish', 'salmon', 'tuna', 'cod', 'haddock', 'halibut', 'tilapia', 'trout',
    'sardine', 'sardines', 'anchovy', 'anchovies', 'mackerel', 'bass', 'snapper',
    'pollock', 'surimi', 'worcestershire', 'nam pla', 'nuoc mam',
  ],
  egg: ['egg', 'eggs', 'omelette', 'omelet', 'frittata', 'mayonnaise', 'mayo', 'aioli', 'meringue', 'custard'],
  soy: ['soy', 'soya', 'soybean', 'soybeans', 'tofu', 'edamame', 'miso', 'tempeh', 'tamari', 'ponzu'],
  sesame: ['sesame', 'tahini', 'halva', 'hummus', 'za atar', 'zaatar', 'gomashio', 'benne'],
  wheat: ['wheat', 'bread', 'pasta', 'noodle', 'noodles', 'flour', 'bun', 'tortilla', 'couscous', 'seitan', 'panko', 'breaded', 'batter', 'roti', 'naan', 'pita'],
  milk: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'ghee', 'paneer', 'mozzarella', 'cheddar', 'parmesan', 'feta', 'ricotta', 'custard', 'alfredo', 'queso'],
};

/** Declared-allergy aliases users actually type. */
const ALLERGEN_ALIASES: Record<string, string> = {
  nuts: 'tree-nut', 'tree nuts': 'tree-nut', treenut: 'tree-nut',
  dairy: 'milk', lactose: 'milk',
  gluten: 'wheat',
  crustacean: 'shellfish', crustaceans: 'shellfish',
};

export const canonicalAllergen = (a: string): string => {
  const f = fold(a);
  return ALLERGEN_ALIASES[f] ?? f.replace(/ /g, '-');
};

// ---------------------------------------------------------------------------
// Restrictions
// ---------------------------------------------------------------------------

const MEAT = [
  'beef', 'steak', 'pork', 'bacon', 'ham', 'sausage', 'chicken', 'turkey', 'duck',
  'lamb', 'mutton', 'goat', 'veal', 'venison', 'brisket', 'pepperoni', 'salami',
  'prosciutto', 'chorizo', 'meatball', 'meatballs', 'burger', 'pastrami', 'gelatin',
  'lard', 'tallow', 'bone broth', 'carnitas', 'barbacoa', 'al pastor', 'shawarma', 'gyro',
];
const PORK = ['pork', 'bacon', 'ham', 'prosciutto', 'pancetta', 'chorizo', 'salami', 'pepperoni', 'lard', 'carnitas', 'guanciale', 'bratwurst'];
const BEEF = ['beef', 'steak', 'brisket', 'veal', 'pastrami', 'burger', 'barbacoa'];
const SEA = ALLERGEN_TERMS.fish.concat(ALLERGEN_TERMS.shellfish);
const ANIMAL_PRODUCT = ALLERGEN_TERMS.milk.concat(ALLERGEN_TERMS.egg, ['honey']);

/**
 * Restriction → terms that DISQUALIFY. Kept as exclusions rather than
 * allow-lists: the space of acceptable foods is unbounded, the space of
 * disqualifying ingredients is not.
 */
const RESTRICTION_TERMS: Record<string, readonly string[]> = {
  vegetarian: [...MEAT, ...SEA],
  vegan: [...MEAT, ...SEA, ...ANIMAL_PRODUCT],
  pescatarian: MEAT,
  'no-pork': PORK,
  'no-beef': BEEF,
  halal: [...PORK, 'alcohol', 'wine', 'beer', 'rum', 'vodka', 'bourbon', 'sake', 'mirin'],
  kosher: [...PORK, ...ALLERGEN_TERMS.shellfish, 'cheeseburger'],
  'gluten-free': ALLERGEN_TERMS.wheat,
  'dairy-free': ALLERGEN_TERMS.milk,
};

export interface DietCandidateFacts {
  name: string;
  description?: string | null;
  /** Tags asserted at ingest ("vegan", "contains:peanut"), trusted over keywords. */
  tags?: string[] | null;
  /** usda/published means composition is known; inferred/estimated means we only know a name. */
  confidence: 'usda' | 'published' | 'inferred' | 'estimated';
}

export function emptyProfile(): DietProfile {
  return { restrictions: [], allergies: [], dislikes: [] };
}

/** Parse the JSON string columns on User into a profile, tolerating junk. */
export function parseDietProfile(u: {
  dietaryRestrictions?: string | null;
  allergies?: string | null;
  dislikedFoods?: string | null;
}): DietProfile {
  const arr = (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(fold) : [];
    } catch {
      // Free text is a legitimate shape here — the coach writes these too.
      return raw.split(/[,;\n]/).map(fold).filter(Boolean);
    }
  };
  return {
    restrictions: arr(u.dietaryRestrictions),
    allergies: arr(u.allergies).map(canonicalAllergen),
    dislikes: arr(u.dislikedFoods),
  };
}

export const hasAnyRestriction = (p: DietProfile): boolean =>
  p.restrictions.length > 0 || p.allergies.length > 0 || p.dislikes.length > 0;

/**
 * Decide whether a candidate may be shown.
 *
 * Order matters: allergens are checked before restrictions before dislikes, so
 * the reason surfaced to the user is the most serious one that applies.
 */
export function checkCandidate(facts: DietCandidateFacts, profile: DietProfile): DietDecision {
  const hay = fold(`${facts.name} ${facts.description ?? ''}`);
  const tags = (facts.tags ?? []).map(fold);
  const verified = facts.confidence === 'usda' || facts.confidence === 'published';

  // An ingest-time tag is a positive assertion and beats keyword guessing.
  const tagSays = (t: string) => tags.includes(fold(t));

  // 1. Allergens.
  for (const allergen of profile.allergies) {
    const terms = ALLERGEN_TERMS[allergen];
    if (tagSays(`contains ${allergen}`) || (terms && hasAny(hay, terms))) {
      return {
        verdict: 'exclude',
        rule: `allergen:${allergen}`,
        reason: `Contains ${allergen.replace('-', ' ')}.`,
      };
    }
    if (tagSays(`free ${allergen}`)) continue; // explicitly certified free
    if (!verified) {
      // The honest case. We know the dish name and nothing about the kitchen.
      return {
        verdict: 'unverifiable',
        rule: `allergen-unverifiable:${allergen}`,
        reason: `We can't verify ${allergen.replace('-', ' ')} from a menu listing — check with the restaurant.`,
      };
    }
  }

  // 2. Restrictions.
  for (const r of profile.restrictions) {
    const key = r.replace(/ /g, '-');
    const terms = RESTRICTION_TERMS[key];
    if (!terms) continue;
    if (tagSays(key)) continue; // certified, e.g. tagged "vegan"
    const hit = hasAny(hay, terms);
    if (hit) {
      return { verdict: 'exclude', rule: `restriction:${key}`, reason: `Not ${key.replace('-', ' ')} — contains ${hit}.` };
    }
  }

  // 3. Dislikes — a preference, so it excludes but never warns.
  for (const d of profile.dislikes) {
    if (d && hasTerm(hay, d)) {
      return { verdict: 'exclude', rule: `dislike:${d}`, reason: `You marked ${d} as something you'd rather not eat.` };
    }
  }

  return { verdict: 'allow' };
}

/**
 * Apply to a list. `unverifiable` items survive with a warning attached, because
 * dropping every restaurant dish the moment a user declares one allergy would
 * silently delete the entire takeout half of the product. The user decides,
 * having been told plainly what we do and do not know.
 */
export function filterCandidates<T>(
  items: T[],
  factsOf: (t: T) => DietCandidateFacts,
  profile: DietProfile,
): Array<{ item: T; decision: DietDecision }> {
  if (!hasAnyRestriction(profile)) return items.map(item => ({ item, decision: { verdict: 'allow' as const } }));
  const out: Array<{ item: T; decision: DietDecision }> = [];
  for (const item of items) {
    const decision = checkCandidate(factsOf(item), profile);
    if (decision.verdict === 'exclude') continue;
    out.push({ item, decision });
  }
  return out;
}
