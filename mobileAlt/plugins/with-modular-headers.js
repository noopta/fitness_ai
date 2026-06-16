// Custom Expo config plugin — makes @react-native-firebase v24 build under
// `useFrameworks: 'static'`.
//
// Iteration log (so future-me knows what didn't work):
//   v1: use_modular_headers! at top-level scope → no effect, pods inside
//       target block weren't touched
//   v2: CLANG_ALLOW_NON_MODULAR_INCLUDES on RNFB targets → bypassed include
//       error but RCTBridgeModule macros still failed to expand because
//       React-Core wasn't actually modular
//   v3: $RNFirebaseAsStaticFramework = true → that variable is from older
//       RNFB versions (< 18), v24 doesn't honor it
//   v4 (current): use_modular_headers! INSIDE the target block, right
//       before use_react_native! → applies to all pods declared by the RN
//       helper including React-Core itself
//
// The CLANG flag is kept as defense-in-depth (cheap, harmless). The pre-
// target $RNFirebaseAsStaticFramework injection is dropped (v24 ignores it).
//
// Idempotent — sentinel-guarded.

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const SENTINEL_IN_TARGET = '# axiom:use-modular-headers-in-target';
const SENTINEL_POST      = '# axiom:rnfb-allow-non-modular-includes';

const POST_INJECT = `
    ${SENTINEL_POST} — see plugins/with-modular-headers.js
    installer.pods_project.targets.each do |t|
      if t.name.start_with?('RNFB')
        t.build_configurations.each do |c|
          c.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        end
      end
    end
`.replace(/^\n/, '');

function patchPodfile(podfilePath) {
  if (!fs.existsSync(podfilePath)) {
    console.warn(`[with-modular-headers] Podfile not found at ${podfilePath} — skipping`);
    return;
  }
  let contents = fs.readFileSync(podfilePath, 'utf8');
  let changed = false;

  // ── 1. use_modular_headers! INSIDE the target block ───────────────────
  // The target block looks like:
  //   target 'mobileAlt' do
  //     use_expo_modules!
  //     ...
  //     use_react_native!(...)
  //   end
  // We need use_modular_headers! to land BEFORE use_react_native! so the RN
  // pods it declares pick up the flag. Inserting right after use_expo_modules!
  // (always the first line of the target block in Expo's template).
  if (!contents.includes(SENTINEL_IN_TARGET)) {
    const useExpoRegex = /(use_expo_modules!.*$)/m;
    if (useExpoRegex.test(contents)) {
      const inject = `\n\n  ${SENTINEL_IN_TARGET} — see plugins/with-modular-headers.js\n  use_modular_headers!`;
      contents = contents.replace(useExpoRegex, (m) => `${m}${inject}`);
      changed = true;
      console.log('[with-modular-headers] injected use_modular_headers! inside target block');
    } else {
      console.warn('[with-modular-headers] use_expo_modules! not found — could not place use_modular_headers!');
    }
  }

  // ── 2. CLANG_ALLOW_NON_MODULAR_INCLUDES on RNFB targets in post_install
  if (!contents.includes(SENTINEL_POST)) {
    const blockStart = /post_install do \|installer\|/;
    if (blockStart.test(contents)) {
      contents = contents.replace(blockStart, (m) => `${m}\n${POST_INJECT}`);
      changed = true;
      console.log('[with-modular-headers] merged RNFB CLANG flag into post_install');
    } else {
      contents = `${contents}\n\npost_install do |installer|\n${POST_INJECT}end\n`;
      changed = true;
      console.log('[with-modular-headers] appended standalone post_install (no existing block)');
    }
  }

  if (changed) {
    fs.writeFileSync(podfilePath, contents);
    // Debug — first 60 lines so we can confirm in EAS logs the injection landed.
    const head = contents.split('\n').slice(0, 60).join('\n');
    console.log('[with-modular-headers] Podfile head after patching:\n' + head);
  } else {
    console.log('[with-modular-headers] Podfile already patched, skipping');
  }
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
