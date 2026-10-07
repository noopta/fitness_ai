// Training (index 1) — Focus bands (RN spec, 3 Oct 2026; design 1b).
//
// One screen that never scrolls. Four bands share the height between the
// header and the tab bar: GOAL, PROGRAM, THIS WEEK, ARCHIVE. Exactly one is
// open; THIS WEEK opens on every tab entry with today's row expanded. Each
// band has one shared value o (0 closed → 1 open); a switch animates the two
// that change in lockstep on the UI thread, so the heights always sum to the
// container. All four bands stay mounted; closed content is just clipped.

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo, PixelRatio, type LayoutChangeEvent } from 'react-native';
import { Pressable } from '../primitives/Pressable';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, interpolate, interpolateColor, Extrapolation,
  useReducedMotion, Easing, type SharedValue,
} from 'react-native-reanimated';
import { v2, T } from '../theme';
import { AnakinRead } from '../shell/Page';
import { headerClearance } from '../shell/Header';
import { TextAction } from '../primitives/TextAction';
import { useTrainingOverview } from '../data';
import { useShell } from '../shell/ShellContext';
import { haptics } from '../haptics';
import type { TrainingOverview } from '../api';
import { niceLabel, sessionName } from '../format';

type Band = 'goal' | 'program' | 'week' | 'archive';
const BANDS: Band[] = ['goal', 'program', 'week', 'archive'];
const TITLES: Record<Band, string> = { goal: 'Goal', program: 'Program', week: 'This week', archive: 'Archive' };
type Day = TrainingOverview['week']['days'][number];
type ArchiveItem = TrainingOverview['archive']['items'][number];

const C = v2.color;
const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const BAND_MS = 560;
const DAY_MS = 450;
const TRAINING_INDEX = 1;
const ROW_H = 44;
const ROW_H_TIGHT = 36;
const DETAIL_3 = 110;
const DETAIL_2 = 90;
// This week row grid (bug fixes 5 Oct, 1a): wide enough for "Wed" at any weight.
const DOT_W = 9;
const DOW_W = 44;
const DAY_GAP = 12;
const NAME_X = DOT_W + DAY_GAP + DOW_W + DAY_GAP; // 77

/** Where an archive row opens. Shared with the full list page. */
export function archiveHref(item: ArchiveItem): any {
  if (item.kind === 'program') return { pathname: '/(v2)/p/[key]', params: { key: `pastprogram:${item.id}` } };
  if (item.source === 'form') return `/form-analysis?id=${item.id}`;
  const conv = item.flow === 'conversation';
  if (item.done) return conv ? `/diagnostic/report?sessionId=${item.id}` : `/diagnostic/plan?sessionId=${item.id}`;
  return conv ? `/diagnostic/conversation?sessionId=${item.id}` : `/diagnostic/chat?sessionId=${item.id}`;
}

export function TrainingPage() {
  const router = useRouter();
  const shell = useShell();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const q = useTrainingOverview();
  const data = q.data;

  // Dynamic Type: at the largest sizes the collapsed bands grow to 72.
  const collapsed = PixelRatio.getFontScale() >= 1.35 ? 72 : 62;

  const todayIndex = data?.week.days.findIndex((d) => d.status === 'today') ?? -1;
  const currentPhase = data?.program?.currentPhase ?? 0;
  const [band, setBand] = useState<Band>('week');
  const [phaseSel, setPhaseSel] = useState(currentPhase);
  const [daySel, setDaySel] = useState(todayIndex);

  // Every tab entry: This week open, today expanded, current phase selected; one call, cached.
  const wasHere = useRef(shell.index === TRAINING_INDEX);
  useEffect(() => {
    const here = shell.index === TRAINING_INDEX;
    if (here && !wasHere.current) {
      setBand('week');
      setDaySel(todayIndex);
      setPhaseSel(currentPhase);
      if (q.isStale) void q.refetch();
    }
    wasHere.current = here;
  }, [shell.index]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cold start without a cached copy: land on today and the current phase once data arrives.
  const seeded = useRef(!!data);
  useEffect(() => {
    if (data && !seeded.current) { seeded.current = true; setDaySel(todayIndex); setPhaseSel(currentPhase); }
  }, [data, todayIndex, currentPhase]);

  // Container height → open height: a shared value for the UI thread, state for the week fit rule.
  const H = useSharedValue(0);
  const [openH, setOpenH] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    H.value = h;
    setOpenH(Math.max(0, h - 3 * collapsed));
  }, [H, collapsed]);

  // One shared value per band (o), plus a Reduce Motion cross-fade value (f).
  const o0 = useSharedValue(0), o1 = useSharedValue(0), o2 = useSharedValue(1), o3 = useSharedValue(0);
  const f0 = useSharedValue(0), f1 = useSharedValue(0), f2 = useSharedValue(1), f3 = useSharedValue(0);
  const o = [o0, o1, o2, o3];
  const fade = [f0, f1, f2, f3];
  useEffect(() => {
    const k = BANDS.indexOf(band);
    o.forEach((v, i) => {
      const to = i === k ? 1 : 0;
      // Both changing values start in the same frame with the same curve, so the heights move in lockstep.
      v.value = reduced ? to : withTiming(to, { duration: BAND_MS, easing: EASE });
      fade[i].value = reduced ? withTiming(to, { duration: 150 }) : to;
    });
  }, [band, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // VoiceOver: keep the animation, announce the opened band's first line.
  const screenReader = useRef(false);
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then((v) => { screenReader.current = v; });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v) => { screenReader.current = v; });
    return () => sub.remove();
  }, []);

  const summaries = useMemo(() => summarize(data), [data]);
  const open = useCallback((b: Band) => {
    if (b === band) return; // the open band's header does nothing — there's always one open
    haptics.select();
    setBand(b);
    if (screenReader.current) AccessibilityInfo.announceForAccessibility(`${TITLES[b]}. ${summaries[b].spoken}`);
  }, [band, summaries]);

  // Stable callbacks so the memoized band contents don't re-render on a band switch.
  const onLift = useCallback((name: string) => { haptics.select(); router.push({ pathname: '/(v2)/p/[key]', params: { key: `lift:${name}` } } as any); }, [router]);
  const onPhase = useCallback((i: number) => { haptics.select(); setPhaseSel(i); }, []);
  const onPhaseLong = useCallback((name: string) => { haptics.light(); shell.prefill(`Can you change the ${name} phase? `); }, [shell]);
  const onDay = useCallback((i: number) => { haptics.select(); setDaySel((cur) => (cur === i ? -1 : i)); }, []);
  const onDayAction = useCallback((d: Day) => {
    haptics.light();
    if (d.status === 'today') router.push('/(v2)/session' as any);
    else if (d.status === 'done') router.push({ pathname: '/(v2)/p/[key]', params: { key: `day:${d.date}` } } as any);
    else if (d.status === 'planned') shell.ask(`Can we move ${d.name} on ${d.dow}?`);
  }, [router, shell]);
  const onArchive = useCallback((item: ArchiveItem) => { haptics.select(); router.push(archiveHref(item)); }, [router]);
  const onArchiveAll = useCallback(() => { haptics.select(); router.push({ pathname: '/(v2)/p/[key]', params: { key: 'archive' } } as any); }, [router]);

  const contentH = Math.max(0, openH - collapsed);
  const pad = { paddingTop: headerClearance(insets.top) + 16, paddingBottom: v2.space.tabBarClearance + insets.bottom };

  if (!data && q.isError) {
    return (
      <View style={[styles.page, pad]}>
        <Text style={T.bodyMuted}>Couldn't load training.</Text>
        <TextAction onPress={() => void q.refetch()} style={{ marginTop: 8 }}>Try again</TextAction>
      </View>
    );
  }
  if (data && !data.program) {
    return (
      <View style={[styles.page, pad]}>
        <AnakinRead text="No program on file. Tell me what you're working toward and I'll build the first week." />
        <TextAction primary onPress={() => router.push('/(v2)/onboarding' as any)} style={{ marginTop: 18 }}>Build a program</TextAction>
      </View>
    );
  }

  return (
    <View style={[styles.page, pad]}>
      <View style={styles.bands} onLayout={onLayout}>
        {BANDS.map((b, i) => (
          <BandView key={b} band={b} o={o[i]} fade={fade[i]} H={H} collapsed={collapsed} contentH={contentH} reduced={!!reduced}
            open={band === b} summary={summaries[b]} onPress={open}>
            {data?.program ? (
              b === 'goal' ? <GoalContent goal={data.goal} week={data.program.week} totalWeeks={data.program.totalWeeks} onLift={onLift} />
              : b === 'program' ? <ProgramContent program={data.program} sel={phaseSel} onSel={onPhase} onLong={onPhaseLong} />
              : b === 'week' ? <WeekContent days={data.week.days} sel={daySel} onDay={onDay} onAction={onDayAction} height={contentH} reduced={!!reduced} />
              : <ArchiveContent archive={data.archive} onItem={onArchive} onAll={onArchiveAll} />
            ) : null}
          </BandView>
        ))}
      </View>
    </View>
  );
}

// ─── Summaries ───────────────────────────────────────────────────────────────

type Summary = { value: string; caption: string; spoken: string };

function summarize(d?: TrainingOverview): Record<Band, Summary> {
  const today = d?.week.days.find((x) => x.status === 'today');
  const phase = d?.program?.phases[d.program.currentPhase];
  const lifts = d?.goal.lifts.length ?? 0;
  return {
    goal: lifts
      ? { value: `${d!.goal.pct}%`, caption: `of the way · ${lifts} lift${lifts === 1 ? '' : 's'}`, spoken: `${d!.goal.pct}% of the way, ${lifts} lifts` }
      : { value: '—', caption: 'log lifts to track', spoken: 'Log lifts to track progress' },
    program: d?.program
      ? { value: `Week ${d.program.week} of ${d.program.totalWeeks}`, caption: phase?.name ?? '', spoken: `Week ${d.program.week} of ${d.program.totalWeeks}${phase ? `, ${phase.name}` : ''}` }
      : { value: '—', caption: '', spoken: '' },
    week: d
      ? { value: `${d.week.done} of ${d.week.planned}`, caption: today ? `today · ${today.name}` : 'nothing left today', spoken: `${d.week.done} of ${d.week.planned} done${today ? `, today ${today.name}` : ''}` }
      : { value: '—', caption: '', spoken: '' },
    archive: d
      ? { value: String(d.archive.count), caption: 'programs · diagnostics', spoken: `${d.archive.count} programs and diagnostics` }
      : { value: '—', caption: '', spoken: '' },
  };
}

// ─── Band ────────────────────────────────────────────────────────────────────

interface BandProps {
  band: Band; o: SharedValue<number>; fade: SharedValue<number>; H: SharedValue<number>;
  collapsed: number; contentH: number; reduced: boolean; open: boolean; summary: Summary;
  onPress: (b: Band) => void; children: React.ReactNode;
}

function BandView({ band, o, fade, H, collapsed, contentH, reduced, open, summary, onPress, children }: BandProps) {
  const box = useAnimatedStyle(() => {
    const openH = H.value - 3 * collapsed;
    if (openH <= collapsed) return { height: collapsed };
    return { height: collapsed + o.value * (openH - collapsed) };
  });
  const eyebrow = useAnimatedStyle(() => ({ color: interpolateColor(o.value, [0, 1], [C.muted, C.ink]) }));
  const sum = useAnimatedStyle(() => ({ opacity: 1 - o.value }));
  const content = useAnimatedStyle(() => ({
    opacity: reduced ? fade.value : interpolate(o.value, [0.35, 1], [0, 1], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View style={[styles.band, box]}>
      <Pressable onPress={() => onPress(band)} style={[styles.bandHead, { height: collapsed - 1 }]}
        accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${TITLES[band]}, ${summary.spoken}. ${open ? 'Expanded' : 'Collapsed'}.`}>
        <Animated.Text style={[styles.eyebrow, eyebrow]}>{TITLES[band]}</Animated.Text>
        <Animated.View style={[styles.summary, sum]} pointerEvents="none">
          <Text style={styles.sumValue}>{summary.value}</Text>
          {summary.caption ? <Text style={styles.sumCaption} numberOfLines={1}>{summary.caption}</Text> : null}
        </Animated.View>
      </Pressable>
      {/* Laid out at the open height and clipped while closed — never mounted or unmounted on toggle. */}
      <Animated.View style={[{ height: contentH }, content]} pointerEvents={open ? 'auto' : 'none'}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!open}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

// ─── GOAL ────────────────────────────────────────────────────────────────────

const paceNote = (pace: 'ahead' | 'on' | 'behind', totalWeeks: number) =>
  pace === 'ahead' ? 'Ahead of pace' : pace === 'on' ? `On pace for week ${totalWeeks}` : 'Slightly behind';

const GoalContent = memo(function GoalContent({ goal, week, totalWeeks, onLift }: {
  goal: TrainingOverview['goal']; week: number; totalWeeks: number; onLift: (name: string) => void;
}) {
  // Where the lift should be by now, if progress were linear across the program.
  const tick = Math.max(0, Math.min(1, (week - 1) / Math.max(1, totalWeeks - 1)));
  if (!goal.lifts.length) {
    return <Text style={[T.bodyMuted, { marginTop: 4 }]}>Log a few sessions of your main lifts and the goal fills in here.</Text>;
  }
  return (
    <View style={{ gap: 22, paddingTop: 4 }}>
      {goal.lifts.map((l) => (
        <Pressable key={l.name} onPress={() => onLift(l.name)} accessibilityRole="button"
          accessibilityLabel={`${l.name}, ${l.current} now, target ${l.target}. ${paceNote(l.pace, totalWeeks)}.`}>
          <View style={styles.liftRow}>
            <Text style={styles.liftName} numberOfLines={1}>{l.name}</Text>
            <View style={styles.liftRight}>
              <Text style={styles.liftNow}>{l.current} →</Text>
              <Text style={styles.liftTarget}>{l.target}</Text>
              <Text style={styles.liftNow}>{l.reps}</Text>
            </View>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(l.progress * 100)}%` }]} />
            <View style={[styles.tick, { left: `${tick * 100}%` }]} />
          </View>
          <Text style={styles.note}>{paceNote(l.pace, totalWeeks)}</Text>
        </Pressable>
      ))}
    </View>
  );
});

// ─── PROGRAM ─────────────────────────────────────────────────────────────────

const ProgramContent = memo(function ProgramContent({ program, sel, onSel, onLong }: {
  program: NonNullable<TrainingOverview['program']>; sel: number; onSel: (i: number) => void; onLong: (name: string) => void;
}) {
  const ph = program.phases[sel] ?? program.phases[0];
  return (
    <View style={{ paddingTop: 2 }}>
      <View style={styles.blocks}>
        {program.phases.map((p, i) => (
          <PhaseBlock key={`${p.name}${i}`} name={p.name} weeks={p.weeks} selected={i === sel} past={i < program.currentPhase}
            onPress={() => onSel(i)} onLongPress={() => onLong(p.name)} />
        ))}
      </View>
      {ph ? (
        <View style={{ marginTop: 22 }}>
          <Text style={styles.phaseTitle} numberOfLines={1}>{ph.focus ? `${ph.name} · ${ph.focus}` : ph.name}</Text>
          {ph.why ? <Text style={styles.why} numberOfLines={2}>{ph.why}</Text> : null}
          <View style={{ marginTop: 14 }}>
            <InfoRow label="Sessions" value={ph.sessions || '—'} />
            <InfoRow label="Effort" value={ph.effort || '—'} />
            <InfoRow label="Focus" value={ph.focusLine || '—'} />
          </View>
        </View>
      ) : null}
    </View>
  );
});

function PhaseBlock({ name, weeks, selected, past, onPress, onLongPress }: {
  name: string; weeks: number; selected: boolean; past: boolean; onPress: () => void; onLongPress: () => void;
}) {
  const s = useSharedValue(selected ? 1 : 0);
  useEffect(() => { s.value = withTiming(selected ? 1 : 0, { duration: 300 }); }, [selected, s]);
  const base = past ? C.hairline : C.surface;
  const bg = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(s.value, [0, 1], [base, C.ink]) }));
  const ink = useAnimatedStyle(() => ({ color: interpolateColor(s.value, [0, 1], [C.muted, C.white]) }));
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={{ flex: weeks }}
      accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${name}, ${weeks} weeks`}
      accessibilityHint="Long-press to ask Anakin to change this phase">
      <Animated.View style={[styles.block, bg]}>
        <Animated.Text style={[styles.blockName, ink]} numberOfLines={1}>{name}</Animated.Text>
        <Animated.Text style={[styles.blockWeeks, ink]} numberOfLines={1}>{weeks} wk</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={T.caption}>{label}</Text>
      <Text style={[T.caption, { color: C.ink, flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─── THIS WEEK ───────────────────────────────────────────────────────────────

const WeekContent = memo(function WeekContent({ days, sel, onDay, onAction, height, reduced }: {
  days: Day[]; sel: number; onDay: (i: number) => void; onAction: (d: Day) => void; height: number; reduced: boolean;
}) {
  // Fit rule — never scroll: three exercise lines if they fit, then two, then tighter rows.
  const lines = 7 * ROW_H + DETAIL_3 <= height ? 3 : 2;
  const rowH = lines === 3 || 7 * ROW_H + DETAIL_2 <= height ? ROW_H : ROW_H_TIGHT;
  return (
    <View>
      {days.map((d, i) => (
        <DayRow key={d.date} day={d} expanded={sel === i} rowH={rowH} lines={lines} reduced={reduced} index={i} onDay={onDay} onAction={onAction} />
      ))}
    </View>
  );
});

const ACTION: Record<Day['status'], string | null> = { done: 'See the log', today: 'Begin', planned: 'Move it', rest: null };

const DayRow = memo(function DayRow({ day, expanded, rowH, lines, reduced, index, onDay, onAction }: {
  day: Day; expanded: boolean; rowH: number; lines: number; reduced: boolean; index: number; onDay: (i: number) => void; onAction: (d: Day) => void;
}) {
  const e = useSharedValue(expanded ? 1 : 0);
  const mh = useSharedValue(0);
  useEffect(() => {
    e.value = reduced ? (expanded ? 1 : 0) : withTiming(expanded ? 1 : 0, { duration: DAY_MS, easing: EASE });
  }, [expanded, reduced, e]);
  // Height 0 → measured, so the rows below move down smoothly.
  const detail = useAnimatedStyle(() => ({ height: e.value * mh.value, opacity: interpolate(e.value, [0.3, 1], [0, 1], Extrapolation.CLAMP) }));
  const isToday = day.status === 'today';
  const nameColor = day.status === 'done' ? C.muted : day.status === 'rest' ? C.placeholder : C.ink;
  const action = ACTION[day.status];
  const hasDetail = day.exercises.length > 0 || !!action;
  return (
    <View style={styles.dayWrap}>
      <Pressable onPress={() => onDay(index)} disabled={!hasDetail} style={[styles.dayRow, { height: rowH }]}
        accessibilityRole="button" accessibilityState={{ expanded, disabled: !hasDetail }}
        accessibilityHint={hasDetail ? 'Double-tap to show exercises' : undefined}
        accessibilityLabel={`${day.dow}, ${day.name}${day.minutes ? `, ${day.minutes} minutes` : ''}, ${day.status}`}>
        <StatusDot status={day.status} />
        <Text style={styles.dow}>{day.dow}</Text>
        <Text style={[styles.dayName, { color: nameColor, fontFamily: isToday ? v2.font.semibold : v2.font.medium }]} numberOfLines={1}>{day.name}</Text>
        {day.minutes ? <Text style={styles.mins}>{day.minutes} min</Text> : null}
      </Pressable>
      {hasDetail ? (
        <Animated.View style={[styles.detailClip, detail]} pointerEvents={expanded ? 'auto' : 'none'}>
          <View style={styles.detail} onLayout={(ev) => { mh.value = ev.nativeEvent.layout.height; }}>
            {day.exercises.slice(0, lines).map((x, k) => (
              <View key={k} style={styles.exLine}>
                <Text style={[T.caption, { color: C.ink, flexShrink: 1 }]} numberOfLines={1}>{x.name}</Text>
                <Text style={[T.caption, T.num]} numberOfLines={1}>{x.spec}</Text>
              </View>
            ))}
            {action ? (
              <Pressable onPress={() => onAction(day)} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
                <Text style={styles.action}>{action} →</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
});

function StatusDot({ status }: { status: Day['status'] }) {
  const s = status === 'done' ? { backgroundColor: C.ink }
    : status === 'today' ? { backgroundColor: C.crimson }
    : status === 'planned' ? { borderWidth: 1.5, borderColor: '#d4d4d8' }
    : { borderWidth: 1.5, borderColor: C.surface };
  return <View style={[styles.dot, s]} />;
}

// ─── ARCHIVE ─────────────────────────────────────────────────────────────────

const ArchiveContent = memo(function ArchiveContent({ archive, onItem, onAll }: {
  archive: TrainingOverview['archive']; onItem: (i: ArchiveItem) => void; onAll: () => void;
}) {
  if (!archive.count) return <Text style={[T.bodyMuted, { marginTop: 4 }]}>Finished programs and diagnostics collect here.</Text>;
  const more = archive.count > 5;
  const shown = archive.items.slice(0, more ? 4 : 5);
  return (
    <View>
      {shown.map((it) => <ArchiveRow key={`${it.kind}:${it.id}`} item={it} onPress={onItem} />)}
      {more ? (
        <Pressable onPress={onAll} style={styles.archRow} accessibilityRole="button" accessibilityLabel={`All ${archive.count}`}>
          <Text style={[styles.archName, { flex: 1 }]}>All {archive.count} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

export function ArchiveRow({ item, onPress }: { item: ArchiveItem; onPress: (item: ArchiveItem) => void }) {
  return (
    <Pressable onPress={() => onPress(item)} style={styles.archRow} accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.sub}, ${item.value}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.archName} numberOfLines={1}>{niceLabel(item.title)}</Text>
        <Text style={styles.archSub} numberOfLines={1}>{item.sub}</Text>
      </View>
      <Text style={[T.caption, T.num]}>{item.value}</Text>
    </Pressable>
  );
}

// ─── Shared exports (chat cards, pushed pages) ───────────────────────────────

export function programPhases(program: any): { name: string; weeks: number; focus: string; index: number }[] {
  const phases: any[] = program?.phases ?? [];
  return phases.map((p, i) => ({
    name: niceLabel(p.name || p.phaseName || `Phase ${i + 1}`),
    weeks: p.durationWeeks ?? p.weeks ?? 1,
    focus: p.focus || p.description || p.goal || (Array.isArray(p.trainingDays ?? p.days) ? `${(p.trainingDays ?? p.days).length} sessions a week` : ''),
    index: i,
  }));
}

/** M–S tiles: done greyed, today ink, rest hairline. Taps only — the track owns the swipe. Used by the week chat card. */
export function WeekStrip({ days, onDay, proposalDates }: { days: any[]; onDay?: (d: any) => void; proposalDates?: string[] }) {
  const letters = 'MTWTFSS'.split('');
  return (
    <View style={{ marginTop: 12 }}>
      <View style={styles.strip}>
        {days.slice(0, 7).map((d, i) => {
          const done = !!d.isLogged || (!!d.isPast && !!d.session && d.isLogged !== false && d.isPast && d.isLogged);
          const today = !!d.isToday;
          const rest = !d.session;
          const proposed = proposalDates?.includes(String(d.date).slice(0, 10));
          const bg = today ? C.ink : done ? C.surface : C.white;
          const border = proposed ? C.crimson : today ? C.ink : done ? C.surface : C.hairline;
          const ink = today ? C.white : done || rest ? C.placeholder : C.ink;
          const sub = rest ? '' : done ? 'Done' : today ? 'Today' : (d.session?.minutes ? `${d.session.minutes}m` : '');
          return (
            <Pressable key={d.date ?? i} onPress={() => onDay?.(d)} style={[styles.tile, { backgroundColor: bg, borderColor: border, borderStyle: proposed ? 'dashed' : 'solid' }]} accessibilityLabel={`${letters[i]} ${d.session?.name ?? 'Rest'}`}>
              <Text style={[styles.tileName, { color: ink, fontFamily: rest ? v2.font.regular : v2.font.semibold }]} numberOfLines={1}>{rest ? 'Rest' : sessionName(d.session?.name ?? d.session?.day).split(' ')[0]}</Text>
              {sub ? <Text style={[styles.tileSub, { color: today ? C.darkMuted : C.muted }]}>{sub}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.letters}>
        {letters.map((l, i) => <Text key={i} style={[T.caption, { flex: 1, textAlign: 'center', color: days[i]?.isToday ? C.ink : C.placeholder, fontFamily: days[i]?.isToday ? v2.font.bold : v2.font.medium }]}>{l}</Text>)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: v2.space.gutter },
  bands: { flex: 1 },
  band: { overflow: 'hidden', borderTopWidth: 1, borderTopColor: C.hairline },
  bandHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontFamily: v2.font.bold, ...v2.type.eyebrow, textTransform: 'uppercase' },
  summary: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1, marginLeft: 16 },
  sumValue: { fontFamily: v2.font.semibold, fontSize: 17, lineHeight: 22, color: C.ink, fontVariant: ['tabular-nums'] },
  sumCaption: { fontFamily: v2.font.regular, fontSize: 13, lineHeight: 18, color: C.muted, flexShrink: 1 },

  liftRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  liftName: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20, color: C.ink, flexShrink: 1 },
  liftRight: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  liftNow: { fontFamily: v2.font.regular, fontSize: 13, color: C.muted, fontVariant: ['tabular-nums'] },
  liftTarget: { fontFamily: v2.font.bold, fontSize: 24, lineHeight: 28, color: C.ink, fontVariant: ['tabular-nums'], letterSpacing: -0.4 },
  track: { height: 2, backgroundColor: C.surface, marginTop: 10 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.ink },
  tick: { position: 'absolute', width: 1, height: 10, backgroundColor: C.crimson, top: -4 },
  note: { fontFamily: v2.font.regular, fontSize: 12, lineHeight: 16, color: C.muted, marginTop: 8 },

  blocks: { flexDirection: 'row', gap: 4 },
  block: { height: 44, borderRadius: 10, padding: 8, justifyContent: 'space-between' },
  blockName: { fontFamily: v2.font.semibold, fontSize: 11, lineHeight: 13 },
  blockWeeks: { fontFamily: v2.font.regular, fontSize: 11, lineHeight: 13, opacity: 0.8 },
  phaseTitle: { fontFamily: v2.font.bold, fontSize: 22, lineHeight: 27, color: C.ink, letterSpacing: -0.3 },
  why: { fontFamily: v2.font.regular, fontSize: 15, lineHeight: 22.5, color: C.muted, marginTop: 8 },
  info: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTopWidth: 1, borderTopColor: C.surface },

  dayWrap: { borderTopWidth: 1, borderTopColor: C.surface },
  // Grid row: [dot 9] 12 [day 44] 12 [name flex] 12 [duration auto] — the name always starts at x = 77.
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: DAY_GAP },
  dot: { width: DOT_W, height: DOT_W, borderRadius: DOT_W / 2 },
  dow: { width: DOW_W, fontFamily: v2.font.regular, fontSize: 13, lineHeight: 18, color: C.muted, fontVariant: ['tabular-nums'] },
  dayName: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20 },
  mins: { fontFamily: v2.font.regular, fontSize: 13, color: C.muted, fontVariant: ['tabular-nums'] },
  detailClip: { overflow: 'hidden' },
  // Indented 77 so the exercises line up with the session name.
  detail: { position: 'absolute', left: NAME_X, right: 0, top: 0, gap: 6, paddingBottom: 12 },
  exLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  action: { fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 19.5, color: C.crimson, marginTop: 2 },

  archRow: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: C.surface },
  archName: { fontFamily: v2.font.medium, fontSize: 15, lineHeight: 19, color: C.ink },
  archSub: { fontFamily: v2.font.regular, fontSize: 12, lineHeight: 15, color: C.muted },

  strip: { flexDirection: 'row', gap: 6 },
  tile: { flex: 1, minHeight: 58, borderWidth: 1, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tileName: { fontSize: 11.5, letterSpacing: -0.1 },
  tileSub: { fontSize: 10, fontFamily: v2.font.regular },
  letters: { flexDirection: 'row', gap: 6, marginTop: 6 },
});
