import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, Animated, Easing, Dimensions, TouchableOpacity, Platform, Linking, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COPY, DX } from '@axiom/diagnostic-core';
import { useProPurchase } from '../../components/UpgradeSheet';
import { Analytics } from '../../lib/analytics';

const C = DX.color;
const [x1, y1, x2, y2] = DX.motion.sheetEasing;

interface Props {
  visible: boolean;
  source: 'diagnostic_limit' | 'diagnostic_report';
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Bottom sheet, radius 24 top, scrim rgba(0,0,0,.5), 320ms slide on
 * cubic-bezier(.16,1,.3,1). Store purchase is primary, card secondary,
 * restore / terms / privacy in the footer. Tap the scrim to dismiss.
 *
 * Purchase paths are the app's existing, verified ones (useProPurchase).
 */
export function DiagnosticPaywall({ visible, source, onClose, onSuccess }: Props) {
  const insets = useSafeAreaInsets();
  const height = Dimensions.get('window').height;
  const slide = useRef(new Animated.Value(height)).current;
  const scrim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) Analytics.paywallViewed(source);
    const easing = Easing.bezier(x1, y1, x2, y2);
    Animated.parallel([
      Animated.timing(slide, { toValue: visible ? 0 : height, duration: DX.motion.sheetMs, easing, useNativeDriver: true }),
      Animated.timing(scrim, { toValue: visible ? 1 : 0, duration: DX.motion.sheetMs, easing, useNativeDriver: true }),
    ]).start();
  }, [visible, slide, scrim, height, source]);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.scrim, opacity: scrim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel={COPY.close} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 20, transform: [{ translateY: slide }] }]}>
        {visible ? <PaywallBody onClose={onClose} onSuccess={onSuccess} source={source} /> : null}
      </Animated.View>
    </Modal>
  );
}

function PaywallBody({ onClose, onSuccess, source }: { onClose: () => void; onSuccess: () => void; source: string }) {
  const p = useProPurchase(onClose, onSuccess);
  const storeLabel = Platform.OS === 'android' ? 'Subscribe with Google Play' : 'Subscribe with Apple';
  const busy = p.iapPurchasing || p.iapLoading || p.stripeConfirming;
  const message = p.iapError ?? p.restoreMsg;

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.handle} />
      <View style={styles.titleRow}>
        <Text style={styles.title}>{COPY.paywallTitle}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel={COPY.close}>
          <Ionicons name="close" size={22} color={C.muted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.promise}>{COPY.paywallPromise}</Text>
      <Text style={styles.price}>{COPY.freeMonthFine} · then {p.displayPrice}/mo</Text>

      {Platform.OS !== 'web' ? (
        <TouchableOpacity
          style={[styles.primary, (busy || !p.product) && { opacity: DX.send.disabledOpacity }]}
          disabled={busy || !p.product}
          onPress={() => { Analytics.upgradeTapped(source); void p.handleNativeSubscribe(); }}
          accessibilityRole="button"
        >
          {p.iapPurchasing || p.iapLoading ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <>
              <Ionicons name={Platform.OS === 'android' ? 'logo-google-playstore' : 'logo-apple'} size={18} color={C.white} />
              <Text style={styles.primaryText}>{storeLabel}</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.secondary, p.stripeConfirming && { opacity: DX.send.disabledOpacity }]}
        disabled={p.stripeConfirming}
        onPress={() => { Analytics.upgradeTapped(source); void (p.stripeOpened ? p.handleStripeConfirm() : p.handleStripeCheckout()); }}
        accessibilityRole="button"
      >
        <Ionicons name="card-outline" size={18} color={C.body} />
        <Text style={styles.secondaryText}>{p.stripeOpened ? "I've completed payment" : COPY.payByCard}</Text>
      </TouchableOpacity>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.footer}>
        <TouchableOpacity onPress={() => void p.handleRestore()} disabled={p.restoring} hitSlop={8}>
          <Text style={styles.footerLink}>{p.restoring ? 'Restoring…' : COPY.restore}</Text>
        </TouchableOpacity>
        <Text style={styles.footerDot}>·</Text>
        <TouchableOpacity onPress={() => Linking.openURL('https://axiomtraining.io/terms').catch(() => {})} hitSlop={8}>
          <Text style={styles.footerLink}>{COPY.terms}</Text>
        </TouchableOpacity>
        <Text style={styles.footerDot}>·</Text>
        <TouchableOpacity onPress={() => Linking.openURL('https://axiomtraining.io/privacy').catch(() => {})} hitSlop={8}>
          <Text style={styles.footerLink}>{COPY.privacy}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.white,
    borderTopLeftRadius: DX.sheetRadius,
    borderTopRightRadius: DX.sheetRadius,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.border },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.6, color: C.ink },
  promise: { fontSize: 14, lineHeight: 20, color: C.body },
  price: { fontSize: 13, fontWeight: '600', color: C.muted },
  primary: {
    minHeight: 52, borderRadius: 999, backgroundColor: C.ink, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { color: C.white, fontSize: 16, fontWeight: '600' },
  secondary: {
    minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: C.border, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  secondaryText: { color: C.body, fontSize: 16, fontWeight: '600' },
  message: { fontSize: 13, color: C.muted, textAlign: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingTop: 4 },
  footerLink: { fontSize: 13, fontWeight: '500', color: C.muted },
  footerDot: { fontSize: 13, color: C.disabled },
});
