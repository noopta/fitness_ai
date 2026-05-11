import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Linking, Platform } from 'react-native';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  ScrollView, Animated, Dimensions, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import {
  initIAP as initAppleIAP,
  fetchProProduct as fetchAppleProProduct,
  purchaseProMonthly as purchaseAppleMonthly,
  verifyAppleReceipt,
  addPurchaseListener as addAppleListener,
  restorePurchases as restoreApple,
} from '../lib/iap';
import {
  initIAP as initGoogleIAP,
  fetchProProduct as fetchGoogleProProduct,
  purchaseProMonthly as purchaseGoogleMonthly,
  verifyGoogleReceipt,
  addPurchaseListener as addGoogleListener,
  restorePurchases as restoreGoogle,
} from '../lib/googleIap';
import type { ProductSubscription, Purchase } from 'react-native-iap';
import { Analytics } from '../lib/analytics';

const IS_ANDROID = Platform.OS === 'android';
const IS_IOS = Platform.OS === 'ios';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.airthreads.ai:4009/api';

export const PRO_PRICE_FALLBACK = '$9.99';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PERKS = [
  { icon: 'infinite-outline',              text: 'Unlimited daily analyses' },
  { icon: 'barbell-outline',               text: 'Full diagnostic interview + AI plan' },
  { icon: 'chatbubble-ellipses-outline',   text: 'Unlimited AI coach chat' },
  { icon: 'stats-chart-outline',           text: 'Strength profile & history' },
  { icon: 'nutrition-outline',             text: 'Nutrition intelligence & tracking' },
];

// ── Inner content — mounts only when sheet is open ────────────────────────────
function PaymentSheetContent({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user, refreshUser } = useAuth();

  // ── Native IAP state (Apple on iOS / Google Play on Android) ──
  const [product, setProduct] = useState<ProductSubscription | null>(null);
  const [iapLoading, setIapLoading] = useState(true);
  const [iapPurchasing, setIapPurchasing] = useState(false);
  const [iapError, setIapError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // ── Stripe state (iOS web fallback only — hidden on Android per Play policy) ──
  const [stripeOpened, setStripeOpened] = useState(false);
  const [stripeConfirming, setStripeConfirming] = useState(false);

  // ── Restore state ──
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  // Initialise the native billing connection for whichever store this is.
  // Android uses Play Billing; iOS uses StoreKit 2. Same shape, different SDK.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIapLoading(true);
      setIapError(null);
      if (IS_IOS) {
        await initAppleIAP();
        const { product: p, error: fetchErr } = await fetchAppleProProduct();
        if (!cancelled) {
          setProduct(p);
          if (fetchErr) setIapError(`StoreKit: ${fetchErr}`);
          setIapLoading(false);
        }
      } else if (IS_ANDROID) {
        await initGoogleIAP();
        const { product: p, error: fetchErr } = await fetchGoogleProProduct();
        if (!cancelled) {
          setProduct(p);
          if (fetchErr) setIapError(`Play Billing: ${fetchErr}`);
          setIapLoading(false);
        }
      } else {
        // Web fallback — no native IAP available
        if (!cancelled) setIapLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [retryCount]);

  // Listen for purchase updates from whichever store this platform uses.
  useEffect(() => {
    const addListener = IS_ANDROID ? addGoogleListener : addAppleListener;
    const verify = IS_ANDROID ? verifyGoogleReceipt : verifyAppleReceipt;
    if (!IS_IOS && !IS_ANDROID) return;
    const remove = addListener(
      async (purchase: Purchase) => {
        setIapPurchasing(true);
        try {
          await verify(purchase);
          Analytics.upgradeCompleted();
          onClose();
          await new Promise<void>(resolve => setTimeout(resolve, 300));
          onSuccessRef.current();
        } catch (err: any) {
          setIapError(err?.message ?? 'Verification failed. Please contact support.');
        } finally {
          setIapPurchasing(false);
        }
      },
      (err) => {
        if ((err as any).code !== 'E_USER_CANCELLED') {
          setIapError(err.message ?? 'Purchase failed. Please try again.');
        }
        setIapPurchasing(false);
      },
    );
    return remove;
  }, [onClose]);

  const handleNativeSubscribe = useCallback(async () => {
    if (iapPurchasing || !product) return;
    Analytics.upgradeTapped(IS_ANDROID ? 'google_play' : 'apple_iap');
    setIapError(null);
    setIapPurchasing(true);
    try {
      if (IS_ANDROID) await purchaseGoogleMonthly(product);
      else await purchaseAppleMonthly();
    } catch (err: any) {
      const code = err?.code ?? err?.responseCode;
      if (code !== 'E_USER_CANCELLED' && code !== 2) {
        setIapError(err?.message ?? 'Could not start purchase. Please try again.');
      }
      setIapPurchasing(false);
    }
  }, [iapPurchasing, product]);

  const handleStripeCheckout = useCallback(async () => {
    Analytics.upgradeTapped('stripe');
    try {
      const res = await fetch(`${API_BASE}/payments/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok || !d.url) throw new Error(d.error || 'Could not create checkout session');
      await Linking.openURL(d.url);
      setStripeOpened(true);
    } catch {
      Alert.alert('Could not open browser', 'Please visit axiomtraining.io to upgrade.');
    }
  }, []);

  const handleStripeConfirm = useCallback(async () => {
    setStripeConfirming(true);
    try {
      await refreshUser();
      Analytics.upgradeCompleted();
      onClose();
      await new Promise<void>(resolve => setTimeout(resolve, 300));
      onSuccessRef.current();
    } catch {
      Alert.alert('Could not verify', 'If your payment completed, please close and reopen the app.');
    } finally {
      setStripeConfirming(false);
    }
  }, [refreshUser, onClose]);

  const handleRestore = useCallback(async () => {
    setRestoring(true);
    setRestoreMsg(null);
    try {
      const restore = IS_ANDROID ? restoreGoogle : restoreApple;
      const restored = await restore();
      if (restored) {
        Analytics.upgradeCompleted();
        onClose();
        await new Promise<void>(resolve => setTimeout(resolve, 300));
        onSuccessRef.current();
      } else {
        setRestoreMsg(IS_ANDROID
          ? 'No previous purchase found for this Google account.'
          : 'No previous purchase found for this Apple ID.');
      }
    } catch (err: any) {
      setRestoreMsg(err?.message ?? 'Restore failed. Please try again.');
    } finally {
      setRestoring(false);
    }
  }, [onClose]);

  const displayPrice = (product as any)?.displayPrice ?? (product as any)?.localizedPrice ?? PRO_PRICE_FALLBACK;

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      {/* Perks */}
      <View style={styles.perksCard}>
        {PERKS.map((perk) => (
          <View key={perk.text} style={styles.perkRow}>
            <View style={styles.perkIcon}>
              <Ionicons name={perk.icon as any} size={16} color={colors.foreground} />
            </View>
            <Text style={styles.perkText}>{perk.text}</Text>
          </View>
        ))}
      </View>

      {/* ── Stripe payment — iOS only.
            Google Play policy requires Play Billing for digital subscriptions;
            offering Stripe on Android would get the app rejected. ── */}
      {IS_IOS && (
        <View style={styles.paymentSection}>
          <Text style={styles.paymentSectionLabel}>PAY WITH CARD</Text>

          {!stripeOpened ? (
            <TouchableOpacity style={styles.stripeBtn} onPress={handleStripeCheckout} activeOpacity={0.85}>
              <Ionicons name="card-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.stripeBtnText}>Subscribe · CA$12.99/mo</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.stripeConfirmBox}>
              <Text style={styles.stripeConfirmMsg}>
                Complete payment in the browser, then tap below to activate your account.
              </Text>
              <TouchableOpacity
                style={[styles.stripeBtn, stripeConfirming && styles.btnDisabled]}
                onPress={handleStripeConfirm}
                disabled={stripeConfirming}
                activeOpacity={0.85}
              >
                {stripeConfirming ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.stripeBtnText}>I've completed payment</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={handleStripeCheckout} style={styles.reopenLink}>
                <Text style={styles.reopenLinkText}>Reopen checkout</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Native store IAP — Apple on iOS, Google Play on Android ── */}
      {(iapLoading || product || iapError) && (
        <View style={styles.paymentSection}>
          <Text style={styles.paymentSectionLabel}>
            {IS_ANDROID ? 'PAY WITH GOOGLE PLAY' : 'PAY WITH APPLE ID'}
          </Text>

          {iapError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
              <View style={{ flex: 1 }}>
                <Text style={styles.errorText}>{iapError}</Text>
                <TouchableOpacity onPress={() => { setIapError(null); setRetryCount(c => c + 1); }} style={styles.retryLink}>
                  <Text style={styles.retryLinkText}>Retry</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.appleBtn, (iapPurchasing || iapLoading || !product) && styles.btnDisabled]}
              onPress={handleNativeSubscribe}
              disabled={iapPurchasing || iapLoading || !product}
              activeOpacity={0.85}
            >
              {iapPurchasing || iapLoading ? (
                <ActivityIndicator color={colors.mutedForeground} />
              ) : (
                <View style={styles.appleBtnInner}>
                  <Ionicons
                    name={IS_ANDROID ? 'logo-google-playstore' : 'logo-apple'}
                    size={17}
                    color={colors.foreground}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.appleBtnText}>Subscribe · {displayPrice}/mo</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Restore Purchases — required by App Store guideline 3.1.1 */}
      <View style={styles.restoreSection}>
        <TouchableOpacity
          onPress={handleRestore}
          disabled={restoring}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {restoring
            ? <ActivityIndicator size="small" color={colors.mutedForeground} />
            : <Text style={styles.restoreText}>Restore previous purchase</Text>
          }
        </TouchableOpacity>
        {restoreMsg ? <Text style={styles.restoreMsgText}>{restoreMsg}</Text> : null}
      </View>

      <Text style={styles.legal}>
        Axiom Pro · auto-renews monthly. Cancel anytime.{'\n'}
        {IS_IOS ? 'Card payments processed securely by Stripe.\n' : ''}
        {IS_ANDROID ? 'Subscription managed by Google Play. Manage anytime in Play Store → Subscriptions.\n' : ''}
        <Text style={styles.legalLink} onPress={() => Linking.openURL('https://axiomtraining.io/terms').catch(() => {})}>Terms of Use</Text>
        {'  ·  '}
        <Text style={styles.legalLink} onPress={() => Linking.openURL('https://axiomtraining.io/privacy').catch(() => {})}>Privacy Policy</Text>
      </Text>
    </ScrollView>
  );
}

// ── Outer shell ───────────────────────────────────────────────────────────────
export function UpgradeSheet({ visible, onClose, onSuccess }: Props) {
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
    } else {
      Animated.timing(slideAnim, { toValue: Dimensions.get('window').height, duration: 220, useNativeDriver: true }).start();
    }
  }, [visible]);

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Upgrade to Pro</Text>
              <Text style={styles.subtitle}>Everything Axiom has to offer</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {visible && <PaymentSheetContent onClose={onClose} onSuccess={onSuccess} />}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 34,
  },
  handle: { width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },
  subtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },
  body: { padding: spacing.lg, gap: spacing.lg },

  perksCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  perkIcon: { width: 28, height: 28, borderRadius: radius.sm, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  perkText: { fontSize: fontSize.sm, color: colors.foreground, flex: 1 },

  paymentSection: { gap: spacing.sm },
  paymentSectionLabel: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.mutedForeground, letterSpacing: 0.8 },

  stripeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#635bff', borderRadius: radius.md, paddingVertical: 15 },
  stripeBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: '#fff' },
  stripeConfirmBox: { gap: spacing.sm },
  stripeConfirmMsg: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 },
  reopenLink: { alignSelf: 'center', paddingVertical: 4 },
  reopenLinkText: { fontSize: fontSize.sm, color: colors.mutedForeground, textDecorationLine: 'underline' },

  appleBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.card },
  appleBtnInner: { flexDirection: 'row', alignItems: 'center' },
  appleBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.medium, color: colors.foreground },

  btnDisabled: { opacity: 0.5 },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef2f2', borderRadius: radius.md, padding: spacing.md },
  errorText: { fontSize: fontSize.sm, color: '#ef4444', flex: 1 },
  retryLink: { marginTop: 6 },
  retryLinkText: { fontSize: fontSize.sm, color: '#ef4444', fontWeight: fontWeight.semibold, textDecorationLine: 'underline' },

  restoreSection: { alignItems: 'center', gap: 6 },
  restoreText: { fontSize: fontSize.sm, color: colors.mutedForeground, textDecorationLine: 'underline' },
  restoreMsgText: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center' },
  legal: { fontSize: 11, color: colors.mutedForeground, textAlign: 'center', lineHeight: 16 },
  legalLink: { fontSize: 11, color: colors.foreground, textDecorationLine: 'underline' },
});
