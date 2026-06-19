import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, Alert } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Ionicons } from '@expo/vector-icons';
import { Poster } from '../Poster';
import { Reveal } from '../motion/Reveal';
import { scene } from './SceneStyles';
import { s, WASHES } from '../theme';
import { PHOTOS } from '../assets/photos/manifest';
import { useAuth } from '../../context/AuthContext';
import { Analytics } from '../../lib/analytics';
import { GoogleLogo } from '../../components/ui/GoogleLogo';

interface Props {
  stepLabel?: string;
  onSignedIn: () => void;     // pager calls this after a successful sign-in
}

// Scene 07 — Sign in · Ember · scrim 0.84 (spec §11). Wires the two buttons
// to the existing AuthContext (Apple + Google), then routes via onSignedIn.
export function Scene07SignIn({ stepLabel, onSignedIn }: Props) {
  const { appleLogin, googleLogin } = useAuth();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
    }
    // 'login' is the closest existing enum value — we want the screen-shown
    // event to land in the existing auth-screen funnel
    Analytics.authScreenShown('login');
  }, []);

  async function handleApple() {
    if (appleBusy || googleBusy) return;
    setAppleBusy(true);
    try {
      await appleLogin();
      Analytics.login('apple');
      setSucceeded(true);
      onSignedIn();
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Sign in failed', e?.message ?? 'Please try again.');
      }
    } finally {
      setAppleBusy(false);
    }
  }

  async function handleGoogle() {
    if (appleBusy || googleBusy) return;
    setGoogleBusy(true);
    try {
      await googleLogin();
      Analytics.login('google');
      setSucceeded(true);
      onSignedIn();
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.message ?? 'Please try again.');
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <Poster
      wash="Ember"
      photo={PHOTOS.rackSmith}
      lx={0.50} ly={0.42}
      scrim={0.84}
      slug={stepLabel ?? 'axiom.fit/start'}
    >
      <Reveal index={0}>
        <View style={scene.eyebrowRow}>
          <View style={[scene.eyebrowTick, { backgroundColor: WASHES.Ember.accent }]} />
          <Text style={scene.eyebrowText}>Free to Start</Text>
        </View>
      </Reveal>
      <Reveal index={1}>
        <Text style={[scene.headline, { fontSize: s(50), lineHeight: s(50) * 0.98 }]}>
          Build your program.
        </Text>
      </Reveal>
      <Reveal index={2}>
        <Text style={[scene.body, { marginTop: s(14) }]}>
          Two minutes of intake. One plan that gets you stronger and leaner at once.
        </Text>
      </Reveal>
      <Reveal index={3}>
        <View style={signin.buttonCol}>
          {appleAvailable && (
            <TouchableOpacity style={signin.appleBtn} onPress={handleApple} activeOpacity={0.85}>
              {appleBusy ? (
                <ActivityIndicator color="#09090b" />
              ) : (
                <>
                  <Ionicons name="logo-apple" size={20} color="#09090b" />
                  <Text style={signin.appleLabel}>Continue with Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={signin.gmailBtn} onPress={handleGoogle} activeOpacity={0.85}>
            {googleBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <View style={signin.gTile}><GoogleLogo size={20} /></View>
                <Text style={signin.gmailLabel}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Reveal>
      <Reveal index={4}>
        {succeeded ? (
          <View style={signin.successPill}>
            <View style={signin.successDot} />
            <Text style={signin.successText}>
              Next: your 2-minute intake, then your program.
            </Text>
          </View>
        ) : (
          <Text style={signin.footer}>
            By continuing you agree to Axiom's{' '}
            <Text style={signin.footerEm}>Terms & Privacy.</Text>
          </Text>
        )}
      </Reveal>
    </Poster>
  );
}

const signin = StyleSheet.create({
  buttonCol: { marginTop: 22, gap: 10 },
  appleBtn: {
    height: 52, borderRadius: 14, backgroundColor: '#fff',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  appleLabel: { color: '#09090b', fontSize: 15.5, fontWeight: '600' },
  gmailBtn: {
    height: 52, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  // Transparent — the colored Google "G" sits directly on the button, no white tile.
  gTile: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  gmailLabel: { color: '#fff', fontSize: 15.5, fontWeight: '600' },
  footer: {
    marginTop: 14, textAlign: 'center', fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
  },
  footerEm: { color: 'rgba(255,255,255,0.82)' },
  successPill: {
    marginTop: 14,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
    alignSelf: 'flex-start',
  },
  successDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e',
    shadowColor: '#22c55e', shadowOpacity: 1, shadowRadius: 5,
  },
  successText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
});
