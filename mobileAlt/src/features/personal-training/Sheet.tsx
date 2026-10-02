// Bottom sheets for the personal-training screens: a titled sheet with a
// close button, and the option list that stands in for a native select. The
// kit BottomSheet is Modal-backed and does not inherit keyboard avoidance, so
// the body sits in its own avoider.

import React from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import { KeyboardDoneBar } from '../../components/ui/KeyboardDoneBar';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';
import { MAX_FONT_SCALE } from './components';
import { IconButton } from './controls';
import { MOBILE_COPY } from './mobileCopy';

export function Sheet({
  visible, onClose, title, fraction = 0.75, children,
}: { visible: boolean; onClose: () => void; title: string; fraction?: number; children: React.ReactNode }) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const height = Math.round(windowHeight * fraction);
  return (
    <BottomSheet visible={visible} onClose={onClose} height={height}>
      {/* The avoider measures itself inside the sheet, so it is told how far the sheet sits from the top. */}
      <KeyboardAvoider style={styles.flex} iosOffset={windowHeight - height}>
        <View style={[styles.flex, { paddingBottom: insets.bottom }]}>
          <View style={styles.head}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.title}>{title}</Text>
            <IconButton icon={X} label={MOBILE_COPY.close} onPress={onClose} />
          </View>
          {children}
        </View>
      </KeyboardAvoider>
      {Platform.OS === 'android' ? <KeyboardDoneBar /> : null}
    </BottomSheet>
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** A single-choice list in a sheet. Choosing an option closes it. */
export function OptionSheet<T extends string | number>({
  visible, onClose, title, options, value, onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: Option<T>[];
  value: T | null;
  onSelect: (value: T) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} fraction={options.length > 6 ? 0.7 : 0.5}>
      <FlatList
        data={options}
        keyExtractor={(o) => String(o.value)}
        renderItem={({ item }) => {
          const selected = item.value === value;
          return (
            <Pressable
              disabled={item.disabled}
              onPress={() => { onSelect(item.value); onClose(); }}
              accessibilityRole="radio"
              accessibilityLabel={item.label}
              accessibilityState={{ selected, checked: selected, disabled: !!item.disabled }}
              style={({ pressed }) => [styles.option, pressed && styles.pressed, item.disabled && styles.disabled]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.optionText, selected && styles.optionTextSelected]}>{item.label}</Text>
              {selected ? <Check size={18} color={colors.foreground} /> : null}
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.options}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingTop: spacing.sm + 4 },
  title: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground, letterSpacing: -0.2 },
  options: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm },
  optionText: { flex: 1, fontSize: fontSize.base, color: colors.foreground },
  optionTextSelected: { fontWeight: fontWeight.semibold },
  separator: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.border },
});
