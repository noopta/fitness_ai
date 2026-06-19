// Capture → share pipeline (spec §8). Rasterizes the card ref at the 1080px
// export raster (1080×1920 story / 1080×1080 square), hands the PNG to the OS
// share sheet, and optionally saves to the camera roll.
//
// `expo-media-library` is imported lazily so the JS bundle still runs on binaries
// built before the native module was added — Save to Photos just reports
// "unavailable" there and lights up on the next build.

import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { EXPORT_WIDTH, refFor } from './tokens';
import { ShareTemplate } from './types';

export async function captureCard(ref: React.RefObject<any>, template: ShareTemplate): Promise<string | null> {
  if (!ref.current) return null;
  const ref0 = refFor(template);
  const height = Math.round(EXPORT_WIDTH * (ref0.h / ref0.w));
  return captureRef(ref, { format: 'png', quality: 1, width: EXPORT_WIDTH, height, result: 'tmpfile' });
}

export async function shareCardImage(uri: string): Promise<boolean> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
    return false;
  }
  try {
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: 'Share your workout',
      UTI: 'public.png',
    });
    return true;
  } catch (err) {
    // Cancelling the share sheet rejects on some platforms — stay quiet.
    console.warn('[share] share failed', err);
    return false;
  }
}

export type SaveResult = 'saved' | 'denied' | 'unavailable';

export async function saveToPhotos(uri: string): Promise<SaveResult> {
  try {
    const MediaLibrary = await import('expo-media-library');
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) return 'denied';
    await MediaLibrary.saveToLibraryAsync(uri);
    return 'saved';
  } catch (err) {
    console.warn('[share] saveToPhotos unavailable', err);
    return 'unavailable';
  }
}
