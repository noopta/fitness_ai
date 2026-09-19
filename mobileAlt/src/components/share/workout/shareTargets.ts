// One-tap export targets for a rendered card (spec §7).
//
// Replaces the single "Share" button — which only ever opened the generic OS
// sheet — with an explicit row, the way Strava/Nike surface theirs.
//
// WHAT SHIPS OVER-THE-AIR vs WHAT NEEDS A BUILD
// ---------------------------------------------
// Save / Copy / More are pure JS and work on the binaries already in the store.
//
// Instagram Stories *direct* cannot ship OTA, on either platform:
//   iOS     Instagram reads the image off UIPasteboard under its own UTI
//           (`com.instagram.sharedSticker.backgroundImage`) and is then opened
//           with `instagram-stories://share`. `expo-clipboard` only writes the
//           generic image type, which Instagram ignores — this needs native code.
//           Separately, `canOpenURL` returns false for any scheme missing from
//           `LSApplicationQueriesSchemes`, so even detection needs a rebuild.
//   Android The documented path is the `com.instagram.share.ADD_TO_STORY`
//           intent with a content:// URI, which needs `expo-intent-launcher`
//           (not currently a dependency) plus a `<queries>` manifest entry.
//
// So `instagramStories` is declared here and reports `available: false` until a
// build provides the native half. Nothing below imports a module that isn't in
// package.json — a lazy import of an uninstalled package fails the Metro bundle,
// which would break the whole app, not just this row.
//
// Until then "More" covers Instagram, TikTok and X: the OS sheet hands the PNG
// to any installed app in one tap. TikTok has no image deep link at all (their
// SDK is the only route) and X cannot attach media via a web intent, so the
// sheet is the correct destination for both regardless of build.

import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';

export type ShareTargetId = 'instagramStories' | 'save' | 'copy' | 'more';

export type TargetResult = 'ok' | 'cancelled' | 'unavailable' | 'denied' | 'failed';

export interface ShareTargetDef {
  id: ShareTargetId;
  label: string;
  /** Ionicons glyph name. */
  icon: string;
  /** False ⇒ render the target hidden, not disabled (spec §7). */
  available: boolean;
}

/** Payload handed to a target. `base64` is only produced when a target needs it. */
export interface CardArtifact {
  uri: string;
  base64?: string;
}

/**
 * Instagram Stories deep link. Exported for the test suite and for the build
 * that wires up the native half.
 *
 * `source_application` must be a registered Meta app id or Instagram rejects the
 * open. Axiom's Facebook app exists — wire its id in here when the native
 * pasteboard/intent support lands.
 */
export const IG_STORIES_URL = (appId: string) =>
  `instagram-stories://share?source_application=${appId}`;

/**
 * Which targets can this binary actually perform?
 *
 * Detection is per-call rather than cached: Save flips from unavailable to
 * available the first time a user installs a build carrying expo-media-library,
 * and the row should reflect that without an app restart.
 */
export async function detectTargets(): Promise<ShareTargetDef[]> {
  const [canShare, canSave] = await Promise.all([
    Sharing.isAvailableAsync().catch(() => false),
    hasMediaLibrary(),
  ]);

  return [
    {
      id: 'instagramStories',
      label: 'Instagram',
      icon: 'logo-instagram',
      // Deliberately false on every current binary — see the header note.
      available: false,
    },
    { id: 'save', label: 'Save', icon: 'download-outline', available: canSave },
    { id: 'copy', label: 'Copy', icon: 'copy-outline', available: true },
    { id: 'more', label: 'More', icon: 'share-outline', available: canShare },
  ];
}

/** Is the native media-library module present in this binary? */
async function hasMediaLibrary(): Promise<boolean> {
  try {
    const MediaLibrary = await import('expo-media-library');
    return typeof MediaLibrary.saveToLibraryAsync === 'function';
  } catch {
    return false;
  }
}

/** Does this target need a base64 copy of the card as well as a file URI? */
export function needsBase64(id: ShareTargetId): boolean {
  return id === 'copy';
}

/** Perform a target. Never throws — every failure maps to a TargetResult. */
export async function runTarget(id: ShareTargetId, art: CardArtifact): Promise<TargetResult> {
  switch (id) {
    case 'save':
      return saveToLibrary(art.uri);

    case 'copy':
      if (!art.base64) return 'failed';
      try {
        await Clipboard.setImageAsync(art.base64);
        return 'ok';
      } catch (err) {
        console.warn('[share] copy failed', err);
        return 'failed';
      }

    case 'more':
      try {
        if (!(await Sharing.isAvailableAsync())) return 'unavailable';
        await Sharing.shareAsync(art.uri, {
          mimeType: 'image/png',
          dialogTitle: 'Share your workout',
          UTI: 'public.png',
        });
        return 'ok';
      } catch (err) {
        // Dismissing the sheet rejects on some platforms — not an error.
        console.warn('[share] share sheet closed', err);
        return 'cancelled';
      }

    case 'instagramStories':
      // Unreachable while detectTargets() reports available:false; kept so the
      // build that adds the native half has one obvious place to fill in.
      return 'unavailable';

    default:
      return 'unavailable';
  }
}

async function saveToLibrary(uri: string): Promise<TargetResult> {
  try {
    const MediaLibrary = await import('expo-media-library');
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) return 'denied';
    await MediaLibrary.saveToLibraryAsync(uri);
    return 'ok';
  } catch (err) {
    console.warn('[share] save unavailable', err);
    return 'unavailable';
  }
}

/** User-facing copy for a completed target. `null` ⇒ say nothing. */
export function resultMessage(id: ShareTargetId, r: TargetResult): { title: string; body: string } | null {
  if (r === 'ok') {
    if (id === 'save') return { title: 'Saved', body: 'Your card was saved to Photos.' };
    if (id === 'copy') return { title: 'Copied', body: 'Your card is on the clipboard.' };
    return null; // the share sheet is its own confirmation
  }
  if (r === 'cancelled') return null;
  if (r === 'denied') {
    return { title: 'Photo access needed', body: 'Enable photo access in Settings to save your card.' };
  }
  if (r === 'unavailable') {
    return {
      title: 'Not available yet',
      body: Platform.select({
        ios: 'This option lights up in the next app update.',
        default: 'This option lights up in the next app update.',
      })!,
    };
  }
  return { title: 'Could not share', body: 'Something went wrong creating your card. Please try again.' };
}
