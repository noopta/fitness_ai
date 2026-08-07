#!/usr/bin/env node
/**
 * Guard that runs before `npm run ota` (an `eas update` to the production
 * channel).
 *
 * The trap it exists to catch: app.json sets
 *   "runtimeVersion": { "policy": "appVersion" }
 * so an update's runtime version IS the `version` string in app.json. An OTA
 * is only delivered to installed binaries whose runtime version matches
 * EXACTLY. The moment someone bumps `version` (say 3.1.0 -> 3.2.0) and runs
 * an OTA, the update publishes successfully, EAS reports success, and it
 * reaches ZERO users — every phone in the field is still on 3.1.0. There is
 * no error anywhere; the update simply lands in a runtime nobody is running.
 *
 * So: compare app.json's `version` against the appVersion of the most recent
 * FINISHED `production` build per platform (EAS is the source of truth, since
 * appVersionSource is "remote"). Mismatch means the OTA would be a no-op and
 * what's actually needed is a native build + store submission.
 *
 * Bypass with --force when you know the mismatch is intentional (e.g. seeding
 * a runtime ahead of a build that's already queued).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const force = process.argv.includes('--force');
const appJsonPath = path.join(__dirname, '..', 'app.json');

function fail(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('');
  console.error('  Bypass with:  npm run ota:force');
  console.error('');
  process.exit(1);
}

const expo = JSON.parse(fs.readFileSync(appJsonPath, 'utf8')).expo;
const localVersion = expo.version;
const policy = expo.runtimeVersion && expo.runtimeVersion.policy;

if (policy !== 'appVersion') {
  // Guard is specific to the appVersion policy. Any other policy (or an
  // explicit runtimeVersion string) has different delivery rules, so rather
  // than assert something wrong, say so and get out of the way.
  console.log(`[preflight-ota] runtimeVersion policy is "${policy}", not "appVersion" — skipping version check`);
  process.exit(0);
}

if (force) {
  console.log(`[preflight-ota] --force — skipping check, publishing at runtime ${localVersion}`);
  process.exit(0);
}

let builds;
try {
  // --limit 30 comfortably covers several releases across both platforms;
  // there is no server-side filter for buildProfile, so filter here.
  const out = execFileSync(
    'eas',
    ['build:list', '--platform', 'all', '--status', 'finished', '--limit', '30', '--json', '--non-interactive'],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 }
  );
  builds = JSON.parse(out);
} catch (err) {
  fail([
    '[preflight-ota] could not reach EAS to verify the shipped app version.',
    '',
    `  ${err.message.split('\n')[0]}`,
    '',
    '  Usually: not logged in (`eas login`) or node_modules missing (`npm install`).',
    `  Verify by hand that the newest production build is version ${localVersion},`,
    '  then re-run.',
  ]);
}

const latestByPlatform = {};
for (const b of builds) {
  if (b.buildProfile !== 'production') continue;
  const prev = latestByPlatform[b.platform];
  if (!prev || new Date(b.completedAt) > new Date(prev.completedAt)) latestByPlatform[b.platform] = b;
}

const shipped = Object.values(latestByPlatform);
if (shipped.length === 0) {
  fail([
    '[preflight-ota] no finished "production" builds found on EAS — nothing to compare against.',
    '  Ship a native build first:  npm run release:all',
  ]);
}

const stale = shipped.filter((b) => b.appVersion !== localVersion);
if (stale.length > 0) {
  fail([
    `[preflight-ota] BLOCKED — this OTA would reach nobody.`,
    '',
    `  app.json version ....... ${localVersion}   (the runtime this update publishes to)`,
    ...shipped.map(
      (b) => `  latest ${b.platform.toLowerCase().padEnd(7)} build ... ${b.appVersion}   (${b.completedAt.slice(0, 10)})`
    ),
    '',
    '  Installed apps only accept updates matching their runtime version exactly,',
    '  so publishing now is a silent no-op for every user in the field.',
    '',
    '  Ship a native build instead:',
    '    npm run release:android     # -> Play internal testing track',
    '    npm run release:ios         # -> TestFlight',
    '    npm run release:all',
  ]);
}

console.log(
  `[preflight-ota] OK — app.json ${localVersion} matches the latest production build on ` +
    `${shipped.map((b) => b.platform.toLowerCase()).join(' + ')}; OTA will reach installed users`
);
