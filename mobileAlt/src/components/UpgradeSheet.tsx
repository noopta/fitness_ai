import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  ScrollView, Animated, Dimensions, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStripe } from '@stripe/stripe-react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';
import { paymentsApi } from '../lib/api';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from './ui/KeyboardDoneBar';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PRICE_CAD = 11.99;

const PERKS = [
  { icon: 'infinite-outline', text: 'Unlimited daily analyses' },
  { icon: 'barbell-outline', text: 'Full diagnostic interview + AI plan' },
  { icon: 'chatbubble-ellipses-outline', text: 'Unlimited AI coach chat' },
  { icon: 'stats-chart-outline', text: 'Strength profile & history' },
  { icon: 'nutrition-outline', text: 'Nutrition intelligence & tracking' },
];

// ── Inner content — only mounts when sheet is open ────────────────────────────
// Stripe hook (useStripe) lives here so it's never called when sheet is closed,
// preventing background SDK initialisation from affecting other tabs.
function PaymentSheetContent({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState<{ code: string; discountPercent: number | null } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hold refs so they're callable even after this component unmounts
  // (our modal is dismissed before presentPaymentSheet resolves)
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  const handleSubscribe = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setError(null);

    try {
      // 1. Create subscription on server (with optional promo code)
      const code = promoApplied?.code ?? (promoCode.trim() || undefined);
      const data = await paymentsApi.createSubscriptionIntent(code);

      // 2. If 100% discount made it free — already activated server-side
      if (data.alreadyActivated) {
        onClose();
        await new Promise<void>(resolve => setTimeout(resolve, 300));
        onSuccessRef.current();
        return;
      }

      // 3. Initialise the PaymentSheet with the client secret
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: data.clientSecret,
        merchantDisplayName: 'Axiom Training',
        returnURL: 'axiom://stripe-redirect',
        allowsDelayedPaymentMethods: false,
      });

      if (initError) {
        setError(initError.message);
        setIsProcessing(false);
        return;
      }

      // 4. Dismiss our sheet first so Stripe's sheet appears alone
      onClose();

      // 5. Give the dismiss animation time to complete (~220ms), then present
      await new Promise<void>(resolve => setTimeout(resolve, 300));

      const { error: presentError } = await presentPaymentSheet();

      if (!presentError) {
        // Success — onSuccess updates auth/tier in the parent
        onSuccessRef.current();
      } else if (presentError.code !== 'Canceled') {
        Alert.alert('Payment failed', presentError.message);
      }
      // Canceled = user swiped away Stripe sheet — do nothing
    } catch (err: any) {
      // If we haven't dismissed yet (error before onClose), show inline
      setError(err?.message ?? 'Something went wrong. Please try again.');
      setIsProcessing(false);
    }
  }, [isProcessing, promoCode, promoApplied, initPaymentSheet, presentPaymentSheet, onClose]);

  const handleApplyPromo = useCallback(async () => {
    const trimmed = promoCode.trim();
    if (!trimmed) return;
    setIsProcessing(true);
    setError(null);
    try {
      // Validate promo code by attempting to create the intent with it
      const data = await paymentsApi.createSubscriptionIntent(trimmed);
      // If we get here the code is valid (backend would 400 on invalid)
      setPromoApplied({ code: trimmed, discountPercent: data.discountPercent ?? null });
      setPromoCode('');
      // Immediately cancel this intent — we'll create a fresh one on Subscribe tap.
      // (The incomplete subscription will expire automatically.)
    } catch (err: any) {
      setError(err?.message ?? 'Invalid promo code.');
    } finally {
      setIsProcessing(false);
    }
  }, [promoCode]);

  const discountedPrice = promoApplied?.discountPercent
    ? (PRICE_CAD * (1 - promoApplied.discountPercent / 100)).toFixed(2)
    : null;

  return (
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

      {/* Promo code */}
      <View style={styles.promoSection}>
        <Text style={styles.promoLabel}>Promo code</Text>
        {promoApplied ? (
          <View style={styles.promoApplied}>
            <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            <Text style={styles.promoAppliedText}>
              {promoApplied.code}
              {promoApplied.discountPercent ? ` — ${promoApplied.discountPercent}% off` : ' applied'}
            </Text>
            <TouchableOpacity onPress={() => setPromoApplied(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle-outline" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.promoRow}>
            <TextInput
              style={styles.promoInput}
              placeholder="Enter code"
              placeholderTextColor={colors.mutedForeground}
              value={promoCode}
              onChangeText={setPromoCode}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleApplyPromo}
              inputAccessoryViewID={KEYBOARD_DONE_ID}
            />
            <TouchableOpacity
              style={[styles.promoApplyBtn, !promoCode.trim() && styles.promoApplyBtnDisabled]}
              onPress={handleApplyPromo}
              disabled={!promoCode.trim() || isProcessing}
              activeOpacity={0.8}
            >
              <Text style={styles.promoApplyBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Error */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Subscribe button */}
      <TouchableOpacity
        style={[styles.subscribeBtn, isProcessing && styles.subscribeBtnDisabled]}
        onPress={handleSubscribe}
        disabled={isProcessing}
        activeOpacity={0.85}
      >
        {isProcessing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={styles.subscribeBtnInner}>
            <Text style={styles.subscribeBtnText}>
              Subscribe ·{' '}
              {discountedPrice ? (
                <>
                  <Text style={styles.strikethrough}>${PRICE_CAD.toFixed(2)}</Text>
                  {` $${discountedPrice}`}
                </>
              ) : (
                `$${PRICE_CAD.toFixed(2)}`
              )}
              /mo
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <Text style={styles.legal}>
        Billed monthly in CAD. Cancel anytime in Settings.
      </Text>
    </ScrollView>
  );
}

// ── Outer shell — Modal + slide animation only ────────────────────────────────
// No Stripe hooks here. PaymentSheetContent mounts only when visible=true,
// so the Stripe SDK never runs in the background while other tabs are open.
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

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kavContainer}
        >
          <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
            <KeyboardDoneBar />
            <View style={styles.handle} />

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

            {visible && <PaymentSheetContent onClose={onClose} onSuccess={onSuccess} />}
          </Animated.View>
        </KeyboardAvoidingView>
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
  kavContainer: {
    width: '100%',
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

  // Promo code
  promoSection: {
    gap: 8,
  },
  promoLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  promoRow: {
    flexDirection: 'row',
    gap: 8,
  },
  promoInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    color: colors.foreground,
    backgroundColor: colors.muted,
  },
  promoApplyBtn: {
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  promoApplyBtnDisabled: {
    opacity: 0.4,
  },
  promoApplyBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },
  promoApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  promoAppliedText: {
    fontSize: fontSize.sm,
    color: '#15803d',
    fontWeight: fontWeight.medium,
    flex: 1,
  },

  // Error
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

  // Subscribe button
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
  strikethrough: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  legal: {
    fontSize: 11,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 16,
  },
});
