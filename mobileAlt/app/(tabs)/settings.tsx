import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Linking,
  TextInput, Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { useUnits } from '../../src/context/UnitsContext';
import { coachApi, authApi } from '../../src/lib/api';
import { initIAP, restorePurchases } from '../../src/lib/iap';
import { Badge } from '../../src/components/ui/Badge';
import { ContributionGraph } from '../../src/components/ContributionGraph';
import { UpgradeSheet } from '../../src/components/UpgradeSheet';
import { InAppBrowser } from '../../src/components/ui/InAppBrowser';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../src/components/ui/KeyboardDoneBar';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { user } = auth;
  const [portalLoading, setPortalLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserTitle, setBrowserTitle] = useState('');
  const [browserVisible, setBrowserVisible] = useState(false);
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  function openInApp(url: string, title: string) {
    setBrowserUrl(url);
    setBrowserTitle(title);
    setBrowserVisible(true);
  }
  const { unit, toggleUnit } = useUnits();

  // Username editing
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);

  // Avatar
  const [avatarLoading, setAvatarLoading] = useState(false);

  const handleCheckUsername = useCallback(async (val: string) => {
    const cleaned = val.trim();
    if (cleaned.length < 3) { setUsernameAvailable(null); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(cleaned)) { setUsernameAvailable(false); return; }
    setCheckingUsername(true);
    try {
      const data = await authApi.checkUsername(cleaned);
      setUsernameAvailable(data.available);
    } catch {
      setUsernameAvailable(null);
    } finally {
      setCheckingUsername(false);
    }
  }, []);

  const handleSaveUsername = async () => {
    const cleaned = usernameInput.trim();
    if (!cleaned || cleaned.length < 3) return Alert.alert('Invalid', 'Username must be at least 3 characters.');
    setUsernameLoading(true);
    try {
      await authApi.setUsername(cleaned);
      await auth.refreshUser();
      setEditingUsername(false);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save username.');
    } finally {
      setUsernameLoading(false);
    }
  };

  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const base64 = `data:image/jpeg;base64,${result.assets[0].base64}`;
    setAvatarLoading(true);
    try {
      await authApi.setAvatar(base64);
      await auth.refreshUser();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to upload avatar.');
    } finally {
      setAvatarLoading(false);
    }
  };

  function handleManageSubscription() {
    // Open iOS Subscriptions settings — Apple requires this for IAP subscribers
    Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() => {
      Linking.openURL('App-prefs:root=APPLE_ACCOUNT&path=SUBSCRIPTIONS');
    });
  }

  async function handleRestorePurchases() {
    setRestoring(true);
    try {
      await initIAP();
      const restored = await restorePurchases();
      if (restored) {
        await auth.refreshUser();
        Alert.alert('Restored!', 'Your Pro subscription has been restored.');
      } else {
        Alert.alert('Nothing to Restore', 'No previous purchases were found for this Apple ID.');
      }
    } catch (err: any) {
      Alert.alert('Restore Failed', err?.message ?? 'Could not restore purchases. Please try again.');
    } finally {
      setRestoring(false);
    }
  }

  function handleUpgrade() {
    setUpgradeVisible(true);
  }

  async function handleUpgradeSuccess() {
    setUpgradeVisible(false);
    await auth.refreshUser();
    Alert.alert('Welcome to Pro!', 'Your account has been upgraded. Enjoy unlimited access.');
  }

  function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try { await auth.logout(); } catch {}
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardDoneBar />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* Header */}
        <Text style={styles.screenTitle}>Settings</Text>

        {/* Profile card */}
        <View style={styles.profileCard}>
          <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.8} style={styles.avatarWrapper}>
            {avatarLoading ? (
              <View style={styles.avatarCircle}>
                <ActivityIndicator color={colors.primaryForeground} />
              </View>
            ) : user?.avatarBase64 ? (
              <Image source={{ uri: user.avatarBase64 }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>{(user?.name ?? 'A').charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <Ionicons name="camera" size={10} color={colors.primaryForeground} />
            </View>
          </TouchableOpacity>

          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>{user?.name ?? 'Athlete'}</Text>
            {user?.username ? (
              <Text style={styles.profileUsername} numberOfLines={1}>@{user.username}</Text>
            ) : (
              user?.email ? <Text style={styles.profileEmail} numberOfLines={1}>{user.email}</Text> : null
            )}
          </View>
          <Badge variant={isPro ? 'pro' : 'secondary'}>{isPro ? 'Pro' : 'Free'}</Badge>
        </View>

        {/* Username section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Profile</Text>
          <View style={styles.card}>
            {!editingUsername ? (
              <TouchableOpacity
                style={styles.cardRow}
                activeOpacity={0.7}
                onPress={() => {
                  setUsernameInput(user?.username ?? '');
                  setUsernameAvailable(null);
                  setEditingUsername(true);
                }}
              >
                <View style={styles.cardIconBox}>
                  <Ionicons name="at" size={18} color={colors.foreground} />
                </View>
                <View style={styles.cardRowText}>
                  <Text style={styles.cardRowTitle}>Username</Text>
                  <Text style={styles.cardRowSub}>
                    {user?.username ? `@${user.username}` : 'Tap to set a username'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ) : (
              <View style={styles.usernameEdit}>
                <View style={styles.usernameInputRow}>
                  <Text style={styles.atSign}>@</Text>
                  <TextInput
                    style={styles.usernameInput}
                    value={usernameInput}
                    onChangeText={(v) => {
                      setUsernameInput(v);
                      handleCheckUsername(v);
                    }}
                    placeholder="username"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={30}
                    autoFocus
                    inputAccessoryViewID={KEYBOARD_DONE_ID}
                  />
                  {checkingUsername && <ActivityIndicator size="small" color={colors.mutedForeground} />}
                  {!checkingUsername && usernameAvailable === true && (
                    <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                  )}
                  {!checkingUsername && usernameAvailable === false && (
                    <Ionicons name="close-circle" size={18} color={colors.destructive} />
                  )}
                </View>
                <Text style={styles.usernameHint}>
                  {usernameAvailable === false ? 'Username taken or invalid' :
                   usernameAvailable === true ? 'Available!' :
                   'Letters, numbers, underscores only'}
                </Text>
                <View style={styles.usernameButtons}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => setEditingUsername(false)}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBtn, (!usernameAvailable || usernameLoading) && styles.saveBtnDisabled]}
                    onPress={handleSaveUsername}
                    disabled={!usernameAvailable || usernameLoading}
                  >
                    {usernameLoading ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <Text style={styles.saveBtnText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Activity graph */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Activity</Text>
          <ContributionGraph userId={user?.id} />
        </View>

        {/* Subscription section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Subscription</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.cardIconBox}>
                <Ionicons name={isPro ? 'star' : 'star-outline'} size={18} color={colors.foreground} />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>{isPro ? 'Pro Plan' : 'Free Plan'}</Text>
                <Text style={styles.cardRowSub}>
                  {isPro ? 'Full access to all features.' : '2 analyses per day. Upgrade for unlimited.'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={isPro ? styles.outlineButton : styles.blackButton}
              activeOpacity={0.82}
              onPress={isPro ? handleManageSubscription : handleUpgrade}
            >
              <Text style={isPro ? styles.outlineButtonText : styles.blackButtonText}>
                {isPro ? 'Manage Subscription' : 'Upgrade to Pro'}
              </Text>
            </TouchableOpacity>
            {!isPro && (
              <TouchableOpacity
                style={styles.restoreBtn}
                activeOpacity={0.7}
                onPress={handleRestorePurchases}
                disabled={restoring}
              >
                {restoring ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <Text style={styles.restoreBtnText}>Restore Purchases</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Preferences section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Preferences</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.cardIconBox}>
                <Ionicons name="barbell-outline" size={18} color={colors.foreground} />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>Weight Unit</Text>
                <Text style={styles.cardRowSub}>Used across workouts, logs, and strength profile</Text>
              </View>
              <TouchableOpacity onPress={toggleUnit} style={styles.unitToggle} activeOpacity={0.8}>
                <Text style={[styles.unitOption, unit === 'lbs' && styles.unitOptionActive]}>lbs</Text>
                <Text style={styles.unitSep}>·</Text>
                <Text style={[styles.unitOption, unit === 'kg' && styles.unitOptionActive]}>kg</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Account section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            <TouchableOpacity
              onPress={handleSignOut}
              activeOpacity={0.7}
              style={styles.accountRow}
            >
              <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
              <Text style={styles.signOutText}>Sign Out</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => openInApp('https://axiomtraining.io/terms', 'Terms of Use')} activeOpacity={0.7}>
            <Text style={styles.legalLink}>Terms of Use</Text>
          </TouchableOpacity>
          <Text style={styles.legalSep}>·</Text>
          <TouchableOpacity onPress={() => openInApp('https://axiomtraining.io/privacy', 'Privacy Policy')} activeOpacity={0.7}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.versionText}>Axiom v1.0.0 · AI-powered strength training</Text>
      </ScrollView>

      <UpgradeSheet
        visible={upgradeVisible}
        onClose={() => setUpgradeVisible(false)}
        onSuccess={handleUpgradeSuccess}
      />
      <InAppBrowser
        url={browserUrl}
        title={browserTitle}
        visible={browserVisible}
        onClose={() => setBrowserVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  screenTitle: {
    fontSize: 28,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: -0.5,
  },

  // Profile
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  avatarWrapper: { position: 'relative' },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.muted,
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: fontWeight.bold,
    color: colors.primaryForeground,
  },
  profileInfo: { flex: 1 },
  profileName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  profileEmail: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },
  profileUsername: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },

  // Username edit
  usernameEdit: { padding: spacing.md, gap: spacing.sm },
  usernameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  atSign: { fontSize: fontSize.base, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  usernameInput: { flex: 1, fontSize: fontSize.base, color: colors.foreground },
  usernameHint: { fontSize: fontSize.xs, color: colors.mutedForeground },
  usernameButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  // Sections
  section: { gap: 8 },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.md,
  },
  cardIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardRowText: { flex: 1 },
  cardRowTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  cardRowSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2, lineHeight: 17 },

  blackButton: {
    margin: spacing.md,
    marginTop: 4,
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  blackButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
  outlineButton: {
    margin: spacing.md,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  outlineButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  restoreBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  restoreBtnText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },

  // Account row
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: 12,
  },
  signOutText: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.medium, color: colors.destructive },

  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  legalLink: { fontSize: fontSize.xs, color: colors.mutedForeground, textDecorationLine: 'underline' },
  legalSep: { fontSize: fontSize.xs, color: colors.mutedForeground },
  versionText: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center', marginTop: 4 },

  unitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  unitOption: { fontSize: fontSize.sm, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  unitOptionActive: { color: colors.foreground, fontWeight: fontWeight.bold },
  unitSep: { fontSize: fontSize.xs, color: colors.mutedForeground },
});
