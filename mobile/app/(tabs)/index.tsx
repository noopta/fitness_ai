import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const features = [
    {
      icon: 'barbell' as const,
      title: 'AI Lift Diagnosis',
      description: 'Identify your weak points with data-driven analysis',
      color: colors.primary,
    },
    {
      icon: 'analytics' as const,
      title: 'Strength Profile',
      description: 'Visualize muscle group indices and imbalances',
      color: colors.green500,
    },
    {
      icon: 'list' as const,
      title: 'Smart Accessories',
      description: 'Get prescribed exercises ranked by impact',
      color: colors.amber500,
    },
    {
      icon: 'chatbubbles' as const,
      title: 'AI Coach',
      description: 'Training programs, nutrition, and 24/7 coaching',
      color: colors.purple500,
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.greeting}>
            Welcome{user?.name ? `, ${user.name}` : ''}
          </Text>
          <Text style={styles.tagline}>
            AI-Powered Lift Diagnostics
          </Text>
        </View>

        <Card style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="flash" size={32} color={colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Diagnose Your Weak Points</Text>
          <Text style={styles.heroDescription}>
            Using your current working weights and lift mechanics, our AI identifies exactly where
            you're struggling and prescribes targeted accessories.
          </Text>
          <Button
            onPress={() => router.push('/diagnostic/onboarding')}
            size="lg"
            style={{ marginTop: 20 }}
          >
            Start Diagnosis
          </Button>
        </Card>

        <Text style={styles.sectionTitle}>Features</Text>

        <View style={styles.featureGrid}>
          {features.map((feature, idx) => (
            <Card key={idx} style={styles.featureCard}>
              <View style={[styles.featureIcon, { backgroundColor: feature.color + '15' }]}>
                <Ionicons name={feature.icon} size={20} color={feature.color} />
              </View>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureDescription}>{feature.description}</Text>
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    color: colors.foreground,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  tagline: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 4,
  },
  heroCard: {
    alignItems: 'center',
    paddingVertical: 32,
    marginBottom: 32,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  heroDescription: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: 16,
  },
  featureGrid: {
    gap: 12,
  },
  featureCard: {
    padding: 16,
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  featureTitle: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    marginBottom: 4,
  },
  featureDescription: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
});
