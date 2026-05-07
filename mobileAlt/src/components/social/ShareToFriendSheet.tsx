import React, { useState } from 'react';
import {
  View, Text, Modal, SafeAreaView, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';

export interface FriendForShare {
  id: string;
  name: string | null;
  username: string | null;
  avatarBase64?: string | null;
}

interface Props {
  visible: boolean;
  title: string;
  /** Short description shown beneath the header. */
  subtitle?: string;
  friends: FriendForShare[];
  onClose: () => void;
  onSend: (friendId: string, note?: string) => Promise<void> | void;
}

/**
 * Generic friend-picker sheet for forwarding content (workouts, articles, etc.)
 * to a friend's DM. Mirrors the pattern in FeedItemCard so UX is consistent
 * across share surfaces.
 */
export function ShareToFriendSheet({ visible, title, subtitle, friends, onClose, onSend }: Props) {
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const filtered = friends.filter(f => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (f.username ?? '').toLowerCase().includes(q) || (f.name ?? '').toLowerCase().includes(q);
  });

  async function handleSend(friendId: string) {
    setSendingTo(friendId);
    try {
      await onSend(friendId, note.trim() || undefined);
      setSearch('');
      setNote('');
      onClose();
    } finally {
      setSendingTo(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <View style={{ width: 30 }} />
        </View>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
        <TextInput
          style={styles.noteInput}
          placeholder="Add a note (optional)"
          placeholderTextColor={colors.mutedForeground}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={240}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search friends…"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        <FlatList
          data={filtered}
          keyExtractor={(f) => f.id}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {friends.length === 0 ? 'Add friends first to share workouts.' : 'No friends match your search.'}
            </Text>
          }
          renderItem={({ item: friend }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.85}
              disabled={sendingTo !== null}
              onPress={() => handleSend(friend.id)}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {((friend.username ?? friend.name ?? '?')[0] ?? '?').toUpperCase()}
                </Text>
              </View>
              <Text style={styles.name}>
                {friend.username ? `@${friend.username}` : (friend.name ?? 'User')}
              </Text>
              {sendingTo === friend.id
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Ionicons name="paper-plane" size={16} color={colors.primary} />}
            </TouchableOpacity>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  closeBtn: { padding: 4 },
  title: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  subtitle: {
    fontSize: fontSize.sm, color: colors.mutedForeground,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
  },
  noteInput: {
    margin: spacing.md, marginBottom: spacing.sm, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    color: colors.foreground, minHeight: 60,
  },
  searchInput: {
    marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    color: colors.foreground,
  },
  empty: {
    fontSize: fontSize.sm, color: colors.mutedForeground,
    textAlign: 'center', marginTop: spacing.lg,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  avatar: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  name: { flex: 1, color: colors.foreground, fontSize: fontSize.sm },
});
