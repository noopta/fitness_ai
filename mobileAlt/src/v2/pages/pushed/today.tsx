// Today (handoff H-01), pushed from the session row on Home. The session with
// each exercise's video, recovery lines from the user's own sleep and food,
// and three text actions where chat used to be the only way:
//   Swap this workout (H-02) — a sheet; every option keeps the week's volume
//     and tapping one shows the Proposal before anything changes.
//   Life happened (H-03) — what's going on, how long, then the new week to approve.
//   Check in (H-04).
// Swap and Life happened run the same tools chat does (/coach/agent/cards/run).

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { swapOptions as coreSwapOptions, lifePlan, addDays, dowOf, type Card, type ToolOption, type LifeReason } from '@axiom/agent-ui-core';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { Pressable } from '../../primitives/Pressable';
import { TextAction } from '../../primitives/TextAction';
import { Sheet } from '../../primitives/Sheet';
import { StandaloneCard } from '../../chat/StandaloneCard';
import { useToday, useSchedule, useCheckins, useMeals, useExerciseVideo, useInvalidate } from '../../data';
import { useShellOptional } from '../../shell/ShellContext';
import { v2Api } from '../../api';
import { exName, sessionTitle, estimateMinutes, phaseShort } from '../../format';
import { todayStr } from '../../../lib/localDate';
import { haptics } from '../../haptics';

const C = v2.color;
const shortName = (s: any) => sessionTitle(s?.name ?? s?.day ?? 'Session').split(/[·—–/]/)[0].trim();
const mins = (s: any) => Number(s?.minutes) || estimateMinutes((s?.exercises ?? []).length) || null;
const scheme = (e: any) => `${e.sets ?? '—'} × ${e.reps ?? '—'}`;
const hm = (h: number) => `${Math.floor(h)} h${Math.round((h % 1) * 60) ? ` ${Math.round((h % 1) * 60)}` : ''}`;

export function TodayPage() {
  const router = useRouter();
  const today = useToday();
  const checkins = useCheckins();
  const meals = useMeals();
  const [sheet, setSheet] = useState<null | 'swap' | 'life'>(null);
  const t: any = today.data;
  const session = t?.todaySession ?? t?.session ?? null;
  const ex: any[] = session?.exercises ?? [];
  const date = todayStr();

  // Recovery reads only what's real: last night's sleep if they checked in, today's protein if they logged.
  const last = (checkins.data?.checkins ?? [])[0];
  const sleep = last && (last.date === date || last.date === addDays(date, -1)) ? Number(last.sleepHours) : null;
  const mealRows: any[] = meals.data?.meals ?? meals.data?.entries ?? (Array.isArray(meals.data) ? meals.data : []);
  const protein = mealRows.reduce((a, m) => a + (Number(m.proteinG) || 0), 0);
  const lead = useMemo(() => {
    if (!session) return t?.nextTrainingDay ? `A rest day. Next up: ${sessionTitle(t.nextTrainingDay)}.` : 'A rest day. I read these as recovery, not absence.';
    const first = ex[0] ? exName(ex[0]) : null;
    const slept = sleep != null ? (sleep >= 7 ? ` You slept ${hm(sleep)} — go as written.` : ` You slept ${hm(sleep)}, so stop a rep earlier on the top sets.`) : '';
    return `${first ? `${first} leads.` : ''}${slept}`.trim() || null;
  }, [session, ex, sleep, t?.nextTrainingDay]);
  const recovery: string[] = [];
  if (session) recovery.push(protein >= 40 ? `${Math.round(protein)} g protein so far — another 30–40 g within 2 h after.` : '30–40 g protein within 2 h after.');
  if (sleep != null) recovery.push(sleep < 7 ? `Last night was ${hm(sleep)}. Aim for 8 h tonight.` : `Keep the ${hm(sleep)} — same bedtime tonight.`);
  else recovery.push('Check in and I’ll plan around your sleep.');

  const meta = t ? `${dowOf(date)}${t.phaseName ? ` · ${phaseShort(t.phaseName)} ${t.weekNumber ?? ''}` : ''}`.trim() : null;
  return (
    <PushedPage back="Home" meta={meta} eyebrow="Today" title={session ? `${shortName(session)}${mins(session) ? ` · ${mins(session)} min` : ''}` : 'Rest'}
      lead={lead} loading={today.isLoading && !t} error={today.isError && !t ? 'Couldn’t load today.' : null} onRetry={() => void today.refetch()}
      cta={session ? { label: 'Begin', onPress: () => { haptics.light(); router.push('/(v2)/session' as any); } } : null}>
      {ex.map((e, i) => <ExerciseRow key={`${exName(e)}${i}`} e={e} day={shortName(session)} last={i === ex.length - 1} />)}
      <Eyebrow style={{ marginTop: ex.length ? 30 : 0 }}>Recovery</Eyebrow>
      <View style={{ marginTop: 6 }}>
        {recovery.map((r, i) => <Row key={i} name={r} last={i === recovery.length - 1} />)}
      </View>
      <View style={styles.actions}>
        {session ? <TextAction muted arrow={false} size={15} onPress={() => setSheet('swap')}>Swap this workout</TextAction> : null}
        <TextAction muted arrow={false} size={15} onPress={() => setSheet('life')}>Life happened</TextAction>
        <TextAction muted arrow={false} size={15} onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'checkin' } } as any)}>Check in</TextAction>
      </View>
      <SwapSheet visible={sheet === 'swap'} onClose={() => setSheet(null)} session={session} />
      <LifeSheet visible={sheet === 'life'} onClose={() => setSheet(null)} />
    </PushedPage>
  );
}

/** One exercise with its video thumbnail; tap for the exercise page (T-10). */
function ExerciseRow({ e, day, last }: { e: any; day: string; last: boolean }) {
  const router = useRouter();
  const name = exName(e);
  const video = useExerciseVideo(name);
  const thumb = video.data?.videoId ? `https://i.ytimg.com/vi/${video.data.videoId}/default.jpg` : null;
  return (
    <Row name={name} value={scheme(e)} last={last}
      leading={(
        <View style={styles.thumb}>
          {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <Text style={[styles.play, thumb ? { color: C.white } : null]}>▶</Text>
        </View>
      )}
      onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `exercise:${name}`, back: day, sets: String(e.sets ?? ''), reps: String(e.reps ?? ''), notes: String(e.notes ?? e.intensity ?? '') } } as any)} />
  );
}

// ─── H-02 Swap ───────────────────────────────────────────────────────────────

function SwapSheet({ visible, onClose, session }: { visible: boolean; onClose: () => void; session: any }) {
  const schedule = useSchedule();
  const shell = useShellOptional();
  const router = useRouter();
  const options = useMemo(() => (session ? coreSwapOptions(session, schedule.data?.weekDays ?? [], todayStr(), shortName, mins) : []), [session, schedule.data]);
  return (
    <ProposalFlow visible={visible} onClose={onClose} title="Swap today for…" sub="I’ll rebalance the rest of the week either way." options={options}
      onAsk={() => { onClose(); shell?.prefill(`Swap today's ${shortName(session).toLowerCase()} for `); router.replace('/(v2)' as any); }} />
  );
}

/** A sheet of options; tapping one asks the server for the proposal and shows its card in place. */
function ProposalFlow({ visible, onClose, title, sub, options, onAsk, footnote, alt }: {
  visible: boolean; onClose: () => void; title: string; sub?: string; options: ToolOption[]; onAsk?: () => void; footnote?: string;
  /** A second proposal offered under the card ("Push the program back instead"). */
  alt?: ToolOption | null;
}) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (o: ToolOption) => {
    setBusy(o.title); setError(null);
    try {
      const r = await v2Api.runTool(o.tool, o.input);
      if (r.cards[0]) { setCard(r.cards[0]); haptics.select(); } else setError('Nothing to change there.');
    } catch (e: any) { setError(e?.message ?? 'Couldn’t build that — try again.'); }
    setBusy(null);
  };
  const close = () => { setCard(null); setError(null); onClose(); };
  const applied = card?.state?.status === 'applied';
  return (
    <Sheet visible={visible} onClose={close} title={card ? undefined : title} sub={card ? undefined : sub}>
      {card ? (
        <View>
          <StandaloneCard key={card.id} card={card} onChange={(c) => { setCard(c); if (c.state?.status === 'applied') void invalidate.afterSchedule(); }} />
          <View style={styles.sheetFoot}>
            {applied ? <TextAction primary onPress={close}>Done</TextAction> : <TextAction muted arrow={false} size={15} onPress={() => setCard(null)}>← Other options</TextAction>}
            {!applied && alt ? <TextAction muted arrow={false} size={15} onPress={() => void run(alt)}>{alt.title}</TextAction> : null}
          </View>
        </View>
      ) : (
        <View>
          {options.map((o, i) => (
            <Row key={o.title} name={o.title} sub={o.sub} last={i === options.length - 1 && !onAsk} onPress={busy ? undefined : () => void run(o)}
              value={busy === o.title ? undefined : '→'} below={busy === o.title ? <ActivityIndicator style={{ alignSelf: 'flex-start', marginTop: 6 }} color={C.muted} /> : undefined} />
          ))}
          {onAsk ? <Row name="Ask Anakin instead" muted last onPress={onAsk} /> : null}
          {error ? <Text style={[T.caption, { color: C.crimson, marginTop: 10 }]}>{error}</Text> : null}
          {footnote ? <Text style={[T.caption, { marginTop: 14 }]}>{footnote}</Text> : null}
        </View>
      )}
    </Sheet>
  );
}

// ─── H-03 Life happened ──────────────────────────────────────────────────────

type Reason = { key: LifeReason; title: string; sub: string };
const REASONS: Reason[] = [
  { key: 'sick', title: 'Sick', sub: 'Rest until you’re better' },
  { key: 'travel', title: 'Travelling', sub: 'I’ll plan around the equipment you have' },
  { key: 'busy', title: 'Busy week', sub: 'Shorter sessions' },
  { key: 'injured', title: 'Injured', sub: 'I’ll ask where' },
  { key: 'break', title: 'I just need a break', sub: 'Up to 2 weeks' },
];
const LENGTHS = [{ label: 'Today', days: 1 }, { label: '2–3 days', days: 3 }, { label: 'A week', days: 7 }, { label: '2 weeks', days: 14 }];

function LifeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const shell = useShellOptional();
  const router = useRouter();
  const [reason, setReason] = useState<Reason | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const close = () => { setReason(null); setDays(null); onClose(); };
  const toChat = (m: string) => { close(); shell?.ask(m); router.replace('/(v2)' as any); };
  const pick = (r: Reason) => { haptics.select(); if (r.key === 'injured') { const p = lifePlan('injured', 1, todayStr()); if ('chat' in p) toChat(p.chat); return; } setReason(r); };
  const pickLen = (n: number) => {
    haptics.select();
    const p = lifePlan(reason!.key, n, todayStr());
    if ('chat' in p) { toChat(p.chat); return; }
    setDays(n);
  };
  if (reason && days != null) {
    const p = lifePlan(reason.key, days, todayStr());
    if (!('chat' in p)) return <AutoProposal visible={visible} onClose={close} option={p.option} alt={p.alt} />;
  }
  return (
    <Sheet visible={visible} onClose={close} title={reason ? 'How long?' : 'What’s going on?'} sub={reason ? `${reason.title}. Your best guess is fine — you can change it.` : undefined}>
      {!reason ? (
        <View>
          {REASONS.map((r, i) => <Row key={r.key} name={r.title} sub={r.sub} value="→" last={i === REASONS.length - 1} onPress={() => pick(r)} />)}
          <Text style={[T.caption, { marginTop: 14 }]}>Next: how long, then the new week to approve.</Text>
        </View>
      ) : (
        <View>
          {LENGTHS.map((l, i) => <Row key={l.label} name={l.label} value="→" last={i === LENGTHS.length - 1} onPress={() => pickLen(l.days)} />)}
          <TextAction muted arrow={false} size={15} style={{ marginTop: 18 }} onPress={() => setReason(null)}>← Back</TextAction>
        </View>
      )}
    </Sheet>
  );
}

/** Runs one proposal as soon as it opens (Life happened's last step). */
function AutoProposal({ visible, onClose, option, alt }: { visible: boolean; onClose: () => void; option: ToolOption; alt: ToolOption | null }) {
  const invalidate = useInvalidate();
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (o: ToolOption) => {
    setBusy(true); setError(null);
    try { const r = await v2Api.runTool(o.tool, o.input); if (r.cards[0]) setCard(r.cards[0]); else setError('Nothing to change there.'); }
    catch (e: any) { setError(e?.message ?? 'Couldn’t build that — try again.'); }
    setBusy(false);
  };
  React.useEffect(() => { if (visible && !card && !busy) void run(option); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const applied = card?.state?.status === 'applied';
  return (
    <Sheet visible={visible} onClose={onClose} title={card ? undefined : 'Working out the new week…'}>
      {busy && !card ? <ActivityIndicator color={C.muted} style={{ marginVertical: 20 }} /> : null}
      {card ? <StandaloneCard key={card.id} card={card} onChange={(c) => { setCard(c); if (c.state?.status === 'applied') void invalidate.afterSchedule(); }} /> : null}
      {error ? <Text style={[T.caption, { color: C.crimson, marginTop: 10 }]}>{error}</Text> : null}
      <View style={styles.sheetFoot}>
        {applied ? <TextAction primary onPress={onClose}>Done</TextAction> : <TextAction muted arrow={false} size={15} onPress={onClose}>Not now</TextAction>}
        {!applied && alt && card ? <TextAction muted arrow={false} size={15} onPress={() => { setCard(null); void run(alt); }}>{alt.title}</TextAction> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 52, height: 36, borderRadius: 6, backgroundColor: C.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  play: { fontSize: 12, color: C.ink },
  actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, rowGap: 10, marginTop: 30 },
  sheetFoot: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 18, flexWrap: 'wrap' },
});
