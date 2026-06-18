#!/usr/bin/env node
/**
 * Deterministically remove the PostHog Session Replay iOS native module.
 *
 * Its Swift layer (ios/PosthogReactNativeSessionReplay.swift) crashes EVERY
 * Xcode 26 release build on launch:
 *   NSClassFromString -> swift_getTypeByMangledNode -> Data Abort (SIGABRT)
 *   on the "com.facebook.react.PosthogReactNativeSessionReplayQueue".
 * (Crash logs builds 107/109/111; known PostHog issue PostHog/posthog-js#3329.)
 *
 * posthog-react-native-session-replay is a TRANSITIVE dependency of
 * posthog-react-native, so it can't be uninstalled and `react-native.config.js`
 * autolinking exclusion can't be verified pre-build. This script physically
 * deletes the pod podspec + ios sources after install, so CocoaPods autolinking
 * has nothing to compile — the crashing code cannot reach the binary. Runs in
 * `postinstall` so it also applies inside EAS Build.
 *
 * Session replay is also disabled in JS (analytics.ts: enableSessionReplay:false).
 * PostHog product analytics (events/identify) are JS-only and unaffected — the
 * package's JS (lib/, src/) is intentionally left intact so the JS require still
 * resolves and PostHog gracefully reports replay as unavailable.
 */
const fs = require('fs');
const path = require('path');

const pkgDir = path.join(__dirname, '..', 'node_modules', 'posthog-react-native-session-replay');

if (!fs.existsSync(pkgDir)) {
  console.log('[strip-posthog-sr] posthog-react-native-session-replay not installed — nothing to do');
  process.exit(0);
}

const targets = [
  path.join(pkgDir, 'posthog-react-native-session-replay.podspec'),
  path.join(pkgDir, 'ios'),
];

let removed = 0;
for (const target of targets) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log('[strip-posthog-sr] removed', path.relative(path.join(__dirname, '..'), target));
    removed++;
  }
}

console.log(`[strip-posthog-sr] done — ${removed} path(s) removed; iOS session-replay native code is not in the build`);
