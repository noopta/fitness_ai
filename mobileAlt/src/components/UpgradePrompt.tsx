import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight } from '../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';

const STRIPE_UPGRADE_URL = 'https://buy.stripe.com/28E9AU15CaIJgYQ5zD0Ba00';

interface UpgradePromptProps {
  userId?: string;
  reason?: string;
}

const FEATURES = [
  'Unlimited analyses',
  'AI Coach (Anakin)',
  'Nutrition & wellness tracking',
];

export function UpgradePrompt({ userId, reason }: UpgradePromptProps) {
  const handleUpgrade = () => {
    const url = `${STRIPE_UPGRADE_URL}?client_reference_id=${userId ?? ''}`;
    Linking.openURL(url).catch(() => {
      // Silently fail — user will see nothing happen rather than a crash
    });
  };

  return (
    <Card style={styles.card}>
      <CardHeader style={styles.header}>
        <View style={styles.iconWrapper}>
          <Ionicons name="star" size={28} color={colors.warning} />
        </View>
        <CardTitle style={styles.title}>Upgrade to Pro</CardTitle>
      </CardHeader>

      <CardContent style={styles.content}>
        <Text style={styles.reason}>
          {reason ?? 'Unlock unlimited analyses, AI coaching, and more.'}
        </Text>

        <View style={styles.featureList}>
          {FEATURES.map((feature, i) => (
            <View key={i} style={styles.featureRow}>
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={colors.success}
                style={styles.checkIcon}
              />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        <Button fullWidth onPress={handleUpgrade} style={styles.upgradeButton}>
          Upgrade Now
        </Button>
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    paddingBottom: spacing.xs,
  },
  iconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(245,158,11,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    textAlign: 'center',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  content: {
    alignItems: 'center',
    gap: spacing.md,
  },
  reason: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  featureList: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkIcon: {
    flexShrink: 0,
  },
  featureText: {
    fontSize: fontSize.base,
    color: colors.foreground,
    flex: 1,
  },
  upgradeButton: {
    marginTop: spacing.xs,
  },
});
