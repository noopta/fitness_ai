// Detects when the page is running inside a third-party app's embedded
// browser (Instagram, Facebook, TikTok, etc.).
//
// Why this matters: Google blocks OAuth in these "disallowed user agents"
// (Error 403: disallowed_useragent — a security policy, not something we can
// configure away). So "Continue with Google" simply cannot work in a webview;
// the user has to open the page in a real browser or use email sign-in.

// High-confidence in-app-browser markers found in navigator.userAgent.
const IN_APP_UA_MARKERS = [
  'FBAN', 'FBAV', 'FB_IAB',          // Facebook / Messenger
  'Instagram',
  'Line/',
  'Twitter', 'TwitterAndroid',
  'Snapchat',
  'musical_ly', 'TikTok', 'Bytedance', // TikTok
  'LinkedInApp',
  'Pinterest',
];

/**
 * True when the current page is inside an embedded / in-app browser where
 * Google OAuth will be rejected. Conservative — only fires on known markers
 * so we don't warn users in real browsers.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (IN_APP_UA_MARKERS.some((m) => ua.includes(m))) return true;
  // Generic Android System WebView marker: "; wv)" in the UA string.
  if (/;\s*wv\)/.test(ua)) return true;
  return false;
}
