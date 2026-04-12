import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Linking } from 'react-native';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  ScrollView, Animated, Dimensions, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';
import {
  initIAP, fetchProProduct, purchaseProMonthly, verifyAppleReceipt,
  addPurchaseListener,
} from '../lib/iap';
import type { ProductSubscription, Purchase } from 'react-native-iap';

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
  const [product, setProduct] = useState<ProductSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  // Initialise StoreKit and load the product
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const connected = await initIAP();
      console.log('[IAP] initIAP connected:', connected);
      const { product: p, error: fetchErr } = await fetchProProduct();
      if (!cancelled) {
        setProduct(p);
        if (fetchErr) setError(`StoreKit: ${fetchErr}`);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Listen for purchase updates from StoreKit
  useEffect(() => {
    const remove = addPurchaseListener(
      async (purchase: Purchase) => {
        // Purchase succeeded — verify with our backend
        setPurchasing(true);
        try {
          await verifyAppleReceipt(purchase);
          onClose();
          await new Promise<void>(resolve => setTimeout(resolve, 300));
          onSuccessRef.current();
        } catch (err: any) {
          setError(err?.message ?? 'Verification failed. Please contact support.');
        } finally {
          setPurchasing(false);
        }
      },
      (err) => {
        if ((err as any).code !== 'E_USER_CANCELLED') {
          setError(err.message ?? 'Purchase failed. Please try again.');
        }
        setPurchasing(false);
      },
    );
    return remove;
  }, [onClose]);

  const handleSubscribe = useCallback(async () => {
    if (purchasing || !product) return;
    setError(null);
    setPurchasing(true);
    try {
      await purchaseProMonthly();
      // purchaseUpdatedListener handles the rest
    } catch (err: any) {
      const code = err?.code ?? err?.responseCode;
      if (code !== 'E_USER_CANCELLED' && code !== 2) {
        setError(err?.message ?? 'Could not start purchase. Please try again.');
      }
      setPurchasing(false);
    }
  }, [purchasing, product]);

  // Derive display price from StoreKit product (localised, correct currency)
  // v14: displayPrice on iOS, localizedPrice as fallback for older builds
  const displayPrice = (product as any)?.displayPrice ?? (product as any)?.localizedPrice ?? '$12.99';

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

      {/* Error */}
      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Product unavailable notice */}
      {!loading && !product && !error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
          <Text style={styles.errorText}>
            Subscription unavailable. Make sure you're signed into the App Store and try again.
          </Text>
        </View>
      )}

      {/* Subscribe button */}
      <TouchableOpacity
        style={[styles.subscribeBtn, (purchasing || loading || !product) && styles.subscribeBtnDisabled]}
        onPress={handleSubscribe}
        disabled={purchasing || loading || !product}
        activeOpacity={0.85}
      >
        {purchasing || loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={styles.subscribeBtnInner}>
            <Ionicons name="logo-apple" size={17} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.subscribeBtnText}>
              Subscribe · {displayPrice}/mo
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <Text style={styles.legal}>
        Subscription auto-renews monthly. Cancel anytime in iOS Settings → Subscriptions.{'\n'}
        Payment charged to your Apple ID account at confirmation of purchase.{'\n'}
        <Text style={styles.legalLink} onPress={() => Linking.openURL('https://axiomtraining.io/terms').catch(() => {})}>Terms of Use</Text>
        {'  ·  '}
        <Text style={styles.legalLink} onPress={() => Linking.openURL('https://axiomtraining.io/privacy').catch(() => {})}>Privacy Policy</Text>
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
    maxHeight: '85%',
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
  subscribeBtn: {
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  subscribeBtnDisabled: {
    opacity: 0.6,
  },
  subscribeBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subscribeBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },
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
