import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../../constants/theme';

interface SeparatorProps {
  style?: ViewStyle;
  vertical?: boolean;
}

export function Separator({ style, vertical }: SeparatorProps) {
  return <View style={[vertical ? styles.vertical : styles.horizontal, style]} />;
}

const styles = StyleSheet.create({
  horizontal: { height: 1, backgroundColor: colors.border, width: '100%' },
  vertical: { width: 1, backgroundColor: colors.border, alignSelf: 'stretch' },
});
