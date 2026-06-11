// Barcode-scan flow. Opens the camera with a guide reticle, fires once on
// the first valid product barcode (EAN-13/UPC-A/EAN-8/UPC-E etc.), looks
// the code up in OpenFoodFacts via the backend, and routes the result
// into ManualEntrySheet (pre-filled) so the user can adjust portion size
// before logging. 404 → manual entry empty, user can still type the meal.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi, type BarcodeLookupResult } from '../src/lib/api';
import { Analytics } from '../src/lib/analytics';
import { colors, spacing, radius, fontSize, fontWeight } from '../src/constants/theme';

const SCAN_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'qr'] as const;

export default function BarcodeScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Single-fire guard — the camera fires onBarcodeScanned multiple times per
  // second once a code is locked. We only want to hit the API once.
  const firedRef = useRef(false);

  useEffect(() => {
    Analytics.barcodeScanOpened?.();
  }, []);

  // Auto-request permission on first mount. Some users will deny — we show
  // a fallback CTA in that branch.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  async function handleScanned(result: BarcodeScanningResult) {
    if (firedRef.current) return;
    firedRef.current = true;
    const code = result.data?.trim() ?? '';
    if (!/^[0-9]{6,14}$/.test(code)) {
      // Probably a QR code or unsupported format — let the user keep scanning.
      firedRef.current = false;
      return;
    }
    setLookingUp(true);
    setError(null);
    try {
      const product: BarcodeLookupResult = await nutritionApi.lookupBarcode(code);
      Analytics.foodBarcodeLogged?.({ code, name: product.name });
      // Hand the result off to ManualEntrySheet via query params so the user
      // can confirm portion size + log. Backend persists from the sheet's
      // existing save handler — no new write path needed.
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
        // Not in OpenFoodFacts' DB — offer the meal-photo path as the
        // graceful fallback instead of forcing manual entry.
        setError('Not in our database. Try the meal-photo scan instead?');
        firedRef.current = false;
        setLookingUp(false);
      } else {
        setError(msg || 'Lookup failed. Try again or enter manually.');
        firedRef.current = false;
        setLookingUp(false);
      }
    }
  }

  // Permission denied — give the user a way out.
  if (permission && !permission.granted && !permission.canAskAgain) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerWrap}>
          <Ionicons name="camera-outline" size={48} color={colors.mutedForeground} />
          <Text style={styles.title}>Camera access needed</Text>
          <Text style={styles.body}>
            To scan a food barcode, allow camera access in iOS Settings &rsaquo; Axiom.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Permission not yet resolved — quick spinner.
  if (!permission) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={colors.foreground} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...SCAN_TYPES] }}
        onBarcodeScanned={lookingUp ? undefined : handleScanned}
      />

      {/* Dimmed overlay with cutout — pure visual; the scanner doesn't actually
          require alignment, but the reticle tells users where to aim. */}
      <View style={[styles.overlay, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.back()}
            hitSlop={12}
          >
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

        <TouchableOpacity
          style={[styles.fallbackBtn, { marginBottom: insets.bottom + 16 }]}
          onPress={() => router.replace({ pathname: '/meal-scan', params: { source: 'manual' } })}
        >
          <Text style={styles.fallbackBtnText}>Enter manually instead</Text>
        </TouchableOpacity>
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
  },
  primaryBtnText: { color: colors.primaryForeground, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },

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

  reticleWrap: { alignItems: 'center' },
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

  fallbackBtn: {
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  fallbackBtnText: { color: '#fff', fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
