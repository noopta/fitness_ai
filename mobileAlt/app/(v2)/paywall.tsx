// Paywall — after the plan is built, before Phase 1. Three value rows (what
// the plan will do, not a feature grid), then the one solid black button in
// onboarding. Prices and the purchase itself come from the existing
// UpgradeSheet (StoreKit / Play via react-native-iap), so store config,
// receipts and the tier refresh are unchanged.

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { v2, T } from '../../src/v2/theme';
import { Mark } from '../../src/v2/primitives/Mark';
import { Row } from '../../src/v2/primitives/Row';
import { Enter } from '../../src/v2/primitives/Enter';
import { TextAction } from '../../src/v2/primitives/TextAction';
import { UpgradeSheet } from '../../src/components/UpgradeSheet';
import { useAuth } from '../../src/context/AuthContext';
import { trackScreen } from '../../src/lib/analytics';

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUser } = useAuth();
  const [sheet, setSheet] = useState(false);
  // gate=1: opened by a Pro-only feature (direct-entry paywall), not at the end of onboarding.
  // Leaving goes back to where the user tapped; there's no Phase 1 to promise.
  const gate = useLocalSearchParams<{ gate?: string }>().gate === '1';
  React.useEffect(() => { trackScreen(gate ? 'v2.paywall.gate' : 'v2.paywall'); }, [gate]);
  const leave = () => { if (gate && router.canGoBack()) router.back(); else router.replace('/(v2)' as any); };
  const done = async () => { await refreshUser(); leave(); };
  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar style="dark" />
      <View style={styles.head}>
        <Mark />
        <Pressable onPress={() => setSheet(true)} hitSlop={8}><Text style={T.caption}>Restore</Text></Pressable>
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Enter exit={false}><Text style={T.headlineSm}>{gate ? 'That\'s Pro. First week free.' : 'Phase 1 starts tomorrow. First week free.'}</Text></Enter>
        <View style={{ marginTop: 28 }}>
          <Enter index={1} exit={false}><Row name="It adapts every session" sub="Easy, hard or missed — the next set changes." /></Enter>
          <Enter index={2} exit={false}><Row name="Food, down to micronutrients" sub="Snap a plate. I find what you're short on." /></Enter>
          <Enter index={3} exit={false}><Row name="Anakin, any hour" sub="Swap a day, ask why, change the plan." last /></Enter>
        </View>
        <Enter index={4} exit={false}>
          <TextAction solid onPress={() => setSheet(true)} style={{ marginTop: 32 }}>Start free week</TextAction>
          <Text style={[T.caption, { marginTop: 12, textAlign: 'center' }]}>Trial terms and the price are shown on the next step. Cancel anytime.</Text>
        </Enter>
        <Enter index={5} exit={false}><TextAction muted arrow={false} size={15} onPress={leave} style={{ marginTop: 24, alignSelf: 'center' }}>Not now</TextAction></Enter>
      </View>
      <UpgradeSheet visible={sheet} onClose={() => setSheet(false)} onSuccess={() => { setSheet(false); void done(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.white, paddingHorizontal: v2.space.gutter },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
});
