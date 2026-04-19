import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Linking } from 'react-native';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  ScrollView, Animated, Dimensions, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { Analytics } from '../lib/analytics';
import {
  initIAP, fetchProProduct, purchaseProMonthly, verifyAppleReceipt,
  addPurchaseListener,
} from '../lib/iap';
import type { ProductSubscription, Purchase } from 'react-native-iap';

// ─── Constants ────────────────────────────────────────────────────────────────

const STRIPE_CHECKOUT_BASE = 'https://buy.stripe.com/28E9AU15CaIJgYQ5zD0Ba00';

// Fallback shown before StoreKit loads — must match the price set in App Store Connect
export const PRO_PRICE_FALLBACK = '$12.99';

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

  // ── Apple IAP state ──
  const [product, setProduct] = useState<ProductSubscription | null>(null);
  const [iapLoading, setIapLoading] = useState(true);
  const [iapPurchasing, setIapPurchasing] = useState(false);
  const [iapError, setIapError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // ── Stripe state ──
  const [stripeOpened, setStripeOpened] = useState(false);
  const [stripeConfirming, setStripeConfirming] = useState(false);

  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  // Initialise StoreKit and load the product (runs in background — doesn't block Stripe)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIapLoading(true);
      setIapError(null);
      const connected = await initIAP();
      const { product: p, error: fetchErr } = await fetchProProduct();
      if (!cancelled) {
        setProduct(p);
        if (fetchErr) setIapError(`StoreKit: ${fetchErr}`);
        setIapLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [retryCount]);

  // Listen for Apple purchase updates
  useEffect(() => {
    const remove = addPurchaseListener(
      async (purchase: Purchase) => {
        setIapPurchasing(true);
        try {
          await verifyAppleReceipt(purchase);
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

  const handleAppleSubscribe = useCallback(async () => {
    if (iapPurchasing || !product) return;
    setIapError(null);
    setIapPurchasing(true);
    Analytics.upgradeTapped('apple_iap');
    try {
      await purchaseProMonthly();
    } catch (err: any) {
      const code = err?.code ?? err?.responseCode;
      if (code !== 'E_USER_CANCELLED' && code !== 2) {
        setIapError(err?.message ?? 'Could not start purchase. Please try again.');
      }
      setIapPurchasing(false);
    }
  }, [iapPurchasing, product]);

  // ── Stripe handlers ──────────────────────────────────────────────────────────

  const handleStripeCheckout = useCallback(async () => {
    const url = user?.id
      ? `${STRIPE_CHECKOUT_BASE}?client_reference_id=${user.id}`
      : STRIPE_CHECKOUT_BASE;
    try {
      Analytics.upgradeTapped('stripe');
      await Linking.openURL(url);
      setStripeOpened(true);
    } catch {
      Alert.alert('Could not open browser', 'Please visit axiomtraining.io to upgrade.');
    }
  }, [user?.id]);

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

  const displayPrice = (product as any)?.displayPrice ?? (product as any)?.localizedPrice ?? PRO_PRICE_FALLBACK;

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      showsVerticalScrollIndicator={false}
    >
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

      {/* ── Stripe payment (primary) ─────────────────────────────────────────── */}
      <View style={styles.paymentSection}>
        <Text style={styles.paymentSectionLabel}>PAY WITH CARD</Text>

        {!stripeOpened ? (
          /* Initial Stripe button */
          <TouchableOpacity
            style={styles.stripeBtn}
            onPress={handleStripeCheckout}
            activeOpacity={0.85}
          >
            <Ionicons name="card-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.stripeBtnText}>Subscribe · {displayPrice}/mo</Text>
          </TouchableOpacity>
        ) : (
          /* After checkout opened — confirm return */
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

      {/* ── Apple IAP (secondary — available when ready) ─────────────────────── */}
      <View style={styles.paymentSection}>
        <View style={styles.appleSectionHeader}>
          <Text style={styles.paymentSectionLabel}>PAY WITH APPLE ID</Text>
          <View style={styles.comingSoonBadge}>
            <Text style={styles.comingSoonText}>Pending registration</Text>
          </View>
        </View>

        {/* Apple IAP error */}
        {iapError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
            <Text style={styles.errorText}>{iapError}</Text>
          </View>
        ) : null}

        {/* Product unavailable notice */}
        {!iapLoading && !product && !iapError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorText}>
                Not available. Make sure you're signed into the App Store, then tap Retry.
              </Text>
              <TouchableOpacity onPress={() => setRetryCount(c => c + 1)} style={styles.retryLink}>
                <Text style={styles.retryLinkText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.appleBtn, (iapPurchasing || iapLoading || !product) && styles.btnDisabled]}
          onPress={handleAppleSubscribe}
          disabled={iapPurchasing || iapLoading || !product}
          activeOpacity={0.85}
        >
          {iapPurchasing || iapLoading ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : (
            <View style={styles.appleBtnInner}>
              <Ionicons name="logo-apple" size={17} color={colors.foreground} style={{ marginRight: 6 }} />
              <Text style={styles.appleBtnText}>
                Subscribe · {displayPrice}/mo
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.legal}>
        Subscription renews monthly. Cancel anytime.{'\n'}
        Card payments processed securely by Stripe.{'\n'}
        <Text style={styles.legalLink} onPress={() => Linking.openURL('https://axiomtraining.io/terms').catch(() => {})}>Terms</Text>
        {'  ·  '}
        <Text style={styles.legalLink} onPress={() => Linking.openURL('https://axiomtraining.io/privacy').catch(() => {})}>Privacy</Text>
      </Text>
    </ScrollView>
  );
}

// ── Outer shell — Modal + slide animation ─────────────────────────────────────
export function UpgradeSheet({ visible, onClose, onSuccess }: Props) {
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: Dimensions.get('window').height,
        duration: 220,
        useNativeDriver: true,
      }).start();
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
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 34,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.lg,
  },

  // Perks
  perksCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  perkIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    flex: 1,
  },

  // Payment sections
  paymentSection: {
    gap: spacing.sm,
  },
  paymentSectionLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    letterSpacing: 0.8,
  },
  appleSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  comingSoonBadge: {
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  comingSoonText: {
    fontSize: 10,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },

  // Stripe button
  stripeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#635bff',
    borderRadius: radius.md,
    paddingVertical: 15,
  },
  stripeBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: '#fff',
  },
  stripeConfirmBox: {
    gap: spacing.sm,
  },
  stripeConfirmMsg: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  reopenLink: {
    alignSelf: 'center',
    paddingVertical: 4,
  },
  reopenLinkText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },

  // Apple button (secondary, muted when unavailable)
  appleBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.card,
  },
  appleBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appleBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },

  // Shared
  btnDisabled: { opacity: 0.5 },

  // Errors
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: '#ef4444',
    flex: 1,
  },
  retryLink: { marginTop: 6 },
  retryLinkText: {
    fontSize: fontSize.sm,
    color: '#ef4444',
    fontWeight: fontWeight.semibold,
    textDecorationLine: 'underline',
  },

  // Legal
  legal: {
    fontSize: 11,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 16,
  },
  legalLink: {
    fontSize: 11,
    color: colors.foreground,
    textDecorationLine: 'underline',
  },
});
