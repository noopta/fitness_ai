// Train Together — pin detail: four states, one screen (spec §08).
//   awaiting  · white card, pulsing "Awaiting <name>" pill, member rows
//   confirmed · dark hero (bg #09090b), session tiles, shared-workout row
//   changed   · dashed card, amber pill (the feature's ONLY color), stacked
//               actions — neutral tone, never error-styled
//   past      · centered afterglow: avatar pair, stat tiles, re-pin row
// State is derived: cancelled pins bounce back; date < today => past.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { trainTogetherApi } from '../../../src/lib/api';
import { useAuth } from '../../../src/context/AuthContext';
import {
  tt, OverlapMark, TTAvatar, PrimaryButton, SecondaryButton, OutlinedButton,
  GhostAction, MicroLabel, Pulse,
} from '../../../src/components/trainTogether/primitives';
import { longDate } from '../../../src/lib/trainTogetherMatch';

interface PinMember {
  userId: string;
  response: 'pending' | 'accepted' | 'declined';
  sharedResponse: 'none' | 'accepted' | 'declined';
  user: { id: string; name: string | null; username: string | null; avatarBase64: string | null; splitLabel: string | null };
  session: { rest: boolean; label: string | null; muscles: string[] };
}
interface PinDetail {
  id: string; date: string; creatorId: string; note: string | null;
  status: 'pending' | 'confirmed' | 'changed' | 'cancelled';
  tier: string; reason: string | null;
  sharedSession: any | null;
  members: PinMember[];
}

const memberName = (m: PinMember) => m.user.name || m.user.username || 'Friend';
const firstOf = (m: PinMember) => memberName(m).split(' ')[0];
const avatarUri = (b64: string | null) =>
  b64 ? (b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`) : null;

const BackChevron = ({ color = tt.ink }: { color?: string }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path d="M15 18l-6-6 6-6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const Check = ({ size = 10, color = tt.ink, stroke = 3.2 }: { size?: number; color?: string; stroke?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 12l6 6L20 6" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

function todayEST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default function PinDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pin, setPin] = useState<PinDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res: any = await trainTogetherApi.getPin(String(id));
      setPin(res);
    } catch {
      setPin(null);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const me = useMemo(() => pin?.members.find(m => m.userId === user?.id) ?? null, [pin, user?.id]);
  const others = useMemo(() => (pin?.members ?? []).filter(m => m.userId !== user?.id), [pin, user?.id]);
  const isPast = pin ? pin.date < todayEST() && pin.status !== 'cancelled' : false;
  const state: 'awaiting' | 'confirmed' | 'changed' | 'past' | 'cancelled' =
    !pin ? 'awaiting'
    : isPast ? 'past'
    : pin.status === 'pending' ? 'awaiting'
    : (pin.status as any);

  async function keepIt() {
    try { await trainTogetherApi.respondToPin(pin!.id, 'accepted'); load(); }
    catch (err: any) { Alert.alert("Couldn't update", err?.message ?? 'Please try again.'); }
  }
  function cancelPin() {
    const mine = pin!.creatorId === user?.id;
    Alert.alert(mine ? 'Cancel the pin?' : 'Leave this pin?', longDate(pin!.date), [
      { text: 'Keep it', style: 'cancel' },
      {
        text: mine ? 'Cancel the pin' : 'Leave pin', style: 'destructive',
        onPress: async () => {
          try { await trainTogetherApi.deletePin(pin!.id); router.back(); }
          catch (err: any) { Alert.alert('Failed', err?.message ?? 'Please try again.'); }
        },
      },
    ]);
  }

  const awaitingNames = others.filter(m => m.response === 'pending').map(firstOf);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => pressed && { opacity: 0.82 }}>
          <BackChevron />
        </Pressable>
        <Text style={s.title}>Your pin</Text>
        <View style={{ width: 20 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={tt.ink} /></View>
      ) : !pin ? (
        <View style={s.center}><Text style={s.mutedText}>This pin is gone.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* ── AWAITING ─────────────────────────────────────────────────── */}
          {state === 'awaiting' && (
            <>
              <View style={s.whiteCard}>
                <View style={s.cardTopRow}>
                  <OverlapMark width={30} height={20} color={tt.ink} variant="solid" />
                  {awaitingNames.length > 0 && (
                    <Pulse>
                      <View style={s.awaitPill}>
                        <Text style={s.awaitPillText}>Awaiting {awaitingNames.join(' + ')}</Text>
                      </View>
                    </Pulse>
                  )}
                </View>
                <Text style={s.bigDate}>{longDate(pin.date)}</Text>
                {!!pin.note && <Text style={s.noteText}>{pin.note}</Text>}
                <View style={s.memberRows}>
                  {pin.members.map(m => (
                    <View key={m.userId} style={s.memberRow}>
                      <TTAvatar name={memberName(m)} self={m.userId === user?.id} size={28} uri={avatarUri(m.user.avatarBase64)} />
                      <Text style={s.memberLine} numberOfLines={1}>
                        <Text style={{ fontWeight: '600' }}>{m.userId === user?.id ? 'You' : firstOf(m)}</Text>
                        {!m.session.rest && m.session.label ? ` · ${m.session.label}` : ' · Rest'}
                      </Text>
                      <Text style={s.memberStatus}>
                        {m.userId === pin.creatorId ? '✓ Created' : m.response === 'accepted' ? '✓ In' : m.response === 'declined' ? 'Declined' : 'Invited'}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={s.caption}>We'll nudge no one — invites expire quietly if ignored.</Text>
              {me && me.response === 'pending' && (
                <PrimaryButton label="I'm in" onPress={keepIt} style={{ marginTop: 16 }} />
              )}
              <GhostAction label={pin.creatorId === user?.id ? 'Cancel the pin' : 'Leave pin'} onPress={cancelPin} style={{ marginTop: 8 }} />
            </>
          )}

          {/* ── CONFIRMED ────────────────────────────────────────────────── */}
          {state === 'confirmed' && (
            <>
              <View style={s.darkHero}>
                <View style={s.cardTopRow}>
                  <OverlapMark width={30} height={20} color={tt.white} variant="solid" />
                  <View style={s.confirmedPill}>
                    <Check size={10} color={tt.ink} />
                    <Text style={s.confirmedPillText}>Confirmed</Text>
                  </View>
                </View>
                <Text style={[s.bigDate, { color: tt.white }]}>{longDate(pin.date)}</Text>
                <Text style={s.darkMeta}>
                  With {others.map(firstOf).join(' + ')}{pin.note ? ` · ${pin.note}` : ''}
                </Text>
                <View style={s.tileRow}>
                  {pin.members.map(m => (
                    <View key={m.userId} style={s.sessionTile}>
                      <MicroLabel style={{ color: 'rgba(255,255,255,0.55)' }}>
                        {m.userId === user?.id ? 'You' : firstOf(m)}
                      </MicroLabel>
                      <Text style={s.tileSession} numberOfLines={1}>
                        {m.session.rest ? 'Rest — joining' : m.session.label ?? '—'}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Build us a shared workout */}
              <Pressable
                onPress={() => router.push(`/train-together/review/${pin.id}`)}
                style={({ pressed }) => [s.sharedRow, pressed && { opacity: 0.82 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.sharedRowTitle}>
                    {me?.sharedResponse === 'accepted' ? 'Shared session locked in' : 'Build us a shared workout'}
                  </Text>
                  <Text style={s.sharedRowSub}>
                    {me?.sharedResponse === 'accepted'
                      ? 'It replaced your session for this day only'
                      : 'One session that fits everyone — optional'}
                  </Text>
                </View>
                {me?.sharedResponse === 'accepted'
                  ? <View style={s.lockedCheck}><Check size={11} color={tt.white} /></View>
                  : <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                      <Path d="M9 6l6 6-6 6" stroke={tt.muted} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>}
              </Pressable>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                <PrimaryButton label="Done" onPress={() => router.back()} style={{ flex: 1 }} />
                <OutlinedButton label="Leave pin" muted onPress={cancelPin} style={{ width: 104 }} />
              </View>
            </>
          )}

          {/* ── CHANGED ──────────────────────────────────────────────────── */}
          {state === 'changed' && (
            <>
              <View style={s.changedCard}>
                <View style={s.cardTopRow}>
                  <OverlapMark width={30} height={20} color={tt.ink} variant="broken" />
                  <View style={s.changedPill}>
                    <Text style={s.changedPillText}>Schedule changed</Text>
                  </View>
                </View>
                <Text style={s.bigDate}>{longDate(pin.date)}</Text>
                <View style={s.memberRows}>
                  {pin.members.map(m => (
                    <View key={m.userId} style={s.memberRow}>
                      <TTAvatar name={memberName(m)} self={m.userId === user?.id} size={28} uri={avatarUri(m.user.avatarBase64)} />
                      <Text style={s.memberLine} numberOfLines={1}>
                        <Text style={{ fontWeight: '600' }}>{m.userId === user?.id ? 'You' : firstOf(m)}</Text>
                        {!m.session.rest && m.session.label ? ` · ${m.session.label}` : ' · Rest'}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={s.explainBlock}>
                  <Text style={s.explainText}>
                    {pin.reason
                      ? `${pin.reason}.`
                      : "These days don't line up like they did when you pinned."}{' '}
                    Plenty of pairs still lift side by side — your call.
                  </Text>
                </View>
              </View>
              <View style={{ gap: 8, marginTop: 16 }}>
                <PrimaryButton label="Keep it — we'll still train together" onPress={keepIt} />
                <SecondaryButton label="Find a new day" onPress={() => {
                  const ids = others.map(o => o.userId).join(',');
                  router.push({ pathname: '/train-together/calendar', params: { friendIds: ids } });
                }} />
                <GhostAction label="Cancel the pin" onPress={cancelPin} />
              </View>
            </>
          )}

          {/* ── PAST ─────────────────────────────────────────────────────── */}
          {state === 'past' && (
            <View style={{ alignItems: 'center', paddingTop: 24 }}>
              <View style={{ flexDirection: 'row' }}>
                {[me, ...others].filter(Boolean).slice(0, 2).map((m, i) => (
                  <TTAvatar
                    key={m!.userId} name={memberName(m!)} self={m!.userId === user?.id} size={44}
                    uri={avatarUri(m!.user.avatarBase64)}
                    style={{ marginLeft: i === 0 ? 0 : -12, borderWidth: 3, borderColor: tt.white, ...({ shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 3 } as any) }}
                  />
                ))}
              </View>
              <Text style={s.pastTitle}>
                You and {others.map(firstOf).join(' + ')} trained together.
              </Text>
              <Text style={s.pastMeta}>{longDate(pin.date)}{pin.note ? ` · ${pin.note}` : ''}</Text>
              <View style={s.statRow}>
                {[
                  { n: String(pin.members.length), c: 'lifters' },
                  { n: String(pin.sharedSession?.exercises?.length ?? me?.session.muscles.length ?? '—'), c: pin.sharedSession ? 'exercises' : 'muscle groups' },
                  { n: pin.tier === 'exact' ? 'Exact' : pin.tier === 'strong' ? 'Strong' : 'Joined', c: 'match' },
                ].map(t => (
                  <View key={t.c} style={s.statTile}>
                    <Text style={s.statNum}>{t.n}</Text>
                    <Text style={s.statCaption}>{t.c.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
              <Pressable
                onPress={() => {
                  const ids = others.map(o => o.userId).join(',');
                  router.push({ pathname: '/train-together/calendar', params: { friendIds: ids } });
                }}
                style={({ pressed }) => [s.repinRow, pressed && { opacity: 0.82 }]}
              >
                <Text style={s.repinText}>Find your next day together</Text>
                <View style={s.repinPill}><Text style={s.repinPillText}>Pin it</Text></View>
              </Pressable>
            </View>
          )}

          {state === 'cancelled' && (
            <View style={s.center}><Text style={s.mutedText}>This pin was cancelled.</Text></View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: tt.white },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  mutedText: { fontSize: 12.5, color: tt.muted },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8,
  },
  title: { fontSize: 16, fontWeight: '600', letterSpacing: -0.32, color: tt.ink },
  scroll: { padding: 20, paddingBottom: 48 },

  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  whiteCard: { borderWidth: 1, borderColor: tt.hairline, borderRadius: 20, padding: 18 },
  awaitPill: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: tt.dim,
    borderRadius: 9999, paddingVertical: 4, paddingHorizontal: 10,
  },
  awaitPillText: { fontSize: 10, fontWeight: '600', color: tt.muted },
  bigDate: { fontSize: 24, fontWeight: '700', letterSpacing: -0.48, color: tt.ink, marginTop: 12 },
  noteText: { fontSize: 12.5, color: tt.muted, marginTop: 2 },
  memberRows: { borderTopWidth: 1, borderTopColor: tt.surface, marginTop: 14, paddingTop: 14, gap: 7 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberLine: { flex: 1, fontSize: 12.5, color: tt.ink },
  memberStatus: { fontSize: 10, fontWeight: '600', color: tt.muted },
  caption: { fontSize: 11, color: tt.muted, textAlign: 'center', marginTop: 10 },

  darkHero: { backgroundColor: tt.ink, borderRadius: 20, padding: 20 },
  confirmedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: tt.white, borderRadius: 9999, paddingVertical: 4, paddingHorizontal: 10,
  },
  confirmedPillText: { fontSize: 10, fontWeight: '700', color: tt.ink },
  darkMeta: { fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  tileRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  sessionTile: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  tileSession: { fontSize: 13, fontWeight: '600', color: tt.white, marginTop: 2 },

  sharedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: tt.hairline, borderRadius: 16,
    paddingVertical: 13, paddingHorizontal: 14, marginTop: 12,
  },
  sharedRowTitle: { fontSize: 12.5, fontWeight: '600', color: tt.ink },
  sharedRowSub: { fontSize: 11, color: tt.muted, marginTop: 1 },
  lockedCheck: {
    width: 21, height: 21, borderRadius: 11, backgroundColor: tt.ink,
    alignItems: 'center', justifyContent: 'center',
  },

  changedCard: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: tt.dim,
    borderRadius: 20, padding: 18,
  },
  changedPill: { backgroundColor: tt.warnSoft, borderRadius: 9999, paddingVertical: 4, paddingHorizontal: 10 },
  changedPillText: { fontSize: 10, fontWeight: '700', color: tt.warnInk },
  explainBlock: { backgroundColor: tt.surface, borderRadius: 12, padding: 12, marginTop: 14 },
  explainText: { fontSize: 12.5, color: tt.ink, lineHeight: 19 },

  pastTitle: { fontSize: 21, fontWeight: '700', letterSpacing: -0.42, color: tt.ink, marginTop: 14, textAlign: 'center' },
  pastMeta: { fontSize: 12.5, color: tt.muted, marginTop: 4 },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 18, alignSelf: 'stretch' },
  statTile: {
    flex: 1, borderWidth: 1, borderColor: tt.hairline, borderRadius: 14,
    paddingVertical: 13, paddingHorizontal: 8, alignItems: 'center',
  },
  statNum: { fontSize: 22, fontWeight: '700', letterSpacing: -0.44, color: tt.ink },
  statCaption: { fontSize: 9.5, color: tt.muted, marginTop: 2, letterSpacing: 0.8 },
  repinRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch',
    borderWidth: 1, borderColor: tt.hairline, borderRadius: 16,
    paddingVertical: 13, paddingHorizontal: 14, marginTop: 18,
  },
  repinText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: tt.ink },
  repinPill: { backgroundColor: tt.ink, borderRadius: 9999, paddingVertical: 8, paddingHorizontal: 14 },
  repinPillText: { fontSize: 12, fontWeight: '600', color: tt.white },
});
