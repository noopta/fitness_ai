// Shared bottom-sheet primitive used by every Nutrition sheet.
// Rolls a slim wrapper around React Native's Modal rather than pulling in
// @gorhom/bottom-sheet — the dependency isn't in the project and the
// sheets here don't need swipe-to-close ergonomics for v1.
//
// Sheet stack discipline (spec §10): only one sheet should be visible at a
// time. The parent owns visibility — each Nutrition sheet sits in
// NutritionScreen's render and is gated by its own piece of state.

import React from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, useWindowDimensions,
  KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontWeight } from '../../../../constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /**
   * Optional subtitle below the title — a one-liner that orients the user.
   * Spec calls for at least the drag-handle pill; keep this concise.
   */
  subtitle?: string;
  children: React.ReactNode;
  /**
   * Whether the user can dismiss by tapping the dimmed backdrop. Defaults
   * to true; flip to false when mid-action (e.g. saving a meal) so taps
   * don't kill the request in flight.
   */
  dismissOnBackdrop?: boolean;
}

export function BottomSheet({
  visible, onClose, title, subtitle, children, dismissOnBackdrop = true,
}: Props) {
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.min(height * 0.92, height - 40);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* Dimmed backdrop — taps dismiss by default. */}
        <Pressable
          style={styles.backdrop}
          onPress={dismissOnBackdrop ? onClose : undefined}
          accessibilityLabel="Close sheet"
          accessibilityRole="button"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        >
          <SafeAreaView edges={['bottom']} style={styles.safe}>
            {/* Drag-handle pill, per spec §10. Purely visual — we don't
                support swipe-to-close in this v1 wrapper. */}
            <View style={styles.handle} />

            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} accessibilityRole="header">{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Close ${title}`}
              >
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <View style={styles.body}>{children}</View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  safe: { flex: 0 },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingBottom: 8,
  },
  title: { fontSize: 18, fontWeight: fontWeight.bold, color: colors.foreground, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: colors.mutedForeground, marginTop: 2, lineHeight: 16 },
  body: { paddingTop: 4, paddingBottom: 12 },
});
