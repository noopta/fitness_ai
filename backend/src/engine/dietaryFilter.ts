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
  /**
   * The user said they have food allergies without saying which — the coach
   * intake's "Food allergies" option carries no specifics. We cannot filter an
   * allergen we were not told, so this does not exclude anything; it makes every
   * unverifiable dish carry a warning, and it prompts the UI to ask which.
   */
  unspecifiedAllergy: boolean;
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

/**
 * Word-boundary match on a folded haystack, so "hammy" never matches "ham" and
 * "eggplant" never matches "egg" — but a plural does match its singular.
 * Without the plural, the tree-nut term `brazil nut` let "Brazil nuts" through.
 */
function hasTerm(haystack: string, term: string): boolean {
  return new RegExp(`(^| )${term}(s|es)?( |$)`).test(haystack);
}

/**
 * Neutralise plant-based "dairy" words before matching.
 *
 * "Fortified soy milk" is vegan and "almond milk" is dairy-free, but both
 * contain "milk". Each such phrase is reduced to its plant word, so soy milk
 * still reads as soy (a soy allergy still catches it) and peanut butter still
 * reads as peanut — only the misleading dairy word is dropped.
 */
function withoutPlantDairy(haystack: string): string {
  return haystack
    .replace(/\b(soy|soya|almond|oat|coconut|rice|cashew|hemp|pea) (milk|yogurt|yoghurt|cheese|cream)\b/g, '$1')
    .replace(/\b(peanut|nut|almond|cashew|sunflower|cocoa|apple|shea) butter\b/g, '$1')
    .replace(/\bplant dairy\b/g, 'plant');
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
  milk: [
    'milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'ghee', 'paneer', 'mozzarella',
    'cheddar', 'parmesan', 'feta', 'ricotta', 'custard', 'alfredo', 'queso',
    // Missed by the first version, which let all three onto a vegan's plate:
    'kefir', 'skyr', 'whey', 'casein', 'quark', 'labneh', 'lassi',
    // Catches catalogue categories ("Dairy", "Fermented dairy"). Plant dairy is
    // neutralised before matching, so "Plant dairy" does not trip it.
    'dairy',
  ],
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
  if (ALLERGEN_ALIASES[f]) return ALLERGEN_ALIASES[f];
  const key = f.replace(/ /g, '-');
  if (ALLERGEN_TERMS[key]) return key;
  // Plurals people type ("peanuts", "eggs", "sesame seeds"). Without this,
  // "Peanuts" was stored as `peanuts`, which is not a known allergen, fell back
  // to matching its own name — and "peanut butter" does not contain "peanuts".
  const singular = key.replace(/-seeds$/, '').replace(/s$/, '');
  if (ALLERGEN_TERMS[singular]) return singular;
  return key;
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
  // Ordinary oats are routinely cross-contaminated and not safe for coeliacs.
  // Deliberately NOT added to the wheat allergy, which is a different condition.
  'gluten-free': [...ALLERGEN_TERMS.wheat, 'oat', 'oats', 'barley', 'rye'],
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
  return { restrictions: [], allergies: [], dislikes: [], unspecifiedAllergy: false };
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
      // Tolerate free text: a hand-edited or legacy value should still filter
    // rather than silently parse to "no restriction".
      return raw.split(/[,;\n]/).map(fold).filter(Boolean);
    }
  };
  return {
    restrictions: arr(u.dietaryRestrictions),
    allergies: arr(u.allergies).map(canonicalAllergen),
    dislikes: arr(u.dislikedFoods),
    unspecifiedAllergy: false,
  };
}

export const hasAnyRestriction = (p: DietProfile): boolean =>
  p.restrictions.length > 0 || p.allergies.length > 0 || p.dislikes.length > 0 || p.unspecifiedAllergy;

/**
 * Decide whether a candidate may be shown.
 *
 * Order matters: allergens are checked before restrictions before dislikes, so
 * the reason surfaced to the user is the most serious one that applies.
 */
export function checkCandidate(facts: DietCandidateFacts, profile: DietProfile): DietDecision {
  const hay = withoutPlantDairy(fold(`${facts.name} ${facts.description ?? ''}`));
  const verified = facts.confidence === 'usda' || facts.confidence === 'published';
  // Tags are positive assertions ("vegan", "free peanut") and may skip a check —
  // but only from a source we trust. The curated chain corpus is unverified, and
  // its "vegetarian" tag on McDonald's fries (US fries carry beef flavouring)
  // would otherwise have waved them past a vegetarian unchecked.
  const tags = verified ? (facts.tags ?? []).map(fold) : [];
  const tagSays = (t: string) => tags.includes(fold(t));

  // Every check runs before anything is returned. The first version returned
  // "can't verify peanut" for a restaurant dish BEFORE looking at restrictions,
  // so a pork dish was shown — with an allergy caveat — to a halal user who also
  // had an allergy. Exclusions now always win; caveats accumulate and are only
  // returned once nothing excluded the dish.
  const caveats: Array<{ rule: string; reason: string }> = [];

  // 1. Allergens.
  for (const allergen of profile.allergies) {
    // An allergen we have no term list for still matches its own name.
    const terms = ALLERGEN_TERMS[allergen] ?? [allergen.replace(/-/g, ' ')];
    if (tagSays(`contains ${allergen}`) || hasAny(hay, terms)) {
      return { verdict: 'exclude', rule: `allergen:${allergen}`, reason: `Contains ${allergen.replace('-', ' ')}.` };
    }
    if (tagSays(`free ${allergen}`)) continue;
    if (!verified) {
      // We know the dish name and nothing about the kitchen.
      caveats.push({
        rule: `allergen-unverifiable:${allergen}`,
        reason: `We can't verify ${allergen.replace('-', ' ')} from a menu listing — check with the restaurant.`,
      });
    }
  }

  // An allergy we were never told the name of.
  if (profile.unspecifiedAllergy && !verified) {
    caveats.push({
      rule: 'allergen-unverifiable:unspecified',
      reason: "You've told us you have food allergies — check ingredients with the restaurant.",
    });
  }

  // 2. Restrictions.
  const unverifiedRestrictions: string[] = [];
  for (const r of profile.restrictions) {
    const key = r.replace(/ /g, '-');
    const terms = RESTRICTION_TERMS[key];
    if (!terms) continue;
    if (tagSays(key)) continue; // a trusted "vegan" tag
    const hit = hasAny(hay, terms);
    if (hit) {
      return { verdict: 'exclude', rule: `restriction:${key}`, reason: `Not ${key.replace('-', ' ')} — contains ${hit}.` };
    }

    const meat = (key === 'halal' || key === 'kosher') ? hasAny(hay, MEAT) : null;
    if (key === 'kosher' && meat) {
      // Kosher does not mix meat and dairy in one meal.
      const dairy = hasAny(hay, ALLERGEN_TERMS.milk);
      if (dairy) {
        return { verdict: 'exclude', rule: 'restriction:kosher-meat-dairy', reason: `Not kosher — mixes ${meat} and ${dairy}.` };
      }
    }
    if (meat) {
      // Permitted meat is only halal or kosher when certified, which no
      // ingredient table or menu listing can tell us.
      caveats.push({
        rule: `certification:${key}`,
        reason: `Choose ${key}-certified ${meat} — we can't confirm certification from a store listing or menu.`,
      });
    } else if (!verified) {
      // A dish name passing the keyword check is not evidence the kitchen
      // kept it vegan: stock, lard, butter and fish sauce never appear in names.
      unverifiedRestrictions.push(key.replace('-', ' '));
    }
  }
  if (unverifiedRestrictions.length) {
    caveats.push({
      rule: 'restriction-unverifiable',
      reason: `We only know the dish name — check it's ${unverifiedRestrictions.join(' and ')} with the restaurant.`,
    });
  }

  // 3. Dislikes — a preference, so it excludes but never warns.
  for (const d of profile.dislikes) {
    if (d && hasTerm(hay, d)) {
      return { verdict: 'exclude', rule: `dislike:${d}`, reason: `You marked ${d} as something you'd rather not eat.` };
    }
  }

  if (caveats.length) {
    return {
      verdict: 'unverifiable',
      rule: caveats.map(c => c.rule).join('+'),
      reason: caveats.map(c => c.reason).join(' '),
    };
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


// ---------------------------------------------------------------------------
// Resolving a user's diet from every place they have told us
// ---------------------------------------------------------------------------

/** Where a restriction came from, so the UI can say "from your coach intake". */
export type DietSource = 'food_finder' | 'coach_intake' | 'nutrition_assessment';

export interface ResolvedDiet {
  profile: DietProfile;
  sources: DietSource[];
  /** True once the user has saved their diet in the Food Finder itself. */
  explicit: boolean;
  /**
   * The intake offers a single combined "Halal / Kosher" option. The two rules
   * differ (kosher excludes shellfish; halal excludes alcohol), so it resolves to
   * BOTH — over-restricting a halal user's shellfish is recoverable, showing
   * shrimp to someone who keeps kosher is not — and the UI asks which applies.
   */
  halalKosherAmbiguous: boolean;
}

/** Coach intake values -> filter restrictions. 'none' and 'allergies' handled separately. */
const INTAKE_RESTRICTION: Record<string, string[]> = {
  vegetarian: ['vegetarian'],
  vegan: ['vegan'],
  gluten_free: ['gluten-free'],
  dairy_free: ['dairy-free'],
  halal_kosher: ['halal', 'kosher'],
};

/** Digestive intolerances from the nutrition assessment that map to a filter. */
const INTOLERANCE_RESTRICTION: Record<string, string> = {
  lactose: 'dairy-free', dairy: 'dairy-free', milk: 'dairy-free',
  gluten: 'gluten-free', wheat: 'gluten-free',
};

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/**
 * One diet profile from everywhere the user has told us about it.
 *
 * The same trap as injuries (which live in both constraintsText and
 * coachProfile): the coach intake has always asked about dietary restrictions,
 * and the nutrition assessment asks how the user eats, but the Food Finder read
 * only its own new columns — so a user who told the coach "halal/kosher" on day
 * one was still offered pork tenderloin.
 *
 * Precedence: once the user saves their diet in the Food Finder, that is the
 * truth, including an explicit empty list — they have seen the intake answers
 * pre-filled and chose. Until then, the intake and assessment answers are
 * unioned. A union is the safe direction for a filter: it can hide an option,
 * never show a forbidden one.
 */
export function resolveDietProfile(u: {
  dietaryRestrictions?: string | null;
  allergies?: string | null;
  dislikedFoods?: string | null;
  coachProfile?: string | null;
}): ResolvedDiet {
  const explicit = u.dietaryRestrictions != null || u.allergies != null || u.dislikedFoods != null;
  if (explicit) {
    return {
      profile: parseDietProfile(u),
      sources: ['food_finder'],
      explicit: true,
      halalKosherAmbiguous: false,
    };
  }

  let coach: any = null;
  try { coach = u.coachProfile ? JSON.parse(u.coachProfile) : null; } catch { coach = null; }

  const restrictions: string[] = [];
  const dislikes: string[] = [];
  const sources = new Set<DietSource>();
  let unspecifiedAllergy = false;
  let halalKosherAmbiguous = false;

  const intake: unknown = coach?.dietaryRestrictions;
  if (Array.isArray(intake)) {
    for (const raw of intake) {
      const v = String(raw).trim().toLowerCase();
      if (v === 'none' || !v) continue;
      if (v === 'allergies') { unspecifiedAllergy = true; sources.add('coach_intake'); continue; }
      if (v === 'halal_kosher') halalKosherAmbiguous = true;
      const mapped = INTAKE_RESTRICTION[v];
      if (mapped) { restrictions.push(...mapped); sources.add('coach_intake'); }
    }
  }

  const style = String(coach?.nutrition?.dietaryStyle ?? '').toLowerCase();
  if (style === 'vegetarian' || style === 'vegan' || style === 'pescatarian') {
    restrictions.push(style);
    sources.add('nutrition_assessment');
  }

  const intolerances: unknown = coach?.nutrition?.digestion?.intolerances;
  if (Array.isArray(intolerances)) {
    for (const raw of intolerances) {
      const f = fold(String(raw));
      if (!f) continue;
      const mapped = INTOLERANCE_RESTRICTION[f];
      if (mapped) restrictions.push(mapped);
      else dislikes.push(f); // an intolerance we cannot map still excludes by name
      sources.add('nutrition_assessment');
    }
  }

  return {
    profile: { restrictions: uniq(restrictions), allergies: [], dislikes: uniq(dislikes), unspecifiedAllergy },
    sources: [...sources],
    explicit: false,
    halalKosherAmbiguous,
  };
}
