// Custom app entry — initializes Sentry BEFORE any other code runs.
//
// Why this exists: ES `import` statements are hoisted and execute before a
// module's body, so a `Sentry.init()` placed at the top of app/_layout.tsx
// still runs AFTER that file's imports (analytics.ts -> `new PostHog()`,
// usePushNotifications -> `setNotificationHandler`, the onboarding modules,
// etc.) have already loaded. If one of those throws at module-load, the app
// crashes before Sentry is watching — which is exactly what we saw (Sentry and
// PostHog both captured nothing from the startup crash). Initializing here, in
// the package.json `main` entry, guarantees Sentry's error handlers are
// installed before any app/route code loads.
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://e3d5d2d971a53361b904ffc7eafe97d3@o4511583169609728.ingest.us.sentry.io/4511583170658304',
  tracesSampleRate: 0.1,
  enableAutoSessionTracking: true,
});

// Now load the real Expo Router entry. `require` (not `import`) so it runs
// after Sentry.init above rather than being hoisted ahead of it.
require('expo-router/entry');
