// Order scan & item-level confirm — handoff §7.5. Upload screenshot/receipt
// → scanning (real async, min-duration so the animation reads) → per-item
// checkboxes + portion control → enriched log card (macros + focus-nutrient
// contributions + gut-pillar wins). Privacy copy at capture is REQUIRED.
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, ActivityIndicator, Animated, StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../../../../constants/theme';
import { nutritionApi } from '../../../../lib/api';
import { Eyebrow, SegmentedControl, EST_NOTE } from './GutPrimitives';

type Portion = 'all' | 'half' | 'bite';
const PORTION_FACTOR: Record<Portion, number> = { all: 1, half: 0.5, bite: 0.15 };

interface ScanItem {
  name: string; quantity: number; modifiers: string[];
  calories: number; proteinG: number; carbsG: number; fatG: number;
  mealType: string;
  ingredients: string[]; tags: string[];
  plants: string[]; fermentedFoods: string[]; ultraProcessed: boolean;
  nutrients: Record<string, number>;
}

type Stage = 'capture' | 'scanning' | 'confirm' | 'logged' | 'error';

export function OrderScanFlow({
  visible, onClose, onLogged,
}: {
  visible: boolean;
  onClose: () => void;
  onLogged: () => void; // parent refreshes the day
}) {
  const [stage, setStage] = useState<Stage>('capture');
  const [vendor, setVendor] = useState<string | null>(null);
  const [items, setItems] = useState<ScanItem[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [portions, setPortions] = useState<Portion[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [gutWins, setGutWins] = useState<{ plants: string[]; fermented: boolean } | null>(null);
  const [loggedCount, setLoggedCount] = useState(0);
  const scanLine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setStage('capture'); setVendor(null); setItems([]); setSelected([]);
      setPortions([]); setErrorMsg(''); setGutWins(null);
    }
  }, [visible]);

  useEffect(() => {
    if (stage !== 'scanning') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [stage, scanLine]);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.8,
    });
    const asset = result.assets?.[0];
    if (!asset?.base64) return;
    setStage('scanning');
    const started = Date.now();
    try {
      const mime = asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const scan = await nutritionApi.scanOrder(asset.base64, mime);
      const minWait = Math.max(0, 1900 - (Date.now() - started));
      await new Promise((r) => setTimeout(r, minWait));
      if (scan.kind === 'food_photo') {
        setErrorMsg('That looks like a photo of food, not an order — use Photo logging for plated meals.');
        setStage('error');
        return;
      }
      setVendor(scan.vendor ?? null);
      setItems(scan.items);
      setSelected(scan.items.map(() => true));
      setPortions(scan.items.map(() => 'all'));
      setStage('confirm');
    } catch (e: any) {
      setErrorMsg(e?.message?.includes('clearer')
        ? e.message
        : 'Couldn’t read that order — try a clearer screenshot, or log by text.');
      setStage('error');
    }
  };

  const logSelected = async () => {
    const chosen = items
      .map((item, i) => ({ item, i }))
      .filter(({ i }) => selected[i]);
    if (chosen.length === 0) return;
    try {
      const res = await nutritionApi.logOrder({
        vendor,
        mealType: chosen[0].item.mealType || 'meal',
        items: chosen.map(({ item, i }) => ({
          name: item.name,
          portionFactor: PORTION_FACTOR[portions[i]],
          quantity: item.quantity,
          calories: item.calories, proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG,
          ingredients: item.ingredients, tags: item.tags,
          plants: item.plants, fermentedFoods: item.fermentedFoods,
          ultraProcessed: item.ultraProcessed, nutrients: item.nutrients,
        })),
      });
      setGutWins(res.gutWins ?? null);
      setLoggedCount(chosen.length);
      setStage('logged');
      onLogged();
    } catch {
      setErrorMsg('Logging failed — your items are still here, try again.');
      setStage('error');
    }
  };

  if (!visible) return null;
  const selectedCount = selected.filter(Boolean).length;
  const chosenItems = items.filter((_, i) => selected[i]);
  const totals = chosenItems.reduce(
    (acc, item, idx) => {
      const i = items.indexOf(item);
      const f = PORTION_FACTOR[portions[i] ?? 'all'] * (item.quantity || 1);
      return {
        kcal: acc.kcal + item.calories * f,
        p: acc.p + item.proteinG * f,
        c: acc.c + item.carbsG * f,
        fat: acc.fat + item.fatG * f,
      };
    },
    { kcal: 0, p: 0, c: 0, fat: 0 },
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {stage === 'capture' && (
          <View style={{ flex: 1, padding: 20, paddingTop: 64, gap: 20 }}>
            <View style={{ gap: 8 }}>
              <Eyebrow>Log an order</Eyebrow>
              <Text style={styles.title}>Screenshot your order, we’ll do the rest</Text>
              <Text style={styles.sub}>
                UberEats, DoorDash, a paper receipt — upload it and every item comes back with
                macros and micronutrients, ready to confirm.
              </Text>
            </View>
            <Pressable onPress={pick} style={styles.uploadZone}>
              <Text style={{ fontSize: 28 }}>⤴</Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>
                Upload screenshot or receipt
              </Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>JPG · PNG · screenshots work best</Text>
              <View style={styles.chooseBtn}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.foreground }}>Choose file</Text>
              </View>
            </Pressable>
            <View style={styles.privacyCallout}>
              <Text style={{ fontSize: 12, lineHeight: 18, color: colors.mutedForeground }}>
                <Text style={{ fontWeight: '700', color: colors.foreground }}>Private by design.</Text> We
                extract the food items and discard the image. Names, addresses, and prices are never read
                into your account or stored.
              </Text>
            </View>
            <Pressable onPress={onClose} style={{ alignItems: 'center', padding: 8 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {stage === 'scanning' && (
          <View style={{ flex: 1, padding: 20, paddingTop: 96, alignItems: 'center', gap: 24 }}>
            <View style={styles.receiptGhost}>
              {[0.9, 0.7, 0.8, 0.5, 0.75, 0.6].map((w, i) => (
                <View key={i} style={[styles.ghostLine, { width: `${w * 100}%` }]} />
              ))}
              <Animated.View
                style={[styles.scanLine, {
                  transform: [{
                    translateY: scanLine.interpolate({ inputRange: [0, 1], outputRange: [0, 148] }),
                  }],
                }]}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={colors.foreground} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                Reading your order · extracting items
              </Text>
            </View>
          </View>
        )}

        {stage === 'confirm' && (
          <>
            <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 64, paddingBottom: 140, gap: 12 }}>
              <View style={{ gap: 6 }}>
                <Eyebrow>{vendor ?? 'Your order'}</Eyebrow>
                <Text style={styles.title}>Which of these were yours?</Text>
                <Text style={styles.sub}>Untick what you didn’t eat. Portions adjust each item.</Text>
              </View>
              {items.map((item, i) => {
                const on = selected[i];
                return (
                  <View key={i} style={[styles.itemCard, !on && { opacity: 0.45 }]}>
                    <Pressable
                      onPress={() => setSelected((s) => s.map((v, j) => (j === i ? !v : v)))}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                    >
                      <View style={[styles.checkbox, on && styles.checkboxOn]}>
                        {on && <Text style={{ color: colors.primaryForeground, fontSize: 12, fontWeight: '700' }}>✓</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>
                          {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}
                        </Text>
                        {item.modifiers.length > 0 && (
                          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{item.modifiers.join(' · ')}</Text>
                        )}
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.foreground, fontVariant: ['tabular-nums'] }}>
                        {Math.round(item.calories)} kcal
                      </Text>
                    </Pressable>
                    {on && (
                      <View style={{ marginTop: 10 }}>
                        <SegmentedControl<Portion>
                          options={[
                            { key: 'all', label: 'All of it' },
                            { key: 'half', label: 'Ate half' },
                            { key: 'bite', label: 'A bite' },
                          ]}
                          value={portions[i]}
                          onChange={(v) => setPortions((p) => p.map((x, j) => (j === i ? v : x)))}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.footer}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.foreground, fontVariant: ['tabular-nums'] }}>
                  {Math.round(totals.kcal)} kcal
                </Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{EST_NOTE}</Text>
              </View>
              <Pressable
                onPress={logSelected}
                disabled={selectedCount === 0}
                style={[styles.primaryButton, { flex: 1.4, opacity: selectedCount === 0 ? 0.4 : 1 }]}
              >
                <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 15 }}>
                  Log {selectedCount} {selectedCount === 1 ? 'item' : 'items'}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {stage === 'logged' && (
          <View style={{ flex: 1, padding: 20, paddingTop: 96, gap: 20 }}>
            <View style={{ gap: 8, alignItems: 'flex-start' }}>
              <View style={styles.successBadge}>
                <Text style={{ color: colors.successInk, fontSize: 16, fontWeight: '700' }}>✓</Text>
              </View>
              <Text style={styles.title}>Logged {loggedCount} {loggedCount === 1 ? 'item' : 'items'}</Text>
              {vendor && <Text style={styles.sub}>{vendor}</Text>}
            </View>
            <View style={styles.itemCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {[
                  { label: 'kcal', value: Math.round(totals.kcal), color: colors.foreground },
                  { label: 'protein', value: `${Math.round(totals.p)}g`, color: colors.gutMacro.protein },
                  { label: 'carbs', value: `${Math.round(totals.c)}g`, color: colors.gutMacro.carbs },
                  { label: 'fat', value: `${Math.round(totals.fat)}g`, color: colors.gutMacro.fat },
                ].map((m) => (
                  <View key={m.label} style={{ alignItems: 'center', gap: 2 }}>
                    <Text style={{ fontSize: 17, fontWeight: '700', color: m.color, fontVariant: ['tabular-nums'] }}>
                      {m.value}
                    </Text>
                    <Text style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#a1a1aa', fontWeight: '700' }}>
                      {m.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            {gutWins && (gutWins.plants.length > 0 || gutWins.fermented) && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {gutWins.plants.length > 0 && (
                  <View style={styles.winChip}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: colors.successInk }}>
                      +{gutWins.plants.length} plants this week
                    </Text>
                  </View>
                )}
                {gutWins.fermented && (
                  <View style={styles.winChip}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: colors.successInk }}>fermented ✓</Text>
                  </View>
                )}
              </View>
            )}
            <Pressable onPress={onClose} style={styles.primaryButton}>
              <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 15 }}>Done</Text>
            </Pressable>
          </View>
        )}

        {stage === 'error' && (
          <View style={{ flex: 1, padding: 20, paddingTop: 96, gap: 16 }}>
            <Text style={styles.title}>Hm, that didn’t work</Text>
            <Text style={styles.sub}>{errorMsg}</Text>
            <Pressable onPress={() => setStage(items.length > 0 ? 'confirm' : 'capture')} style={styles.primaryButton}>
              <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 15 }}>
                {items.length > 0 ? 'Back to my items' : 'Try another image'}
              </Text>
            </Pressable>
            <Pressable onPress={onClose} style={{ alignItems: 'center', padding: 8 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Log by text instead</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.6, color: colors.foreground },
  sub: { fontSize: 13, lineHeight: 19, color: colors.mutedForeground },
  uploadZone: {
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: 16,
    padding: 28, alignItems: 'center', gap: 6,
  },
  chooseBtn: {
    marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  privacyCallout: {
    backgroundColor: colors.muted, borderRadius: 12, padding: 14,
  },
  receiptGhost: {
    width: 200, height: 180, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    padding: 16, gap: 12, overflow: 'hidden', backgroundColor: colors.card,
  },
  ghostLine: { height: 8, borderRadius: 4, backgroundColor: colors.muted },
  scanLine: {
    position: 'absolute', left: 8, right: 8, top: 12, height: 2,
    backgroundColor: colors.foreground, opacity: 0.5, borderRadius: 1,
  },
  itemCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, padding: 14,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingBottom: 32,
    backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border,
  },
  primaryButton: {
    backgroundColor: '#09090b', borderRadius: 12, paddingVertical: 13, alignItems: 'center',
  },
  successBadge: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.successSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  winChip: {
    backgroundColor: colors.successSoft, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11,
  },
});
