/**
 * Verify Places API type strings against the live API before adding them.
 *
 * Necessary because ONE invalid entry in `includedTypes` 400s the entire
 * request — the whole path silently disappears rather than degrading, so a
 * guessed type name is a way to lose a feature without an error appearing
 * anywhere a user can see.
 *
 *   npx tsx scripts/probePlaceTypes.ts [lat] [lng] [type ...]
 */
import 'dotenv/config';
import { searchNearby } from '../src/services/places/placesClient.js';
import { normaliseVenueName } from '../src/services/foodFinder/brandMatcher.js';

const DEFAULTS = [
  'fast_food_restaurant', 'hamburger_restaurant', 'coffee_shop', 'cafe',
  'pizza_restaurant', 'chicken_restaurant', 'meal_takeaway', 'donut_shop',
  'bagel_shop', 'deli', 'juice_shop', 'acai_shop', 'salad_shop',
];

async function main() {
  const [latArg, lngArg, ...rest] = process.argv.slice(2);
  const lat = Number(latArg) || 43.6561;
  const lng = Number(lngArg) || -79.3802;
  const types = rest.length ? rest : DEFAULTS;

  for (const t of types) {
    // One type per call, so a rejection names the culprit instead of poisoning
    // the batch.
    const res = await searchNearby({ lat, lng, radiusM: 1500, includedTypes: [t], maxResults: 10 });
    console.log(`${t.padEnd(24)} ${res.length ? `OK  ${res.length} hits` : 'no hits (invalid, or genuinely none nearby)'}`);
    // The normalised form is what brand matching actually sees, so printing it
    // is the fastest way to diagnose a chain that should have matched but did not.
    for (const p of res) console.log(`    ${p.name.slice(0, 34).padEnd(36)} -> "${normaliseVenueName(p.name)}"`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
