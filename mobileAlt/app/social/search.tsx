import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { socialApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../src/components/ui/KeyboardDoneBar';

interface UserResult {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  avatarBase64: string | null;
}

interface PendingRequest {
  id: string;
  requesterId: string;
  requesterName: string | null;
  requesterEmail: string | null;
}

export default function SocialSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    socialApi.getFriendRequests()
      .then((data) => {
        const received = Array.isArray(data) ? data : data.received ?? [];
        setPendingRequests(received);
      })
      .catch(() => setPendingRequests([]))
      .finally(() => setLoadingRequests(false));
  }, []);

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    socialApi.searchUsers(q)
      .then((data) => setResults(Array.isArray(data) ? data : data.users ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, []);

  const onChangeQuery = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 300);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleAddFriend = async (userId: string) => {
    try {
      await socialApi.sendFriendRequest(userId);
      setSentIds((prev) => new Set([...prev, userId]));
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not send friend request.');
    }
  };

  const handleAccept = async (req: PendingRequest) => {
    try {
      await socialApi.acceptFriendRequest(req.requesterId);
      setPendingRequests((prev) => prev.filter((r) => r.requesterId !== req.requesterId));
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not accept request.');
    }
  };

  const handleDecline = async (req: PendingRequest) => {
    try {
      await socialApi.declineFriendRequest(req.requesterId);
      setPendingRequests((prev) => prev.filter((r) => r.requesterId !== req.requesterId));
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not decline request.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardDoneBar />
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Find Friends</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Search input */}
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={18} color={colors.mutedForeground} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, username, or email…"
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={onChangeQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            inputAccessoryViewID={KEYBOARD_DONE_ID}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Pending requests */}
        {!loadingRequests && pendingRequests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Friend Requests</Text>
            {pendingRequests.map((req) => (
              <View key={req.requesterId} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>
                      {((req.requesterName ?? req.requesterEmail ?? '?')[0]).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardName}>{req.requesterName ?? 'User'}</Text>
                    {req.requesterEmail ? (
                      <Text style={styles.cardSub}>{req.requesterEmail}</Text>
                    ) : null}
                  </View>
                  <View style={styles.requestActions}>
                    <TouchableOpacity style={styles.acceptButton} activeOpacity={0.8} onPress={() => handleAccept(req)}>
                      <Text style={styles.acceptButtonText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.declineButton} activeOpacity={0.8} onPress={() => handleDecline(req)}>
                      <Text style={styles.declineButtonText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Search results */}
        {query.trim().length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {searching ? 'Searching…' : `Results${results.length > 0 ? ` (${results.length})` : ''}`}
            </Text>
            {!searching && results.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.mutedText}>No users found for "{query}"</Text>
              </View>
            )}
            {results.map((user) => (
              <View key={user.id} style={styles.card}>
                <View style={styles.cardRow}>
                  {user.avatarBase64 ? (
                    <Image source={{ uri: user.avatarBase64 }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatarCircle}>
                      <Text style={styles.avatarText}>
                        {((user.name ?? user.email ?? '?')[0]).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.cardContent}>
                    <Text style={styles.cardName}>{user.name ?? 'User'}</Text>
                    {user.username ? (
                      <Text style={styles.cardSub}>@{user.username}</Text>
                    ) : user.email ? (
                      <Text style={styles.cardSub}>{user.email}</Text>
                    ) : null}
                  </View>
                  {sentIds.has(user.id) ? (
                    <View style={styles.sentBadge}>
                      <Text style={styles.sentBadgeText}>Sent</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addButton}
                      activeOpacity={0.8}
                      onPress={() => handleAddFriend(user.id)}
                    >
                      <Ionicons name="person-add-outline" size={14} color={colors.primaryForeground} />
                      <Text style={styles.addButtonText}>Add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {query.trim().length === 0 && pendingRequests.length === 0 && !loadingRequests && (
          <View style={styles.center}>
            <Ionicons name="search-outline" size={40} color={colors.mutedForeground} />
            <Text style={styles.emptyTitle}>Search for people</Text>
            <Text style={styles.emptySubtitle}>Find friends by name, username, or email.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { padding: 4 },
  screenTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    gap: 8,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.foreground,
    padding: 0,
  },

  section: { gap: spacing.sm },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },

  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: colors.card,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  avatarImage: { width: 40, height: 40, borderRadius: radius.full },
  cardContent: { flex: 1 },
  cardName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  cardSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },

  requestActions: { flexDirection: 'row', gap: 6 },
  acceptButton: {
    backgroundColor: colors.foreground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  acceptButtonText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
  declineButton: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  declineButtonText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.mutedForeground },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.foreground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  addButtonText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  sentBadge: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  sentBadgeText: { fontSize: fontSize.xs, color: colors.mutedForeground },

  emptyBox: { alignItems: 'center', paddingVertical: spacing.lg },
  center: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptySubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  mutedText: { fontSize: fontSize.sm, color: colors.mutedForeground },
});
