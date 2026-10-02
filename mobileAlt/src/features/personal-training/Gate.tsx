// Decides what a signed-in user sees at /personal-training before any client
// data is requested: the dashboard, practice setup, or a plain statement that
// the feature is not on for this account. Every state offers the way out to
// the athlete app, because trainer mode persists across launches.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COPY, PersonalTrainingApiError, type MeResponse } from '@axiom/personal-training-core';
import { AxiomLogo } from '../../components/ui/AxiomLogo';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { postAuthDestination } from '../../onboarding/formhook/postAuthRoute';
import { MAX_FONT_SCALE } from './components';
import { useCreatePractice, useMe } from './hooks';
import { setTrainerMode } from './mode';

/** Leave the trainer dashboard for the athlete app this account also has. */
export function useExitToMyTraining() {
  const router = useRouter();
  const { getLatestUser, getFeatures } = useAuth();
  return async () => {
    await setTrainerMode(false);
    router.replace((await postAuthDestination(getLatestUser(), getFeatures())) as any);
  };
}

function Centered({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  const exit = useExitToMyTraining();
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoider style={styles.centered}>
        <AxiomLogo size={32} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.title}>{title}</Text>
        {body ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>{body}</Text> : null}
        {children}
        <Button variant="ghost" onPress={exit} fullWidth>{COPY.exit.myTraining}</Button>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

function PracticeSetup() {
  const [name, setName] = useState('');
  const create = useCreatePractice();
  const valid = name.trim().length >= 2 && name.trim().length <= 80;
  return (
    <Centered title={COPY.setup.title} body={COPY.setup.body}>
      <Input
        label={COPY.setup.nameLabel}
        value={name}
        onChangeText={setName}
        maxLength={80}
        placeholder={COPY.setup.namePlaceholder}
        error={create.isError ? COPY.setup.failed : undefined}
        containerStyle={styles.field}
      />
      <Button onPress={() => create.mutate(name.trim())} disabled={!valid} loading={create.isPending} fullWidth>
        {COPY.setup.submit}
      </Button>
    </Centered>
  );
}

export function Gate({ children }: { children: (me: MeResponse) => React.ReactNode }) {
  const me = useMe();

  if (me.isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading} accessibilityLabel="Loading" accessibilityState={{ busy: true }}>
          <Skeleton width={160} height={24} />
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      </SafeAreaView>
    );
  }

  if (me.isError) {
    const notEnabled = me.error instanceof PersonalTrainingApiError && me.error.status === 404;
    return notEnabled
      ? <Centered title={COPY.unavailable.title} body={COPY.unavailable.body} />
      : (
        <Centered title={COPY.roster.loadFailed}>
          <Button variant="secondary" onPress={() => me.refetch()} fullWidth>{COPY.roster.retry}</Button>
        </Centered>
      );
  }

  if (!me.data.practice) return <PracticeSetup />;
  return <>{children(me.data)}</>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  loading: { padding: spacing.md, gap: spacing.md },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground, letterSpacing: -0.2 },
  body: { fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600 },
  field: { marginTop: spacing.sm },
});
