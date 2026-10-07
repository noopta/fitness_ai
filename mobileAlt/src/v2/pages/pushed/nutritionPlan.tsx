// Nutrition plan (bug fixes 5 Oct 2026, 2b): pushed from Fuel's Plan row or a
// Proposal card's Open →. Detail template — back, meta "Week 2 of 8",
// eyebrow, headline, Anakin's read — then four groups: focus nutrients, the
// gut this week, the supplement, sources. Every change to the plan happens in
// chat as a Proposal card: "Rebuild plan" asks for the NTP-05 proposal, the
// Ask line opens the composer.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Pressable } from '../../primitives/Pressable';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { TextAction } from '../../primitives/TextAction';
import { CoverageBar } from '../../charts';
import { useNutritionPlan } from '../../data';
import { useShellOptional } from '../../shell/ShellContext';
import { haptics } from '../../haptics';
import { v2, T } from '../../theme';
import type { NutritionPlanSummary } from '../../api';

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pct = (n: number, of: number) => (of > 0 ? (n / of) * 100 : 0);
/** "Iron, vitamin D" — first word capitalised, the rest lower. */
export const focusList = (names: string[]) => names.map((s, i) => (i ? s.charAt(0).toLowerCase() + s.slice(1) : s)).join(', ');

export function NutritionPlanPage() {
  const router = useRouter();
  const shell = useShellOptional();
  const q = useNutritionPlan();
  const p = q.data;
  const toChat = (send: (s: NonNullable<typeof shell>) => void) => { if (!shell) return; send(shell); router.replace('/(v2)' as any); };

  if (q.isSuccess && !p) {
    return (
      <PushedPage back="Fuel" eyebrow="Nutrition plan" title="No plan yet" lead="Answer the gut check-in — 13 quick questions — and I'll build focus nutrients and a gut protocol around how you eat."
        cta={{ label: 'Start the check-in', onPress: () => toChat((s) => s.ask('Start my gut and nutrition questions.')) }} />
    );
  }

  return (
    <PushedPage
      back="Fuel"
      meta={p ? `Week ${p.week} of ${p.weeks}` : null}
      eyebrow="Nutrition plan"
      title={p ? headline(p) : 'Plan'}
      lead={p ? read(p) : null}
      loading={q.isLoading}
      error={q.isError ? 'Couldn’t load your plan.' : null}
      onRetry={() => void q.refetch()}
      refreshing={q.isFetching && !q.isLoading}
      onRefresh={() => void q.refetch()}
    >
      {p ? (
        <View>
          <Eyebrow>Focus nutrients</Eyebrow>
          <View style={styles.group}>
            {p.focus.map((f, i) => (
              <Row key={f.key} name={f.nutrient} value={`${num(f.amount)} / ${num(f.target)} ${f.unit}`} valueStyle={{ color: v2.color.ink }}
                below={<CoverageBar pct={pct(f.amount, f.target)} width="100%" />} last={i === p.focus.length - 1}
                onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `mic:${f.key}` } } as any)} />
            ))}
          </View>

          <Eyebrow style={styles.eyebrow}>Gut · this week</Eyebrow>
          <View style={styles.group}>
            <Row name="Plants" value={`${p.gut.plants.n} / ${p.gut.plants.target}`} valueStyle={{ color: v2.color.ink }} below={<CoverageBar pct={pct(p.gut.plants.n, p.gut.plants.target)} width="100%" />} />
            <Row name="Fiber" value={`${num(p.gut.fiberG.n)} / ${num(p.gut.fiberG.target)} g a day`} />
            <Row name="Fermented" value={`${p.gut.fermentedDays.n} / ${p.gut.fermentedDays.target} days`} />
            <Row name="Ultra-processed" value={`${p.gut.upfPct.n}% · max ${p.gut.upfPct.max}%`} last />
          </View>

          {p.supplements.length ? (
            <>
              <Eyebrow style={styles.eyebrow}>Supplement</Eyebrow>
              <View style={styles.group}>
                {p.supplements.map((s, i) => <Row key={s.name} name={s.name} sub={[s.dose, s.when].filter(Boolean).join(' · ')} last={i === p.supplements.length - 1} />)}
              </View>
            </>
          ) : null}

          {p.sources.length ? (
            <>
              <Eyebrow style={styles.eyebrow}>Sources</Eyebrow>
              <View style={styles.group}>
                <Row name={`${p.sources.length} ${p.sources.length === 1 ? 'source' : 'sources'}`} sub="What this plan is built on" last
                  onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'plansources' } } as any)} />
              </View>
            </>
          ) : null}

          <View style={styles.foot}>
            <TextAction muted size={15} onPress={() => toChat((s) => s.ask('Rebuild my nutrition plan.'))}>Rebuild plan</TextAction>
            <Pressable onPress={() => { haptics.select(); toChat((s) => s.prefill('')); }} accessibilityRole="button" accessibilityLabel="Ask Anakin about your plan" style={{ marginTop: 18 }}>
              <Text style={T.bodyMuted}>Ask Anakin — e.g. raise my fiber target</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </PushedPage>
  );
}

/** Sources in the MEM-06 format: title, then where it's from; tap opens it. */
export function PlanSourcesPage() {
  const q = useNutritionPlan();
  const list = q.data?.sources ?? [];
  return (
    <PushedPage back="Plan" meta={q.data ? `${list.length} ${list.length === 1 ? 'source' : 'sources'}` : null} title="Sources" lead="What your plan's focus nutrients and gut protocol are built on." loading={q.isLoading}>
      {list.map((s, i) => (
        <Row key={s.id} name={s.title} sub={s.detail || (s.type === 'podcast' ? 'Podcast' : 'Research library')} last={i === list.length - 1}
          onPress={s.url ? () => void WebBrowser.openBrowserAsync(String(s.url)) : undefined} />
      ))}
    </PushedPage>
  );
}

/** ≤ 2 lines: what the plan is about. */
function headline(p: NutritionPlanSummary): string {
  const names = p.focus.slice(0, 2).map((f) => f.nutrient);
  return names.length ? `Gut first, then ${focusList(names).replace(/^./, (c) => c.toLowerCase())}.` : 'Gut first.';
}

/** Anakin's read: how the week is going, then the plan's own summary sentence. */
function read(p: NutritionPlanSummary): string {
  const behind = p.focus.filter((f) => !f.onTrack).map((f) => f.nutrient);
  const status = p.total
    ? p.onTrack === p.total ? `All ${p.total} focus nutrients on track this week.`
      : `${p.onTrack} of ${p.total} on track. ${focusList(behind.slice(0, 2))} ${behind.length === 1 ? 'is' : 'are'} short.`
    : '';
  const first = String(p.plan?.summary ?? '').split(/(?<=[.!?])\s+/)[0] ?? '';
  return [status, first].filter(Boolean).join(' ');
}

const styles = StyleSheet.create({
  group: { marginTop: 10 },
  eyebrow: { marginTop: 30 },
  foot: { marginTop: 40, paddingTop: 20, borderTopWidth: 1, borderTopColor: v2.color.hairline },
});
