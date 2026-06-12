// expo-camera availability probe. The native module is added via the
// expo-camera plugin at EAS-build time — OTA updates cannot deliver it.
// A binary cut before the plugin landed will crash on any reference to
// the module, including the lazy-require inside BarcodeScanScreen on
// iOS new-architecture (TurboModule registry surfaces as a native
// exception that JS try/catch doesn't catch).
//
// Probe at module load: if `require('expo-camera')` throws synchronously,
// the binary doesn't have it. Cached for the lifetime of the JS instance.

let _result: boolean | null = null;

export function isCameraAvailable(): boolean {
  if (_result !== null) return _result;
  try {
    // The require itself triggers the native bridge lookup. If the bridge
    // module isn't registered, this throws.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const mod = require('expo-camera');
    // Sanity check that the exports we'll actually use are there.
    _result = !!(mod && (mod.CameraView || mod.Camera) && mod.useCameraPermissions);
  } catch {
    _result = false;
  }
  return _result;
}
