// Where a looked-up meal's numbers came from — "Source · mcdonalds.com ↗".
// Tapping opens the page in the app's browser. Sources without a page (your
// own scan, a verified record) show as plain text.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { MealSource } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { Pressable } from '../primitives/Pressable';
import { haptics } from '../haptics';

export function SourceLinks({ sources, style }: { sources: MealSource[]; style?: any }) {
  if (!sources.length) return null;
  return (
    <View style={[styles.wrap, style]}>
      {sources.map((s, i) => {
        const line = (
          <Text style={T.caption} numberOfLines={1}>
            <Text style={T.captionStrong}>Source · </Text>
            <Text style={s.url ? styles.link : null}>{s.site}{s.url ? ' ↗' : ''}</Text>
            {sources.length > 1 ? <Text>{`  ${s.what}`}</Text> : null}
          </Text>
        );
        return s.url ? (
          <Pressable key={`${s.site}-${i}`} hitSlop={8} accessibilityRole="link" accessibilityLabel={`Open ${s.site}`}
            onPress={() => { haptics.select(); void WebBrowser.openBrowserAsync(s.url!).catch(() => {}); }}>
            {line}
          </Pressable>
        ) : <View key={`${s.site}-${i}`}>{line}</View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  link: { color: v2.color.ink, textDecorationLine: 'underline' },
});
