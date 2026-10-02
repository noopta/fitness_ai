// Inputs and controls shared by the personal-training screens (design handoff
// §5): buttons at the 44pt minimum, the segmented control, the tinted switch,
// disclosures, the picker field and the multiline draft input.

import React from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';
import { KEYBOARD_DONE_ID } from '../../components/ui/KeyboardDoneBar';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { MAX_FONT_SCALE } from './components';

/** Light impact, for send and approve only (handoff §7). */
export function sendHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

type ButtonProps = React.ComponentProps<typeof Button>;

/** The kit button held to the 44pt minimum height; ghost text is zinc-600. */
export function ActionButton({ style, textStyle, variant = 'primary', ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      variant={variant}
      style={{ minHeight: 44, ...style }}
      textStyle={{ ...(variant === 'ghost' ? { color: colors.zinc600 } : null), fontSize: fontSize.sm, ...textStyle }}
    />
  );
}

/** An icon-only button with a 44pt target and a spoken label. */
export function IconButton({
  icon: Icon, label, onPress, disabled, color = colors.zinc600, size = 18,
}: { icon: LucideIcon; label: string; onPress: () => void; disabled?: boolean; color?: string; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Icon size={size} color={color} />
    </Pressable>
  );
}

/** zinc-100 track, 3px inset, active segment white with a hairline border. */
export function SegmentedControl<T extends string>({
  value, onChange, options, label, style,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segments, style]}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            disabled={o.disabled}
            hitSlop={{ top: 3, bottom: 3 }}
            onPress={() => { if (!selected) onChange(o.value); }}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected, checked: selected, disabled: !!o.disabled }}
            style={[styles.segment, selected && styles.segmentActive, o.disabled && styles.disabled]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.segmentText, selected && styles.segmentTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Track black when on, zinc-200 when off (handoff §5). */
export function TintedSwitch({ value, onValueChange, label, disabled }: { value: boolean; onValueChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={label}
      trackColor={{ true: colors.foreground, false: colors.border }}
      thumbColor={colors.background}
      ios_backgroundColor={colors.border}
    />
  );
}

export function SwitchRow({ label, hint, value, onValueChange, disabled }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.label}>{label}</Text>
        {hint ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.hint}>{hint}</Text> : null}
      </View>
      <TintedSwitch value={value} onValueChange={onValueChange} label={label} disabled={disabled} />
    </View>
  );
}

/** A text toggle that reveals its children; the chevron and expanded state say which way it is. */
export function Disclosure({ label, open, onToggle, children, strong }: { label: string; open: boolean; onToggle: () => void; children?: React.ReactNode; strong?: boolean }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}
      >
        <Icon size={16} color={colors.zinc600} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.disclosureText, strong && styles.disclosureStrong]}>{label}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

/** Stands in for a native select: shows the current value and opens an option sheet. */
export function PickerField({ label, value, onPress, disabled, style }: { label: string; value: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.picker, pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.pickerText}>{value}</Text>
      <ChevronDown size={16} color={colors.zinc600} />
    </Pressable>
  );
}

/** Bordered text input; multiline by default, for drafts, notes and questions. */
export function TextArea({ style, multiline = true, ...props }: TextInputProps) {
  return (
    <TextInput
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      placeholderTextColor={colors.mutedForeground}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_DONE_ID : undefined}
      {...props}
      style={[styles.textArea, multiline && styles.textAreaMultiline, style]}
    />
  );
}

/** One line of feedback under a control: a failure (announced) or a quiet confirmation. */
export function FeedbackText({ children, error }: { children: string; error?: boolean }) {
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      accessibilityRole={error ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.feedback, error && styles.feedbackError]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  segments: { flexDirection: 'row', backgroundColor: colors.muted, borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 9 },
  segmentActive: { backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  segmentText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.zinc600, textAlign: 'center' },
  segmentTextActive: { color: colors.foreground },
  switchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchText: { flex: 1, gap: 2 },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  hint: { fontSize: 12, lineHeight: 17, color: colors.zinc600 },
  disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  disclosureText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.zinc600 },
  disclosureStrong: { color: colors.foreground },
  picker: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border,
    backgroundColor: colors.background,
  },
  pickerText: { flexShrink: 1, fontSize: fontSize.base, color: colors.foreground },
  textArea: {
    minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, backgroundColor: colors.background,
    fontSize: fontSize.base, lineHeight: 22, color: colors.foreground,
  },
  textAreaMultiline: { minHeight: 96 },
  feedback: { fontSize: 12, lineHeight: 17, color: colors.zinc600 },
  feedbackError: { color: colors.destructiveInk },
});
