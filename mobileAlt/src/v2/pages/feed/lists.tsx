// The Feed's other lists — Groups, Leaderboard, Train together. Rendered
// under the Feed tab's text links (they swap the list, no push) and inside
// their own pushed pages for chat Open → links.

import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Row } from '../../primitives/Row';
import { T } from '../../theme';
import { useGroups } from '../../data';

export const groupsOf = (data: any): any[] => data?.groups ?? (Array.isArray(data) ? data : []);

export function GroupsList() {
  const router = useRouter();
  const q = useGroups();
  const groups = groupsOf(q.data);
  if (q.isLoading) return <Text style={T.caption}>Reading…</Text>;
  return (
    <View>
      {groups.map((g) => <Row key={g.id} name={g.name} sub={`${g.memberCount ?? g.members?.length ?? '?'} people`} onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `group:${g.id}` } } as any)} />)}
      <Row name={groups.length ? 'Find a group' : 'Find or start a group'} onPress={() => router.push('/groups' as any)} last />
    </View>
  );
}
