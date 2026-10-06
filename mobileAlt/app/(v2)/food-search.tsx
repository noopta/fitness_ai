// Food search — the default way in to logging (bug fixes 5 Oct 2026, 4a):
// from Search on Fuel's dock, or "Log food" in chat.
//
// A light pushed page. The search input is the header (22/600, ink
// underline) and the keyboard opens on mount. Scopes: All · Mine · Recipes.
// Rows are 62 pt — name 15/600, source caption 12, kcal on the right — yours
// and your recipes first. Before typing: your recent foods and recipes. No
// horizontal chips. Footer: Scan instead · Describe it · Enter macros
// manually (and Voice · Order or receipt, which used to sit under Fuel's
// More). A row opens the review sheet; the manual sheet is the fallback.
//
// The footer rides 12 pt above the keyboard; the list scrolls in what's left.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { v2, T } from '../../src/v2/theme';
import { haptics } from '../../src/v2/haptics';
import { v2Api, type FoodResult } from '../../src/v2/api';
import { useInvalidate } from '../../src/v2/data';
import { SearchHeader, LinkTabs } from '../../src/v2/pages/feed/common';
import { ReviewSheet } from '../../src/v2/food/ReviewSheet';
import { ManualSheet } from '../../src/v2/food/ManualSheet';
import { threadBus } from '../../src/v2/chat/captureBus';
import { VoiceSheet } from '../../src/components/coach/nutrition/sheets/VoiceSheet';
import { OrderScanFlow } from '../../src/components/coach/nutrition/gut/OrderScanFlow';
import { trackScreen } from '../../src/lib/analytics';
import { useProScreen } from '../../src/v2/shell/proGate';

const C = v2.color;
type Scope = 'all' | 'mine' | 'recipes';
type Classic = null | 'voice' | 'order';

function FoodSearchScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const invalidate = useInvalidate();
  const params = useLocalSearchParams<{ from?: string }>();
  const fromChat = params.from === 'chat';
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [picked, setPicked] = useState<FoodResult | null>(null);
  const [manual, setManual] = useState(false);
  const [classic, setClassic] = useState<Classic>(null);
  useEffect(() => { trackScreen('v2.food_search'); }, []);

  const q = useQuery({
    queryKey: ['v2', 'food-search', scope, query],
    queryFn: () => v2Api.foodSearch(query, scope),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const results = q.data?.results ?? [];

  // After a log: back to Fuel (the new row animates into Today), or to chat with a Logged card.
  const done = useRef(false);
  const logged = async (mealId: string | null) => {
    if (done.current) return;
    done.current = true;
    setPicked(null); setManual(false); setClassic(null);
    await invalidate.afterMeal();
    if (fromChat && mealId) {
      try { await v2Api.loggedCard([mealId]); threadBus.rehydrate(); } catch { /* the meal is logged either way */ }
    }
    if (router.canGoBack()) router.back(); else router.replace('/(v2)' as any);
  };

  const capture = (mode: 'barcode' | 'describe') => { haptics.select(); router.replace({ pathname: '/(v2)/capture', params: { mode } } as any); };

  const { height: kb } = useReanimatedKeyboardAnimation();
  const base = Math.max(insets.bottom, 12);
  const footPad = useAnimatedStyle(() => ({ paddingBottom: Math.max(base, -kb.value + 12) }));

  const typed = query.length > 0;
  return (
    <View style={styles.page}>
      <SearchHeader placeholder="Search foods" value={text} onChange={setText} onQuery={setQuery} size={22} />
      <LinkTabs items={[{ key: 'all', label: 'All' }, { key: 'mine', label: 'Mine' }, { key: 'recipes', label: 'Recipes' }]} value={scope} onChange={setScope} style={styles.scopes} />

      <View style={{ flex: 1 }}>
        <FlashList
          data={results}
          keyExtractor={(r) => `${r.kind}:${r.id}`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: v2.space.gutter, paddingBottom: 12 }}
          ListHeaderComponent={!typed && results.length ? <Text style={[T.eyebrow, { marginTop: 6, marginBottom: 8 }]}>Recent</Text> : null}
          ListEmptyComponent={q.isLoading ? <Text style={[T.caption, { marginTop: 12 }]}>Searching…</Text>
            : typed ? <Text style={[T.bodyMuted, { marginTop: 12 }]}>Nothing for “{query}”. Describe it, or enter the macros.</Text>
            : <Text style={[T.bodyMuted, { marginTop: 12 }]}>What you log shows up here.</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => { haptics.select(); setPicked(item); }} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.caption}, ${item.kcal} calories`}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.caption} numberOfLines={1}>{item.caption}</Text>
              </View>
              <Text style={styles.kcal}>{item.kcal.toLocaleString()}</Text>
            </Pressable>
          )}
        />
      </View>

      <Animated.View style={[styles.foot, footPad]}>
        <View style={styles.links}>
          <Link label="Scan instead" onPress={() => capture('barcode')} />
          <Link label="Describe it" onPress={() => capture('describe')} />
          <Link label="Enter macros manually" onPress={() => { haptics.select(); setManual(true); }} />
        </View>
        <View style={[styles.links, { marginTop: 10 }]}>
          <Link label="Voice" muted onPress={() => { haptics.select(); setClassic('voice'); }} />
          <Link label="Order or receipt" muted onPress={() => { haptics.select(); setClassic('order'); }} />
        </View>
      </Animated.View>

      {picked ? <ReviewSheet result={picked} onClose={() => setPicked(null)} onLogged={(id) => void logged(id)} /> : null}
      {manual ? <ManualSheet initialName={text.trim()} onClose={() => setManual(false)} onLogged={(id) => void logged(id)} /> : null}
      {classic === 'voice' ? <VoiceSheet visible onClose={() => setClassic(null)} onLogged={() => void logged(null)} /> : null}
      {classic === 'order' ? <OrderScanFlow visible onClose={() => setClassic(null)} onLogged={() => void logged(null)} /> : null}
    </View>
  );
}

function Link({ label, onPress, muted }: { label: string; onPress: () => void; muted?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      <Text style={[styles.link, { color: muted ? C.muted : C.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.white },
  scopes: { paddingHorizontal: v2.space.gutter, paddingTop: 14, paddingBottom: 6 },
  row: { height: 62, flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: C.hairline },
  name: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20, color: C.ink },
  caption: { fontFamily: v2.font.regular, fontSize: 12, lineHeight: 16, color: C.muted, marginTop: 2 },
  kcal: { fontFamily: v2.font.regular, fontSize: 15, lineHeight: 20, color: C.muted, fontVariant: ['tabular-nums'] },
  foot: { paddingHorizontal: v2.space.gutter, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.hairline, backgroundColor: C.white },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, rowGap: 8 },
  link: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20 },
});

// Pro-only under the direct-entry paywall: free users get the paywall instead.
export default function FoodSearchScreen() {
  const gated = useProScreen();
  return gated ? null : <FoodSearchScreenInner />;
}
