// Shared shell for the Nutrition Profile subscreens (spec §5): a native-stack
// screen with a 34×34 hairline back button, a micro-label kicker, and a title.
// Body scrolls; content padding 16/18.
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fontWeight } from '../../../constants/theme';
import { NP } from './npTokens';

export function NpScreen({ kicker, title, children }: {
  kicker: string; title: string; children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.bar}>
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={18} color={NP.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{kicker}</Text>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: NP.cardBg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  back: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: NP.border, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.mutedInk },
  title: { fontSize: 17, fontWeight: fontWeight.bold, color: NP.ink, letterSpacing: -0.3 },
  body: { paddingHorizontal: 16, paddingVertical: 18, paddingBottom: 60, gap: 16 },
});
