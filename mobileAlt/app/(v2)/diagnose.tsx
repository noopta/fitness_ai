// Diagnostic · v2 (handoff T-15). The same Ask pattern as onboarding: one
// question, its reason, and up to four rows; a 2 pt crimson line shows
// progress. Pause saves the place (every answer is already on the server);
// Home and Analyze show Continue →. Driven by the same controller as the
// classic conversation — numbers, accessories, the video and the verdict use
// its composer and report.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { LIFTS, composerView, headerView, type ThreadItem } from '@axiom/diagnostic-core';
import { v2, T } from '../../src/v2/theme';
import { Pressable } from '../../src/v2/primitives/Pressable';
import { Row } from '../../src/v2/primitives/Row';
import { TextAction } from '../../src/v2/primitives/TextAction';
import { Receipt } from '../../src/v2/primitives/Receipt';
import { ProgressHairline } from '../../src/v2/charts';
import { KeyboardAvoider } from '../../src/components/ui/KeyboardAvoider';
import { useUnits } from '../../src/context/UnitsContext';
import { useAuth } from '../../src/context/AuthContext';
import { useDiagnostic } from '../../src/diagnostic/useDiagnostic';
import { Composer } from '../../src/diagnostic/components/Composer';
import { ReportView } from '../../src/diagnostic/components/ReportView';
import { VerdictCard, LimitCard } from '../../src/diagnostic/components/ThreadItems';
import { DiagnosticPaywall } from '../../src/diagnostic/components/DiagnosticPaywall';
import { haptics } from '../../src/v2/haptics';
import { qk } from '../../src/v2/data';
import { askParts, progressFraction } from '@axiom/agent-ui-core';

export default function DiagnoseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ sessionId?: string; lift?: string }>();
  const { unit, setUnitPref } = useUnits();
  const { refreshUser } = useAuth();
  const { controller, state } = useDiagnostic(params.sessionId, unit === 'kg' ? 'kg' : 'lb');
  const [reportOpen, setReportOpen] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const liftPicked = useRef(false);

  // Opened from a lift page: that lift is the first answer.
  useEffect(() => {
    if (liftPicked.current || !params.lift || state.loadStatus !== 'ready' || state.stage !== 'lift') return;
    const want = String(params.lift).toLowerCase();
    const l = LIFTS.find((x) => x.name.toLowerCase() === want || x.short === want || want.includes(x.short));
    if (l) { liftPicked.current = true; controller.act({ type: 'lift', lift: l.id as never }); }
  }, [params.lift, state.loadStatus, state.stage, controller]);

  const pause = () => {
    haptics.select();
    void qc.invalidateQueries({ queryKey: qk.diagnostics });
    void qc.invalidateQueries({ queryKey: qk.trainingOverview });
    if (router.canGoBack()) router.back(); else router.replace('/(v2)' as any);
  };
  const view = composerView(state);
  const header = headerView(state);
  const thread: ThreadItem[] = state.thread ?? [];
  const lastAsk = [...thread].reverse().find((t) => t.kind === 'anakin') as Extract<ThreadItem, { kind: 'anakin' }> | undefined;
  const lastUser = [...thread].reverse().find((t) => t.kind === 'user') as Extract<ThreadItem, { kind: 'user' }> | undefined;
  const verdict = [...thread].reverse().find((t) => t.kind === 'verdict') as Extract<ThreadItem, { kind: 'verdict' }> | undefined;
  const limited = thread.some((t) => t.kind === 'limit') && view.mode === 'blocked';
  const { title, reason } = askParts(lastAsk?.text ?? '');

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <StatusBar style="dark" />
      <View style={styles.top}>
        <Pressable onPress={pause} hitSlop={10} accessibilityRole="button" accessibilityLabel="Pause — your place is saved"><Text style={[T.body, { color: v2.color.muted }]}>Pause</Text></Pressable>
        <Text style={[T.caption, T.num]}>{header.progress.replace(' / ', ' of ')}</Text>
      </View>
      <View style={{ marginTop: 10 }}><ProgressHairline fraction={progressFraction(header.progress)} /></View>

      <KeyboardAvoider style={{ flex: 1 }} iosOffset={insets.top + 48}>
        {state.loadStatus === 'loading' ? <View style={styles.center}><ActivityIndicator color={v2.color.muted} /></View>
          : state.loadStatus === 'failed' ? (
            <View style={styles.center}>
              <Text style={T.bodyMuted}>Couldn’t open this diagnostic.</Text>
              <TextAction onPress={() => router.replace({ pathname: '/(v2)/diagnose', params: state.sessionId ? { sessionId: state.sessionId } : {} } as any)} style={{ marginTop: 10 }}>Try again</TextAction>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 36, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              {verdict ? (
                <View>
                  <Text style={T.eyebrow}>Diagnosis</Text>
                  <View style={{ marginTop: 14 }}><VerdictCard verdict={verdict.verdict} animate={false} onOpen={() => setReportOpen(true)} /></View>
                  <TextAction primary style={{ marginTop: 24 }} onPress={() => setReportOpen(true)}>Open the report</TextAction>
                </View>
              ) : limited ? (
                <LimitCard animate={false} onUpgrade={() => setPaywall(true)} onLater={pause} />
              ) : (
                <View>
                  {title ? <Text style={T.read}>{title}</Text> : null}
                  {reason ? <Text style={[T.bodyMuted, { marginTop: 10 }]}>{reason}</Text> : null}
                  {view.mode === 'chips' ? (
                    <View style={{ marginTop: 26 }}>
                      {view.options.slice(0, 4).map((o, i, arr) => (
                        <Row key={o.id} name={o.label} value="→" last={i === arr.length - 1} onPress={view.disabled ? undefined : () => {
                          haptics.select();
                          if (state.stage === 'lift') controller.act({ type: 'lift', lift: o.id as never });
                          else controller.act({ type: 'answer', question: state.stage as never, optionId: o.id, text: o.label, flags: o.flags });
                        }} />
                      ))}
                      {view.options.length > 4 ? <Text style={[T.caption, { marginTop: 10 }]}>{view.options.slice(4).map((o) => o.label).join(' · ')} — type it below.</Text> : null}
                      {view.typeInstead ? <TextAction muted arrow={false} size={15} style={{ marginTop: 18 }} onPress={() => controller.setTypeInstead(true)}>Type it instead</TextAction> : null}
                    </View>
                  ) : null}
                </View>
              )}
            </ScrollView>
          )}
        {state.loadStatus === 'ready' && !verdict && !limited && view.mode !== 'chips' ? (
          <View style={{ paddingBottom: insets.bottom + 8 }}>
            <Composer view={view} controller={controller} onOpenReport={() => setReportOpen(true)} onDone={pause} onUnitChange={(u) => setUnitPref(u === 'kg' ? 'kg' : 'lbs')} />
          </View>
        ) : null}
        {lastUser && !verdict ? <View style={[styles.noted, { paddingBottom: insets.bottom + 12 }]}><Receipt verb="Noted" text={lastUser.text} animate={false} /></View> : null}
      </KeyboardAvoider>

      <Modal visible={reportOpen && !!verdict} animationType="fade" onRequestClose={() => setReportOpen(false)}>
        {verdict ? <ReportView verdict={verdict.verdict} onClose={() => setReportOpen(false)}
          onAddNumbers={controller.canAct({ type: 'addNumbers' }) ? () => { setReportOpen(false); controller.act({ type: 'addNumbers' }); } : undefined} /> : null}
      </Modal>
      <DiagnosticPaywall visible={paywall} source="diagnostic_limit" onClose={() => setPaywall(false)}
        onSuccess={() => { setPaywall(false); void refreshUser().then(() => controller.unblock()); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.white, paddingHorizontal: v2.space.gutter },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noted: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: v2.color.hairline, paddingTop: 10 },
});
