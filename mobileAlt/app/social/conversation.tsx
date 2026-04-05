import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { socialApi } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../src/components/ui/KeyboardDoneBar';

interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export default function ConversationScreen() {
  const router = useRouter();
  const { id: conversationId, name: otherName } = useLocalSearchParams<{ id: string; name: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastIdRef = useRef<string | undefined>(undefined);

  const scrollToBottom = useCallback((animated = true) => {
    // First attempt fast, second attempt after layout settles
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated }), 50);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated }), 200);
  }, []);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await socialApi.getMessages(conversationId);
      const msgs: Message[] = Array.isArray(data) ? data : data.messages ?? [];
      setMessages(msgs);
      if (msgs.length > 0) {
        lastIdRef.current = msgs[msgs.length - 1].id;
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    try {
      await socialApi.markRead(conversationId);
    } catch { /* ignore */ }
  }, [conversationId]);

  const pollForNew = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await socialApi.pollMessages(conversationId, lastIdRef.current);
      const newMsgs: Message[] = Array.isArray(data) ? data : data.messages ?? [];
      if (newMsgs.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const toAdd = newMsgs.filter((m) => !existingIds.has(m.id));
          if (toAdd.length === 0) return prev;
          lastIdRef.current = toAdd[toAdd.length - 1].id;
          return [...prev, ...toAdd];
        });
        scrollToBottom();
      }
    } catch { /* ignore */ }
  }, [conversationId, scrollToBottom]);

  useEffect(() => {
    loadMessages().then(() => {
      scrollToBottom(false);
      markRead();
    });
  }, [loadMessages, scrollToBottom, markRead]);

  useEffect(() => {
    pollRef.current = setInterval(pollForNew, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollForNew]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !conversationId) return;
    setInputText('');
    setSending(true);
    try {
      const data = await socialApi.sendMessage(conversationId, text);
      const newMsg: Message = data.message ?? data;
      if (newMsg?.id) {
        setMessages((prev) => {
          lastIdRef.current = newMsg.id;
          return [...prev, newMsg];
        });
        scrollToBottom();
      }
    } catch {
      setInputText(text);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.senderId === user?.id;
    return (
      <View style={[styles.bubbleWrapper, isMine ? styles.bubbleWrapperRight : styles.bubbleWrapperLeft]}>
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
            {item.body}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{(otherName ?? 'U')[0].toUpperCase()}</Text>
        </View>
        <Text style={styles.screenTitle} numberOfLines={1}>{otherName ?? 'Conversation'}</Text>
      </View>

      <KeyboardDoneBar />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            onLayout={() => scrollToBottom(false)}
            onContentSizeChange={() => scrollToBottom(true)}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Text style={styles.mutedText}>No messages yet. Say hello!</Text>
              </View>
            }
          />
        )}

        {/* Input bar */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(spacing.sm, insets.bottom) }]}>
          <TextInput
            style={styles.input}
            placeholder="Type a message…"
            placeholderTextColor={colors.mutedForeground}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            returnKeyType="default"
            inputAccessoryViewID={KEYBOARD_DONE_ID}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendButtonDisabled]}
            activeOpacity={0.8}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Ionicons name="send" size={18} color={colors.primaryForeground} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

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
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  screenTitle: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },

  messageList: { padding: spacing.md, paddingBottom: spacing.sm, gap: 6 },

  bubbleWrapper: { flexDirection: 'row', marginVertical: 2 },
  bubbleWrapperRight: { justifyContent: 'flex-end' },
  bubbleWrapperLeft: { justifyContent: 'flex-start' },

  bubble: {
    maxWidth: '75%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  bubbleMine: {
    backgroundColor: colors.foreground,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: fontSize.sm, lineHeight: 20 },
  bubbleTextMine: { color: colors.primaryForeground },
  bubbleTextTheirs: { color: colors.foreground },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyChat: { alignItems: 'center', paddingTop: spacing.xxl },
  mutedText: { fontSize: fontSize.sm, color: colors.mutedForeground },
});
