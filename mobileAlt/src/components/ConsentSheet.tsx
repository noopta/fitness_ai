// "Before we continue" — one-time Terms/Privacy + health-data consent.
//
// Shown after sign-in when /auth/me reports `consent.acceptedTermsAt` or
// `consent.healthConsentAt` as null. Health and fitness data (injuries, body
// video) is special-category data, so it gets its own explicit, unticked
// checkbox rather than riding on the Terms acceptance. Marketing is optional.
//
// Older backends don't send `consent` at all — then this renders nothing.
// Mounted once at the root (app/_layout.tsx), so it covers classic and v2.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, type ConsentState } from '../context/AuthContext';
import { authApi } from '../lib/api';
import { openExternal } from '../lib/openExternal';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';

const SITE = 'https://axiomtraining.io';

/** Accepted Terms older than the current ones (Oct 2026: §4 health screening, red flags, weight cutting). */
export function termsOutdated(consent: ConsentState | undefined): boolean {
  return !!consent?.acceptedTermsAt && !!consent.currentTermsVersion && consent.termsVersion !== consent.currentTermsVersion;
}

/** True when the backend reports consent and a required piece is missing — or the Terms changed since they agreed. */
export function consentPending(consent: ConsentState | undefined): boolean {
  return !!consent && (!consent.acceptedTermsAt || !consent.healthConsentAt || termsOutdated(consent));
}

function Check({ on, onPress, label, children }: { on: boolean; onPress: () => void; label: string; children: React.ReactNode }) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onPress} activeOpacity={0.7}
      accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.foreground : colors.mutedForeground} />
      <View style={{ flex: 1 }}>{children}</View>
    </TouchableOpacity>
  );
}

export function ConsentSheet() {
  const { user, loading, needsDobCheck, consent, refreshUser, logout } = useAuth();
  const [terms, setTerms] = useState(false);
  const [health, setHealth] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Per-user "already answered this session" — so a backend that records the
  // consent but doesn't echo it back can't trap the user in a loop.
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);

  useEffect(() => { setTerms(false); setHealth(false); setMarketing(false); }, [user?.id]);

  const visible = !loading && !!user && !needsDobCheck && answeredFor !== user.id && consentPending(consent);
  if (!visible) return null;

  const submit = async () => {
    if (!terms || !(health || healthDone) || busy) return;
    setBusy(true);
    try {
      await authApi.setConsent({ acceptedTerms: true, ...(healthDone ? {} : { healthConsent: true }), ...(updated ? {} : { marketingConsent: marketing }) });
      setAnsweredFor(user!.id);
      void refreshUser();
    } catch (e: any) {
      Alert.alert('Couldn’t save that', e?.message || 'Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const decline = () => Alert.alert(
    'Sign out?',
    'Axiom needs both to coach you. You can sign back in and agree any time.',
    [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void logout(); } }],
  );

  const link = (path: string) => () => { void openExternal(`${SITE}${path}`); };
  // Re-accepting updated Terms: health consent already given stays given.
  const updated = termsOutdated(consent);
  const healthDone = !!consent?.healthConsentAt;
  const ready = terms && (health || healthDone);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { /* required — not dismissible */ }}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>{updated ? 'We’ve updated our Terms' : 'Before we continue'}</Text>
          <Text style={styles.sub}>{updated
            ? 'New in section 4: what happens if you train with a symptom we flag (like pain down an arm or leg), and weight cutting before a weigh-in. Please read and agree to keep going.'
            : 'Two things we need your OK on. You can withdraw either later by deleting your account in Settings.'}</Text>

          <Check on={terms} onPress={() => setTerms((v) => !v)} label="I agree to the Terms of Use and Privacy Policy">
            <Text style={styles.checkText}>
              I agree to the{' '}
              <Text style={styles.link} onPress={link('/terms')}>Terms of Use</Text>
              {' '}and{' '}
              <Text style={styles.link} onPress={link('/privacy')}>Privacy Policy</Text>.
            </Text>
          </Check>

          {healthDone ? null : <Check on={health} onPress={() => setHealth((v) => !v)} label="I consent to Axiom processing my health and fitness data">
            <Text style={styles.checkText}>
              I consent to Axiom processing my health and fitness data, including injuries and body video, to coach me. See our{' '}
              <Text style={styles.link} onPress={link('/health-data')}>Consumer Health Data Privacy Policy</Text>.
            </Text>
          </Check>}

          {updated ? null : <Check on={marketing} onPress={() => setMarketing((v) => !v)} label="Optional: send me tips and product news by email">
            <Text style={styles.checkText}>
              <Text style={styles.optional}>Optional · </Text>Send me training tips and product news by email.
            </Text>
          </Check>}

          <TouchableOpacity style={[styles.cta, !ready && styles.ctaOff]} onPress={() => void submit()} disabled={!ready || busy} activeOpacity={0.85}
            accessibilityRole="button" accessibilityState={{ disabled: !ready || busy }}>
            {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={styles.ctaText}>Continue</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={decline} style={styles.declineRow} hitSlop={8}>
            <Text style={styles.declineText}>Not now — sign out</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  title: { fontSize: 28, fontWeight: fontWeight.bold, color: colors.foreground, letterSpacing: -0.6, marginBottom: 8 },
  sub: { fontSize: fontSize.base, color: colors.mutedForeground, lineHeight: 22, marginBottom: spacing.lg },
  checkRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  checkText: { fontSize: fontSize.base, color: colors.foreground, lineHeight: 22 },
  link: { textDecorationLine: 'underline', color: colors.foreground, fontWeight: fontWeight.semibold },
  optional: { color: colors.mutedForeground },
  cta: { backgroundColor: colors.foreground, borderRadius: radius.xl, paddingVertical: 17, alignItems: 'center', marginTop: spacing.lg },
  ctaOff: { opacity: 0.35 },
  ctaText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
  declineRow: { alignItems: 'center', paddingVertical: spacing.md },
  declineText: { fontSize: fontSize.sm, color: colors.mutedForeground, textDecorationLine: 'underline' },
});
