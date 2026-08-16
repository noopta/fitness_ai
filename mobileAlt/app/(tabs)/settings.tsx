import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Linking,
  TextInput, Image, ActivityIndicator, Modal, Platform,
} from 'react-native';
import { KeyboardAvoider } from '../../src/components/ui/KeyboardAvoider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { useUnits } from '../../src/context/UnitsContext';
import { coachApi, authApi, paymentsApi } from '../../src/lib/api';
import * as WebBrowser from 'expo-web-browser';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { Badge } from '../../src/components/ui/Badge';
import { ContributionGraph } from '../../src/components/ContributionGraph';
import { UpgradeSheet } from '../../src/components/UpgradeSheet';
import { InAppBrowser } from '../../src/components/ui/InAppBrowser';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../src/components/ui/KeyboardDoneBar';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';
import { trackScreen, trackScreenTime, Analytics } from '../../src/lib/analytics';

export default function SettingsScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { user } = auth;
  const [portalLoading, setPortalLoading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserTitle, setBrowserTitle] = useState('');
  const [browserVisible, setBrowserVisible] = useState(false);
  // Exit-survey state — gates the destructive deleteAccount call so we
  // capture *why* someone is leaving. Three churns/month is small in absolute
  // numbers but the signal compounds.
  const [exitSurveyVisible, setExitSurveyVisible] = useState(false);
  const [exitFreeText, setExitFreeText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  useEffect(() => {
    trackScreen('Settings');
    return trackScreenTime('Settings');
  }, []);

  // Build identity. Until this existed there was no way to tell which JS a
  // device was running — "did the fix ship?" had to be inferred from server
  // logs, which cost several debugging rounds and is impossible for testers.
  //
  // Updates.updateId is null when running the bundle baked into the binary, so
  // "embedded" genuinely means "no OTA applied" rather than "unknown".
  const appVersion = (Constants.expoConfig?.version as string | undefined) ?? '?';
  const bundleLabel = Updates.updateId
    ? `update ${Updates.updateId.slice(0, 8)}`
    : 'embedded build';
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  async function handleCheckUpdates() {
    if (!Updates.isEnabled) {
      Alert.alert('Updates unavailable', `Running the ${bundleLabel}. OTA updates are disabled in this build.`);
      return;
    }
    setCheckingUpdate(true);
    try {
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) {
        Alert.alert('Up to date', `Axiom ${appVersion} · ${bundleLabel}`);
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert('Update ready', 'Axiom will restart to apply it.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Restart', onPress: () => { void Updates.reloadAsync(); } },
      ]);
    } catch (err: any) {
      Alert.alert('Could not check for updates', err?.message ?? String(err));
    } finally {
      setCheckingUpdate(false);
    }
  }

  function openInApp(url: string, title: string) {
    setBrowserUrl(url);
    setBrowserTitle(title);
    setBrowserVisible(true);
  }
  const { unit, toggleUnit } = useUnits();

  // Subtract-workout-burn toggle. Default true on server side, so an
  // explicit `false` from the API is the only way to be off.
  const subtractBurn = user?.subtractWorkoutBurnFromCalories !== false;
  const [togglingSubtractBurn, setTogglingSubtractBurn] = useState(false);

  /** Flip the subtract-workout-burn flag server-side, then refresh user. */
  async function toggleSubtractBurn() {
    if (togglingSubtractBurn) return;
    setTogglingSubtractBurn(true);
    try {
      await authApi.updateProfile({ subtractWorkoutBurnFromCalories: !subtractBurn });
      await auth.refreshUser();
    } catch (err: any) {
      Alert.alert('Could not update preference', err?.message ?? 'Please try again.');
    } finally {
      setTogglingSubtractBurn(false);
    }
  }

  // ── Food region ────────────────────────────────────────────────────────────
  // Picks which food-composition data and prompt vocabulary meal logging uses.
  // USDA has almost no West African coverage, so leaving a Nigerian user on
  // "Global" means egusi soup and eba get estimated from model recall alone.
  const FOOD_REGIONS = [
    { value: 'global', label: 'Global', sub: 'USDA database, US portion sizes' },
    { value: 'ng', label: 'Nigeria', sub: 'Jollof, egusi, eba, moi moi, suya — local portions' },
    { value: 'gm', label: 'The Gambia', sub: 'Benachin, domoda, superkanja — local portions' },
    { value: 'wa', label: 'West Africa', sub: 'Shared West African dishes' },
  ] as const;
  type FoodRegionValue = typeof FOOD_REGIONS[number]['value'];

  const foodRegion: FoodRegionValue = (user?.foodRegion as FoodRegionValue) ?? 'global';
  const foodRegionLabel = FOOD_REGIONS.find(r => r.value === foodRegion)?.label ?? 'Global';
  const [savingFoodRegion, setSavingFoodRegion] = useState(false);

  function chooseFoodRegion() {
    if (savingFoodRegion) return;
    Alert.alert(
      'Food region',
      'Sets which foods and portion sizes we recognise when you log a meal.',
      [
        ...FOOD_REGIONS.map(r => ({
          text: r.value === foodRegion ? `${r.label} ✓` : r.label,
          onPress: () => applyFoodRegion(r.value),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }

  async function applyFoodRegion(next: FoodRegionValue) {
    if (next === foodRegion) return;
    setSavingFoodRegion(true);
    try {
      await authApi.updateProfile({ foodRegion: next });
      await auth.refreshUser();
    } catch (err: any) {
      Alert.alert('Could not update food region', err?.message ?? 'Please try again.');
    } finally {
      setSavingFoodRegion(false);
    }
  }

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
      Analytics.profileAvatarUpdated();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to upload avatar.');
    } finally {
      setAvatarLoading(false);
    }
  };

  async function handleManageSubscription() {
    // Rail-aware: Stripe subscribers get the Stripe Customer Portal (swap
    // card, cancel, invoices); IAP subscribers get the platform's own
    // subscription manager. Previously this ALWAYS opened Apple's page —
    // Stripe subscribers landed on an empty list with no way to manage.
    try {
      const status = await paymentsApi.getPaymentsStatus();
      const stripeActive = ['active', 'trialing', 'past_due'].includes(status?.subStatus);
      if (stripeActive) {
        const portal = await paymentsApi.getPaymentsPortal();
        if (portal?.url) {
          await WebBrowser.openBrowserAsync(portal.url);
          return;
        }
      }
    } catch {
      // Status/portal unavailable — fall through to the store manager rather
      // than dead-ending the tap.
    }
    if (Platform.OS === 'android') {
      Linking.openURL('https://play.google.com/store/account/subscriptions').catch(() => {});
      return;
    }
    // Apple requires this path for IAP subscribers
    Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() => {
      Linking.openURL('App-prefs:root=APPLE_ACCOUNT&path=SUBSCRIPTIONS');
    });
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your account and all data, sessions, plans, nutrition logs, and social activity. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setExitFreeText('');
            setExitSurveyVisible(true);
          },
        },
      ]
    );
  }

  /**
   * Final delete step. Captures the survey reason (and any free-text) into
   * PostHog as `delete_account_survey_submitted`, then runs the actual delete.
   * `reason` is one of a small fixed vocabulary so the dashboard can group it.
   */
  async function performDelete(reason: string) {
    setDeletingAccount(true);
    try {
      Analytics.deleteAccountSurveySubmitted(reason, exitFreeText.trim() || undefined);
      await authApi.deleteAccount();
      await auth.logout();
      router.replace('/(auth)/welcome');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not delete account. Please try again.');
    } finally {
      setDeletingAccount(false);
      setExitSurveyVisible(false);
    }
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

        {/* Training history */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Training History</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.cardRow}
              activeOpacity={0.82}
              onPress={() => router.push('/completed-programs')}
            >
              <View style={styles.cardIconBox}>
                <Ionicons name="archive-outline" size={18} color={colors.foreground} />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>Finished programs</Text>
                <Text style={styles.cardRowSub}>Past programs with stats — workouts, volume, BW change.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {isPro ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Subscription</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <View style={styles.cardIconBox}>
                  <Ionicons name="star" size={18} color={colors.foreground} />
                </View>
                <View style={styles.cardRowText}>
                  <Text style={styles.cardRowTitle}>Pro Plan</Text>
                  <Text style={styles.cardRowSub}>Full access to all features.</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.outlineButton}
                activeOpacity={0.82}
                onPress={handleManageSubscription}
              >
                {portalLoading
                  ? <ActivityIndicator size="small" color={colors.foreground} />
                  : <Text style={styles.outlineButtonText}>Manage Subscription</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Subscription</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <View style={styles.cardIconBox}>
                  <Ionicons name="star-outline" size={18} color={colors.foreground} />
                </View>
                <View style={styles.cardRowText}>
                  <Text style={styles.cardRowTitle}>Free Plan</Text>
                  <Text style={styles.cardRowSub}>Upgrade to unlock AI coaching & more.</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.outlineButton}
                activeOpacity={0.82}
                onPress={() => setShowUpgrade(true)}
              >
                <Text style={styles.outlineButtonText}>Upgrade to Pro</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

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
            <View style={styles.rowDivider} />
            <View style={styles.cardRow}>
              <View style={styles.cardIconBox}>
                <Ionicons name="globe-outline" size={18} color={colors.foreground} />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>Food Region</Text>
                <Text style={styles.cardRowSub}>Which foods and portion sizes we recognise when logging</Text>
              </View>
              <TouchableOpacity
                onPress={chooseFoodRegion}
                style={styles.unitToggle}
                activeOpacity={0.8}
                disabled={savingFoodRegion}
                accessibilityRole="button"
                accessibilityLabel={`Food region, currently ${foodRegionLabel}`}
              >
                {savingFoodRegion ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <Text style={[styles.unitOption, styles.unitOptionActive]}>{foodRegionLabel}</Text>
                )}
              </TouchableOpacity>
            </View>
            <View style={styles.rowDivider} />
            <View style={styles.cardRow}>
              <View style={styles.cardIconBox}>
                <Ionicons name="flame-outline" size={18} color={colors.foreground} />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>Subtract workout burn</Text>
                <Text style={styles.cardRowSub}>Add today's estimated calorie burn to your daily target. Turn off if your plan already assumes a high activity multiplier.</Text>
              </View>
              <TouchableOpacity
                onPress={toggleSubtractBurn}
                style={[styles.toggleBox, subtractBurn && styles.toggleBoxOn]}
                activeOpacity={0.8}
                disabled={togglingSubtractBurn}
              >
                <View style={[styles.toggleKnob, subtractBurn && styles.toggleKnobOn]} />
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
            <View style={styles.rowDivider} />
            <TouchableOpacity
              onPress={handleDeleteAccount}
              activeOpacity={0.7}
              style={styles.accountRow}
            >
              <Ionicons name="trash-outline" size={20} color={colors.destructive} />
              <Text style={styles.signOutText}>Delete Account</Text>
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
        <TouchableOpacity onPress={handleCheckUpdates} activeOpacity={0.6} disabled={checkingUpdate}>
          <Text style={styles.versionText}>
            {checkingUpdate ? 'Checking for updates…' : `Axiom ${appVersion} · ${bundleLabel}`}
          </Text>
          <Text style={styles.versionHint}>Tap to check for updates</Text>
        </TouchableOpacity>
      </ScrollView>

      <InAppBrowser
        url={browserUrl}
        title={browserTitle}
        visible={browserVisible}
        onClose={() => setBrowserVisible(false)}
      />
      <UpgradeSheet
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        onSuccess={async () => { setShowUpgrade(false); await auth.refreshUser(); }}
      />

      {/* Exit survey — short, single screen, runs before the actual delete. */}
      <Modal
        visible={exitSurveyVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !deletingAccount && setExitSurveyVisible(false)}
      >
        <SafeAreaView style={styles.exitContainer} edges={['top', 'bottom']}>
          {/* Modals render in their own native window, so keyboard avoidance
              from the screen behind does not reach them. */}
          <KeyboardAvoider style={{ flex: 1 }}>
          <View style={styles.exitHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.exitEyebrow}>One last thing</Text>
              <Text style={styles.exitTitle}>What's making you leave?</Text>
              <Text style={styles.exitSub}>
                Your answer is anonymous and goes straight to the team. It helps us
                fix what's not working.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => !deletingAccount && setExitSurveyVisible(false)}
              hitSlop={8}
              disabled={deletingAccount}
            >
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.exitBody}>
            {EXIT_REASONS.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.exitReason}
                activeOpacity={0.85}
                onPress={() => performDelete(r.id)}
                disabled={deletingAccount}
              >
                <Text style={styles.exitReasonText}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}

            <Text style={styles.exitFieldLabel}>Anything else? (optional)</Text>
            <TextInput
              style={styles.exitFreeText}
              value={exitFreeText}
              onChangeText={setExitFreeText}
              placeholder="Tell us what would have kept you here"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              editable={!deletingAccount}
            />

            <View style={{ height: 16 }} />
            <Text style={styles.exitFinePrint}>
              Tapping any reason above immediately deletes your account and all data.
            </Text>

            {deletingAccount && (
              <View style={styles.exitLoading}>
                <ActivityIndicator color={colors.mutedForeground} />
                <Text style={styles.exitLoadingText}>Deleting your account…</Text>
              </View>
            )}
          </ScrollView>
          </KeyboardAvoider>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const EXIT_REASONS: Array<{ id: string; label: string }> = [
  { id: 'too_expensive',        label: "Too expensive" },
  { id: 'didnt_use_enough',     label: "I wasn't using it enough" },
  { id: 'missing_features',     label: "Missing features I need" },
  { id: 'switching_apps',       label: "Switching to a different app" },
  { id: 'tech_issues',          label: "Bugs or technical issues" },
  { id: 'other',                label: "Other reason" },
];

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
  rowDivider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md },

  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  legalLink: { fontSize: fontSize.xs, color: colors.mutedForeground, textDecorationLine: 'underline' },
  legalSep: { fontSize: fontSize.xs, color: colors.mutedForeground },
  versionText: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center', marginTop: 4 },
  versionHint: { fontSize: 10, color: colors.mutedForeground, textAlign: 'center', marginTop: 2, opacity: 0.7 },

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

  // ── Subtract-workout-burn toggle ──────────────────────────────────────────
  toggleBox: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: colors.muted,
    padding: 3,
    justifyContent: 'center',
  },
  toggleBoxOn: { backgroundColor: colors.foreground },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: colors.card,
    alignSelf: 'flex-start',
  },
  toggleKnobOn: { alignSelf: 'flex-end' },

  // ── Exit survey modal ──────────────────────────────────────────────────────
  exitContainer: { flex: 1, backgroundColor: colors.background },
  exitHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  exitEyebrow: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.2,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
  },
  exitTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    marginTop: 4,
  },
  exitSub: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    marginTop: 6,
    lineHeight: 20,
  },
  exitBody: { padding: spacing.lg, gap: 10, paddingBottom: spacing.xl },
  exitReason: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  exitReasonText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },
  exitFieldLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.8,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  exitFreeText: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    fontSize: fontSize.sm,
    color: colors.foreground,
    backgroundColor: colors.card,
    textAlignVertical: 'top',
  },
  exitFinePrint: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 16,
  },
  exitLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  exitLoadingText: { fontSize: fontSize.sm, color: colors.mutedForeground },
});
