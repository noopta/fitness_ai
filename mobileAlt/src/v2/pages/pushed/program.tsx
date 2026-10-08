// The program outside chat (handoff T-07, T-08).
//
// Full program (T-08): Training's Program band → Open →. Every week in one
//   list; a week expands to its days and a day pushes its page, where each
//   exercise opens with its video (T-10).
// Review before saving (T-07): every new program from chat lands here first —
//   phase blocks pick the phase, each day expands to every set, and changes
//   are made by asking. Opened from onboarding it reviews the saved program.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Share, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { Pressable } from '../../primitives/Pressable';
import { useProgram, useWorkouts, useInvalidate } from '../../data';
import { useShellOptional } from '../../shell/ShellContext';
import { v2Api, type TrainingOverview } from '../../api';
import { coachApi } from '../../../lib/api';
import { AnakinRead } from '../../shell/Page';
import { exName, niceLabel, estimateMinutes } from '../../format';
import { todayStr } from '../../../lib/localDate';
import { haptics } from '../../haptics';
import { phasesOf as corePhasesOf, addDays, programWeek } from '@axiom/agent-ui-core';

const C = v2.color;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The program's phases, names tidied. */
const phasesOf = (program: any) => corePhasesOf(program, niceLabel);
type PhaseView = ReturnType<typeof phasesOf>[number];
const dayLabel = (d: any, i: number) => String(d?.day || d?.name || `Day ${i + 1}`);
const dayMinutes = (d: any) => Number(d?.minutes) || estimateMinutes((d?.exercises ?? []).length);
const dayLine = (d: any) => (d?.exercises ?? []).slice(0, 3).map((e: any) => `${exName(e).toLowerCase()} ${e.sets ?? '—'} × ${e.reps ?? '—'}`).join(', ');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Phase blocks: widths by weeks; the selected one is ink. */
function PhaseBlocks({ phases, sel, onSel, current }: { phases: PhaseView[]; sel: number; onSel: (i: number) => void; current?: number }) {
  return (
    <View style={styles.blocks}>
      {phases.map((p, i) => (
        <Pressable key={`${p.name}${i}`} onPress={() => { haptics.select(); onSel(i); }} style={{ flex: p.weeks }} accessibilityRole="button" accessibilityState={{ selected: i === sel }} accessibilityLabel={`${p.name}, ${p.weeks} weeks`}>
          <View style={[styles.block, { backgroundColor: i === sel ? C.ink : current != null && i < current ? C.hairline : C.surface }]}>
            <Text style={[styles.blockName, { color: i === sel ? C.white : C.muted }]} numberOfLines={1}>{p.name}</Text>
            <Text style={[styles.blockWeeks, { color: i === sel ? C.white : C.muted }]}>{p.weeks} wk</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** One training day: name, minutes, a one-line summary; tap to expand every set. */
function DayBlock({ d, i, first, onOpen }: { d: any; i: number; first?: boolean; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const ex: any[] = d?.exercises ?? [];
  // A rest day holds its weekday's place in the program; nothing to expand.
  if (!ex.length) return <View style={[styles.day, first && { borderTopWidth: 0 }]}><Text style={[T.row, { color: C.muted }]}>{dayLabel(d, i)}</Text></View>;
  const m = dayMinutes(d);
  return (
    <View style={[styles.day, first && { borderTopWidth: 0 }]}>
      <Pressable onPress={() => { haptics.select(); setOpen((o) => !o); }} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={styles.dayHead}>
          <Text style={[T.rowStrong, { flex: 1 }]} numberOfLines={1}>{dayLabel(d, i)}</Text>
          {m ? <Text style={[T.caption, T.num]}>{m} min {open ? '↑' : '↓'}</Text> : null}
        </View>
        {!open && ex.length ? <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>{cap(dayLine(d))}</Text> : null}
      </Pressable>
      {open ? (
        <View style={{ marginTop: 8 }}>
          {ex.map((e, k) => (
            <View key={k} style={styles.set}>
              <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{exName(e)}</Text>
              <Text style={[T.caption, T.num, { color: C.ink }]}>{e.sets ?? '—'} × {e.reps ?? '—'}{e.intensity ? ` · ${e.intensity}` : ''}</Text>
            </View>
          ))}
          {onOpen ? <Pressable onPress={onOpen} hitSlop={8} style={{ marginTop: 8 }}><Text style={[T.captionStrong, { color: C.crimson }]}>Videos and cues →</Text></Pressable> : null}
        </View>
      ) : null}
    </View>
  );
}

// ─── T-08 Full program ───────────────────────────────────────────────────────

export function FullProgramPage() {
  const router = useRouter();
  const invalidate = useInvalidate();
  const q = useProgram();
  const workouts = useWorkouts();
  const p = q.data?.program ?? null;
  const phases = useMemo(() => phasesOf(p), [p]);
  const total = phases.reduce((a, x) => a + x.weeks, 0);
  const start: string | null = q.data?.programStartDate ? String(q.data.programStartDate).slice(0, 10) : null;
  const today = todayStr();
  const now = start ? programWeek(start, today, total) : 1;
  const curPhase = Math.max(0, phases.findIndex((ph) => now >= ph.from && now < ph.from + ph.weeks));
  const [sel, setSel] = useState<number | null>(null);
  const shown = sel ?? curPhase;
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const logged: string[] = (Array.isArray(workouts.data) ? workouts.data : workouts.data?.workouts ?? []).map((w: any) => String(w.date).slice(0, 10));
  const ph = phases[shown];
  const weeks = ph ? Array.from({ length: ph.weeks }, (_, k) => ph.from + k) : [];
  return (
    <PushedPage back="Training" meta={total ? `Week ${now} of ${total}` : null} title={p?.goal ? String(p.goal) : 'Program'} loading={q.isLoading}
      foot={[
        { label: 'Past programs', onPress: () => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'past' } } as any) },
        // Train your own way: the program is set aside (not deleted) and can come back from the freestyle home.
        { label: 'Switch to freestyle', onPress: () => Alert.alert('Train freestyle?', 'Your program is set aside, not deleted — bring it back any time. I’ll suggest sessions from what you log.', [
          { text: 'Keep the program', style: 'cancel' },
          { text: 'Go freestyle', onPress: async () => { try { await coachApi.goFreestyle(); await invalidate.afterProgram(); haptics.success(); router.back(); } catch (e: any) { Alert.alert('Couldn’t switch', e?.message ?? 'Try again.'); } } },
        ]) },
      ]}>
      {phases.length ? <PhaseBlocks phases={phases} sel={shown} onSel={(i) => { setSel(i); setOpenWeek(null); }} current={curPhase} /> : null}
      {ph?.why ? <Text style={[T.bodyMuted, { marginTop: 14 }]} numberOfLines={3}>{ph.why}</Text> : null}
      <Eyebrow style={{ marginTop: 24 }}>Weeks</Eyebrow>
      <View style={{ marginTop: 6 }}>
        {weeks.map((w, k) => {
          const from = start ? addDays(start, (w - 1) * 7) : null;
          const to = from ? addDays(from, 6) : null;
          const done = from && to ? logged.filter((d) => d >= from && d <= to).length : 0;
          const past = w < now; const cur = w === now;
          const sessions = ph.days.filter((d: any) => (d?.exercises ?? []).length > 0).length;
          const value = past || cur ? `${done} of ${sessions}` : 'Planned';
          return (
            <View key={w}>
              <Row name={`Week ${w}${cur ? ' · now' : ''}`} sub={ph.name} value={`${value} ${openWeek === w ? '↑' : '→'}`} emphasis={cur} muted={past}
                last={k === weeks.length - 1 && openWeek !== w} onPress={() => { haptics.select(); setOpenWeek((o) => (o === w ? null : w)); }} />
              {openWeek === w ? (
                <View style={styles.weekDays}>
                  {ph.days.map((d: any, i: number) => ((d?.exercises ?? []).length
                    ? <Row key={i} name={dayLabel(d, i)} sub={cap(dayLine(d))} value={dayMinutes(d) ? `${dayMinutes(d)} min →` : '→'} last={i === ph.days.length - 1}
                      onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `progday:${shown}:${i}`, week: String(w) } } as any)} />
                    : <Row key={i} name={dayLabel(d, i)} muted last={i === ph.days.length - 1} />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </PushedPage>
  );
}

/** A program day: its exercises, each opening the exercise page with its video. */
export function ProgramDayPage({ arg, params }: { arg: string; params: Record<string, string> }) {
  const router = useRouter();
  const q = useProgram();
  const [pi, di] = arg.split(':').map(Number);
  const ph = phasesOf(q.data?.program)[pi];
  const d = ph?.days?.[di];
  const ex: any[] = d?.exercises ?? [];
  const label = d ? dayLabel(d, di) : 'Day';
  return (
    <PushedPage back={params.week ? `Week ${params.week}` : 'Program'} meta={ph ? ph.name : null} title={label} lead={d?.focus ? String(d.focus) : null} loading={q.isLoading}>
      {ex.map((e, k) => (
        <Row key={k} name={exName(e)} sub={e.intensity || undefined} value={`${e.sets ?? '—'} × ${e.reps ?? '—'}`} arrow last={k === ex.length - 1}
          onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `exercise:${exName(e)}`, back: label.split(/[—–·/]/)[0].trim(), day: label, sets: String(e.sets ?? ''), reps: String(e.reps ?? ''), notes: String(e.notes ?? '') } } as any)} />
      ))}
    </PushedPage>
  );
}

// ─── T-07 Review before saving ───────────────────────────────────────────────

export function ProgramReviewPage({ cardId }: { cardId?: string }) {
  const router = useRouter();
  const shell = useShellOptional();
  const invalidate = useInvalidate();
  const saved = useProgram();
  const proposal = useQuery({ queryKey: ['v2', 'cardProgram', cardId], queryFn: () => v2Api.cardProgram(cardId!), enabled: !!cardId, staleTime: Infinity });
  const program = cardId ? proposal.data?.program : saved.data?.program;
  const card = proposal.data?.card;
  const live = !cardId || !card?.state || card.state.status === 'live';
  const phases = useMemo(() => phasesOf(program), [program]);
  const total = phases.reduce((a, x) => a + x.weeks, 0);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ph = phases[sel];
  const save = async () => {
    if (!cardId) { router.back(); return; }
    setBusy(true); setError(null);
    try {
      await v2Api.cardAction(cardId, 'apply');
      await invalidate.afterProgram();
      haptics.success();
      shell?.goTo(1);
      router.replace('/(v2)' as any);
    } catch (e: any) { setError(e?.message ?? 'Couldn’t save it — try again.'); setBusy(false); }
  };
  const change = () => { shell?.prefill('Change the new program: '); router.replace('/(v2)' as any); };
  const title = program ? `${program.goal ? String(program.goal) : 'New program'} · ${total} weeks` : 'Program';
  return (
    <PushedPage back="Back" meta={cardId ? 'New program' : 'Your program'} eyebrow={cardId ? 'Review · before saving' : 'Every day, every set'} title={title}
      loading={(cardId ? proposal.isLoading : saved.isLoading) && !program} error={cardId && proposal.isError ? 'That program isn’t available any more.' : error}
      cta={program && live ? { label: cardId ? 'Save program' : 'Looks good', onPress: () => void save(), loading: busy } : null}
      foot={program ? [{ label: 'Change something', onPress: change }] : undefined}>
      {cardId && !live ? <Text style={[T.bodyMuted, { marginBottom: 18 }]}>{card?.state?.status === 'applied' ? 'Saved — this is your program now.' : 'You kept your current program.'}</Text> : null}
      {phases.length ? <PhaseBlocks phases={phases} sel={sel} onSel={setSel} /> : null}
      {ph ? <Text style={[T.caption, { marginTop: 10 }]}>Weeks {ph.from}–{ph.from + ph.weeks - 1}{ph.why ? ` · ${ph.why}` : ''}</Text> : null}
      <View style={{ marginTop: 18 }}>
        {(ph?.days ?? []).map((d: any, i: number) => <DayBlock key={`${sel}:${i}`} d={d} i={i} first={i === 0} />)}
      </View>
      {program ? <Text style={[T.caption, { marginTop: 18 }]}>To change it, ask: “make Thursday shorter” or “no lunges”.</Text> : null}
    </PushedPage>
  );
}

// ─── T-09 Program finished ───────────────────────────────────────────────────

/** Takes over the Training tab the day the last session is logged, until the user picks what's next. */
export function ProgramFinishedView({ data }: { data: TrainingOverview }) {
  const router = useRouter();
  const shell = useShellOptional();
  const f = data.finished!;
  const lead = data.goal.lifts[0];
  const unit = data.unit;
  const gain = lead ? lead.current - lead.start : 0;
  const read = !lead ? 'Every session is in. Pick what comes next and I\'ll build from where this one ended.'
    : lead.current >= lead.target ? `You hit ${lead.target}. The next block should start from there.`
    : `${lead.target - lead.current} short of ${lead.target}. The next block starts from ${lead.current}.`;
  const ask = (m: string) => { shell?.ask(m); };
  const share = () => { void Share.share({ message: `Finished a ${f.weeks}-week program on Axiom${lead ? ` — ${lead.name} ${lead.current} ${unit} (${gain >= 0 ? '+' : ''}${gain})` : ''}.` }).catch(() => {}); };
  return (
    <View>
      <Text style={T.eyebrow}>Program finished · {f.weeks} weeks</Text>
      {lead ? (
        <View style={styles.heroRow}>
          <Text style={T.hero}>{lead.current}</Text>
          <Text style={[T.body, { color: C.muted, marginLeft: 8, flexShrink: 1 }]} numberOfLines={1}>{unit} {lead.name.toLowerCase()}</Text>
          {gain ? <Text style={[T.captionStrong, { marginLeft: 10 }]}>{gain > 0 ? '+' : ''}{gain}</Text> : null}
        </View>
      ) : <Text style={[T.headlineSm, { marginTop: 10 }]}>{f.goal ?? 'Program complete'}</Text>}
      <View style={{ marginTop: 12 }}><AnakinRead text={read} /></View>
      <View style={styles.stats}>
        {f.sessionsLogged != null ? <Stat value={`${f.sessionsLogged}${f.sessionsPlanned ? `/${f.sessionsPlanned}` : ''}`} label="sessions" /> : null}
        {f.bodyWeightChangeLb != null ? <Stat value={`${f.bodyWeightChangeLb > 0 ? '+' : ''}${unit === 'kg' ? Math.round(f.bodyWeightChangeLb * 0.4536 * 10) / 10 : Math.round(f.bodyWeightChangeLb * 10) / 10} ${unit}`} label="bodyweight" /> : null}
        {data.goal.lifts.length ? <Stat value={String(data.goal.lifts.filter((l) => l.current > l.start).length)} label={`of ${data.goal.lifts.length} lifts up`} /> : null}
      </View>
      <Eyebrow style={{ marginTop: 26 }}>What’s next</Eyebrow>
      <View style={{ marginTop: 6 }}>
        <Row name="Build the next one" sub={lead ? `Starts from ${lead.current}` : 'Starts from where this ended'} arrow onPress={() => ask('Build my next program — start from where this one ended.')} />
        <Row name="Repeat it" sub="Same block, loads +5%" arrow onPress={() => ask('Repeat my last program with the loads up about 5%.')} />
        <Row name="New goal" sub="Start from the goal" arrow onPress={() => router.push('/(v2)/onboarding' as any)} />
        <Row name="Share the result" arrow last onPress={share} />
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[T.readSm, T.num, { fontFamily: v2.font.semibold }]}>{value}</Text>
      <Text style={T.caption}>{label}</Text>
    </View>
  );
}

export { DOW };

const styles = StyleSheet.create({
  blocks: { flexDirection: 'row', gap: 4 },
  block: { height: 44, borderRadius: 10, padding: 8, justifyContent: 'space-between' },
  blockName: { fontFamily: v2.font.semibold, fontSize: 11, lineHeight: 13 },
  blockWeeks: { fontFamily: v2.font.regular, fontSize: 11, lineHeight: 13, opacity: 0.8 },
  day: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline, paddingVertical: 14 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  set: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 5 },
  weekDays: { paddingLeft: 16, borderLeftWidth: 2, borderLeftColor: C.surface, marginBottom: 6 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 10 },
  stats: { flexDirection: 'row', gap: 16, marginTop: 22, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.hairline },
});
