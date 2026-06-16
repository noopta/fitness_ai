// Custom Expo config plugin — makes @react-native-firebase build under
// `useFrameworks: 'static'`.
//
// The journey:
//   1. Default config:  "include of non-modular header inside framework module"
//      → use_modular_headers! at top scope didn't propagate through use_react_native!
//   2. CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES = YES on RNFB targets:
//      → bypassed the include error, but surfaced the deeper issue —
//      "RCTBridgeModule must be imported from module RNFBApp.RNFBAppModule"
//      because the React macros can't expand properly without a real module
//      context.
//   3. The canonical @react-native-firebase fix: `$RNFirebaseAsStaticFramework`
//      global at the top of the Podfile. Tells RNFB's own podspec to declare
//      itself as a static framework cleanly, which sidesteps the entire
//      module-visibility mess.
//
// We do BOTH:
//   - $RNFirebaseAsStaticFramework = true at the top (the real fix)
//   - the CLANG flag in post_install as a safety net (cheap, harmless)
//
// Idempotent — sentinel-guarded.

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const SENTINEL_PRE  = '# axiom:rnfb-static-framework';
const SENTINEL_POST = '# axiom:rnfb-allow-non-modular-includes';

const PRE_INJECT = `
${SENTINEL_PRE} — see plugins/with-modular-headers.js
$RNFirebaseAsStaticFramework = true
`.trim();

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

  // ── 1. $RNFirebaseAsStaticFramework = true at top scope ────────────────
  if (!contents.includes(SENTINEL_PRE)) {
    // Land it AFTER the `require` lines (autolinking scripts) but BEFORE any
    // target block. Simplest: insert immediately after the `platform :ios`
    // line, which is top-scope and always present.
    const platformRegex = /^platform :ios.*$/m;
    if (platformRegex.test(contents)) {
      contents = contents.replace(platformRegex, (m) => `${m}\n\n${PRE_INJECT}\n`);
    } else {
      contents = `${PRE_INJECT}\n\n${contents}`;
    }
    changed = true;
    console.log('[with-modular-headers] injected $RNFirebaseAsStaticFramework = true');
  }

  // ── 2. CLANG_ALLOW_NON_MODULAR_INCLUDES on RNFB targets in post_install ──
  if (!contents.includes(SENTINEL_POST)) {
    const blockStart = /post_install do \|installer\|/;
    if (blockStart.test(contents)) {
      contents = contents.replace(blockStart, (m) => `${m}\n${POST_INJECT}`);
      changed = true;
      console.log('[with-modular-headers] merged RNFB build-settings into existing post_install');
    } else {
      // Fallback — append a standalone block. Shouldn't happen with Expo's
      // template (it always emits a post_install) but defensive.
      contents = `${contents}\n\npost_install do |installer|\n${POST_INJECT}end\n`;
      changed = true;
      console.log('[with-modular-headers] appended standalone post_install (no existing block)');
    }
  }

  if (changed) fs.writeFileSync(podfilePath, contents);
  else        console.log('[with-modular-headers] Podfile already patched, skipping');
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
