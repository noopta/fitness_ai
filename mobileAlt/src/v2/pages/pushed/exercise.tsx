// Exercise, with video (handoff T-10). Tap any exercise in a day, the review
// or Today. The video plays on the page itself; cues come from the program's
// notes; Today is the prescription with the load the progression would use;
// Last time is the logged top set. Swap offers alternatives (same muscle) and
// shows the swap as a Proposal before anything changes.

import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import YoutubeIframe from 'react-native-youtube-iframe';
import { cuesFrom, type Card } from '@axiom/agent-ui-core';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { TextAction } from '../../primitives/TextAction';
import { Sheet } from '../../primitives/Sheet';
import { StandaloneCard } from '../../chat/StandaloneCard';
import { useExerciseVideo, useInvalidate } from '../../data';
import { useUnits } from '../../../context/UnitsContext';
import { v2Api } from '../../api';
import { haptics } from '../../haptics';
import { useRouter } from 'expo-router';
import { useAuth } from '../../../context/AuthContext';
import { useShellOptional } from '../../shell/ShellContext';
import { SwapSheet as ExerciseSwapSheet } from '../../swap/SwapSheet';
import { setTodaySwap } from '../../todaySwaps';

const C = v2.color;
const fmtDay = (d?: string) => { if (!d) return ''; const x = new Date(`${String(d).slice(0, 10)}T12:00:00`); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };

export function ExercisePage({ name, params }: { name: string; params: Record<string, string> }) {
  const { width } = useWindowDimensions();
  const { fromKg, unit } = useUnits();
  const video = useExerciseVideo(name);
  const last = useQuery({ queryKey: ['v2', 'last', name.toLowerCase()], queryFn: () => v2Api.lastExercise(name).catch(() => null), staleTime: 60_000 });
  const [failed, setFailed] = useState(false);
  const [swap, setSwap] = useState(false);
  const l: any = last.data;
  const targetKg = l?.target?.targetWeightKg ?? l?.exposures?.[0]?.top?.weightKg ?? null;
  const top = l?.exposures?.[0]?.top;
  const vw = width - v2.space.gutter * 2;
  const cues = cuesFrom(params.notes);
  const sets = params.sets && params.sets !== 'undefined' ? params.sets : null;
  const reps = params.reps && params.reps !== 'undefined' ? params.reps : null;
  // Swaps that keep the job (flag swapV2); off = the alternatives sheet below.
  const swapV2 = useAuth().getFeatures().swapV2;
  const router = useRouter();
  const shell = useShellOptional();
  const planned = params.orig || name;
  return (
    <View style={{ flex: 1 }}>
    <PushedPage back={params.back || 'Back'} title={name}
      right={<TextAction muted arrow={false} size={15} onPress={() => { haptics.select(); setSwap(true); }}>Swap</TextAction>}
      visual={video.data?.videoId && !failed ? (
        <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: C.ink }}>
          <YoutubeIframe height={Math.round((vw * 9) / 16)} width={vw} videoId={video.data.videoId} onError={() => setFailed(true)} webViewProps={{ allowsFullscreenVideo: true }} />
        </View>
      ) : video.isLoading ? <View style={[styles.videoBox, { height: Math.round((vw * 9) / 16) }]}><ActivityIndicator color={C.darkMuted} /></View> : null}>
      {cues.length ? (
        <>
          <Eyebrow>Cues</Eyebrow>
          <View style={{ marginTop: 6 }}>{cues.map((c, i) => <Row key={i} name={c} last={i === cues.length - 1} />)}</View>
        </>
      ) : null}
      {sets || reps ? (
        <>
          <Eyebrow style={{ marginTop: cues.length ? 28 : 0 }}>Today</Eyebrow>
          <View style={{ marginTop: 6 }}>
            <Row name={`${sets ?? '—'} × ${reps ?? '—'}`} value={targetKg ? `${Math.round(fromKg(targetKg))} ${unit}` : undefined} last />
          </View>
        </>
      ) : null}
      {top ? (
        <>
          <Eyebrow style={{ marginTop: 28 }}>Last time</Eyebrow>
          <View style={{ marginTop: 6 }}>
            <Row name={fmtDay(l.exposures[0].date)} value={`${top.weightKg ? Math.round(fromKg(top.weightKg)) : 'BW'} × ${top.reps ?? '—'}`} last />
          </View>
        </>
      ) : null}
      {!video.isLoading && !video.data?.videoId ? <Text style={[T.caption, { marginTop: 24 }]}>No video for this one yet.</Text> : null}
      {!swapV2 ? <SwapExerciseSheet visible={swap} onClose={() => setSwap(false)} name={name} day={params.day || params.back} /> : null}
    </PushedPage>
    {swapV2 ? (
      <ExerciseSwapSheet visible={swap} onClose={() => setSwap(false)} name={planned}
        slot={{ sets, reps, notes: params.notes ?? null, index: params.index ? Number(params.index) : null, session: params.session ? params.session.split('|') : undefined }}
        day={params.day || params.back || null}
        onToday={async (to) => { await setTodaySwap(planned, to); router.back(); }}
        onAsk={(m) => { shell?.prefill(m); router.replace('/(v2)' as any); }} />
    ) : null}
    </View>
  );
}

function SwapExerciseSheet({ visible, onClose, name, day }: { visible: boolean; onClose: () => void; name: string; day?: string }) {
  const invalidate = useInvalidate();
  const alts = useQuery({ queryKey: ['v2', 'alts', name.toLowerCase()], queryFn: () => v2Api.exerciseAlternatives(name), enabled: visible, staleTime: Infinity });
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = alts.data?.alternatives ?? [];
  const pick = async (to: string) => {
    setBusy(to); setError(null);
    try {
      const r = await v2Api.runTool('propose_exercise_swap', { fromExerciseName: name, toExerciseName: to, scope: 'day', ...(day ? { day } : {}), rationale: `Same muscles as ${name}.` });
      if (r.cards[0]) setCard(r.cards[0]);
    } catch (e: any) { setError(e?.message ?? 'Couldn’t build that swap.'); }
    setBusy(null);
  };
  const close = () => { setCard(null); setError(null); onClose(); };
  return (
    <Sheet visible={visible} onClose={close} title={card ? undefined : `Instead of ${name}`} sub={card ? undefined : 'Same muscles. You’ll see the change before it’s made.'}>
      {card ? (
        <View>
          <StandaloneCard key={card.id} card={card} onChange={(c) => { setCard(c); if (c.state?.status === 'applied') void invalidate.afterProgram(); }} />
          <View style={{ flexDirection: 'row', gap: 24, marginTop: 18 }}>
            {card.state?.status === 'applied' ? <TextAction primary onPress={close}>Done</TextAction> : <TextAction muted arrow={false} size={15} onPress={() => setCard(null)}>← Other options</TextAction>}
          </View>
        </View>
      ) : (
        <View>
          {alts.isLoading ? <ActivityIndicator color={C.muted} style={{ marginVertical: 16 }} /> : null}
          {list.map((a, i) => <Row key={a.name} name={a.name} sub={a.isCompound ? 'Compound' : 'Isolation'} value={busy === a.name ? '…' : '→'} last={i === list.length - 1} onPress={busy ? undefined : () => void pick(a.name)} />)}
          {!alts.isLoading && !list.length ? <Text style={T.bodyMuted}>I don’t have alternatives for this one. Ask Anakin and he’ll suggest some.</Text> : null}
          {error ? <Text style={[T.caption, { color: C.crimson, marginTop: 10 }]}>{error}</Text> : null}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  videoBox: { borderRadius: 12, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
});
