import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  COPY,
  DX,
  composerView,
  headerView,
  type ThreadItem,
} from '@axiom/diagnostic-core';
import { useUnits } from '../../src/context/UnitsContext';
import { useAuth } from '../../src/context/AuthContext';
import { KeyboardAvoider } from '../../src/components/ui/KeyboardAvoider';
import { Analytics, trackScreen } from '../../src/lib/analytics';
import { useDiagnostic } from '../../src/diagnostic/useDiagnostic';
import { markDiagnosticFirstSeen } from '../../src/onboarding/diagnosticFirst';
import { Composer } from '../../src/diagnostic/components/Composer';
import { ReportView } from '../../src/diagnostic/components/ReportView';
import { DiagnosticPaywall } from '../../src/diagnostic/components/DiagnosticPaywall';
import { Monogram, InkButton } from '../../src/diagnostic/components/primitives';
import {
  AnakinBubble,
  LimitCard,
  TypingBubble,
  UserBubble,
  VerdictCard,
  VideoCard,
} from '../../src/diagnostic/components/ThreadItems';

const C = DX.color;

/**
 * Lift diagnostic — one message thread with Anakin (handoff §1). Every input
 * lives in the composer; the shared core's stage drives what it shows.
 *
 *   /diagnostic/conversation                      new diagnostic
 *   /diagnostic/conversation?sessionId=…          resume from Home
 *   /diagnostic/conversation?sessionId=…&action=addNumbers   re-score from a report
 */
export default function DiagnosticConversation() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string; action?: string }>();
  const { unit, setUnitPref } = useUnits();
  const { refreshUser } = useAuth();
  const { controller, state } = useDiagnostic(params.sessionId, unit === 'kg' ? 'kg' : 'lb');
  const [reportOpen, setReportOpen] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const listRef = useRef<FlatList<ThreadItem>>(null);
  const insets = useSafeAreaInsets();
  // Items already on screen when the thread (re)loads don't animate in.
  const [animateFrom, setAnimateFrom] = useState<number | null>(params.sessionId ? null : 0);
  const addNumbersDone = useRef(false);

  useEffect(() => { trackScreen('LiftDiagnostic'); }, []);

  useEffect(() => {
    if (animateFrom === null && state.loadStatus === 'ready') setAnimateFrom(state.thread.length);
  }, [animateFrom, state.loadStatus, state.thread.length]);

  // "Add the missing numbers" from a standalone report lands here.
  useEffect(() => {
    if (params.action === 'addNumbers' && !addNumbersDone.current && state.stage === 'verdict' && state.loadStatus === 'ready') {
      addNumbersDone.current = true;
      controller.act({ type: 'addNumbers' });
    }
  }, [params.action, state.stage, state.loadStatus, controller]);

  // Exit always lands on Home, where the hero offers Resume. It also ends the
  // first-run routing: the next cold start goes Home rather than into a fresh
  // thread next to the saved one.
  const exit = useCallback(() => {
    void markDiagnosticFirstSeen();
    router.replace('/(tabs)');
  }, [router]);

  const openReport = useCallback(() => {
    if (!state.verdict) return;
    Analytics.diagnosticVerdictViewed({ locked: false });
    setReportOpen(true);
  }, [state.verdict]);

  const onPurchased = useCallback(async () => {
    setPaywall(false);
    await refreshUser();
    // Purchase clears the daily-limit block and resumes at `ready`.
    controller.unblock();
  }, [controller, refreshUser]);

  const view = composerView(state);
  const header = headerView(state);
  const showTyping = header.typing && view.mode !== 'waiting';

  const renderItem = ({ item, index }: { item: ThreadItem; index: number }) => {
    const animate = animateFrom !== null && index >= animateFrom;
    switch (item.kind) {
      case 'anakin':
        return <AnakinBubble text={item.text} animate={animate} />;
      case 'user':
        return <UserBubble item={item} animate={animate} onRetry={() => controller.retry()} />;
      case 'video':
        return <VideoCard result={item.result} animate={animate} />;
      case 'verdict':
        return <VerdictCard verdict={item.verdict} animate={animate} onOpen={openReport} />;
      case 'limit':
        return <LimitCard animate={animate} onUpgrade={() => setPaywall(true)} onLater={exit} />;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={exit} hitSlop={12} accessibilityRole="button" accessibilityLabel="Exit to Home">
          <Ionicons name="close" size={24} color={C.ink} />
        </TouchableOpacity>
        <Monogram size={32} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{COPY.anakin}</Text>
          <Text style={styles.status}>{header.typing ? COPY.statusTyping : COPY.statusOnline}</Text>
        </View>
        <View style={styles.pill} accessibilityLabel={`Progress ${header.progress}`}>
          <Text style={styles.pillText}>{header.progress}</Text>
        </View>
      </View>

      {/* iOS offset = what sits above the avoider: safe area + the 57px header. */}
      <KeyboardAvoider style={{ flex: 1 }} iosOffset={insets.top + 57}>
        {state.loadStatus === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.ink} />
          </View>
        ) : state.loadStatus === 'failed' ? (
          <View style={styles.center}>
            <Text style={styles.loadFailed}>Couldn't open this diagnostic.</Text>
            <InkButton label={COPY.retry} onPress={() => router.replace({ pathname: '/diagnostic/conversation', params: { sessionId: state.sessionId } })} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={state.thread}
            keyExtractor={(t) => t.id}
            renderItem={renderItem}
            contentContainerStyle={styles.thread}
            ListFooterComponent={showTyping ? <TypingBubble /> : null}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          />
        )}
        {state.loadStatus === 'ready' ? (
          <Composer
            view={view}
            controller={controller}
            onOpenReport={openReport}
            onDone={exit}
            onUnitChange={(u) => setUnitPref(u === 'kg' ? 'kg' : 'lbs')}
          />
        ) : null}
      </KeyboardAvoider>

      <Modal visible={reportOpen && !!state.verdict} animationType="fade" onRequestClose={() => setReportOpen(false)}>
        {state.verdict ? (
          <ReportView
            verdict={state.verdict}
            onClose={() => setReportOpen(false)}
            onAddNumbers={
              controller.canAct({ type: 'addNumbers' })
                ? () => { setReportOpen(false); controller.act({ type: 'addNumbers' }); }
                : undefined
            }
          />
        ) : null}
      </Modal>

      {/* The only paywall in the flow: the daily limit (never on onboarding). */}
      <DiagnosticPaywall
        visible={paywall}
        source="diagnostic_limit"
        onClose={() => setPaywall(false)}
        onSuccess={() => void onPurchased()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  name: { fontSize: 15, fontWeight: '600', color: C.ink },
  status: { fontSize: 12, fontWeight: '500', color: C.muted },
  pill: { backgroundColor: C.surface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 12, fontWeight: '600', color: C.body2 },
  thread: { padding: 16, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  loadFailed: { fontSize: 15, color: C.muted },
});
