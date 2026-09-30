// Food capture — the only dark screen in the app.
//
// Photo · Barcode · Describe are one surface, switched by tapping the mode
// labels (no swiping). A 72pt shutter. Photo → the agent identifies items,
// shown as receipts and item rows with grams (tap to fix), totals, one line
// on the gap it fills, `Log it →`. Barcode → a crimson scan line; on
// detection a bottom sheet (28 top radius) with the product, servings and
// `Log it →`. Built on react-native-vision-camera, which the binary already
// links. Every module access is guarded: on a binary without the camera the
// screen explains instead of crashing.

import { captureBus } from '../../src/v2/chat/captureBus';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Image, ScrollView, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, FadeIn } from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { v2, T } from '../../src/v2/theme';
import { TextAction } from '../../src/v2/primitives/TextAction';
import { Row } from '../../src/v2/primitives/Row';
import { ReceiptList } from '../../src/v2/primitives/Receipt';
import { Enter } from '../../src/v2/primitives/Enter';
import { nutritionApi } from '../../src/lib/api';
import { useInvalidate } from '../../src/v2/data';
import { haptics } from '../../src/v2/haptics';
import type { ReceiptVerb } from '@axiom/agent-ui-core';

let vision: any = null;
try { vision = require('react-native-vision-camera'); } catch { vision = null; }

type Mode = 'photo' | 'barcode' | 'describe';
type Item = { name: string; grams: number | null; calories: number; proteinG: number; carbsG: number; fatG: number };

export default function CaptureScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // cardId: opened from a chat capture card; the logged meal answers that card.
  const params = useLocalSearchParams<{ mode?: string; cardId?: string }>();
  const [mode, setMode] = useState<Mode>((params.mode as Mode) || 'photo');
  const invalidate = useInvalidate();
  const camRef = useRef<any>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [log, setLog] = useState<{ verb: ReceiptVerb; text: string }[]>([]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [gap, setGap] = useState<string | null>(null);
  const [product, setProduct] = useState<any>(null);
  const [servings, setServings] = useState(1);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const scanned = useRef(false);
  const hasCam = !!vision?.Camera;
  const device = hasCam ? vision.useCameraDevice('back') : null;
  const perm = hasCam ? vision.useCameraPermission() : { hasPermission: false, requestPermission: async () => false };
  useEffect(() => { if (hasCam && !perm.hasPermission) void perm.requestPermission(); }, [hasCam]); // eslint-disable-line react-hooks/exhaustive-deps

  const codeScanner = hasCam && mode === 'barcode' ? vision.useCodeScanner({
    codeTypes: ['ean-13', 'ean-8', 'upc-a', 'upc-e', 'code-128'],
    onCodeScanned: (codes: any[]) => {
      if (scanned.current || busy) return;
      const c = codes?.[0]?.value; if (!c) return;
      scanned.current = true;
      void lookup(String(c));
    },
  }) : undefined;

  const lookup = async (code: string) => {
    setBusy(true); setLog([{ verb: 'Read', text: `Barcode ${code}` }]);
    try {
      const r: any = await nutritionApi.lookupBarcode(code);
      const p = r?.product ?? r;
      if (!p || (!p.name && !p.per100g && !p.calories)) throw new Error('Not found');
      // Normalise to per-serving macros: the lookup returns per100g plus an
      // optional serving size in grams.
      const grams = Number(p.servingSizeG ?? p.servingGrams ?? p.serving?.grams) || 100;
      const f = grams / 100;
      const base = p.per100g ?? p;
      setProduct({
        name: p.name, brand: p.brand ?? null, source: p.source ?? 'Open Food Facts', code,
        servingSize: p.servingSize ?? `${grams} g`,
        calories: Math.round((base.calories ?? 0) * f), proteinG: Math.round((base.proteinG ?? 0) * f), carbsG: Math.round((base.carbsG ?? 0) * f), fatG: Math.round((base.fatG ?? 0) * f),
      });
      setLog((l) => [...l, { verb: 'Pulled', text: `${p.source ?? 'Open Food Facts'} — ${p.name ?? code}` }]);
      haptics.success();
    } catch (e: any) {
      setLog((l) => [...l, { verb: 'Noted', text: 'No match for that barcode. Try the label, or describe it.' }]);
      setTimeout(() => { scanned.current = false; setLog([]); }, 1800);
    }
    setBusy(false);
  };

  const snap = async () => {
    if (!camRef.current || busy) return;
    setBusy(true); haptics.light();
    try {
      const photo = await camRef.current.takePhoto({ flash: 'off', enableShutterSound: false });
      const uri = photo?.path?.startsWith('file://') ? photo.path : `file://${photo.path}`;
      const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1024 } }], { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      setPhotoUri(small.uri);
      setLog([{ verb: 'Read', text: 'Photo' }]);
      const b64 = small.base64 ?? (await FileSystem.readAsStringAsync(small.uri, { encoding: 'base64' as any }));
      const r: any = await nutritionApi.analyzePhoto(b64, 'image/jpeg');
      const list: any[] = r?.items ?? r?.foods ?? (r?.name ? [r] : []);
      const its: Item[] = list.map((x) => ({ name: x.name ?? 'Item', grams: x.grams ?? x.portionG ?? null, calories: Math.round(x.calories ?? 0), proteinG: Math.round(x.proteinG ?? 0), carbsG: Math.round(x.carbsG ?? 0), fatG: Math.round(x.fatG ?? 0) }));
      setLog((l) => [...l, { verb: 'Read', text: `Photo — ${its.length} item${its.length === 1 ? '' : 's'}` }, { verb: 'Searched', text: `${its.map((i) => i.name).slice(0, 3).join(', ')}${its.length > 3 ? '…' : ''}` }, { verb: 'Checked', text: `Portions from plate size — ${its.reduce((s, i) => s + i.calories, 0)} kcal` }]);
      setItems(its);
      setGap(r?.gap ?? r?.note ?? null);
      haptics.success();
    } catch (e: any) {
      Alert.alert('Couldn\'t read the plate', e?.message ?? 'Try again with the whole plate in frame.');
      setPhotoUri(null); setLog([]);
    }
    setBusy(false);
  };

  const logPhoto = async () => {
    if (!items?.length || busy) return;
    setBusy(true);
    const tot = items.reduce((a, i) => ({ calories: a.calories + i.calories, proteinG: a.proteinG + i.proteinG, carbsG: a.carbsG + i.carbsG, fatG: a.fatG + i.fatG }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    try {
      const m: any = await nutritionApi.logMeal({ name: items.map((i) => i.name).join(', '), mealType: mealType(), ...tot, source: 'photo', items } as any);
      await invalidate.afterMeal(); haptics.success(); captureBus.done(params.cardId, m?.id ? [m.id] : []); router.back();
    } catch (e: any) { Alert.alert('Couldn\'t log', e?.message ?? ''); }
    setBusy(false);
  };
  const logProduct = async () => {
    if (!product || busy) return;
    setBusy(true);
    const k = (v: any) => Math.round((Number(v) || 0) * servings);
    try {
      const m: any = await nutritionApi.logMeal({ name: `${product.name}${product.brand ? ` · ${product.brand}` : ''}`, mealType: mealType(), calories: k(product.calories), proteinG: k(product.proteinG), carbsG: k(product.carbsG), fatG: k(product.fatG), source: 'barcode', barcode: product.code } as any);
      await invalidate.afterMeal(); haptics.success(); captureBus.done(params.cardId, m?.id ? [m.id] : []); router.back();
    } catch (e: any) { Alert.alert('Couldn\'t log', e?.message ?? ''); }
    setBusy(false);
  };
  const describe = async () => {
    const t = text.trim(); if (!t || busy) return;
    setBusy(true); setLog([{ verb: 'Read', text: `“${t}”` }]);
    try {
      const parsed: any = await nutritionApi.parseMeal(t);
      const item = parsed?.meal ?? parsed?.items?.[0] ?? parsed;
      const its: Item[] = (parsed?.items ?? [item]).map((x: any) => ({ name: x?.name ?? t, grams: x?.grams ?? null, calories: Math.round(x?.calories ?? 0), proteinG: Math.round(x?.proteinG ?? 0), carbsG: Math.round(x?.carbsG ?? 0), fatG: Math.round(x?.fatG ?? 0) }));
      setItems(its); setLog((l) => [...l, { verb: 'Searched', text: `${its.map((i) => i.name).join(', ')} — matched` }]);
    } catch (e: any) { Alert.alert('Couldn\'t parse that', e?.message ?? ''); setLog([]); }
    setBusy(false);
  };
  const fixItem = (i: number) => {
    const it = items![i];
    Alert.prompt?.(`Fix ${it.name}`, 'Grams', (val) => { const g = Number(val); if (!Number.isFinite(g) || !it.grams) return; const f = g / it.grams; setItems((arr) => arr!.map((x, k) => (k === i ? { ...x, grams: g, calories: Math.round(x.calories * f), proteinG: Math.round(x.proteinG * f), carbsG: Math.round(x.carbsG * f), fatG: Math.round(x.fatG * f) } : x))); }, 'plain-text', String(it.grams ?? ''), 'numeric');
  };

  const scanLine = useSharedValue(0);
  useEffect(() => { scanLine.value = withRepeat(withTiming(1, { duration: 1400 }), -1, true); }, [scanLine]);
  const lineStyle = useAnimatedStyle(() => ({ top: `${12 + scanLine.value * 76}%` }));
  const tot = useMemo(() => (items ?? []).reduce((a, i) => ({ calories: a.calories + i.calories, proteinG: a.proteinG + i.proteinG, carbsG: a.carbsG + i.carbsG, fatG: a.fatG + i.fatG }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }), [items]);
  const time = new Date();
  const header = `${mealType().charAt(0).toUpperCase()}${mealType().slice(1)} · ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;

  // ── Result: photo / describe identified ────────────────────────────────
  if (items) {
    return (
      <View style={[styles.light, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
        <StatusBar style="dark" />
        <View style={styles.top}>
          <Pressable onPress={() => { setItems(null); setPhotoUri(null); setLog([]); }} hitSlop={10}><Text style={[T.body, { color: v2.color.muted }]}>← Retake</Text></Pressable>
          <Text style={T.caption}>{header}</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingTop: 20 }} showsVerticalScrollIndicator={false}>
          {photoUri ? <Image source={{ uri: photoUri }} style={styles.thumb} /> : null}
          <View style={{ marginTop: 18 }}><ReceiptList items={log} animate={false} /></View>
          <View style={{ marginTop: 22 }}>
            {items.map((it, i) => <Row key={i} name={it.name} sub={it.grams ? `${it.grams} g · tap to fix` : 'tap to fix'} value={`${it.calories}`} last={i === items.length - 1} onPress={() => fixItem(i)} />)}
          </View>
          <View style={styles.totals}>
            {[[tot.calories, 'kcal', v2.color.ink], [tot.proteinG, 'protein', v2.color.macro.protein], [tot.carbsG, 'carbs', v2.color.macro.carbs], [tot.fatG, 'fat', v2.color.macro.fat]].map(([n, l, c]) => (
              <View key={String(l)}><Text style={[T.hero, { fontSize: 28, lineHeight: 32, letterSpacing: -0.8, color: String(c) }]}>{String(n)}</Text><Text style={T.caption}>{String(l)}</Text></View>
            ))}
          </View>
          {gap ? <Text style={[T.bodyMuted, { marginTop: 14 }]}>{gap}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 28 }}>
            <TextAction primary onPress={() => void logPhoto()} loading={busy}>Log it</TextAction>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  return (
    <View style={[styles.dark, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Text style={[T.body, { color: v2.color.darkMuted }]}>Close</Text></Pressable>
        <Text style={[T.caption, { color: v2.color.darkMuted }]}>{mode === 'barcode' ? 'Barcode' : header}</Text>
      </View>
      <View style={styles.frame}>
        {hasCam && device && perm.hasPermission && mode !== 'describe' ? (
          <vision.Camera ref={camRef} style={StyleSheet.absoluteFill} device={device} isActive photo={mode === 'photo'} codeScanner={codeScanner} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
            {mode === 'describe' ? null : <Text style={[T.body, { color: v2.color.darkMuted, textAlign: 'center' }]}>{hasCam ? 'Camera permission is off. Allow it in Settings, or describe the meal.' : 'This build has no camera module. Describe the meal instead.'}</Text>}
          </View>
        )}
        {mode !== 'describe' ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {[['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']].map(([y, x]) => (
              <View key={y + x} style={[styles.corner, { [y]: 18, [x]: 18, [`border${y[0].toUpperCase() + y.slice(1)}Width`]: 1.5, [`border${x[0].toUpperCase() + x.slice(1)}Width`]: 1.5 } as any]} />
            ))}
            {mode === 'barcode' ? <Animated.View style={[styles.scanLine, lineStyle]} /> : null}
          </View>
        ) : null}
        {mode === 'describe' ? (
          <View style={{ padding: 24, paddingTop: 40 }}>
            <Text style={[T.headlineSm, { color: v2.color.darkInk }]}>What did you eat?</Text>
            <TextInput value={text} onChangeText={setText} placeholder="turkey sandwich and an apple" placeholderTextColor={v2.color.darkMuted} style={[styles.describeInput]} autoFocus multiline cursorColor={v2.color.crimson} onSubmitEditing={() => void describe()} blurOnSubmit returnKeyType="send" />
            <TextAction primary onPress={() => void describe()} loading={busy} style={{ marginTop: 20 }}>Find it</TextAction>
          </View>
        ) : null}
      </View>
      {log.length && !product ? <View style={{ marginTop: 14 }}><ReceiptList items={log} tone="dark" liveIndex={busy ? log.length - 1 : -1} /></View> : null}
      <Text style={[T.caption, { color: v2.color.darkMuted, textAlign: 'center', marginTop: 14 }]}>{mode === 'photo' ? 'Fit the whole plate. I\'ll find what\'s on it.' : mode === 'barcode' ? 'Line the barcode up inside the frame.' : 'A sentence is enough.'}</Text>
      <View style={styles.modes}>
        {(['photo', 'barcode', 'describe'] as Mode[]).map((m) => (
          <Pressable key={m} onPress={() => { setMode(m); scanned.current = false; setLog([]); }} hitSlop={8}>
            <Text style={[T.captionStrong, { color: mode === m ? v2.color.darkInk : v2.color.darkMuted, textTransform: 'capitalize' }]}>{m}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'photo' ? (
        <View style={{ alignItems: 'center', marginTop: 18 }}>
          <Pressable onPress={() => void snap()} disabled={busy || !hasCam} style={[styles.shutter, { opacity: busy || !hasCam ? 0.4 : 1 }]} accessibilityLabel="Take photo"><View style={styles.shutterInner} /></Pressable>
        </View>
      ) : <View style={{ height: 90 }} />}

      {product ? (
        <Animated.View entering={FadeIn.duration(300)} style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.grabber} />
          <ReceiptList items={[{ verb: 'Pulled', text: `${product.source ?? 'Open Food Facts'} — ${product.code}` }]} animate={false} />
          <Text style={[T.headlineSm, { marginTop: 14 }]}>{product.name ?? 'Product'}</Text>
          {product.brand || product.servingSize ? <Text style={[T.caption, { marginTop: 4 }]}>{[product.brand, product.servingSize].filter(Boolean).join(' · ')}</Text> : null}
          <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: v2.color.hairline }}>
            <Text style={T.row}>Servings</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
              <Pressable onPress={() => setServings((s) => Math.max(0.5, s - 0.5))} hitSlop={8}><Text style={T.rowStrong}>−</Text></Pressable>
              <Text style={[T.rowStrong, T.num]}>{servings}</Text>
              <Pressable onPress={() => setServings((s) => s + 0.5)} hitSlop={8}><Text style={T.rowStrong}>+</Text></Pressable>
            </View>
          </View>
          <View style={styles.totals}>
            {[[product.calories, 'kcal', v2.color.ink], [product.proteinG, 'protein', v2.color.macro.protein], [product.carbsG, 'carbs', v2.color.macro.carbs], [product.fatG, 'fat', v2.color.macro.fat]].map(([n, l, c]) => (
              <View key={String(l)}><Text style={[T.hero, { fontSize: 28, lineHeight: 32, letterSpacing: -0.8, color: String(c) }]}>{Math.round((Number(n) || 0) * servings)}</Text><Text style={T.caption}>{String(l)}</Text></View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 28, alignItems: 'center', marginTop: 22 }}>
            <TextAction primary onPress={() => void logProduct()} loading={busy}>Log it</TextAction>
            <TextAction muted arrow={false} onPress={() => { setProduct(null); scanned.current = false; setLog([]); }}>Rescan</TextAction>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function mealType(): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = new Date().getHours();
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: v2.color.cameraGround, paddingHorizontal: v2.space.gutter },
  light: { flex: 1, backgroundColor: v2.color.white, paddingHorizontal: v2.space.gutter },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  frame: { flex: 1, marginTop: 18, borderRadius: 20, overflow: 'hidden', backgroundColor: '#161618' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: 'rgba(255,255,255,.9)' },
  scanLine: { position: 'absolute', left: 30, right: 30, height: 2, backgroundColor: v2.color.crimson, opacity: 0.9 },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 32, marginTop: 16 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: 'rgba(255,255,255,.9)', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  thumb: { width: '100%', height: 180, borderRadius: v2.radius.thumb, backgroundColor: v2.color.surface },
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
  describeInput: { ...T.body, color: v2.color.darkInk, fontSize: 18, marginTop: 16, minHeight: 60, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.2)', paddingBottom: 8 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: v2.color.white, borderTopLeftRadius: v2.radius.sheet, borderTopRightRadius: v2.radius.sheet, paddingHorizontal: v2.space.gutter, paddingTop: 12 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: v2.color.hairline, marginBottom: 16 },
});
