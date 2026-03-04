import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/context/AuthContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    if (!email || !password) return;
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Login Failed', err.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.title}>Sign in to Axiom</Text>
            <View style={styles.subtitleRow}>
              <Text style={styles.subtitle}>Don't have an account? </Text>
              <Link href="/(auth)/register">
                <Text style={styles.link}>Register</Text>
              </Link>
            </View>
          </View>

          <Card style={styles.card}>
            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Input
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              containerStyle={{ marginTop: 16 }}
            />

            <Button
              onPress={handleLogin}
              disabled={!email || !password}
              loading={submitting}
              style={{ marginTop: 24 }}
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  subtitleRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
  link: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  card: {
    gap: 0,
  },
});
