// Group chat detail — messages list (Anakin's morning posts appear as system
// messages with no sender), composer, and a settings sheet for the group
// goal + Anakin opt-in + leaving the group.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { groupsApi } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface Msg { id: string; senderId: string | null; text: string; createdAt: string }
interface Member { user: { id: string; username: string | null; name: string | null; avatarBase64?: string | null }; goal: string | null }

// Small avatar circle — image when the user has one, initials fallback
// otherwise. Mirrors the inline pattern used in social DMs / PostCard (the app
// has no shared Avatar component).
function MemberAvatar({ name, avatarBase64, size = 28 }: { name: string; avatarBase64?: string | null; size?: number }) {
  const uri = avatarBase64
    ? (avatarBase64.startsWith('data:') ? avatarBase64 : `data:image/jpeg;base64,${avatarBase64}`)
    : null;
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri
        ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        : <Text style={[styles.avatarInitials, { fontSize: size * 0.4 }]}>{initials}</Text>}
    </View>
  );
}
interface GroupDetail {
  id: string; name: string; groupGoal: string | null; anakinDailyEnabled: boolean;
  members: Member[]; messages: Msg[];
}

export default function GroupChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const r = await groupsApi.get(String(id));
      setGroup((r as any).group);
    } catch (err: any) {
      Alert.alert('Could not load', err?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await groupsApi.postMessage(String(id), t);
      setText('');
      await load();
      setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 30);
    } catch (err: any) {
      Alert.alert('Send failed', err?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (loading || !group) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loadingBox}><ActivityIndicator color={colors.foreground} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{group.name}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
            {group.anakinDailyEnabled ? ' · Anakin daily on' : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setSettingsOpen(true)} hitSlop={10}>
          <Ionicons name="settings-outline" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={group.messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.xs }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: false })}
        renderItem={({ item }) => {
          const isAnakin = item.senderId === null;
          const isMine = item.senderId === user?.id;
          const senderMember = isAnakin ? null : group.members.find((x) => x.user.id === item.senderId);
          const senderName = isAnakin
            ? 'Anakin'
            : (senderMember?.user.name ?? senderMember?.user.username ?? 'Member');
          return (
            <View style={[styles.msgRow, isMine && styles.msgRowMine]}>
              {isAnakin ? (
                <View style={styles.anakinBubble}>
                  <Text style={styles.anakinName}>Anakin</Text>
                  <Text style={styles.anakinText}>{item.text}</Text>
                </View>
              ) : (
                <>
                  {/* Other people's messages show their avatar on the left;
                      your own don't need one. */}
                  {!isMine && <MemberAvatar name={senderName} avatarBase64={senderMember?.user.avatarBase64} size={28} />}
                  <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {!isMine && <Text style={styles.bubbleName}>{senderName}</Text>}
                    <Text style={[styles.bubbleText, isMine && { color: '#fff' }]}>{item.text}</Text>
                  </View>
                </>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>Start the conversation.</Text>}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* paddingBottom respects the home-indicator inset so the input isn't
            clipped below the safe area on notched iPhones. */}
        <View style={[styles.composer, { paddingBottom: Math.max(spacing.sm, insets.bottom) }]}>
          <TextInput
            style={styles.composerInput}
            placeholder="Message"
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]} disabled={!text.trim() || sending} onPress={send}>
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <SettingsSheet
        visible={settingsOpen}
        group={group}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => { setSettingsOpen(false); load(); }}
        onLeft={() => { setSettingsOpen(false); router.back(); }}
      />
    </SafeAreaView>
  );
}

function SettingsSheet({
  visible, group, onClose, onChanged, onLeft,
}: { visible: boolean; group: GroupDetail; onClose: () => void; onChanged: () => void; onLeft: () => void }) {
  const [groupGoal, setGroupGoal] = useState(group.groupGoal ?? '');
  const [anakinDailyEnabled, setAnakinDailyEnabled] = useState(group.anakinDailyEnabled);
  const [selfGoal, setSelfGoal] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (visible) {
      setGroupGoal(group.groupGoal ?? '');
      setAnakinDailyEnabled(group.anakinDailyEnabled);
      setSelfGoal('');
    }
  }, [visible, group.id]);

  const save = async () => {
    setSaving(true);
    try {
      await groupsApi.patch(group.id, {
        groupGoal: groupGoal.trim() || null,
        anakinDailyEnabled,
        ...(selfGoal.trim() ? { selfGoal: selfGoal.trim() } : {}),
      });
      onChanged();
    } catch (err: any) {
      Alert.alert('Save failed', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const triggerCheckin = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const r: any = await groupsApi.anakinCheckin(group.id, true);
      Alert.alert('Anakin would say', r?.text ?? r?.reasoning ?? 'No draft.');
    } catch (err: any) {
      Alert.alert('Could not run check-in', err?.message ?? 'Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const leave = async () => {
    Alert.alert('Leave group?', 'You can be re-added later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
          try { await groupsApi.leave(group.id); onLeft(); } catch (err: any) { Alert.alert('Failed', err?.message ?? ''); }
      } },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>Group settings</Text>
          <TouchableOpacity onPress={save} hitSlop={10} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.foreground} /> : <Text style={styles.saveBtn}>Save</Text>}
          </TouchableOpacity>
        </View>
        <View style={{ padding: spacing.md, gap: spacing.md }}>
          <View>
            <Text style={styles.fieldLabel}>Group goal</Text>
            <TextInput style={styles.input} value={groupGoal} onChangeText={setGroupGoal} placeholder="What is the group working toward?" placeholderTextColor={colors.mutedForeground} multiline />
          </View>
          <TouchableOpacity style={styles.toggleRow} onPress={() => setAnakinDailyEnabled((v) => !v)} activeOpacity={0.7}>
            <Ionicons name={anakinDailyEnabled ? 'checkbox' : 'square-outline'} size={20} color={anakinDailyEnabled ? colors.primary : colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Anakin drops by every morning</Text>
              <Text style={styles.toggleSub}>Posts a status check-in noting who's on track or slipping + group-goal progress.</Text>
            </View>
          </TouchableOpacity>
          <View>
            <Text style={styles.fieldLabel}>Members ({group.members.length})</Text>
            <View style={{ gap: spacing.sm, marginTop: 2 }}>
              {group.members.map((m) => {
                const name = m.user.name ?? m.user.username ?? 'Member';
                return (
                  <View key={m.user.id} style={styles.memberRow}>
                    <MemberAvatar name={name} avatarBase64={m.user.avatarBase64} size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
                      {m.goal ? <Text style={styles.memberGoal} numberOfLines={1}>{m.goal}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
          <View>
            <Text style={styles.fieldLabel}>Update your goal (optional)</Text>
            <TextInput style={styles.input} value={selfGoal} onChangeText={setSelfGoal} placeholder="Your current goal" placeholderTextColor={colors.mutedForeground} />
          </View>
          <TouchableOpacity style={styles.secondaryBtn} onPress={triggerCheckin} disabled={checking}>
            {checking ? <ActivityIndicator color={colors.foreground} /> : <Text style={styles.secondaryBtnText}>Preview Anakin's check-in now</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerBtn} onPress={leave}>
            <Text style={styles.dangerBtnText}>Leave group</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  subtitle: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 1 },
  saveBtn: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.semibold },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', color: colors.mutedForeground, marginTop: spacing.xl, fontSize: fontSize.sm },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  msgRowMine: { justifyContent: 'flex-end' },
  avatar: {
    backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarInitials: { color: colors.mutedForeground, fontWeight: fontWeight.semibold },
  bubble: { maxWidth: '80%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.muted, borderBottomLeftRadius: 4 },
  bubbleName: { fontSize: fontSize.xs, color: colors.mutedForeground, marginBottom: 2, fontWeight: fontWeight.semibold },
  bubbleText: { fontSize: fontSize.sm, color: colors.foreground, lineHeight: 19 },

  anakinBubble: {
    alignSelf: 'center', maxWidth: '92%',
    backgroundColor: `${colors.primary}14`,
    borderWidth: 1, borderColor: `${colors.primary}55`,
    borderRadius: radius.md, padding: 10, marginVertical: 4,
  },
  anakinName: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold, marginBottom: 2 },
  anakinText: { fontSize: fontSize.sm, color: colors.foreground, lineHeight: 19 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background,
  },
  composerInput: {
    flex: 1, maxHeight: 120, minHeight: 40,
    backgroundColor: colors.muted, borderRadius: radius.lg,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: fontSize.base, color: colors.foreground,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  fieldLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.muted, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 10,
    fontSize: fontSize.base, color: colors.foreground, minHeight: 44,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memberName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  memberGoal: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  toggleLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  toggleSub: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 16, marginTop: 2 },
  secondaryBtn: {
    paddingVertical: 12, alignItems: 'center', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted,
  },
  secondaryBtnText: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  dangerBtn: { paddingVertical: 12, alignItems: 'center', marginTop: spacing.xs },
  dangerBtnText: { color: colors.destructive, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
