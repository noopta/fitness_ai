// Train Together — shared session review: "One session, two fits." (spec §10)
// One generated workout that both (all) members can run side by side; a fit
// tab per member explains what it costs them (usually nothing). Accepting
// applies it to YOUR schedule for the pin date only; declining changes
// nothing — the pin stands.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { trainTogetherApi } from '../../../src/lib/api';
import { useAuth } from '../../../src/context/AuthContext';
import {
  tt, TTAvatar, PrimaryButton, GhostAction, MicroLabel,
} from '../../../src/components/trainTogether/primitives';
import { weekdayShort } from '../../../src/lib/trainTogetherMatch';

interface FitCard { heading: string; body: string }
interface PinMember {
  userId: string;
  sharedResponse: 'none' | 'accepted' | 'declined';
  sharedRespondedAt: string | null;
  user: { id: string; name: string | null; username: string | null; avatarBase64: string | null };
  session: { rest: boolean; label: string | null };
}

const BackChevron = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path d="M15 18l-6-6 6-6" stroke={tt.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const nameOf = (m: PinMember) => (m.user.name || m.user.username || 'Friend').split(' ')[0];
const avatarUri = (b64: string | null) =>
  b64 ? (b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`) : null;

function agoLabel(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function SharedSessionReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [fits, setFits] = useState<Record<string, FitCard[]>>({});
  const [tab, setTab] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const detail: any = await trainTogetherApi.getPin(String(id));
      setPin(detail);
      const built: any = await trainTogetherApi.buildSharedSession(String(id));
      setSession(built.session);
      setFits(built.fits ?? {});
      setTab(user?.id ?? null);
    } catch (err: any) {
      Alert.alert("Couldn't build the session", err?.message ?? 'Please try again.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);
  useEffect(() => { load(); }, [load]);

  const members: PinMember[] = pin?.members ?? [];
  const me = members.find(m => m.userId === user?.id);
  const peers = members.filter(m => m.userId !== user?.id);
  const acceptedPeer = peers.find(m => m.sharedResponse === 'accepted');
  const exercises: any[] = session?.exercises ?? [];
  const estMin = Math.round(exercises.length * 8 + 10) + 3; // display "~" anyway
  const dow = pin ? weekdayShort(pin.date) : '';
  const dowLong = pin
    ? new Date(pin.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
    : '';
  const myDayLabel = me?.session.rest ? 'rest day' : `${me?.session.label ?? 'own'} day`;

  const activeFits = tab ? fits[tab] ?? [] : [];

  async function respond(accept: boolean) {
    setBusy(true);
    try {
      await trainTogetherApi.respondSharedSession(String(id), accept ? 'accepted' : 'declined');
      router.back();
    } catch (err: any) {
      Alert.alert("Couldn't save", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => pressed && { opacity: 0.82 }}>
          <BackChevron />
        </Pressable>
        <Text style={s.headerTitle}>Shared session</Text>
        <View style={{ width: 20 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={tt.ink} /></View>
      ) : !session ? null : (
        <>
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            <Text style={s.title}>One session, two fits.</Text>

            {/* Fit tabs — same segmented control as the calendar filter */}
            <View style={s.segTrack}>
              {members.map(m => {
                const sel = tab === m.userId;
                return (
                  <Pressable key={m.userId} onPress={() => setTab(m.userId)}
                    style={[s.segItem, sel && s.segItemSel]}>
                    <Text style={[s.segText, sel && s.segTextSel]}>
                      {m.userId === user?.id ? 'How it fits you' : `How it fits ${nameOf(m)}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Fit cards — 3 per member, identical layout */}
            <View style={{ marginTop: 12, gap: 7 }}>
              {activeFits.map(card => (
                <View key={card.heading} style={s.fitCard}>
                  <MicroLabel>{card.heading}</MicroLabel>
                  <Text style={s.fitBody}>{card.body}</Text>
                </View>
              ))}
            </View>

            {/* Full exercise list */}
            <Pressable onPress={() => setListOpen(o => !o)}
              style={({ pressed }) => [s.listRow, pressed && { opacity: 0.82 }]}>
              <Text style={s.listRowTitle}>Full exercise list</Text>
              <Text style={s.listRowMeta}>
                {exercises.length} exercises · ~{estMin} min {listOpen ? '↑' : '→'}
              </Text>
            </Pressable>
            {listOpen && (
              <View style={s.exList}>
                {exercises.map((ex, i) => (
                  <View key={i} style={[s.exRow, i < exercises.length - 1 && s.exRowBorder]}>
                    <Text style={s.exName}>{ex.exercise ?? ex.name ?? `Exercise ${i + 1}`}</Text>
                    <Text style={s.exMeta}>
                      {[ex.sets && `${ex.sets} sets`, ex.reps && `${ex.reps} reps`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Peer status line */}
            {acceptedPeer && (
              <View style={s.peerRow}>
                <TTAvatar name={nameOf(acceptedPeer)} size={22} uri={avatarUri(acceptedPeer.user.avatarBase64)} />
                <Text style={s.peerText}>
                  {nameOf(acceptedPeer)} accepted their version {agoLabel(acceptedPeer.sharedRespondedAt)}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Footer — bottom padding clears the home indicator */}
          <View style={[s.footer, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
            <PrimaryButton
              label={busy ? 'Saving…' : `Accept for ${dowLong} only`}
              disabled={busy || me?.sharedResponse === 'accepted'}
              onPress={() => respond(true)}
            />
            <GhostAction label={`Keep my own ${myDayLabel}`} onPress={() => respond(false)} style={{ marginTop: 8 }} />
          </View>
        </>
      )}
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
  headerTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.32, color: tt.ink },
  scroll: { padding: 20, paddingBottom: 16 },
  title: { fontSize: 21, fontWeight: '700', letterSpacing: -0.42, color: tt.ink },

  segTrack: { flexDirection: 'row', backgroundColor: tt.surface, borderRadius: 11, padding: 2, marginTop: 12 },
  segItem: { flex: 1, paddingVertical: 7, borderRadius: 9, alignItems: 'center' },
  segItemSel: {
    backgroundColor: tt.white, borderWidth: 1, borderColor: tt.hairline,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  segText: { fontSize: 12, fontWeight: '500', color: tt.muted },
  segTextSel: { fontWeight: '600', color: tt.ink },

  fitCard: {
    borderWidth: 1, borderColor: tt.hairline, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  fitBody: { fontSize: 12.5, color: tt.ink, lineHeight: 18.75, marginTop: 3 },

  listRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: tt.hairline, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 14, marginTop: 12,
  },
  listRowTitle: { fontSize: 12, fontWeight: '600', color: tt.ink },
  listRowMeta: { fontSize: 11, color: tt.muted },
  exList: { borderWidth: 1, borderColor: tt.hairline, borderRadius: 14, marginTop: 6, overflow: 'hidden' },
  exRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, paddingHorizontal: 14,
  },
  exRowBorder: { borderBottomWidth: 1, borderBottomColor: tt.surface },
  exName: { flex: 1, fontSize: 12.5, fontWeight: '500', color: tt.ink },
  exMeta: { fontSize: 11, color: tt.muted },

  peerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  peerText: { fontSize: 11, color: tt.muted },

  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
});
