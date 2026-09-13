/** Where the request-path milliseconds actually go. */
import 'dotenv/config';
import { searchNearby } from '../src/services/places/placesClient.js';
import { CHAIN_PLACE_TYPES } from '../src/services/foodFinder/chainMenu.js';
import { DISH_PLACE_TYPES } from '../src/engine/cuisineDishes.js';

const ms = async (label: string, fn: () => Promise<unknown>) => {
  const t = process.hrtime.bigint();
  await fn();
  console.log(`  ${label.padEnd(34)} ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(1)} ms`);
};

async function main() {
  const lat = 43.5448, lng = -80.2482;
  console.log('COLD (first call for this grid cell):');
  await ms('Places: groceries', () => searchNearby({ lat, lng, radiusM: 2500, includedTypes: ['supermarket', 'grocery_store'], maxResults: 20 }));
  await ms('Places: cuisine restaurants', () => searchNearby({ lat, lng, radiusM: 2500, includedTypes: DISH_PLACE_TYPES, maxResults: 20 }));
  await ms('Places: chains', () => searchNearby({ lat, lng, radiusM: 2500, includedTypes: [...CHAIN_PLACE_TYPES], maxResults: 20 }));
  console.log('WARM (same cell, served from the grid cache):');
  await ms('Places: groceries', () => searchNearby({ lat, lng, radiusM: 2500, includedTypes: ['supermarket', 'grocery_store'], maxResults: 20 }));
  await ms('Places: cuisine restaurants', () => searchNearby({ lat, lng, radiusM: 2500, includedTypes: DISH_PLACE_TYPES, maxResults: 20 }));
}
main().catch(e => { console.error(e); process.exit(1); });
