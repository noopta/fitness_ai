// react-native-vision-camera availability probe. The native module is added
// at EAS-build time via the config plugin — OTA updates cannot deliver it.
// A binary cut before the plugin landed will crash on any reference to the
// module, including the lazy-require inside BarcodeScanScreen.
//
// We swapped FROM expo-camera (which crashed on iPhone XR + Fabric) TO
// vision-camera 5.x because vision-camera has more mature handling for
// older A12 devices and doesn't go through the TurboModule path that was
// crashing for us.
//
// Probe at module load: if `require('react-native-vision-camera')` throws,
// the binary doesn't have it. Cached for the lifetime of the JS instance.

let _result: boolean | null = null;

export function isCameraAvailable(): boolean {
  if (_result !== null) return _result;
  try {
    // The require itself triggers the native bridge lookup. If the bridge
    // module isn't registered, this throws.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const mod = require('react-native-vision-camera');
    // Sanity check that the exports we'll actually use are there.
    _result = !!(mod && mod.Camera && mod.useCameraDevice && mod.useCameraPermission);
  } catch {
    _result = false;
  }
  return _result;
}
