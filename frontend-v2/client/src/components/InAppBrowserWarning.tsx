import { isInAppBrowser } from '@/lib/inAppBrowser';

/**
 * Warning banner shown on the login / register pages when the page is open
 * inside an in-app browser. Google OAuth fails there with
 * "Error 403: disallowed_useragent", so we tell the user how to proceed.
 * Renders nothing in a normal browser.
 */
export function InAppBrowserWarning() {
  if (!isInAppBrowser()) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900"
    >
      <strong>Heads up:</strong> Google sign-in doesn't work in in-app browsers
      (Instagram, Facebook, etc.). Open this page in Safari or Chrome — tap the
      menu (⋯) and choose <strong>Open in browser</strong> — or just sign in
      with your email below.
    </div>
  );
}
