/**
 * The one way to open a link that came from content (coach replies, chat
 * messages, cards, plan sources).
 *
 *   http(s)      → in-app browser (expo-web-browser), never handed to the OS,
 *                  so a link can't silently launch another app.
 *   mailto / tel → confirmed with an Alert that shows the address first.
 *   anything else (intent:, sms:, file:, javascript:, custom schemes, …) is
 *   refused. Deep links into Axiom itself go through the router, not here.
 */
import { Alert, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { log } from './log';

export const SUPPORT_EMAIL = 'support@axiomtraining.io';

function scheme(url: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Open `url` if its scheme is allowed. Resolves true if something was opened
 * (or the confirmation was shown for mailto/tel), false if refused.
 * `trusted` skips the mailto/tel confirmation for first-party links the app
 * itself builds (e.g. the support address).
 */
export async function openExternal(rawUrl: string | null | undefined, opts?: { trusted?: boolean }): Promise<boolean> {
  const url = String(rawUrl ?? '').trim();
  if (!url) return false;
  const s = scheme(url);

  if (s === 'http' || s === 'https') {
    try {
      await WebBrowser.openBrowserAsync(url);
      return true;
    } catch (e: any) {
      log.warn('[openExternal] browser failed', e?.message);
      return false;
    }
  }

  if (s === 'mailto' || s === 'tel') {
    const target = safeDecode(url.slice(s.length + 1).split('?')[0]).slice(0, 120);
    const go = () => { Linking.openURL(url).catch(() => Alert.alert('Couldn’t open that', target)); };
    if (opts?.trusted) { go(); return true; }
    Alert.alert(
      s === 'mailto' ? 'Open Mail?' : 'Call this number?',
      target,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: s === 'mailto' ? 'Open Mail' : 'Call', onPress: go },
      ],
    );
    return true;
  }

  log.warn('[openExternal] refused scheme', s);
  return false;
}

/** "Contact / Report a concern" — opens a pre-addressed email to support. */
export function contactSupport(subject = 'Axiom — report a concern'): void {
  void openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`, { trusted: true });
}
