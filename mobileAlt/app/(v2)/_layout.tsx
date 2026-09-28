// The agent-first shell's route group.
//
// One Stack: the track (index) plus pushed pages that slide in from the right
// with a `← Parent` back label. Fonts load here, not in the root layout, so
// the v1 boot path is untouched; the shell renders with the system font if
// Inter is late or missing rather than blocking.

import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { v2 } from '../../src/v2/theme';
import { useV2Fonts } from '../../src/v2/fonts';
import { ShellProvider } from '../../src/v2/shell/ShellContext';

export default function V2Layout() {
  const ready = useV2Fonts();
  if (!ready) return <View style={{ flex: 1, backgroundColor: v2.color.darkGround }} />;
  return (
    <ShellProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: v2.motion.push,
          gestureEnabled: true,
          contentStyle: { backgroundColor: v2.color.white },
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="session" options={{ gestureEnabled: false }} />
        <Stack.Screen name="capture" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="paywall" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
    </ShellProvider>
  );
}
