// Custom app entry — initializes Sentry BEFORE any other code runs.
//
// ES `import` statements are hoisted and execute before a module's body, so a
// `Sentry.init()` at the top of app/_layout.tsx still runs AFTER that file's
// imports have loaded. Initializing here, in the package.json `main` entry,
// guarantees Sentry's handlers are installed before any app/route code loads —
// so it captures even very-early startup errors.
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://e3d5d2d971a53361b904ffc7eafe97d3@o4511583169609728.ingest.us.sentry.io/4511583170658304',
  tracesSampleRate: 0.1,
  enableAutoSessionTracking: true,
});

// Load the real Expo Router entry after Sentry is watching. `require` (not
// `import`) so it runs after Sentry.init rather than being hoisted ahead of it.
require('expo-router/entry');
