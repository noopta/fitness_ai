// Custom Expo config plugin — injects `use_modular_headers!` into the
// generated iOS Podfile.
//
// WHY: @react-native-firebase ships its iOS modules as ObjC framework
// modules. With `useFrameworks: 'static'` set (which Firebase iOS SDK
// REQUIRES), those modules error out when they include non-modular React
// headers (RCTConvert.h, RCTBridgeModule.h, RCTEventEmitter.h) with
// `-Werror,-Wnon-modular-include-in-framework-module`.
//
// `use_modular_headers!` flips ALL pods to be built with modular headers,
// which satisfies the strict include rule. Documented CocoaPods
// recommendation when combining `use_frameworks!` with libraries that need
// modular includes.
//
// Idempotent — tags the Podfile with a sentinel comment, skips on re-run.

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const SENTINEL = '# axiom:use-modular-headers — see plugins/with-modular-headers.js';
const INJECT = `\n${SENTINEL}\nuse_modular_headers!\n`;

function patchPodfile(podfilePath) {
  if (!fs.existsSync(podfilePath)) {
    console.warn(`[with-modular-headers] Podfile not found at ${podfilePath} — skipping`);
    return;
  }
  let contents = fs.readFileSync(podfilePath, 'utf8');
  if (contents.includes(SENTINEL)) return;

  // Insert AFTER the `platform :ios` line so it lands at top-level scope.
  // Falls back to top-of-file if the platform line isn't found.
  const platformRegex = /^platform :ios.*$/m;
  if (platformRegex.test(contents)) {
    contents = contents.replace(platformRegex, (match) => `${match}${INJECT}`);
  } else {
    contents = INJECT + contents;
  }
  fs.writeFileSync(podfilePath, contents);
  console.log('[with-modular-headers] patched Podfile with use_modular_headers!');
}

module.exports = function withModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      patchPodfile(podfilePath);
      return cfg;
    },
  ]);
};
