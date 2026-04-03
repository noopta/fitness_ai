import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  ScrollView, Animated, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useEmbeddedPaymentElement,
  IntentConfiguration,
  EmbeddedPaymentElementConfiguration,
  IntentCreationCallbackParams,
} from '@stripe/stripe-react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';
import { paymentsApi } from '../lib/api';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PRICE_CAD = 11.99;
const PRICE_CENTS = 1199;

// ── Perks shown in the upgrade sheet ──────────────────────────────────────
const PERKS = [
  { icon: 'infinite-outline', text: 'Unlimited daily analyses' },
  { icon: 'barbell-outline', text: 'Full diagnostic interview + AI plan' },
  { icon: 'chatbubble-ellipses-outline', text: 'Unlimited AI coach chat' },
  { icon: 'stats-chart-outline', text: 'Strength profile & history' },
];

export function UpgradeSheet({ visible, onClose, onSuccess }: Props) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;

  // ── Animate in/out ──────────────────────────────────────────────────────
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

  // ── confirmHandler: called by the SDK when user taps "Subscribe" ────────
  // Sends confirmation token to our server → server creates subscription →
  // returns client_secret → SDK finalises the PaymentIntent.
  const handleConfirm = useCallback(async (
    _confirmationToken: any,
    intentCreationCallback: (params: IntentCreationCallbackParams) => void
  ) => {
    try {
      const data = await paymentsApi.createSubscriptionIntent();
      intentCreationCallback({ clientSecret: data.clientSecret });
    } catch (err: any) {
      intentCreationCallback({ error: { message: err?.message ?? 'Failed to start subscription' } } as any);
    }
  }, []);

  const intentConfig: IntentConfiguration = {
    mode: { amount: PRICE_CENTS, currencyCode: 'CAD' },
    confirmHandler: handleConfirm,
  };

  const elementConfig: EmbeddedPaymentElementConfiguration = {
    merchantDisplayName: 'Axiom Training',
    returnURL: 'axiom://stripe-redirect',
  };

  const { embeddedPaymentElementView, paymentOption, confirm, isLoaded } =
    useEmbeddedPaymentElement(
      visible ? intentConfig : null!,
      visible ? elementConfig : null!
    );

  // ── Confirm payment ─────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!paymentOption) return;
    setIsProcessing(true);
    try {
      const result = await confirm();
      if (result.status === 'completed') {
        onSuccess();
      } else if (result.status === 'failed') {
        setLoadingError(result.error?.message ?? 'Payment failed');
      }
      // canceled: user dismissed 3DS etc. — do nothing
    } catch {
      setLoadingError('An unexpected error occurred');
    } finally {
      setIsProcessing(false);
    }
  }, [confirm, paymentOption, onSuccess]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      {/* Dim backdrop */}
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

      {/* Bottom sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Upgrade to Pro</Text>
            <Text style={styles.subtitle}>
              ${PRICE_CAD.toFixed(2)} CAD / month · Cancel anytime
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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

          {/* Error banner */}
          {loadingError && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
              <Text style={styles.errorText}>{loadingError}</Text>
            </View>
          )}

          {/* Payment Element */}
          <View style={styles.paymentSection}>
            <Text style={styles.paymentLabel}>Payment method</Text>

            {/* Keep in render tree for Android init — control visibility with opacity */}
            <View style={{ opacity: isLoaded ? 1 : 0 }}>
              {embeddedPaymentElementView}
            </View>
            {!isLoaded && (
              <View style={styles.paymentLoading}>
                <ActivityIndicator color={colors.mutedForeground} />
              </View>
            )}
          </View>

          {/* Subscribe button */}
          <TouchableOpacity
            style={[
              styles.subscribeBtn,
              (!paymentOption || isProcessing) && styles.subscribeBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!paymentOption || isProcessing}
            activeOpacity={0.85}
          >
            {isProcessing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.subscribeBtnText}>
                Subscribe · ${PRICE_CAD.toFixed(2)}/mo
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.legal}>
            By subscribing you agree to our Terms of Use. Subscriptions auto-renew monthly.
            Manage or cancel anytime in Settings.
          </Text>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
  paymentSection: {
    gap: 8,
  },
  paymentLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paymentLoading: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscribeBtn: {
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  subscribeBtnDisabled: {
    opacity: 0.45,
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
});
