#!/usr/bin/env node
/**
 * Guard that runs in CI before every OTA publish.
 *
 * The trap it exists to catch: an OTA carries JavaScript only, and reaches
 * every installed binary on the same runtimeVersion. If a commit adds or
 * upgrades a NATIVE dependency (anything with ios/ or android/ code) without
 * bumping runtimeVersion, the new JS lands on binaries that don't contain the
 * native half. Oct 2026: the Apple Health commit added
 * @kingstinct/react-native-healthkit; its JS reached build 171 (runtime 3.2.0)
 * by OTA, and every launch threw "HybridObject CoreModule has not been
 * registered" into Sentry (REACT-NATIVE-G).
 *
 * native-deps.json records the dependencies as of the current runtimeVersion.
 * After `npm ci`, any dependency that differs from it is classified: JS-only
 * changes pass; a native change fails unless runtimeVersion was bumped (then
 * a native build is needed anyway) or the package is listed in `jsGuarded`
 * (the JS checks for the native module before using it, and the native half
 * ships in the next build).
 *
 *   node scripts/check-native-deps.js           check (CI)
 *   node scripts/check-native-deps.js --write   re-baseline after a runtime bump + native build
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const snapPath = path.join(root, 'native-deps.json');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const expo = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const runtime = typeof expo.runtimeVersion === 'string' ? expo.runtimeVersion : expo.version;
const deps = { ...(pkg.dependencies || {}) };

/** True when the installed package carries native code that autolinks into the binary. */
function isNative(name) {
  const dir = path.join(root, 'node_modules', name);
  if (!fs.existsSync(dir)) return null; // not installed: can't tell
  const markers = ['ios', 'android', 'expo-module.config.json', 'nitro.json', 'react-native.config.js'];
  if (markers.some((m) => fs.existsSync(path.join(dir, m)))) return true;
  return fs.readdirSync(dir).some((f) => f.endsWith('.podspec'));
}

if (process.argv.includes('--write')) {
  const prev = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath, 'utf8')) : {};
  const keep = prev.runtimeVersion === runtime ? prev.jsGuarded || {} : {};
  fs.writeFileSync(snapPath, JSON.stringify({ runtimeVersion: runtime, dependencies: deps, jsGuarded: keep }, null, 2) + '\n');
  console.log(`native-deps.json written for runtime ${runtime} (${Object.keys(deps).length} dependencies).`);
  process.exit(0);
}

if (!fs.existsSync(snapPath)) {
  console.error('native-deps.json is missing. Run: node scripts/check-native-deps.js --write');
  process.exit(1);
}
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
if (snap.runtimeVersion !== runtime) {
  // A runtime bump: this OTA only reaches binaries built for the new runtime,
  // which include whatever native code is in package.json now.
  console.log(`runtimeVersion ${snap.runtimeVersion} -> ${runtime}: native changes are allowed. Re-baseline with --write after the build.`);
  process.exit(0);
}

const changed = Object.keys({ ...deps, ...snap.dependencies }).filter((n) => deps[n] !== snap.dependencies[n]);
const guarded = snap.jsGuarded || {};
const problems = [];
for (const name of changed) {
  if (guarded[name] && guarded[name] === deps[name]) continue;
  const native = deps[name] ? isNative(name) : true; // a removed native dep also changes the binary contract
  if (native === false) continue;
  const how = !snap.dependencies[name] ? `added ${deps[name]}` : !deps[name] ? `removed (was ${snap.dependencies[name]})` : `${snap.dependencies[name]} -> ${deps[name]}`;
  problems.push(`  ${name}: ${how}${native === null ? ' (not installed, so treated as native)' : ''}`);
}

if (problems.length) {
  console.error('');
  console.error(`Native dependencies changed on runtime ${runtime}. This OTA would reach binaries that don't contain them:`);
  for (const p of problems) console.error(p);
  console.error('');
  console.error('Fix one of:');
  console.error('  - bump expo.runtimeVersion in app.json and ship a native build (then --write), or');
  console.error('  - if the JS checks for the module before using it, add it to "jsGuarded" in native-deps.json');
  console.error('    with its version, so the guarded JS can ship ahead of the next build.');
  console.error('');
  process.exit(1);
}
console.log(`native deps OK for runtime ${runtime} (${changed.length} JS-only change(s)).`);
