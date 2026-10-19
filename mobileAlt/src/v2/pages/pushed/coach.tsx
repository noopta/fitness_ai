// You → Coach: working with a personal trainer.
//
// Not coached: join with the link or code a trainer sent (or an invite waiting
// for this account's email) — the same consent and Accept as the chat card.
// Coached: what the trainer can see, and Stop sharing (confirm sheet), which
// deactivates only this account's membership; nothing is deleted.
// Deep links axiom://personal-training/join/<token> and axiom://coach/join/<code>
// land here with the invite preloaded (app/+native-intent.ts).

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, type CoachingMembership, type InviteView } from '@axiom/personal-training-core';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { TextAction } from '../../primitives/TextAction';
import { Sheet } from '../../primitives/Sheet';
import { v2, T } from '../../theme';
import { haptics } from '../../haptics';
import { ptApi } from '../../../features/personal-training/api';

const consent = (trainer: string) =>
  `If you accept, ${trainer} will see your workouts, check-ins, body weight, program and the injuries you've listed, and can message you.`;

const SEES: [string, string][] = [
  ['Workouts', 'Every session you log'],
  ['Check-ins', 'Sleep, energy, mood, stress and their own questions'],
  ['Body weight', 'Your weigh-ins'],
  ['Program', 'What you are following and changes to it'],
  ['Injuries', 'The ones you have listed'],
  ['Messages', 'They can message you'],
];

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const UNUSABLE: Record<Exclude<InviteView['state'], 'open'>, string> = {
  expired: 'This invite has expired — ask your trainer for a new one.',
  used: 'This invite has already been used.',
  joined: 'You already joined with this invite.',
  revoked: 'This invite is no longer active.',
};

function errorText(e: any, fallback: string): string {
  if (e?.status === 403) return 'This invite was sent to a different email address. Sign in with that account, or ask your trainer for a new invite.';
  return e?.message && !/^HTTP \d/.test(e.message) ? e.message : fallback;
}

export function CoachPage({ params }: { params: Record<string, string> }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.coaching, queryFn: ptApi.coaching, retry: 1, staleTime: 30_000 });
  const [entry, setEntry] = useState('');
  const [preview, setPreview] = useState<InviteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'find' | 'accept' | 'leave' | null>(null);
  const [joinedLine, setJoinedLine] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<CoachingMembership | null>(null);

  const find = useCallback(async (input: string) => {
    const v = input.trim();
    if (!v) return;
    setBusy('find'); setError(null); setJoinedLine(null);
    try { setPreview((await ptApi.resolveInvite(v)).invite); haptics.light(); }
    catch (e) { setPreview(null); setError(errorText(e, 'Couldn’t find that invite — check the code and try again.')); }
    finally { setBusy(null); }
  }, []);

  // A deep link opened this page with an invite: show it straight away.
  const preload = params.token || params.code || '';
  useEffect(() => { if (preload) void find(preload); }, [preload, find]);

  const accept = async (view: InviteView) => {
    setBusy('accept'); setError(null);
    try {
      await ptApi.acceptInvite(view.token);
      haptics.success();
      setPreview(null); setEntry('');
      setJoinedLine(`You’re coached by ${view.trainerName} now. They’ll send your first check-in.`);
      await qc.invalidateQueries({ queryKey: queryKeys.coaching });
    } catch (e) { setError(errorText(e, 'Couldn’t join — try again.')); }
    finally { setBusy(null); }
  };

  const leave = async (m: CoachingMembership) => {
    setBusy('leave'); setError(null);
    try {
      await ptApi.leavePractice(m.practice.id);
      haptics.success();
      setLeaving(null);
      await qc.invalidateQueries({ queryKey: queryKeys.coaching });
    } catch (e) { setError(errorText(e, 'Couldn’t stop sharing — try again.')); setLeaving(null); }
    finally { setBusy(null); }
  };

  const coaching = q.data?.coaching ?? [];
  const pending = q.data?.pending ?? [];
  const coach = coaching[0] ?? null;

  const previewBlock = preview ? (
    <View style={styles.block}>
      <Eyebrow>Invite</Eyebrow>
      <Row name={preview.trainerName} sub={preview.practice.name} arrow={false} />
      {preview.state !== 'open' ? (
        <Text style={[T.body, styles.gap]}>{UNUSABLE[preview.state]}</Text>
      ) : preview.forViewer === false ? (
        <Text style={[T.body, styles.gap]}>This invite was sent to a different email address. Sign in with that account, or ask {preview.trainerName} for a new invite.</Text>
      ) : (
        <>
          <Text style={[T.body, styles.gap]}>{consent(preview.trainerName)}</Text>
          <Text style={[T.caption, { marginTop: 8 }]}>Open until {day(preview.expiresAt)}. You can stop sharing any time from this page.</Text>
          <View style={styles.actions}>
            <TextAction primary onPress={() => void accept(preview)} loading={busy === 'accept'}>Accept</TextAction>
            <TextAction muted arrow={false} onPress={() => setPreview(null)}>Not now</TextAction>
          </View>
        </>
      )}
    </View>
  ) : null;

  if (coach && !preview) {
    return (
      <PushedPage back="You" title="Coach" lead={`${coach.trainerName} · ${coach.practice.name}`} loading={q.isLoading}
        refreshing={q.isFetching} onRefresh={() => void q.refetch()}>
        {joinedLine ? <Text style={[T.body, styles.gap]}>{joinedLine}</Text> : null}
        <View style={styles.block}>
          <Eyebrow>What {coach.trainerName} can see</Eyebrow>
          <View style={{ marginTop: 8 }}>
            {SEES.map(([name, sub], i) => <Row key={name} name={name} sub={sub} arrow={false} last={i === SEES.length - 1} />)}
          </View>
          <Text style={[T.caption, { marginTop: 12 }]}>Sharing since {day(coach.joinedAt)}.</Text>
        </View>
        {coaching.length > 1 ? (
          <View style={styles.block}>
            <Eyebrow>Also sharing with</Eyebrow>
            {coaching.slice(1).map((m, i, arr) => <Row key={m.practice.id} name={m.trainerName} sub={m.practice.name} value="Stop" onPress={() => setLeaving(m)} last={i === arr.length - 1} />)}
          </View>
        ) : null}
        {error ? <Text style={[T.body, styles.error]}>{error}</Text> : null}
        <View style={styles.actions}>
          <TextAction muted arrow={false} onPress={() => setLeaving(coach)}>Stop sharing</TextAction>
        </View>
        <Sheet visible={!!leaving} onClose={() => setLeaving(null)} title={leaving ? `Stop sharing with ${leaving.trainerName}?` : undefined}
          sub="They stop seeing your training from now on. Nothing is deleted — your history stays yours, and a new invite reconnects you.">
          <View style={styles.actions}>
            <TextAction primary onPress={() => { if (leaving) void leave(leaving); }} loading={busy === 'leave'}>Stop sharing</TextAction>
            <TextAction muted arrow={false} onPress={() => setLeaving(null)}>Keep sharing</TextAction>
          </View>
        </Sheet>
      </PushedPage>
    );
  }

  return (
    <PushedPage back="You" title="Work with a trainer" lead="Your trainer sees what you log, checks in with you and can adjust your plan. Join with the invite they sent you."
      loading={q.isLoading && !preload} refreshing={q.isFetching} onRefresh={() => void q.refetch()}>
      {joinedLine ? <Text style={[T.body, styles.gap]}>{joinedLine}</Text> : null}
      {previewBlock}
      {pending.length && !preview ? (
        <View style={styles.block}>
          <Eyebrow>Waiting for you</Eyebrow>
          <View style={{ marginTop: 8 }}>
            {pending.map((p, i) => (
              <Row key={p.inviteId} name={p.trainerName} sub={`${p.practice.name} · open until ${day(p.expiresAt)}`} onPress={() => { setError(null); setPreview(p); }} last={i === pending.length - 1} />
            ))}
          </View>
        </View>
      ) : null}
      {!preview ? (
        <View style={styles.block}>
          <Eyebrow>Join with an invite</Eyebrow>
          <View style={styles.field}>
            <TextInput value={entry} onChangeText={(t) => { setEntry(t); setError(null); }} placeholder="Code or link, e.g. K7QM-3XPA"
              placeholderTextColor={v2.color.placeholder} autoCapitalize="characters" autoCorrect={false} returnKeyType="go"
              onSubmitEditing={() => void find(entry)} style={styles.input} cursorColor={v2.color.crimson} selectionColor={v2.color.crimson}
              accessibilityLabel="Invite code or link" />
          </View>
          <Text style={[T.caption, { marginTop: 8 }]}>Your trainer’s invite has a link and an eight-character code. Either works.</Text>
          <View style={styles.actions}>
            <TextAction primary onPress={() => void find(entry)} loading={busy === 'find'} disabled={!entry.trim()}>Find invite</TextAction>
          </View>
        </View>
      ) : null}
      {error ? <Text style={[T.body, styles.error]}>{error}</Text> : null}
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 28 },
  gap: { marginTop: 14 },
  field: { borderBottomWidth: 1, borderBottomColor: v2.color.ink, paddingBottom: 6, marginTop: 14 },
  input: { fontFamily: v2.font.semibold, fontSize: 20, color: v2.color.ink, padding: 0, letterSpacing: 0.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 22 },
  error: { marginTop: 16, color: v2.color.crimson },
});
