// Ask Anakin on the phone (design handoff §6.6): a conversation screen with
// starter cards, streamed answers and a composer with a scope picker. Threads
// and the questions that run every morning live behind a header button.

import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { List } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  COPY, anakinMessagePath, queryKeys,
  type AnakinEvent, type AnakinMessage, type AnakinScope, type MeResponse,
} from '@axiom/personal-training-core';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { AnakinThreadsSheet } from './AnakinThreadsSheet';
import { AssistantTurn, UserTurn, type Turn } from './AnakinTurns';
import { ptApi, streamEvents } from './api';
import { Eyebrow, MAX_FONT_SCALE, Notice, TAB_PATH, clientPath } from './components';
import { ActionButton, PickerField, TextArea } from './controls';
import { Screen } from './Screen';
import { OptionSheet, type Option } from './Sheet';

const SCOPES: Option<AnakinScope>[] = (['all', 'new', 'support'] as AnakinScope[]).map((value) => ({ value, label: COPY.anakin.scopes[value] }));
const RENDERED: AnakinEvent['type'][] = ['answer', 'clarify', 'drafts', 'error'];

/** A stored message keeps every event of its turn; the one to show is the first that renders. */
const shownEvent = (m: AnakinMessage) => m.events.find((e) => RENDERED.includes(e.type)) ?? m.events[0];

export function AnakinScreen({ me }: { me: MeResponse }) {
  const router = useRouter();
  const qc = useQueryClient();

  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<AnakinScope>('all');
  const [busy, setBusy] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const list = useRef<FlatList<Turn>>(null);
  const [failedThread, setFailedThread] = useState<string | null>(null);
  // Guards a slow thread load, or a stream still running, against the trainer having moved on.
  const loadToken = useRef(0);

  const openThread = useCallback((id: string) => {
    const token = ++loadToken.current;
    setThreadsOpen(false);
    setFailedThread(null);
    setThreadId(id);
    setTurns([{ key: `load-${id}`, role: 'assistant', text: '', pending: true }]);
    ptApi.anakinThread(id).then((t) => {
      if (token !== loadToken.current) return;
      let lastQuestion = '';
      setTurns(t.messages.map((m) => {
        if (m.role === 'user') lastQuestion = m.text;
        return { key: m.id, role: m.role, text: m.text, event: shownEvent(m), question: lastQuestion };
      }));
    }).catch(() => {
      if (token === loadToken.current) { setTurns([]); setFailedThread(id); }
    });
  }, []);

  const newQuestion = useCallback(() => {
    loadToken.current += 1;
    setThreadsOpen(false);
    setFailedThread(null);
    setThreadId(null);
    setTurns([]);
  }, []);

  const ask = useCallback((question: string, clarifyChoice?: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const key = `a-${Date.now()}`;
    const token = loadToken.current;
    setBusy(true);
    setFailedThread(null);
    setText('');
    setTurns((prev) => [
      ...prev,
      ...(clarifyChoice ? [] : [{ key: `u-${Date.now()}`, role: 'user' as const, text: q }]),
      { key, role: 'assistant', text: '', pending: true, question: q },
    ]);
    const patch = (p: Partial<Turn>) => setTurns((prev) => prev.map((t) => (t.key === key ? { ...t, ...p } : t)));
    let current = threadId;
    let answered = false;

    streamEvents<AnakinEvent>(
      anakinMessagePath(threadId),
      { method: 'POST', body: JSON.stringify({ text: q, scope, ...(clarifyChoice ? { clarifyChoice } : {}) }) },
      (e) => {
        if (e.type === 'thread') { if (!current && token === loadToken.current) { current = e.threadId; setThreadId(e.threadId); } }
        else if (e.type === 'status') patch({ status: e.text });
        else if (e.type === 'answer' || e.type === 'clarify' || e.type === 'drafts' || e.type === 'error') { answered = true; patch({ event: e, pending: false }); }
      },
    )
      // A stream that ends with nothing to show must not leave the turn thinking forever.
      .then(() => { if (!answered) patch({ event: { type: 'error', message: COPY.anakin.failed }, pending: false }); })
      .catch(() => patch({ event: { type: 'error', message: COPY.anakin.failed }, pending: false }))
      .finally(() => { setBusy(false); void qc.invalidateQueries({ queryKey: queryKeys.anakinThreads }); });
  }, [busy, qc, scope, threadId]);

  const onClarify = useCallback((turn: Turn, choice: string) => {
    setTurns((prev) => prev.map((t) => (t.key === turn.key ? { ...t, chosen: choice } : t)));
    ask(turn.question ?? '', choice);
  }, [ask]);

  const openClient = useCallback((clientId: string) => router.navigate(clientPath(clientId) as any), [router]);
  const applyFilter = useCallback((messageId: string) => {
    if (!threadId) return;
    router.navigate({ pathname: TAB_PATH.clients, params: { anakin: `${threadId}:${messageId}` } } as any);
  }, [router, threadId]);

  const starters = (
    <View style={styles.empty}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.heading}>{COPY.anakin.heading}</Text>
      {COPY.anakin.starters.map((s) => (
        <Pressable key={s.text} onPress={() => ask(s.text)} disabled={busy} accessibilityRole="button" accessibilityLabel={`${s.category}. ${s.text}`} style={({ pressed }) => [styles.starter, pressed && styles.pressed]}>
          <Eyebrow>{s.category}</Eyebrow>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.starterText}>{s.text}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Screen
      me={me}
      title={COPY.anakin.title}
      active="anakin"
      headerAction={(
        <Pressable onPress={() => setThreadsOpen(true)} hitSlop={4} accessibilityRole="button" accessibilityLabel={COPY.anakin.threads} style={styles.headerButton}>
          <List size={22} color={colors.foreground} />
        </Pressable>
      )}
    >
      <FlatList
        ref={list}
        style={styles.flex}
        data={turns}
        keyExtractor={(t) => t.key}
        renderItem={({ item }) => (item.role === 'user'
          ? <UserTurn text={item.text} />
          : <AssistantTurn turn={item} scope={scope} canFilter={!!threadId} onAsk={ask} onClarify={onClarify} onOpenClient={openClient} onApplyFilter={applyFilter} />)}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListEmptyComponent={failedThread
          ? <Notice alert action={<ActionButton variant="secondary" onPress={() => openThread(failedThread)}>{COPY.roster.retry}</ActionButton>}>{COPY.anakin.failed}</Notice>
          : starters}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        onContentSizeChange={() => { if (turns.length > 0) list.current?.scrollToEnd({ animated: false }); }}
      />

      <View style={styles.composer}>
        <TextArea
          value={text}
          onChangeText={setText}
          placeholder={COPY.anakin.placeholder}
          accessibilityLabel={COPY.anakin.placeholder}
          style={styles.input}
        />
        <View style={styles.composerRow}>
          <PickerField style={styles.scope} label={COPY.anakin.scope} value={COPY.anakin.scopes[scope]} onPress={() => setScopeOpen(true)} />
          <ActionButton disabled={busy || !text.trim()} onPress={() => ask(text)}>{COPY.anakin.send}</ActionButton>
        </View>
      </View>

      <OptionSheet visible={scopeOpen} onClose={() => setScopeOpen(false)} title={COPY.anakin.scope} options={SCOPES} value={scope} onSelect={setScope} />
      <AnakinThreadsSheet visible={threadsOpen} onClose={() => setThreadsOpen(false)} threadId={threadId} onNew={newQuestion} onOpenThread={openThread} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.82 },
  headerButton: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.md, paddingBottom: spacing.lg },
  gap: { height: spacing.lg },
  empty: { gap: 12, paddingTop: spacing.sm },
  heading: { fontSize: 22, lineHeight: 27, fontWeight: fontWeight.bold, letterSpacing: -0.4, color: colors.foreground, marginBottom: spacing.sm },
  starter: { padding: spacing.md, gap: 6, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  starterText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  composer: { padding: spacing.sm, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border, backgroundColor: colors.background },
  input: { minHeight: 44, maxHeight: 132 },
  composerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  scope: { flexShrink: 1, minWidth: 150 },
});
