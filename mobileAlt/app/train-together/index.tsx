// Train Together — entry screen. Three jobs:
//   1. First-run consent: schedule sharing is off by default; explain the
//      scope (session types + rest days only) and let the user opt in.
//   2. Friend picker: choose 1+ friends to find overlapping training days
//      with. Friends who aren't sharing (or have no program) render disabled
//      with the reason and a nudge.
//   3. Upcoming plans: pins I'm part of, with accept/decline for invites and
//      a "changed" treatment when a member's schedule drifted after pinning.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, Image, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trainTogetherApi } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface TTFriend {
  id: string;
  name: string | null;
  username: string | null;
  avatarBase64: string | null;
  splitLabel: string | null;
  sharing: boolean;
  hasProgram: boolean;
  selectable: boolean;
}

interface PinMember {
  id: string;
  userId: string;
  response: 'pending' | 'accepted' | 'declined';
  user: { id: string; name: string | null; username: string | null; avatarBase64: string | null };
}

interface Pin {
  id: string;
  date: string;
  creatorId: string;
  note: string | null;
  status: 'pending' | 'confirmed' | 'changed' | 'cancelled';
  members: PinMember[];
}

const memberName = (m: PinMember) => m.user.name || m.user.username || 'Friend';

function prettyDate(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

const STATUS_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  pending: { label: 'Awaiting replies', icon: 'time-outline' },
  confirmed: { label: 'Confirmed', icon: 'checkmark-circle' },
  changed: { label: 'Schedule changed', icon: 'alert-circle-outline' },
};

export default function TrainTogetherScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sharing, setSharing] = useState<boolean | null>(null);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [friends, setFriends] = useState<TTFriend[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [sharingRes, friendsRes, pinsRes] = await Promise.all([
        trainTogetherApi.getSharing(),
        trainTogetherApi.getFriends(),
        trainTogetherApi.getPins(),
      ]);
      setSharing(!!(sharingRes as any)?.scheduleSharing);
      setFriends(Array.isArray(friendsRes) ? friendsRes : []);
      setPins(Array.isArray(pinsRes) ? pinsRes : []);
    } catch {
      // Keep whatever we had; pull-to-refresh retries.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSharing = useCallback(async (enabled: boolean) => {
    setSharingBusy(true);
    setSharing(enabled); // optimistic
    try {
      await trainTogetherApi.setSharing(enabled);
    } catch {
      setSharing(!enabled);
      Alert.alert('Could not update', 'Please try again.');
    } finally {
      setSharingBusy(false);
    }
  }, []);

  const toggleFriend = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const findDays = () => {
    if (selected.size === 0) return;
    router.push({
      pathname: '/train-together/calendar',
      params: { friendIds: [...selected].join(',') },
    });
  };

  const respond = async (pin: Pin, response: 'accepted' | 'declined') => {
    try {
      await trainTogetherApi.respondToPin(pin.id, response);
      load();
    } catch (err: any) {
      Alert.alert('Could not respond', err?.message ?? 'Please try again.');
    }
  };

  const cancelOrLeave = (pin: Pin) => {
    const mine = pin.creatorId === user?.id;
    Alert.alert(
      mine ? 'Cancel this plan?' : 'Leave this plan?',
      prettyDate(pin.date),
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: mine ? 'Cancel plan' : 'Leave',
          style: 'destructive',
          onPress: async () => {
            try { await trainTogetherApi.deletePin(pin.id); load(); }
            catch (err: any) { Alert.alert('Failed', err?.message ?? 'Please try again.'); }
          },
        },
      ],
    );
  };

  const upcomingPins = useMemo(
    () => pins.filter(p => p.status !== 'cancelled'),
    [pins],
  );

  const renderPin = (pin: Pin) => {
    const meta = STATUS_META[pin.status] ?? STATUS_META.pending;
    const others = pin.members.filter(m => m.userId !== user?.id && m.response !== 'declined');
    const myMembership = pin.members.find(m => m.userId === user?.id);
    const needsMyReply = myMembership?.response === 'pending' || pin.status === 'changed';
    return (
      <View key={pin.id} style={[styles.pinCard, pin.status === 'changed' && styles.pinCardChanged]}>
        <View style={styles.pinHeader}>
          <Text style={styles.pinDate}>{prettyDate(pin.date)}</Text>
          <View style={styles.pinStatus}>
            <Ionicons name={meta.icon} size={13} color={colors.mutedForeground} />
            <Text style={styles.pinStatusText}>{meta.label}</Text>
          </View>
        </View>
        <Text style={styles.pinWith}>
          🤝 With {others.map(memberName).join(', ') || '—'}
          {pin.note ? `  ·  ${pin.note}` : ''}
        </Text>
        {pin.status === 'changed' && (
          <Text style={styles.pinChangedNote}>
            A training partner's schedule changed for this day. Still on?
          </Text>
        )}
        <View style={styles.pinActions}>
          {needsMyReply && (
            <>
              <TouchableOpacity style={styles.pinPrimaryBtn} onPress={() => respond(pin, 'accepted')}>
                <Text style={styles.pinPrimaryBtnText}>{pin.status === 'changed' ? 'Keep it' : 'Accept'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pinGhostBtn} onPress={() => respond(pin, 'declined')}>
                <Text style={styles.pinGhostBtnText}>Decline</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.pinGhostBtn} onPress={() => cancelOrLeave(pin)}>
            <Text style={styles.pinGhostBtnText}>{pin.creatorId === user?.id ? 'Cancel' : 'Leave'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderFriend = (f: TTFriend) => {
    const isSelected = selected.has(f.id);
    const reason = !f.sharing ? 'Not sharing their schedule' : !f.hasProgram ? 'No active program' : null;
    return (
      <TouchableOpacity
        key={f.id}
        style={[styles.friendRow, isSelected && styles.friendRowSelected, !f.selectable && styles.friendRowDisabled]}
        activeOpacity={0.8}
        disabled={!f.selectable}
        onPress={() => toggleFriend(f.id)}
      >
        {f.avatarBase64 ? (
          <Image source={{ uri: `data:image/jpeg;base64,${f.avatarBase64}` }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{(f.name || f.username || '?')[0]?.toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.friendInfo}>
          <Text style={styles.friendName}>{f.name || f.username || 'Friend'}</Text>
          {reason ? <Text style={styles.friendReason}>{reason}</Text> : null}
        </View>
        {f.splitLabel ? (
          <View style={styles.splitBadge}>
            <Text style={styles.splitBadgeText}>{f.splitLabel}</Text>
          </View>
        ) : null}
        <Ionicons
          name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={isSelected ? colors.foreground : colors.border}
        />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.title}>Train Together</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.foreground} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        >
          {/* Consent */}
          <View style={styles.consentCard}>
            <View style={styles.consentTextWrap}>
              <Text style={styles.consentTitle}>Share my schedule with friends</Text>
              <Text style={styles.consentBody}>
                Friends you've accepted can see your session types and rest days — never your
                lifts, weights, or logs. Both of you must share to see overlap.
              </Text>
            </View>
            <Switch
              value={!!sharing}
              disabled={sharingBusy}
              onValueChange={toggleSharing}
              trackColor={{ true: colors.foreground, false: colors.border }}
              thumbColor="#ffffff"
            />
          </View>

          {/* Upcoming plans */}
          {upcomingPins.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Upcoming plans</Text>
              {upcomingPins.map(renderPin)}
            </>
          )}

          {/* Friend picker */}
          <Text style={styles.sectionTitle}>Find days together</Text>
          {!sharing ? (
            <Text style={styles.emptyText}>Turn on schedule sharing above to find overlapping days.</Text>
          ) : friends.length === 0 ? (
            <Text style={styles.emptyText}>
              Add friends on Axiom first — then find the days your training lines up.
            </Text>
          ) : (
            <>
              <Text style={styles.sectionHint}>
                Pick friends and we'll find the days your training naturally lines up — nobody
                changes their program.
              </Text>
              {friends.map(renderFriend)}
            </>
          )}
        </ScrollView>
      )}

      {sharing && selected.size > 0 && (
        <View style={styles.ctaWrap}>
          <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={findDays}>
            <Ionicons name="calendar-outline" size={18} color={colors.primaryForeground} />
            <Text style={styles.ctaText}>
              Find days with {selected.size} {selected.size === 1 ? 'friend' : 'friends'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.md, paddingBottom: 120 },

  consentCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, backgroundColor: colors.card,
  },
  consentTextWrap: { flex: 1 },
  consentTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  consentBody: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 4, lineHeight: 18 },

  sectionTitle: {
    fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  sectionHint: { fontSize: fontSize.sm, color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 18 },
  emptyText: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 18 },

  friendRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.xs, backgroundColor: colors.card,
  },
  friendRowSelected: { borderColor: colors.foreground },
  friendRowDisabled: { opacity: 0.5 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.mutedForeground },
  friendInfo: { flex: 1 },
  friendName: { fontSize: fontSize.base, fontWeight: fontWeight.medium, color: colors.foreground },
  friendReason: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
  splitBadge: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  splitBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.mutedForeground },

  pinCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.card,
  },
  pinCardChanged: { borderColor: colors.warning },
  pinHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pinDate: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  pinStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pinStatusText: { fontSize: fontSize.xs, color: colors.mutedForeground },
  pinWith: { fontSize: fontSize.sm, color: colors.foreground, marginTop: spacing.xs },
  pinChangedNote: { fontSize: fontSize.sm, color: colors.warning, marginTop: spacing.xs },
  pinActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  pinPrimaryBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  pinPrimaryBtnText: { color: colors.primaryForeground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  pinGhostBtn: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  pinGhostBtnText: { color: colors.foreground, fontSize: fontSize.sm },

  ctaWrap: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14,
  },
  ctaText: { color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
