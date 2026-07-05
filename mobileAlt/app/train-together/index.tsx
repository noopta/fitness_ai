// Train Together — friend picker ("Who's lifting?") + first-run consent
// sheet. Recreated from the RN implementation spec v1.1 §05 (picker) and §06
// (consent). The consent sheet shows once, before the picker is usable, and
// "Not now" still proceeds — the user just isn't visible to friends.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path } from 'react-native-svg';
import { trainTogetherApi, groupsApi } from '../../src/lib/api';
import {
  tt, shadowSm, OverlapMark, TTAvatar, TTAvatarStack, SplitBadge,
  PrimaryButton, GhostAction, MicroLabel, TTSheet,
} from '../../src/components/trainTogether/primitives';

const CONSENT_SEEN_KEY = '@tt_consent_seen';

interface TTFriend {
  id: string; name: string | null; username: string | null;
  avatarBase64: string | null; splitLabel: string | null;
  sharing: boolean; hasProgram: boolean; selectable: boolean;
}
interface Crew { id: string; name: string; memberIds: string[]; sharingIds: string[] }

const avatarUri = (b64: string | null) =>
  b64 ? (b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`) : null;
const displayName = (f: TTFriend) => f.name || f.username || 'Friend';
const firstName = (f: TTFriend) => displayName(f).split(' ')[0];

const BackChevron = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path d="M15 18l-6-6 6-6" stroke={tt.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const CheckIcon = ({ size = 10, color = tt.white, stroke = 3 }: { size?: number; color?: string; stroke?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 12l6 6L20 6" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export default function WhosLiftingScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState<TTFriend[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [consentVisible, setConsentVisible] = useState(false);
  const [asked, setAsked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [friendsRes, sharingRes, groupsRes, seen] = await Promise.all([
        trainTogetherApi.getFriends(),
        trainTogetherApi.getSharing(),
        groupsApi.list().catch(() => null),
        AsyncStorage.getItem(CONSENT_SEEN_KEY),
      ]);
      const list: TTFriend[] = Array.isArray(friendsRes) ? friendsRes : [];
      setFriends(list);

      const selectableIds = new Set(list.filter(f => f.selectable).map(f => f.id));
      const groups: any[] = (groupsRes as any)?.groups ?? [];
      setCrews(groups
        .map(g => {
          const memberIds: string[] = (g.members ?? []).map((m: any) => m.user?.id ?? m.userId).filter(Boolean);
          return {
            id: g.id, name: g.name,
            memberIds,
            sharingIds: memberIds.filter(id => selectableIds.has(id)),
          };
        })
        .filter(c => c.memberIds.length > 0));

      // Consent: once, on first entry, before the picker — unless already sharing.
      if (!seen && !(sharingRes as any)?.scheduleSharing) setConsentVisible(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectCrew = (crew: Crew) => {
    const allSelected = crew.sharingIds.length > 0 && crew.sharingIds.every(id => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(crew.sharingIds));
  };

  const ask = async (f: TTFriend) => {
    setAsked(prev => new Set(prev).add(f.id));
    try { await trainTogetherApi.nudge(f.id); } catch { /* one-shot, quiet */ }
  };

  async function consentChoice(turnOn: boolean) {
    setConsentVisible(false);
    AsyncStorage.setItem(CONSENT_SEEN_KEY, '1').catch(() => {});
    if (turnOn) {
      try { await trainTogetherApi.setSharing(true); } catch { Alert.alert("Couldn't turn on sharing", 'You can enable it any time from Settings.'); }
    }
  }

  const selectedFriends = useMemo(() => friends.filter(f => selected.has(f.id)), [friends, selected]);
  const footerNames = selectedFriends.length
    ? `You + ${selectedFriends.map(firstName).join(' + ')}`
    : 'Pick at least one friend';

  const findDays = () => {
    if (!selected.size) return;
    router.push({ pathname: '/train-together/calendar', params: { friendIds: [...selected].join(',') } });
  };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => pressed && { opacity: 0.82 }}>
          <BackChevron />
        </Pressable>
        <Text style={s.title}>Who's lifting?</Text>
        <View style={{ width: 20 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={tt.ink} /></View>
      ) : (
        <>
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            {/* YOUR CREWS */}
            {crews.length > 0 && (
              <>
                <MicroLabel style={{ marginTop: 16 }}>Your crews</MicroLabel>
                <View style={s.crewRow}>
                  {crews.map(crew => {
                    const sel = crew.sharingIds.length > 0 && crew.sharingIds.every(id => selected.has(id))
                      && selected.size === crew.sharingIds.length;
                    const members = crew.memberIds
                      .map(id => friends.find(f => f.id === id))
                      .filter(Boolean) as TTFriend[];
                    return (
                      <Pressable key={crew.id} onPress={() => selectCrew(crew)}
                        style={({ pressed }) => [
                          s.crewCard, sel ? [{ borderColor: tt.ink }, shadowSm] : { borderColor: tt.hairline },
                          pressed && { opacity: 0.82 },
                        ]}>
                        <View style={{ flexDirection: 'row' }}>
                          {members.slice(0, 4).map((m, i) => (
                            <TTAvatar key={m.id} name={displayName(m)} size={22} uri={avatarUri(m.avatarBase64)}
                              style={{ marginLeft: i === 0 ? 0 : -7, borderWidth: 1.5, borderColor: tt.white }} />
                          ))}
                        </View>
                        <Text style={s.crewName} numberOfLines={1}>{crew.name}</Text>
                        <Text style={s.crewMeta}>
                          {crew.sharingIds.length
                            ? `${crew.sharingIds.length} sharing`
                            : 'Nobody sharing yet'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {/* OR PICK FRIENDS */}
            <MicroLabel style={{ marginTop: 20 }}>{crews.length ? 'Or pick friends' : 'Pick friends'}</MicroLabel>
            <View style={{ marginTop: 4 }}>
              {friends.map(f => {
                const sel = selected.has(f.id);
                const status = f.selectable
                  ? 'Sharing their schedule'
                  : !f.sharing ? "Hasn't shared their schedule" : 'No active program';
                return (
                  <Pressable
                    key={f.id}
                    disabled={!f.selectable}
                    onPress={() => toggle(f.id)}
                    style={({ pressed }) => [s.friendRow, pressed && f.selectable && { opacity: 0.82 }]}
                  >
                    <View style={[s.friendRowInner, !f.selectable && { opacity: 0.55 }]}>
                      <TTAvatar name={displayName(f)} size={32} uri={avatarUri(f.avatarBase64)} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.friendName}>{displayName(f)}</Text>
                        <Text style={s.friendStatus}>{status}</Text>
                      </View>
                      <SplitBadge label={f.splitLabel} />
                    </View>
                    {f.selectable ? (
                      <View style={[s.checkCircle, sel ? s.checkCircleSel : s.checkCircleIdle]}>
                        {sel && <CheckIcon />}
                      </View>
                    ) : !f.sharing ? (
                      <Pressable onPress={() => ask(f)} disabled={asked.has(f.id)}
                        style={({ pressed }) => [s.askPill, pressed && { opacity: 0.82 }, asked.has(f.id) && { opacity: 0.5 }]}>
                        <Text style={s.askText}>{asked.has(f.id) ? 'Asked' : 'Ask'}</Text>
                      </Pressable>
                    ) : (
                      <View style={{ width: 20 }} />
                    )}
                  </Pressable>
                );
              })}
              {friends.length === 0 && (
                <Text style={s.emptyText}>
                  Add friends on Axiom first — then find the days your training lines up.
                </Text>
              )}
            </View>
          </ScrollView>

          {/* Sticky footer */}
          <View style={s.footer}>
            {selectedFriends.length > 0 && (
              <TTAvatarStack size={28} people={[{ name: 'You', self: true },
                ...selectedFriends.map(f => ({ name: displayName(f), uri: avatarUri(f.avatarBase64) }))]} />
            )}
            <Text style={s.footerNames} numberOfLines={1}>{footerNames}</Text>
            <Pressable
              disabled={selected.size === 0}
              onPress={findDays}
              style={({ pressed }) => [s.cta, selected.size === 0 && { opacity: 0.4 }, pressed && { opacity: 0.82 }]}
            >
              <Text style={s.ctaText}>Find our days</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* ── Consent sheet — first run (§06) ────────────────────────────────── */}
      <TTSheet visible={consentVisible} onClose={() => consentChoice(false)}>
        <View style={{ alignItems: 'center' }}>
          <OverlapMark width={52} height={36} color={tt.ink} variant="solid" />
          <Text style={s.consentTitle}>First — share your schedule?</Text>
          <Text style={s.consentBody}>
            Train Together works by comparing calendars. Friends you've accepted will see which
            days are 'Push', 'Upper' or 'Rest'.
          </Text>
        </View>

        {/* Scope ledger — this exact table, do not paraphrase */}
        <View style={s.ledger}>
          {([
            ['Session types', 'Visible'],
            ['Rest days', 'Visible'],
            ['Lifts, weights, logs', 'Never'],
            ['Body data', 'Never'],
          ] as const).map(([k, v]) => (
            <View key={k} style={s.ledgerRow}>
              <Text style={s.ledgerKey}>{k}</Text>
              <Text style={[s.ledgerVal, { color: v === 'Visible' ? tt.ink : tt.muted }]}>{v}</Text>
            </View>
          ))}
        </View>

        <PrimaryButton label="Turn on sharing" onPress={() => consentChoice(true)} style={{ marginTop: 16 }} />
        <GhostAction label="Not now" onPress={() => consentChoice(false)} style={{ marginTop: 12 }} />
      </TTSheet>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: tt.white },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8,
  },
  title: { fontSize: 16, fontWeight: '600', letterSpacing: -0.32, color: tt.ink },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },

  crewRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  crewCard: { flex: 1, borderWidth: 1, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 12, backgroundColor: tt.white },
  crewName: { fontSize: 12.5, fontWeight: '700', color: tt.ink, marginTop: 8 },
  crewMeta: { fontSize: 10.5, color: tt.muted, marginTop: 1 },

  friendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: tt.surface,
  },
  friendRowInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  friendName: { fontSize: 13, fontWeight: '600', color: tt.ink },
  friendStatus: { fontSize: 10.5, color: tt.muted, marginTop: 1 },
  checkCircle: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkCircleSel: { backgroundColor: tt.ink },
  checkCircleIdle: { borderWidth: 1.5, borderColor: '#d4d4d8' },
  askPill: {
    borderWidth: 1, borderColor: tt.hairline, borderRadius: 9999,
    paddingVertical: 5, paddingHorizontal: 10,
  },
  askText: { fontSize: 11, fontWeight: '600', color: tt.ink },
  emptyText: { fontSize: 12.5, color: tt.muted, marginTop: 12, lineHeight: 18 },

  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: tt.hairline,
    paddingVertical: 12, paddingHorizontal: 20,
  },
  footerNames: { flex: 1, fontSize: 11.5, color: tt.muted },
  cta: { backgroundColor: tt.ink, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 18 },
  ctaText: { fontSize: 13, fontWeight: '600', color: tt.white },

  consentTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, color: tt.ink, marginTop: 14, textAlign: 'center' },
  consentBody: { fontSize: 12.5, color: tt.muted, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  ledger: { marginTop: 16, backgroundColor: tt.surface, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 15 },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  ledgerKey: { fontSize: 12, color: tt.ink },
  ledgerVal: { fontSize: 12, fontWeight: '600' },
});
