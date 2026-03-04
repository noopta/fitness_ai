import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/context/AuthContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';

export default function RegisterScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleRegister() {
    if (!name || !email || !password) return;
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await register(name, email, password);
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Registration Failed', err.message || 'Please try again.');
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
            <Text style={styles.title}>Create your account</Text>
            <View style={styles.subtitleRow}>
              <Text style={styles.subtitle}>Already have an account? </Text>
              <Link href="/(auth)/login">
                <Text style={styles.link}>Sign in</Text>
              </Link>
            </View>
          </View>

          <Card style={styles.card}>
            <Input
              label="Name"
              placeholder="Your name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />

            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              containerStyle={{ marginTop: 16 }}
            />

            <Input
              label="Password (min 8 chars)"
              placeholder="Enter a secure password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              containerStyle={{ marginTop: 16 }}
            />

            <Text style={styles.terms}>
              By creating an account, you agree to our Terms of Service and Privacy Policy.
            </Text>

            <Button
              onPress={handleRegister}
              disabled={!name || !email || !password}
              loading={submitting}
              style={{ marginTop: 24 }}
            >
              {submitting ? 'Creating account...' : 'Create account'}
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
  terms: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 16,
    lineHeight: 16,
  },
});
