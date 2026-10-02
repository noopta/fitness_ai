// Phone shell for the personal-training screens (design handoff §6): a header
// bar with the logo, screen title and bell, the content, and the five-tab bar.

import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, CircleUserRound } from 'lucide-react-native';
import { COPY, type MeResponse } from '@axiom/personal-training-core';
import { AxiomLogo } from '../../components/ui/AxiomLogo';
import { KeyboardAvoider, useKeyboardHeight } from '../../components/ui/KeyboardAvoider';
import { KeyboardDoneBar } from '../../components/ui/KeyboardDoneBar';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { MAX_FONT_SCALE, TAB_PATH, TabBar, type TabKey } from './components';
import { useExitToMyTraining } from './Gate';
import { MOBILE_COPY } from './mobileCopy';
import { NotificationBell } from './NotificationBell';

export function Screen({
  me, title, active, back, headerAction, children,
}: {
  me: MeResponse;
  title: string;
  /** The tab this screen is, or null for a screen opened from one. */
  active: TabKey | null;
  back?: boolean;
  /** One extra header button, left of the bell. */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const exit = useExitToMyTraining();
  const keyboardOpen = useKeyboardHeight() > 0;

  function openAccount() {
    Alert.alert(me.trainer.name, me.practice?.name, [
      { text: COPY.exit.myTraining, onPress: () => { void exit(); } },
      { text: MOBILE_COPY.signOut, style: 'destructive', onPress: () => { void logout(); } },
      { text: MOBILE_COPY.cancel, style: 'cancel' },
    ]);
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.navigate(TAB_PATH.clients as any);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {back ? (
          <Pressable onPress={goBack} hitSlop={4} accessibilityRole="button" accessibilityLabel={MOBILE_COPY.back} style={styles.iconButton}>
            <ChevronLeft size={24} color={colors.foreground} />
          </Pressable>
        ) : (
          <AxiomLogo size={28} />
        )}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} accessibilityRole="header" style={styles.title}>{title}</Text>
        {headerAction}
        <NotificationBell />
        <Pressable onPress={openAccount} hitSlop={4} accessibilityRole="button" accessibilityLabel={COPY.exit.menu} style={styles.iconButton}>
          <CircleUserRound size={24} color={colors.foreground} />
        </Pressable>
      </View>
      <KeyboardAvoider style={styles.content}>{children}</KeyboardAvoider>
      {/* The tab bar gives its room to the keyboard; the spacer keeps the avoider's inset arithmetic true. */}
      {keyboardOpen ? <View style={{ height: insets.bottom }} /> : <TabBar active={active} />}
      <KeyboardDoneBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: colors.border,
  },
  title: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  iconButton: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
});
