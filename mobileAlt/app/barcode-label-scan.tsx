// Barcode-miss recovery: photograph the nutrition panel.
//
// OpenFoodFacts barely covers Nigerian- and Gambian-manufactured packaged
// goods, so scanning a Dangote or local pack used to dead-end at "Not in our
// database. Try the meal-photo scan instead." That is a wall, and it is the
// single most-complained-about part of logging packaged food in those markets.
//
// The only way to build coverage for products no database carries is to read
// the label ourselves. What the user contributes is cached globally against the
// barcode, so the next person to scan that product gets it instantly.
//
// Uses expo-image-picker rather than vision-camera: it is already a dependency
// and needs no native module, so this whole screen ships over-the-air to
// binaries already in users' hands.

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { nutritionApi, type BarcodeLookupResult } from '../src/lib/api';
import { Analytics } from '../src/lib/analytics';
import { colors, spacing, radius, fontSize, fontWeight } from '../src/constants/theme';

export default function BarcodeLabelScanScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const barcode = String(code ?? '').trim();

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ensurePermission(kind: 'camera' | 'library'): Promise<boolean> {
    const req = kind === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!req.granted) {
      Alert.alert(
        kind === 'camera' ? 'Camera permission needed' : 'Photo library permission needed',
        'Enable it in Settings to photograph the nutrition label.',
      );
      return false;
    }
    return true;
  }

  async function pick(kind: 'camera' | 'library') {
    if (reading) return;
    if (!await ensurePermission(kind)) return;
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      base64: true,
      // Cropping matters more here than for a meal photo: the panel is a small
      // part of the pack, and a tighter crop reads far more reliably.
      allowsEditing: true,
      quality: 0.6,
    };
    const res = kind === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;

    const asset = res.assets[0];
    setPreviewUri(asset.uri);
    await submit(asset.base64 ?? null, asset.mimeType ?? 'image/jpeg');
  }

  async function submit(base64: string | null, mimeType: string) {
    if (!base64) {
      setError('Could not read that image. Try again.');
      return;
    }
    setReading(true);
    setError(null);
    try {
      const product: BarcodeLookupResult = await nutritionApi.scanNutritionLabel(
        barcode, base64, mimeType,
      );
      Analytics.foodBarcodeLogged?.({ code: barcode, name: product.name, servingsLogged: 0 });
      // Hand off to the existing confirm screen with exactly the params it
      // already accepts — the label endpoint returns the OpenFoodFacts shape,
      // so barcode-confirm needs no changes at all.
      router.replace({
        pathname: '/barcode-confirm',
        params: {
          code: barcode,
          name: product.name,
          brand: product.brand ?? '',
          calories: String(product.per100g.calories ?? 0),
          proteinG: String(product.per100g.proteinG ?? 0),
          carbsG:   String(product.per100g.carbsG ?? 0),
          fatG:     String(product.per100g.fatG ?? 0),
          nutrients: JSON.stringify(product.per100g),
          servingSize: product.servingSize ?? '',
          servingQuantityG: product.servingQuantityG != null ? String(product.servingQuantityG) : '',
          imageUrl: '',
        },
      });
    } catch (err: any) {
      setError(err?.message || 'Could not read that label. Try a straighter, closer photo.');
      setReading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="close" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan the label</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.body}>
        {previewUri ? (
          <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
        ) : (
          <View style={styles.illustration}>
            <Ionicons name="document-text-outline" size={54} color={colors.mutedForeground} />
          </View>
        )}

        <Text style={styles.title}>We don't have this product yet</Text>
        <Text style={styles.body_}>
          Take a photo of the <Text style={styles.bold}>Nutrition Information</Text> panel on the
          pack and we'll read it. Fill the frame with just the table, and keep it straight on.
        </Text>
        <Text style={styles.contribNote}>
          Your scan is saved for everyone — the next person to scan this product gets it instantly.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {reading ? (
          <View style={styles.readingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.readingText}>Reading the label…</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => pick('camera')}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Ionicons name="camera" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>
                {previewUri ? 'Retake photo' : 'Take a photo'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={() => pick('library')} activeOpacity={0.85}>
              <Text style={styles.secondaryBtnText}>Choose from library</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={styles.skipBtnText}>Enter it manually instead</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: { padding: 4 },
  headerTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, alignItems: 'center' },
  illustration: {
    width: 120, height: 120, borderRadius: radius.lg, backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  preview: {
    width: '100%', height: 200, borderRadius: radius.md,
    backgroundColor: colors.muted, marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground,
    textAlign: 'center', marginBottom: spacing.sm,
  },
  body_: {
    fontSize: fontSize.sm, color: colors.mutedForeground,
    textAlign: 'center', lineHeight: 20, marginBottom: spacing.sm,
  },
  bold: { fontWeight: fontWeight.semibold, color: colors.foreground },
  contribNote: {
    fontSize: fontSize.xs, color: colors.mutedForeground,
    textAlign: 'center', fontStyle: 'italic', marginBottom: spacing.lg,
  },
  error: {
    fontSize: fontSize.sm, color: colors.destructive,
    textAlign: 'center', marginBottom: spacing.md,
  },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  readingText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 14, paddingHorizontal: spacing.lg, width: '100%',
  },
  primaryBtnText: { color: '#fff', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  secondaryBtn: { paddingVertical: 12, marginTop: spacing.sm },
  secondaryBtnText: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  skipBtn: { paddingVertical: 8, marginTop: spacing.xs },
  skipBtnText: { color: colors.mutedForeground, fontSize: fontSize.sm },
});
