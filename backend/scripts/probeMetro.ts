import 'dotenv/config';
import { nearestMetro, currencyFor, haversineM } from '../src/engine/currency.js';
const [lat, lng] = [Number(process.argv[2] ?? 43.5448), Number(process.argv[3] ?? -80.2482)];
const m = nearestMetro(lat, lng);
console.log(`(${lat}, ${lng}) -> metro=${m?.slug ?? 'NONE'} currency=${currencyFor(lat, lng)}`);
if (m) console.log(`  distance to ${m.label}: ${(haversineM(lat, lng, m.lat, m.lng) / 1000).toFixed(1)} km`);
