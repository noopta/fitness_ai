// Barcode-scan flow (react-native-vision-camera 5.x).
//
// Why vision-camera instead of expo-camera:
//   - expo-camera 56 crashed on iPhone XR (A12 + Fabric / TurboModule
//     interaction). Vision-camera 5 ships its own well-tested CodeScanner
//     pipeline that works reliably back to iOS 13 + A12-class devices.
//   - The codeScanner config is declarative and stable; we don't have to
//     hand-throttle in JS like we did with expo-camera's per-frame callback.
//
// Like expo-camera, vision-camera is a NATIVE module. Lazy-loaded via
// require() inside a try/catch so an OTA on a binary without the plugin
// shows the "Update needed" fallback instead of crashing on file load.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi, type BarcodeLookupResult } from '../src/lib/api';
import { Analytics } from '../src/lib/analytics';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { colors, spacing, radius, fontSize, fontWeight } from '../src/constants/theme';

// Lazy-load. Same import-guard pattern we used for Sentry / expo-camera
// before — a binary that predates the vision-camera plugin must NOT crash
// when the JS bundle hits this file.
type VisionModule = typeof import('react-native-vision-camera');
function loadVisionModule(): VisionModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    return require('react-native-vision-camera') as VisionModule;
  } catch {
    return null;
  }
}

// Supported barcode formats. EAN-13 / UPC-A are the common consumer-food
// formats; the rest are bonuses (some products use EAN-8 or Code-128).
const CODE_TYPES = ['ean-13', 'ean-8', 'upc-a', 'upc-e', 'code-128', 'qr'] as const;

export default function BarcodeScanScreen() {
  // Wrap in ErrorBoundary so a Camera render failure shows the friendly
  // fallback instead of taking the whole app down. The boundary's
  // componentDidCatch also forwards to PostHog for remote diagnosis.
  return (
    <ErrorBoundary
      label="barcode-scan"
      message="The barcode scanner had trouble starting on this device. Try the meal photo scan instead."
    >
      <BarcodeScanScreenInner />
    </ErrorBoundary>
  );
}

function BarcodeScanScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [vision] = useState(() => loadVisionModule());
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Single-fire guard — vision-camera's onCodeScanned fires on every frame
  // a code is locked. We only want to hit the API once per scan session.
  const firedRef = useRef(false);

  useEffect(() => {
    Analytics.barcodeScanOpened?.();
  }, []);

  async function handleScanned(code: string) {
    if (firedRef.current) return;
    if (!/^[0-9]{6,14}$/.test(code)) return; // QR / non-numeric: keep scanning
    firedRef.current = true;
    setLookingUp(true);
    setError(null);
    try {
      const product: BarcodeLookupResult = await nutritionApi.lookupBarcode(code);
      Analytics.foodBarcodeLogged?.({ code, name: product.name });
      router.replace({
        pathname: '/barcode-confirm',
        params: {
          code,
          name: product.name,
          brand: product.brand ?? '',
          calories: String(product.per100g.calories ?? 0),
          proteinG: String(product.per100g.proteinG ?? 0),
          carbsG:   String(product.per100g.carbsG ?? 0),
          fatG:     String(product.per100g.fatG ?? 0),
          servingSize: product.servingSize ?? '',
          servingQuantityG: product.servingQuantityG != null ? String(product.servingQuantityG) : '',
          imageUrl: product.imageUrl ?? '',
        },
      });
    } catch (err: any) {
      const msg = err?.message ?? '';
      const notFound = err?.status === 404 || /not in database/i.test(msg);
      Analytics.foodBarcodeLookupFailed?.({ code, reason: notFound ? 'not_found' : 'error' });
      if (notFound) {
        setError('Not in our database. Try the meal-photo scan instead.');
      } else {
        setError(msg || 'Lookup failed. Try again or enter manually.');
      }
      firedRef.current = false;
      setLookingUp(false);
    }
  }

  // Module isn't in this binary — show "Update needed."
  if (!vision) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerWrap}>
          <Ionicons name="cloud-download-outline" size={48} color={colors.mutedForeground} />
          <Text style={styles.title}>Update needed</Text>
          <Text style={styles.body}>
            The barcode scanner needs the latest version of Axiom. Install the
            newest build from TestFlight or the App Store, then try again.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <CameraView
      vision={vision}
      lookingUp={lookingUp}
      error={error}
      insets={insets}
      onScanned={handleScanned}
      onCancel={() => router.back()}
    />
  );
}

// Pulled into its own component so the camera-permission hook is called
// CONDITIONALLY on the module being loaded — calling useCameraPermission
// when vision is null would crash via hook rule.
function CameraView({
  vision,
  lookingUp,
  error,
  insets,
  onScanned,
  onCancel,
}: {
  vision: VisionModule;
  lookingUp: boolean;
  error: string | null;
  insets: { top: number; bottom: number };
  onScanned: (code: string) => void;
  onCancel: () => void;
}) {
  const Camera = vision.Camera;
  const device = vision.useCameraDevice('back');
  const { hasPermission, requestPermission } = vision.useCameraPermission();

  // Auto-prompt for permission on mount. Users who deny get a polite
  // fallback below; users who allow proceed straight to the camera view.
  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  const codeScanner = vision.useCodeScanner({
    codeTypes: CODE_TYPES as any,
    onCodeScanned: (codes) => {
      const v = codes?.[0]?.value;
      if (v) onScanned(v);
    },
  });

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerWrap}>
          <Ionicons name="camera-outline" size={48} color={colors.mutedForeground} />
          <Text style={styles.title}>Camera access needed</Text>
          <Text style={styles.body}>
            To scan a food barcode, allow camera access. If you previously
            denied, enable it in iOS Settings &rsaquo; Axiom.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => void requestPermission()}>
            <Text style={styles.primaryBtnText}>Allow camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, styles.secondaryBtn]} onPress={onCancel}>
            <Text style={[styles.primaryBtnText, { color: colors.foreground }]}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={colors.foreground} />
          <Text style={styles.body}>Starting camera…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        codeScanner={lookingUp ? undefined : codeScanner}
      />

      {/* Reticle + top bar + fallback CTA */}
      <View style={[styles.overlay, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={onCancel} hitSlop={12}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Scan a barcode</Text>
          <View style={{ width: 26 }} />
        </View>

        <View style={styles.reticleWrap}>
          <View style={styles.reticle} />
          <Text style={styles.reticleHint}>
            {lookingUp ? 'Looking it up…' : 'Align the barcode inside the box'}
          </Text>
          {lookingUp ? <ActivityIndicator color="#fff" size="large" style={{ marginTop: 16 }} /> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  cameraWrap: { flex: 1, backgroundColor: '#000' },

  centerWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: spacing.xl, gap: spacing.md,
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground, textAlign: 'center' },
  body: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },

  primaryBtn: {
    backgroundColor: colors.foreground,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.full,
    marginTop: spacing.md,
    alignItems: 'center',
    width: '100%',
  },
  primaryBtnText: { color: colors.primaryForeground, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },
  secondaryBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  topBarTitle: { color: '#fff', fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  iconBtn: { padding: 6 },

  reticleWrap: { alignItems: 'center', paddingBottom: spacing.xxl },
  reticle: {
    width: '78%',
    aspectRatio: 1.5,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'transparent',
  },
  reticleHint: {
    color: '#fff',
    fontSize: fontSize.sm,
    marginTop: spacing.md,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: fontSize.sm,
    marginTop: spacing.md,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
