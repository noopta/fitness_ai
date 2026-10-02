// Phone shell for the personal-training screens (design handoff §6): a header
// bar with the logo and screen title, the content, and the five-tab bar.

import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, CircleUserRound } from 'lucide-react-native';
import { COPY, type MeResponse } from '@axiom/personal-training-core';
import { AxiomLogo } from '../../components/ui/AxiomLogo';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { MAX_FONT_SCALE, TabBar } from './components';
import { useExitToMyTraining } from './Gate';

export function Screen({ me, title, back, children }: { me: MeResponse; title: string; back?: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const { logout } = useAuth();
  const exit = useExitToMyTraining();

  function openAccount() {
    Alert.alert(me.trainer.name, me.practice?.name, [
      { text: COPY.exit.myTraining, onPress: () => { void exit(); } },
      { text: 'Sign out', style: 'destructive', onPress: () => { void logout(); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {back ? (
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Back to ${COPY.roster.title}`} style={styles.iconButton}>
            <ChevronLeft size={24} color={colors.foreground} />
          </Pressable>
        ) : (
          <AxiomLogo size={28} />
        )}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} accessibilityRole="header" style={styles.title}>{title}</Text>
        <Pressable onPress={openAccount} hitSlop={12} accessibilityRole="button" accessibilityLabel={COPY.exit.menu} style={styles.iconButton}>
          <CircleUserRound size={24} color={colors.foreground} />
        </Pressable>
      </View>
      <View style={styles.content}>{children}</View>
      <TabBar active="clients" onClients={() => router.navigate('/personal-training' as any)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: colors.border,
  },
  title: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  iconButton: { minWidth: 28, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
});
