// Pushed-page resolvers. Every page: back label → meta → title → Anakin's
// read → one visual → hairline rows → optional Proposed + CTA.

import React from 'react';
import { View, Text, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { TextAction } from '../../primitives/TextAction';
import { ReceiptList } from '../../primitives/Receipt';
import { LineForecast, RatioBand, CoverageBar, WeekBars, Radar } from '../../charts';
import { v2, T } from '../../theme';
import { useProgram, useSchedule, useToday, useCompletedPrograms, useStrength, useNpDay, useNpEffect, useNpNutrient, useMeals, useMemory, useBodyWeight, useStreak, useDiagnostics, useInvalidate, qk } from '../../data';
import { programPhases } from '../Training';
import { strengthRead } from '../You';
import { useUnits } from '../../../context/UnitsContext';
import { useAuth } from '../../../context/AuthContext';
import { nutritionApi, socialApi, groupsApi, trainTogetherApi, paymentsApi, apiFetch } from '../../../lib/api';
import { useShellOptional } from '../../shell/ShellContext';

export function PushedPageFor({ pageKey, params }: { pageKey: string; params: Record<string, string> }) {
  const [kind, arg] = pageKey.includes(':') ? [pageKey.slice(0, pageKey.indexOf(':')), pageKey.slice(pageKey.indexOf(':') + 1)] : [pageKey, ''];
  switch (kind) {
    case 'phase': return <PhasePage index={Number(arg)} />;
    case 'day': return <DayPage date={arg} />;
    case 'past': return <PastPage />;
    case 'pastprogram': return <PastProgramPage id={arg} />;
    case 'diag': return <DiagPage />;
    case 'systems': return <SystemsPage />;
    case 'sys': return <SystemPage id={arg} />;
    case 'micros': return <MicrosPage />;
    case 'mic': return <NutrientPage nkey={arg} />;
    case 'meal': return <MealPage id={arg} />;
    case 'strength': return <StrengthPage />;
    case 'ratios': return <RatiosPage />;
    case 'lift': return <LiftPage name={arg} />;
    case 'body': return <BodyPage />;
    case 'streak': return <StreakPage />;
    case 'memory': return <MemoryPage />;
    case 'billing': return <BillingPage />;
    case 'prefs': return <PrefsPage />;
    case 'groups': return <GroupsPage />;
    case 'leaderboard': return <LeaderboardPage />;
    case 'together': return <TogetherPage />;
    case 'person': return <PersonPage id={arg} params={params} />;
    default: return <PushedPage back="Back" title="Not here yet" lead="That page hasn't been built in the new shell. Ask Anakin — or open it from the classic screens." />;
  }
}

// ─── Training ────────────────────────────────────────────────────────────────

function PhasePage({ index }: { index: number }) {
  const router = useRouter();
  const program = useProgram();
  const schedule = useSchedule();
  const p = program.data?.program ?? program.data?.savedProgram ?? program.data ?? null;
  const phases = programPhases(p);
  const ph = phases[index];
  const raw = p?.phases?.[index];
  const days: any[] = raw?.trainingDays ?? raw?.days ?? [];
  const isCurrent = schedule.data?.phaseName === ph?.name;
  const startWeek = phases.slice(0, index).reduce((s, x) => s + x.weeks, 0) + 1;
  return (
    <PushedPage back="Training" meta={ph ? `Weeks ${startWeek}–${startWeek + ph.weeks - 1}` : null} title={ph?.name ?? 'Phase'} lead={ph?.focus || raw?.description || null} loading={program.isLoading}
      cta={isCurrent ? { label: "Begin today's session", onPress: () => router.push('/(v2)/session' as any) } : null}>
      {days.map((d, i) => {
        const ex: any[] = d.exercises ?? [];
        return (
          <View key={i}>
            <Eyebrow style={{ marginTop: i ? 24 : 0 }}>{d.day || d.name || `Day ${i + 1}`}{d.focus ? ` · ${d.focus}` : ''}</Eyebrow>
            <View style={{ marginTop: 10 }}>
              {ex.map((e, k) => <Row key={k} name={e.name} sub={e.notes || undefined} value={`${e.sets ?? '—'} × ${e.reps ?? '—'}`} last={k === ex.length - 1} />)}
            </View>
          </View>
        );
      })}
    </PushedPage>
  );
}

function DayPage({ date }: { date: string }) {
  const router = useRouter();
  const schedule = useSchedule();
  const shell = useShellOptional();
  const day = (schedule.data?.weekDays ?? []).find((d: any) => String(d.date).slice(0, 10) === date);
  const s = day?.session;
  const ex: any[] = s?.exercises ?? [];
  return (
    <PushedPage back="Training" meta={date} title={s?.name ?? 'Rest'} lead={s?.focus ?? (s ? null : 'A rest day. Anakin reads these as recovery, not absence.')}
      cta={s && day?.isToday && !day?.isLogged ? { label: 'Begin', onPress: () => router.push('/(v2)/session' as any) } : null}
      foot={s ? [{ label: 'Move this day', onPress: () => { shell?.ask(`Can we move ${s.name} from ${date}?`); router.replace('/(v2)' as any); } }] : undefined}>
      {ex.map((e, k) => <Row key={k} name={e.name} sub={e.notes || undefined} value={`${e.sets ?? '—'} × ${e.reps ?? '—'}`} last={k === ex.length - 1} />)}
    </PushedPage>
  );
}

function PastPage() {
  const router = useRouter();
  const q = useCompletedPrograms();
  const list: any[] = q.data?.programs ?? (Array.isArray(q.data) ? q.data : []);
  return (
    <PushedPage back="Training" meta={`${list.length} completed`} title="Past programs" lead="Finished programs are reference — Anakin reads them before writing a new one." loading={q.isLoading}>
      {list.map((c, i) => {
        const st = c.stats ? (typeof c.stats === 'string' ? safeJson(c.stats) : c.stats) : {};
        return <Row key={c.id} name={c.goal || 'Program'} sub={`${fmtMonth(c.startDate)} – ${fmtMonth(c.endDate)} · ${c.durationWeeks ?? '?'} wk${st?.workoutsLogged ? ` · ${st.workoutsLogged} sessions` : ''}`} value={c.reason === 'completed' ? 'done' : 'replaced'} muted last={i === list.length - 1}
          onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `pastprogram:${c.id}` } } as any)} />;
      })}
      {!list.length && !q.isLoading ? <Text style={T.bodyMuted}>Nothing finished yet.</Text> : null}
    </PushedPage>
  );
}

function PastProgramPage({ id }: { id: string }) {
  const [data, setData] = React.useState<any>(null);
  React.useEffect(() => { (apiFetch(`/coach/completed-programs/${id}`) as Promise<any>).then(setData).catch(() => setData({ error: true })); }, [id]);
  const p = data?.program ?? data?.programJson ?? data;
  const prog = typeof p === 'string' ? safeJson(p) : p;
  const phases = programPhases(prog);
  return (
    <PushedPage back="Past programs" title={data?.goal || prog?.goal || 'Program'} meta={data ? `${fmtMonth(data.startDate)} – ${fmtMonth(data.endDate)}` : null} loading={!data} lead={data?.reason === 'completed' ? 'Completed. Anakin reads this before writing the next one.' : data ? 'Replaced before it finished.' : null}>
      {phases.map((ph, i) => <Row key={i} name={ph.name} sub={ph.focus || undefined} value={`${ph.weeks} wk`} last={i === phases.length - 1} />)}
    </PushedPage>
  );
}

function DiagPage() {
  const router = useRouter();
  const q = useDiagnostics();
  const analyses: any[] = q.data?.analyses ?? [];
  const sessions: any[] = q.data?.sessions ?? [];
  return (
    <PushedPage back="Training" meta="Last 90 days" title="Diagnostics" lead="Every form analysis and lift diagnostic Anakin has run. Tap one to see what it saw." loading={q.isLoading}
      foot={[{ label: 'New form analysis', onPress: () => router.push('/form-analysis' as any) }, { label: 'New lift diagnostic', onPress: () => router.push('/diagnostic/conversation' as any) }]}>
      {analyses.length ? <Eyebrow>Form analyses</Eyebrow> : null}
      <View style={{ marginTop: 10 }}>
        {analyses.map((a, i) => <Row key={a.id} name={`${a.lift ?? a.exercise ?? 'Lift'} · ${fmtDay(a.createdAt)}`} sub={a.summary ?? a.primaryIssue ?? (a.status === 'complete' ? 'Complete' : a.status)} value={a.status === 'complete' ? undefined : '…'} arrow last={i === analyses.length - 1} onPress={() => router.push(`/form-analysis?id=${a.id}` as any)} />)}
      </View>
      {sessions.length ? <Eyebrow style={{ marginTop: 28 }}>Lift diagnostics</Eyebrow> : null}
      <View style={{ marginTop: 10 }}>
        {sessions.map((s, i) => {
          const done = s.status === 'completed' || !!s.primaryLimiter;
          const conv = s.flow === 'conversation';
          const to = done ? (conv ? `/diagnostic/report?sessionId=${s.id}` : `/diagnostic/plan?sessionId=${s.id}`) : (conv ? `/diagnostic/conversation?sessionId=${s.id}` : `/diagnostic/chat?sessionId=${s.id}`);
          return <Row key={s.id} name={`${liftName(s.selectedLift)} · ${fmtDay(s.createdAt)}`} sub={s.primaryLimiter ? String(s.primaryLimiter).replace(/_/g, ' ') : done ? 'Complete' : 'In progress'} value={s.confidence ? `${Math.round(s.confidence * 100)}%` : undefined} arrow last={i === sessions.length - 1} onPress={() => router.push(to as any)} />;
        })}
      </View>
      {!analyses.length && !sessions.length && !q.isLoading ? <Text style={T.bodyMuted}>Nothing yet.</Text> : null}
    </PushedPage>
  );
}

// ─── Fuel ────────────────────────────────────────────────────────────────────

function SystemsPage() {
  const router = useRouter();
  const np = useNpDay();
  const systems: any[] = [...(np.data?.systems ?? [])].sort((a, b) => a.score - b.score);
  const worst = systems[0];
  return (
    <PushedPage back="Fuel" meta={np.data?.profileScore != null ? `Profile ${np.data.profileScore}` : null} title="Body systems" lead="How well today's food covers the nutrients behind each system. The profile is capped by the weakest one — a low system can't hide behind four good ones." loading={np.isLoading}
      visual={systems.length ? <Radar axes={systems.map((s) => ({ t: s.name.split(' ')[0], v: String(s.score), r: Math.max(0.05, (s.score - 40) / 60), hot: s.status !== 'ok' }))} band={[(80 - 40) / 60, 1]} size={330} /> : null}>
      {systems.map((s, i) => <Row key={s.id} name={s.name} sub={s.status !== 'ok' ? `Below band · ${(s.chips ?? []).slice(0, 2).join(', ')}` : (s.chips ?? []).slice(0, 3).join(', ')} value={String(s.score)} bigValue emphasis={s === worst} valueStyle={s.status === 'ok' ? { color: v2.color.muted, fontFamily: v2.font.regular } : undefined} last={i === systems.length - 1}
        onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `sys:${s.id}` } } as any)} />)}
    </PushedPage>
  );
}

function SystemPage({ id }: { id: string }) {
  const router = useRouter();
  const shell = useShellOptional();
  const q = useNpEffect(id);
  const d = q.data;
  const drivers = [...(d?.drivers ?? [])].sort((a, b) => a.pct - b.pct);
  return (
    <PushedPage back="Body systems" meta={d ? `7-day` : null} eyebrow={d?.name} title={d ? `${d.score}` : 'System'} hero={d ? { value: String(d.score), unit: d.status === 'ok' ? 'in band' : 'below band' } : null} lead={d?.summary ?? null} loading={q.isLoading} error={q.error ? 'Couldn\'t read this system.' : null} onRetry={() => void q.refetch()}
      proposed={d && d.status !== 'ok' && drivers[0] ? { text: `${drivers[0].label} is the lever — ${drivers[0].pct}% of target.` } : null}
      cta={d && d.status !== 'ok' ? { label: 'Ask Anakin for tonight', onPress: () => { shell?.ask(`What should I eat tonight to bring up ${d.name.toLowerCase()}?`); router.replace('/(v2)' as any); } } : null}>
      {drivers.map((dr, i) => <Row key={dr.key} name={dr.label} value={`${dr.pct}%`} emphasis={dr.pct < 100} muted={dr.pct >= 100} last={i === drivers.length - 1}
        below={<CoverageBar pct={dr.pct} covered={dr.pct >= 100} width={300} />}
        onPress={dr.tracked ? () => router.push({ pathname: '/(v2)/p/[key]', params: { key: `mic:${dr.key}` } } as any) : undefined} />)}
      {d?.watchFor ? <Text style={[T.caption, { marginTop: 18 }]}>{d.watchFor}</Text> : null}
      <Text style={[T.caption, { marginTop: 14 }]}>Sorted by gap. Covered nutrients sink to the bottom and fade.</Text>
    </PushedPage>
  );
}

function MicrosPage() {
  const router = useRouter();
  const np = useNpDay();
  const systems: any[] = np.data?.systems ?? [];
  // Gaps: every tracked driver under 100%, across systems, de-duplicated, worst first.
  const seen = new Map<string, any>();
  for (const s of systems) for (const d of s.drivers ?? []) if (d.tracked && d.pct < 100 && !seen.has(d.key)) seen.set(d.key, d);
  const gaps = [...seen.values()].sort((a, b) => a.pct - b.pct);
  return (
    <PushedPage back="Fuel" meta={np.data?.microCoveragePct != null ? `Coverage ${np.data.microCoveragePct}%` : null} title="Gaps" lead={gaps.length ? `${gaps.length} nutrient${gaps.length === 1 ? '' : 's'} under target today. Only what's short — nothing at 150% pretending to be a problem.` : 'Nothing under target today.'} loading={np.isLoading}>
      {gaps.map((g, i) => <Row key={g.key} name={g.label} value={`${g.pct}%`} bigValue emphasis last={i === gaps.length - 1} below={<CoverageBar pct={g.pct} width={300} />}
        onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `mic:${g.key}` } } as any)} />)}
    </PushedPage>
  );
}

function NutrientPage({ nkey }: { nkey: string }) {
  const router = useRouter();
  const shell = useShellOptional();
  const q = useNpNutrient(nkey);
  const d = q.data;
  const days = (d as any)?.days ?? (d as any)?.daily ?? null;
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <PushedPage back="Gaps" meta="7 days" eyebrow={d?.label} title={d?.label ?? 'Nutrient'} hero={d ? { value: d.current, unit: `of ${d.target}${d.unit ? ` ${d.unit}` : ''}` } : null} lead={d?.why ?? null} loading={q.isLoading} error={q.error ? 'Couldn\'t read this nutrient.' : null} onRetry={() => void q.refetch()}
      visual={Array.isArray(days) && days.length ? <WeekBars values={days.map((x: any) => Number(x.amount ?? x.value ?? 0))} max={Math.max(...days.map((x: any) => Number(x.amount ?? x.value ?? 0)), 1)} labels={days.map((x: any, i: number) => x.label ?? labels[i % 7])} todayIndex={days.length - 1} /> : null}
      proposed={d?.recommendation ? { text: d.recommendation } : null}
      cta={d?.recommendation ? { label: 'Add to meals', onPress: () => { shell?.ask(`Help me add this to my meals: ${d.recommendation}`); router.replace('/(v2)' as any); } } : null}>
      {d?.sources?.length ? <Eyebrow>Where yours came from</Eyebrow> : null}
      <View style={{ marginTop: 10 }}>
        {(d?.sources ?? []).map((s, i) => <Row key={i} name={s.food} value={s.amount} last={i === (d?.sources?.length ?? 0) - 1} />)}
      </View>
      {d?.chain?.length ? <Eyebrow style={{ marginTop: 28 }}>Why it matters</Eyebrow> : null}
      <View style={{ marginTop: 10 }}>
        {(d?.chain ?? []).map((c, i) => <Row key={i} name={c.title} sub={c.body} last={i === (d?.chain?.length ?? 0) - 1} />)}
      </View>
      {d?.watchFor ? <Text style={[T.caption, { marginTop: 18 }]}>{d.watchFor}</Text> : null}
    </PushedPage>
  );
}

function MealPage({ id }: { id: string }) {
  const router = useRouter();
  const meals = useMeals();
  const invalidate = useInvalidate();
  const shell = useShellOptional();
  const rows: any[] = meals.data?.meals ?? meals.data?.entries ?? (Array.isArray(meals.data) ? meals.data : []);
  const m = rows.find((x) => String(x.id) === id);
  const [busy, setBusy] = React.useState(false);
  const fix = (field: 'calories' | 'proteinG' | 'carbsG' | 'fatG', label: string) => {
    Alert.prompt?.(`Fix ${label}`, `Anakin read ${Math.round(m?.[field] ?? 0)}. What should it be?`, async (val) => {
      const n = Number(val); if (!Number.isFinite(n)) return;
      setBusy(true);
      try { await nutritionApi.updateMeal(id, { [field]: n } as any); await invalidate.afterMeal(); } catch (e: any) { Alert.alert('Couldn\'t save', e?.message ?? ''); }
      setBusy(false);
    }, 'plain-text', String(Math.round(m?.[field] ?? 0)), 'numeric') ?? Alert.alert('Fix', 'Ask Anakin: "change the protein on my lunch to 40 g".');
  };
  const remove = () => Alert.alert('Delete this meal?', 'This cannot be undone.', [{ text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await nutritionApi.deleteMeal(id); await invalidate.afterMeal(); router.back(); } catch (e: any) { Alert.alert('Couldn\'t delete', e?.message ?? ''); } } }]);
  const via = String(m?.source ?? '').toLowerCase();
  const lead = /photo|snap/.test(via) ? 'Identified from your photo. Fix any number Anakin got wrong.' : /barcode|scan/.test(via) ? 'Scanned. Label values.' : /describe|voice|text/.test(via) ? 'From your description.' : 'Entered by hand.';
  return (
    <PushedPage back="Fuel" meta={m ? `${m.mealType ?? ''}${via ? ` · via ${via.split('_')[0]}` : ''}` : null} title={m?.name ?? m?.description ?? 'Meal'} lead={m ? lead : null} loading={meals.isLoading}
      foot={m ? [{ label: 'Save as recipe', onPress: () => { shell?.ask(`Save "${m.name ?? m.description}" as a recipe`); router.replace('/(v2)' as any); } }, { label: 'Delete', onPress: remove }] : undefined}>
      {m ? (
        <View>
          <Row name="Calories" sub="Fix" value={`${Math.round(m.calories ?? 0)}`} bigValue onPress={() => fix('calories', 'calories')} />
          <Row name="Protein" sub="Fix" value={`${Math.round(m.proteinG ?? 0)} g`} onPress={() => fix('proteinG', 'protein')} />
          <Row name="Carbs" sub="Fix" value={`${Math.round(m.carbsG ?? 0)} g`} onPress={() => fix('carbsG', 'carbs')} />
          <Row name="Fat" sub="Fix" value={`${Math.round(m.fatG ?? 0)} g`} onPress={() => fix('fatG', 'fat')} last />
          {busy ? <Text style={[T.caption, { marginTop: 10 }]}>Saving…</Text> : null}
        </View>
      ) : <Text style={T.bodyMuted}>That meal isn't in today's list.</Text>}
    </PushedPage>
  );
}

// ─── You ─────────────────────────────────────────────────────────────────────

function StrengthPage() {
  const router = useRouter();
  const s = useStrength();
  const { fromKg, unit } = useUnits();
  const d: any = s.data;
  const lifts: any[] = d?.lifts ?? [];
  const rel: any[] = d?.athleteModel?.relativeStrength ?? [];
  const ratios: any[] = d?.athleteModel?.ratios ?? [];
  const out = ratios.filter((r) => r.status === 'high' || r.status === 'low').length;
  const conf = Math.round((d?.athleteModel?.confidence ?? 0) * 100);
  const read = strengthRead(d);
  const axes = ratios.filter((r) => r.value != null).map((r) => { const k = (r.value - (r.band[0] + r.band[1]) / 2) / (r.band[1] - r.band[0]); return { t: r.name.replace(' : ', ':'), v: r.value.toFixed(2), r: Math.max(0.12, Math.min(1.08, 0.75 + k * 0.35)), hot: r.status !== 'in-band' }; });
  return (
    <PushedPage back="You" meta={conf ? `${conf}% confidence` : null} title="Strength profile" lead={read} loading={s.isLoading}
      visual={axes.length >= 3 ? <Radar axes={axes} band={[0.575, 0.925]} size={330} /> : null}>
      {lifts.slice(0, 6).map((l, i) => {
        const r = rel.find((x) => x.lift === l.canonicalName || l.canonicalName.includes(x.lift));
        return <Row key={l.canonicalName} name={l.canonicalName} sub={r ? `${r.ratioToBw} × BW · ${r.tier}` : `${l.sessionCount} sessions`} value={`${Math.round(fromKg(l.current1RMkg))}`} bigValue last={false}
          onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `lift:${l.canonicalName}` } } as any)} />;
      })}
      <Row name="Ratios" sub={ratios.length ? `${out} of ${ratios.filter((r) => r.status !== 'no-data').length} out of band` : 'Log more lifts to unlock'} onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'ratios' } } as any)} last />
      <Text style={[T.caption, { marginTop: 14 }]}>e1RM in {unit}.</Text>
    </PushedPage>
  );
}

function RatiosPage() {
  const router = useRouter();
  const shell = useShellOptional();
  const s = useStrength();
  const ratios: any[] = s.data?.athleteModel?.ratios ?? [];
  const insights: any[] = s.data?.athleteModel?.insights ?? [];
  const first = ratios.find((r) => r.status === 'high' || r.status === 'low');
  const fix = insights.find((i) => i.kind === 'imbalance' || i.kind === 'stagnation');
  return (
    <PushedPage back="Strength profile" meta="Updated today" title={`${ratios.filter((r) => r.status === 'high' || r.status === 'low').length} of ${ratios.filter((r) => r.status !== 'no-data').length} ratios are out of band.`} lead={first ? first.note : 'Bands are where balanced lifters land. Outside a band is a lead, not a verdict.'} loading={s.isLoading}
      proposed={fix?.ctaHint ? { text: fix.ctaHint } : null}
      cta={fix?.ctaHint ? { label: 'Add to plan', onPress: () => { shell?.ask(`${fix.ctaHint} — can you put that in my program?`); router.replace('/(v2)' as any); } } : null}>
      {ratios.map((r, i) => <Row key={r.id} name={r.name} sub={r.status === 'no-data' ? r.note : `${r.band[0].toFixed(2)}–${r.band[1].toFixed(2)}${r.status !== 'in-band' ? ` · ${r.status}` : ''}`} value={r.value != null ? r.value.toFixed(2) : '—'} emphasis={r.status === 'high' || r.status === 'low'} last={i === ratios.length - 1}
        below={r.value != null ? <RatioBand lo={r.band[0]} hi={r.band[1]} value={r.value} width={300} /> : undefined} />)}
      <Text style={[T.caption, { marginTop: 14 }]}>Grey band — the range for your goal and bodyweight.</Text>
    </PushedPage>
  );
}

function LiftPage({ name }: { name: string }) {
  const s = useStrength();
  const { fromKg, unit } = useUnits();
  const lifts: any[] = s.data?.lifts ?? [];
  const l = lifts.find((x) => x.canonicalName === name) ?? lifts.find((x) => String(x.canonicalName).toLowerCase().includes(name.toLowerCase()));
  const series: number[] = (l?.weekSeries ?? []).map((p: any) => fromKg(p.rm));
  const fc = l?.forecast ? { value: fromKg(l.forecast.value), label: String(l.forecast.week).replace(/^\d{4}-W/, 'wk ') } : null;
  const delta = series.length > 1 ? series[series.length - 1] - series[0] : 0;
  const stalled = (s.data?.athleteModel?.insights ?? []).find((i: any) => i.kind === 'stagnation' && String(i.title).startsWith(l?.canonicalName ?? '—'));
  const lead = stalled ? stalled.detail : l?.forecast?.slopePerWeek > 0 ? `Steady ${fromKg(l.forecast.slopePerWeek).toFixed(1)} ${unit} a week. At this rate ${Math.round(fc!.value)} lands around ${fc!.label}.` : l ? 'Holding. Change the stimulus before adding weight.' : null;
  return (
    <PushedPage back="Strength profile" meta={l ? `${l.weekSeries?.length ?? 0} weeks` : null} eyebrow={l ? `${l.canonicalName} · estimated 1RM` : null} title={l?.canonicalName ?? name} hero={l ? { value: String(Math.round(fromKg(l.current1RMkg))), unit, delta: series.length > 1 ? `${delta >= 0 ? '+' : ''}${Math.round(delta)}` : undefined } : null} lead={lead} loading={s.isLoading}
      visual={series.length > 1 ? <LineForecast series={series} forecast={fc} width={330} unitLabel={unit} /> : null}
      proposed={stalled?.ctaHint ? { text: stalled.ctaHint } : null}>
      <Eyebrow>Sessions</Eyebrow>
      <View style={{ marginTop: 10 }}>
        {(l?.weekSeries ?? []).slice().reverse().map((p: any, i: number, arr: any[]) => <Row key={p.week} name={String(p.week).replace(/^(\d{4})-W(\d{2})$/, 'Week $2 · $1')} value={`${Math.round(fromKg(p.rm))} ${unit}`} last={i === arr.length - 1} />)}
      </View>
    </PushedPage>
  );
}

function BodyPage() {
  const { user } = useAuth();
  const { fromKg, unit } = useUnits();
  const bw = useBodyWeight();
  const logs: any[] = bw.data?.logs ?? [];
  const latest = logs[logs.length - 1];
  const kg = latest?.weightKg ?? (user as any)?.weightKg ?? null;
  const router = useRouter();
  const shell = useShellOptional();
  return (
    <PushedPage back="You" title="Body" lead={kg ? `${fromKg(kg)} ${unit}${logs.length > 6 ? ', logged regularly' : ''}. Anakin uses this for protein and strength ratios.` : 'Log a weight and Anakin can set protein and read your ratios.'}
      cta={{ label: 'Log today\'s weight', onPress: () => { shell?.ask('Log my weight: '); router.replace('/(v2)' as any); } }}>
      <Row name="Weight" sub={latest?.date ? `Logged ${fmtDay(latest.date)}` : undefined} value={kg ? `${fromKg(kg)} ${unit}` : '—'} />
      <Row name="Height" value={(user as any)?.heightCm ? `${(user as any).heightCm} cm` : '—'} />
      <Row name="Training age" value={(user as any)?.trainingAge ?? '—'} />
      <Row name="History" sub={(user as any)?.constraintsText || 'Nothing noted'} last />
    </PushedPage>
  );
}

function StreakPage() {
  const q = useStreak();
  const d = q.data;
  return (
    <PushedPage back="You" title={d ? `${d.currentStreak} days` : 'Streak'} lead="Every day you logged food or trained. Anakin reads consistency before it reads intensity." loading={q.isLoading}>
      <Row name="Longest" value={d ? `${d.longest} days` : '—'} />
      <Row name="This week" value={d ? `${d.thisWeek} of 7` : '—'} />
      <Row name="Active days" value={d ? `${d.activeDays}` : '—'} last />
    </PushedPage>
  );
}

function MemoryPage() {
  const q = useMemory();
  const notes = q.data?.notes ?? [];
  return (
    <PushedPage back="You" meta={`${notes.length} noted`} title="What Anakin knows" lead={'Things you\'ve told him that he keeps between sessions. Say "forget that" in chat to remove one.'} loading={q.isLoading}>
      {notes.map((n, i) => <Row key={i} name={n} last={i === notes.length - 1} />)}
      {!notes.length && !q.isLoading ? <Text style={T.bodyMuted}>Nothing noted yet. It fills in as you talk.</Text> : null}
    </PushedPage>
  );
}

function BillingPage() {
  const { user } = useAuth();
  const pro = user?.tier === 'pro' || user?.tier === 'enterprise';
  const [busy, setBusy] = React.useState(false);
  const portal = async () => {
    setBusy(true);
    try { const r: any = await paymentsApi.getPaymentsPortal(); if (r?.url) await WebBrowser.openBrowserAsync(r.url); else Alert.alert('Manage in the store', 'Your subscription is managed through the App Store or Google Play.'); } catch { Alert.alert('Manage in the store', 'Your subscription is managed through the App Store or Google Play.'); }
    setBusy(false);
  };
  return (
    <PushedPage back="You" title={pro ? 'Pro' : 'Free'} lead={pro ? 'Anakin, unlimited.' : 'Diagnosis is free. Pro is the coach that runs the plan with you.'}
      cta={pro ? { label: 'Manage subscription', onPress: () => void portal(), loading: busy } : { label: 'See Pro', onPress: () => Alert.alert('Upgrade', 'Open the classic Coach tab to upgrade for now.') }}>
      <Row name="Plan" value={pro ? 'Pro' : 'Free'} />
      <Row name="Payment" sub="Managed by the store" last />
    </PushedPage>
  );
}

function PrefsPage() {
  const { unit, toggleUnit } = useUnits();
  const { logout } = useAuth();
  const router = useRouter();
  return (
    <PushedPage back="You" title="Preferences">
      <Row name="Units" value={unit} onPress={() => toggleUnit()} />
      <Row name="Notifications" sub="Only when Anakin needs you" value="Quiet" onPress={() => Linking.openSettings()} />
      <Row name="Sources Anakin can use" sub="Research, your logs" value="On" />
      <Row name="Classic app" sub="The previous tabs, still here" onPress={() => router.push('/(tabs)' as any)} />
      <Row name="Export my data" onPress={() => void WebBrowser.openBrowserAsync('https://api.airthreads.ai/api/auth/export')} />
      <Row name="Sign out" onPress={() => Alert.alert('Sign out?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void logout() }])} last />
    </PushedPage>
  );
}

// ─── Feed ────────────────────────────────────────────────────────────────────

function GroupsPage() {
  const router = useRouter();
  const [data, setData] = React.useState<any>(null);
  React.useEffect(() => { (groupsApi.list() as Promise<any>).then(setData).catch(() => setData({ groups: [] })); }, []);
  const groups: any[] = data?.groups ?? (Array.isArray(data) ? data : []);
  return (
    <PushedPage back="Feed" meta={data ? `${groups.length} group${groups.length === 1 ? '' : 's'}` : null} title="Groups" loading={!data}>
      {groups.map((g, i) => <Row key={g.id} name={g.name} sub={`${g.memberCount ?? g.members?.length ?? '?'} people`} last={false} onPress={() => router.push(`/groups/${g.id}` as any)} />)}
      <Row name="Find a group" onPress={() => router.push('/groups' as any)} last />
    </PushedPage>
  );
}

function LeaderboardPage() {
  const [data, setData] = React.useState<any>(null);
  const [lift, setLift] = React.useState<string | null>(null);
  React.useEffect(() => {
    (async () => {
      try {
        const lifts: any = await socialApi.getLeaderboardLifts();
        const list: string[] = lifts?.lifts ?? (Array.isArray(lifts) ? lifts : []);
        const first = list[0] ?? 'deadlift';
        setLift(first);
        const r: any = await socialApi.getLeaderboard(String(first));
        setData(r);
      } catch { setData({ entries: [] }); }
    })();
  }, []);
  const entries: any[] = data?.entries ?? data?.leaderboard ?? (Array.isArray(data) ? data : []);
  return (
    <PushedPage back="Feed" meta={lift ? liftName(lift) : null} title="Leaderboard" lead="By estimated 1RM on the lift, among people you train with." loading={!data}>
      {entries.slice(0, 20).map((e, i) => <Row key={e.userId ?? e.id ?? i} name={e.name ?? e.username ?? 'Someone'} sub={e.goal ?? e.phase ?? undefined} value={String(e.e1rm ?? e.oneRm ?? e.value ?? e.score ?? e.sessions ?? '—')} bigValue last={i === Math.min(entries.length, 20) - 1} />)}
      {!entries.length && data ? <Text style={T.bodyMuted}>No one on the board yet this week.</Text> : null}
    </PushedPage>
  );
}

function TogetherPage() {
  const router = useRouter();
  const [data, setData] = React.useState<any>(null);
  React.useEffect(() => { (trainTogetherApi.getPins() as Promise<any>).then(setData).catch(() => setData({ pins: [] })); }, []);
  const pins: any[] = data?.pins ?? (Array.isArray(data) ? data : []);
  return (
    <PushedPage back="Feed" meta="Near you" title="Train together" loading={!data}>
      {pins.map((p, i) => <Row key={p.id} name={`${p.hostName ?? p.host?.name ?? 'Someone'} · ${fmtWhen(p.startsAt ?? p.date)}`} sub={[p.sessionName ?? p.title, p.location ?? p.gym].filter(Boolean).join(' · ')} value="Join" last={false} onPress={() => router.push(`/train-together/pin/${p.id}` as any)} />)}
      <Row name="Post a session" onPress={() => router.push('/train-together' as any)} last />
    </PushedPage>
  );
}

function PersonPage({ id, params }: { id: string; params: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const follow = async () => { setBusy(true); try { await socialApi.sendFriendRequest(id); Alert.alert('Request sent'); } catch (e: any) { Alert.alert('Couldn\'t send', e?.message ?? ''); } setBusy(false); };
  return (
    <PushedPage back="Feed" title={params.name || 'Person'} meta={params.goal || null} lead={params.did ? `Latest — ${params.did}${params.whenAt ? `, ${params.whenAt} ago` : ''}` : null}
      cta={id ? { label: 'Follow', onPress: () => void follow(), loading: busy } : null}
      foot={id ? [{ label: 'Full profile', onPress: () => router.push({ pathname: '/social/profile', params: { userId: id } } as any) }] : undefined}>
      {params.did ? <Row name="Latest" sub={params.did} value={params.whenAt} last /> : null}
    </PushedPage>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function safeJson(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
function fmtMonth(d?: string): string { if (!d) return '?'; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); }
function fmtDay(d?: string): string { if (!d) return ''; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }); }
function fmtWhen(d?: string): string { if (!d) return ''; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
function liftName(k?: string): string { return String(k ?? 'Lift').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); }
export { useQueryClient, qk, ReceiptList, TextAction };
