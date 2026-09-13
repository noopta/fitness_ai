import 'dotenv/config';
import { autocompletePlaces, placeDetails } from '../src/services/places/placesClient.js';
async function main() {
  const q = process.argv.slice(2).join(' ') || '172 Farley Dr Guelph';
  const s = await autocompletePlaces(q, { lat: 43.5448, lng: -80.2482, sessionToken: 'probe-1' });
  console.log(`"${q}" -> ${s.length} suggestions`);
  for (const x of s) console.log(`  ${x.primary} | ${x.secondary}`);
  if (s[0]) {
    const d = await placeDetails(s[0].placeId);
    console.log('first resolves to:', d ? `${d.name} (${d.lat}, ${d.lng})` : 'null');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
