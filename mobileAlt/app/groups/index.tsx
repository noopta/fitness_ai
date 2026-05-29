// Groups list screen — caller's group chats, plus a "New group" sheet that
// captures name + optional group goal + members + opt-in Anakin daily.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { groupsApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface Group {
  id: string; name: string; groupGoal: string | null; anakinDailyEnabled: boolean;
  members: Array<{ user: { id: string; username: string | null; name: string | null } }>;
  messages?: Array<{ text: string; createdAt: string }>;
}

export default function GroupsScreen() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const r = await groupsApi.list();
      setGroups((r as any)?.groups ?? []);
    } catch (err: any) {
      if (err?.status === 404) {
        // Agent surface is off / not allowlisted — show empty + a note.
        setGroups([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.title}>Groups</Text>
        <TouchableOpacity onPress={() => setCreateOpen(true)} hitSlop={10}>
          <Ionicons name="add" size={26} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator color={colors.foreground} /></View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No groups yet</Text>
              <Text style={styles.emptySub}>Tap + to start one with friends. Anakin can drop by every morning to keep everyone honest.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const lastMsg = item.messages?.[0]?.text ?? null;
            return (
              <TouchableOpacity style={styles.row} onPress={() => router.push(`/groups/${item.id}`)}>
                <View style={styles.iconBubble}>
                  <Ionicons name="people" size={20} color={colors.foreground} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowHead}>
                    <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                    {item.anakinDailyEnabled ? (
                      <View style={styles.badge}><Text style={styles.badgeText}>Anakin daily</Text></View>
                    ) : null}
                  </View>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {item.members.length} member{item.members.length === 1 ? '' : 's'}
                    {item.groupGoal ? ` · ${item.groupGoal}` : ''}
                  </Text>
                  {lastMsg ? <Text style={styles.rowMsg} numberOfLines={1}>{lastMsg}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            );
          }}
        />
      )}

      <CreateGroupSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(g) => {
          setCreateOpen(false);
          router.push(`/groups/${g.id}`);
        }}
      />
    </SafeAreaView>
  );
}

function CreateGroupSheet({
  visible, onClose, onCreated,
}: { visible: boolean; onClose: () => void; onCreated: (g: Group) => void }) {
  const [name, setName] = useState('');
  const [groupGoal, setGroupGoal] = useState('');
  const [members, setMembers] = useState('');
  const [selfGoal, setSelfGoal] = useState('');
  const [anakinDailyEnabled, setAnakinDailyEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setName(''); setGroupGoal(''); setMembers(''); setSelfGoal(''); setAnakinDailyEnabled(false); setSaving(false);
    }
  }, [visible]);

  const create = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const memberUsernames = members.split(',').map((s) => s.trim()).filter(Boolean);
      const r = await groupsApi.create({
        name: name.trim(),
        groupGoal: groupGoal.trim() || undefined,
        memberUsernames: memberUsernames.length ? memberUsernames : undefined,
        selfGoal: selfGoal.trim() || undefined,
        anakinDailyEnabled,
      });
      onCreated((r as any).group);
    } catch (err: any) {
      Alert.alert('Could not create', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>New group</Text>
          <View style={{ width: 24 }} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ padding: spacing.md, gap: spacing.md }}>
            <Field label="Group name">
              <TextInput style={styles.input} placeholder="Lift Squad" placeholderTextColor={colors.mutedForeground} value={name} onChangeText={setName} />
            </Field>
            <Field label="Group goal (optional)">
              <TextInput style={styles.input} placeholder="All hit 5 workouts/week" placeholderTextColor={colors.mutedForeground} value={groupGoal} onChangeText={setGroupGoal} />
            </Field>
            <Field label="Invite members by username (comma-separated)">
              <TextInput style={styles.input} placeholder="alice, bob" placeholderTextColor={colors.mutedForeground} value={members} onChangeText={setMembers} autoCapitalize="none" />
            </Field>
            <Field label="Your workout goal (optional)">
              <TextInput style={styles.input} placeholder="Lose 10 lb / hit a 405 deadlift" placeholderTextColor={colors.mutedForeground} value={selfGoal} onChangeText={setSelfGoal} />
            </Field>
            <TouchableOpacity style={styles.toggleRow} onPress={() => setAnakinDailyEnabled((v) => !v)} activeOpacity={0.7}>
              <Ionicons name={anakinDailyEnabled ? 'checkbox' : 'square-outline'} size={20} color={anakinDailyEnabled ? colors.primary : colors.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Anakin drops by every morning</Text>
                <Text style={styles.toggleSub}>Posts a check-in noting who's on track or slipping, plus group-goal progress.</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, (!name.trim() || saving) && { opacity: 0.5 }]} disabled={!name.trim() || saving} onPress={create}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create group</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptySub: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', marginTop: spacing.xs, lineHeight: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  iconBubble: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowName: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  rowSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
  rowMsg: { fontSize: fontSize.xs, color: colors.foreground, marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: `${colors.primary}22` },
  badgeText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold },

  fieldLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.muted, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 10,
    fontSize: fontSize.base, color: colors.foreground,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4 },
  toggleLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  toggleSub: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 16, marginTop: 2 },
  primaryBtn: {
    marginTop: spacing.md, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingVertical: 12, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
