// Capture a rendered view to a PNG and hand it to the OS share sheet
// (X, Instagram, Messages, etc.). Used by the nutrition + weight share cards.
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

export async function captureAndShare(
  ref: React.RefObject<any>,
  opts?: { dialogTitle?: string },
): Promise<void> {
  try {
    if (!ref.current) return;
    const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
      return;
    }
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: opts?.dialogTitle ?? 'Share your progress',
      UTI: 'public.png',
    });
  } catch (err) {
    // User cancelling the share sheet also rejects on some platforms — keep quiet.
    console.warn('[share] capture/share failed', err);
  }
}
