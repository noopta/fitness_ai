// Feed (index 3): activity rows — name + what they did + when. Groups,
// leaderboard and train-together push their own pages. Composing, reactions
// and comments stay on the v1 Social screen under v2 chrome until redesigned.

import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { T, v2 } from '../theme';
import { TabPage, PageTitle } from '../shell/Page';
import { Row } from '../primitives/Row';
import { Enter } from '../primitives/Enter';
import { TextAction } from '../primitives/TextAction';
import { useFeed } from '../data';

function when(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} d`;
}

export function describe(item: any): string {
  const t = String(item?.itemType ?? item?.type ?? '');
  const p = item?.payload ?? {};
  if (item?.caption) return String(item.caption);
  switch (t) {
    case 'workout': case 'workout_log': return p.title ? `logged ${p.title}` : 'logged a session';
    case 'pr': case 'personal_record': return p.exercise ? `hit a PR — ${p.exercise} ${p.weight ?? ''}` : 'hit a PR';
    case 'program': case 'program_started': return p.goal ? `started a new program — ${p.goal}` : 'started a new program';
    case 'streak': return p.days ? `${p.days}-day streak` : 'kept the streak';
    case 'nutrition': case 'meal': return 'logged a meal';
    default: return p.summary || p.text || t.replace(/_/g, ' ') || 'was active';
  }
}

export function FeedPage() {
  const router = useRouter();
  const feed = useFeed();
  const items: any[] = feed.data?.items ?? feed.data?.feed ?? feed.data?.posts ?? (Array.isArray(feed.data) ? feed.data : []);
  const social = items.filter((i) => i?.sharer || i?.author || i?.user);
  return (
    <TabPage refreshing={feed.isFetching} onRefresh={() => void feed.refetch()}>
      <PageTitle title="Feed" caption={social.length ? `${social.length} updates from people you follow` : 'People you follow, what they did, when'} />
      <View style={{ marginTop: 28 }}>
        {social.length === 0 && !feed.isLoading ? (
          <View>
            <Text style={T.bodyMuted}>Nothing yet. Follow someone, or post a session and they'll see it here.</Text>
            <TextAction muted size={15} onPress={() => router.push('/(tabs)/social' as any)} style={{ marginTop: 10 }}>Open the social screen</TextAction>
          </View>
        ) : null}
        {social.slice(0, 30).map((it, i) => {
          const who = it.sharer ?? it.author ?? it.user ?? {};
          const name = who.name || who.username || 'Someone';
          return (
            <Enter key={it.id ?? i} index={Math.min(i, 8) + 1} exit={false}>
              <Row name={name} sub={describe(it)} value={when(it.createdAt)} last={i === social.length - 1}
                onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `person:${who.id ?? ''}`, name, goal: who.goal ?? '', did: describe(it), whenAt: when(it.createdAt) } } as any)} />
            </Enter>
          );
        })}
      </View>
      <View style={{ marginTop: 34 }}>
        <Row name="Groups" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'groups' } } as any)} />
        <Row name="Leaderboard" sub="Sessions completed, not weight lifted" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'leaderboard' } } as any)} />
        <Row name="Train together" sub="Near you" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'together' } } as any)} />
        <Row name="Messages, search, saved" sub="Opens the social screen" onPress={() => router.push('/(tabs)/social' as any)} last />
      </View>
      <Text style={[T.caption, { marginTop: 20, color: v2.color.placeholder }]}>Posting and comments open the social screen for now.</Text>
    </TabPage>
  );
}
