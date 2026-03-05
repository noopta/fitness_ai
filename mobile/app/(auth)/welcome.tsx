import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/constants/theme';
import { Button } from '../../src/components/ui/Button';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Logo + Branding */}
        <View style={styles.brandingSection}>
          <Image
            source={require('../../assets/axiom-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.appName}>Axiom</Text>
          <Text style={styles.tagline}>AI-powered strength diagnosis.</Text>
        </View>

        <View style={styles.spacer} />

        {/* CTA Buttons */}
        <View style={styles.actionsSection}>
          <Button
            variant="default"
            fullWidth
            size="lg"
            onPress={() => router.push('/(auth)/login')}
          >
            Sign In
          </Button>

          <Button
            variant="outline"
            fullWidth
            size="lg"
            onPress={() => router.push('/(auth)/register')}
            style={styles.createAccountButton}
          >
            Create Account
          </Button>
        </View>

        {/* Bottom tagline */}
        <Text style={styles.bottomTagline}>Your personal AI strength coach.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl * 1.5,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  brandingSection: {
    alignItems: 'center',
    gap: spacing.md,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 14,
  },
  appName: {
    fontSize: 28,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  spacer: {
    flex: 1,
  },
  actionsSection: {
    width: '100%',
    gap: spacing.sm + 4,
    marginBottom: spacing.xl,
  },
  createAccountButton: {
    marginTop: 0,
  },
  bottomTagline: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
