// Custom app entry — initializes Sentry and a startup-error catcher BEFORE any
// other code runs.
//
// Why this exists: ES `import` statements are hoisted and execute before a
// module's body, so a `Sentry.init()` placed at the top of app/_layout.tsx still
// runs AFTER that file's imports (analytics.ts -> `new PostHog()`,
// usePushNotifications -> `setNotificationHandler`, the onboarding modules) have
// already loaded. If one of those throws at module-load, the app crashes before
// anything is watching — which is what we saw (Sentry + PostHog both empty).
//
// Initializing here, in the package.json `main` entry, guarantees the handlers
// are installed before any app/route code loads.
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://e3d5d2d971a53361b904ffc7eafe97d3@o4511583169609728.ingest.us.sentry.io/4511583170658304',
  tracesSampleRate: 0.1,
  enableAutoSessionTracking: true,
});

// Startup-error catcher: if a fatal JS error happens before the app's own React
// error UI can mount, (1) report it to Sentry explicitly and (2) show it in an
// on-screen Alert so it's readable on the device with no Mac/Sentry dashboard.
// Swallows the first fatal so the process survives long enough to display it.
(function installStartupErrorCatcher() {
  const EU = global.ErrorUtils;
  if (!EU || typeof EU.setGlobalHandler !== 'function') return;
  const prev = typeof EU.getGlobalHandler === 'function' ? EU.getGlobalHandler() : null;
  let shown = false;
  EU.setGlobalHandler(function (error, isFatal) {
    try { Sentry.captureException(error); } catch (e) {}
    if (isFatal && !shown) {
      shown = true;
      try {
        const { Alert } = require('react-native');
        const msg = (error && error.message) ? error.message : String(error);
        const stack = (error && error.stack) ? String(error.stack).slice(0, 700) : '';
        setTimeout(function () {
          try { Alert.alert('Axiom startup error — screenshot this', msg + '\n\n' + stack); } catch (e) {}
        }, 800);
      } catch (e) {}
      return; // do NOT chain to the default handler — that RCTFatals before the Alert can show
    }
    if (prev) prev(error, isFatal);
  });
})();

// Load the real Expo Router entry. `require` (not `import`) so it runs after the
// init + catcher above rather than being hoisted ahead of them.
require('expo-router/entry');
