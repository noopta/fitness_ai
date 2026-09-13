import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DX, type Verdict } from '@axiom/diagnostic-core';
import { diagnosticApi } from '../../src/diagnostic/api';
import { ReportView } from '../../src/diagnostic/components/ReportView';
import { InkButton } from '../../src/diagnostic/components/primitives';
import { Analytics } from '../../src/lib/analytics';

/** A saved report opened from Home's Diagnostics list (modal presentation). */
export default function DiagnosticReportScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const v = await diagnosticApi.getReport(sessionId);
      setVerdict(v);
      Analytics.diagnosticVerdictViewed({ locked: false });
    } catch {
      setFailed(true);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  if (!verdict) {
    return (
      <View style={styles.center}>
        {failed ? (
          <>
            <Text style={styles.muted}>Couldn't open this report.</Text>
            <InkButton label="Retry" onPress={() => void load()} />
          </>
        ) : (
          <ActivityIndicator color={DX.color.ink} />
        )}
      </View>
    );
  }

  return (
    <ReportView
      verdict={verdict}
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      onAddNumbers={
        verdict.missingLifts.length
          ? () => router.replace({ pathname: '/diagnostic/conversation', params: { sessionId, action: 'addNumbers' } })
          : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: DX.color.white },
  muted: { fontSize: 15, color: DX.color.muted },
});
