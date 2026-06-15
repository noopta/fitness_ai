// Custom Expo config plugin — patches the generated iOS Podfile so the
// @react-native-firebase native modules can build under
// `useFrameworks: 'static'`.
//
// WHY the previous attempt (use_modular_headers!) wasn't enough:
//   `use_modular_headers!` at top-level scope is supposed to flip all pods
//   to modular header builds, but Expo declares React-Core via the
//   `use_react_native!` helper inside a target block, and the helper's
//   pod declarations don't pick up the global flag reliably. Result: RNFB
//   targets still see React-Core headers as non-modular and the framework-
//   module compile errors out.
//
// The fix: directly set CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES
// to YES on every RNFB* pod target via a post_install hook. This tells the
// compiler "allow non-modular includes inside this framework module" — the
// targeted brute-force fix recommended in the @react-native-firebase iOS
// troubleshooting guide.
//
// We inject INTO the existing post_install block Expo generates, so we don't
// fight CocoaPods' "only one post_install per target_definition" rule.
//
// Idempotent — guarded by a sentinel comment.

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const SENTINEL = '# axiom:rnfb-allow-non-modular-includes — see plugins/with-modular-headers.js';

// Body of the build-settings loop. Indented to match Expo's existing
// post_install style (2-space).
const INJECTION = `
    ${SENTINEL}
    installer.pods_project.targets.each do |t|
      if t.name.start_with?('RNFB')
        t.build_configurations.each do |c|
          c.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        end
      end
    end
`.replace(/^\n/, '');

// Standalone post_install block — used as a fallback if the Podfile doesn't
// already contain one for us to merge into.
const STANDALONE = `
${SENTINEL.replace('see plugins/with-modular-headers.js', 'standalone block')}
post_install do |installer|
${INJECTION}end
`.trim();

function patchPodfile(podfilePath) {
  if (!fs.existsSync(podfilePath)) {
    console.warn(`[with-modular-headers] Podfile not found at ${podfilePath} — skipping`);
    return;
  }
  let contents = fs.readFileSync(podfilePath, 'utf8');
  if (contents.includes(SENTINEL.split(' — ')[0])) {
    console.log('[with-modular-headers] Podfile already patched, skipping');
    return;
  }

  // Try to inject INSIDE the existing `post_install do |installer|` block.
  // Expo's generated Podfile always contains one (calls react_native_post_install).
  const blockStart = /post_install do \|installer\|/;
  if (blockStart.test(contents)) {
    contents = contents.replace(
      blockStart,
      (match) => `${match}\n${INJECTION}`,
    );
    console.log('[with-modular-headers] merged RNFB build-settings into existing post_install block');
  } else {
    contents = `${contents}\n\n${STANDALONE}\n`;
    console.log('[with-modular-headers] appended standalone post_install block (no existing block found)');
  }

  fs.writeFileSync(podfilePath, contents);
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
