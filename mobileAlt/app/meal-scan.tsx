// Standalone meal-photo macro scan — a free-tier entry point that hosts the
// existing SnapSheet outside the Pro-gated coach tab, so free users reaching
// it from the onboarding picker can try macro/micronutrient extraction. The
// sheet handles capture → Gemini vision → review → log; closing it (or logging)
// returns the user home.

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SnapSheet } from '../src/components/coach/nutrition/sheets/SnapSheet';
import { colors } from '../src/constants/theme';

export default function MealScanScreen() {
  const router = useRouter();
  const [visible, setVisible] = useState(true);

  const leave = () => {
    setVisible(false);
    // Replace so the user lands on the home tab rather than back on the
    // (now-empty) scan host.
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.host}>
      <SnapSheet visible={visible} onClose={leave} onLogged={leave} />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: colors.background },
});
