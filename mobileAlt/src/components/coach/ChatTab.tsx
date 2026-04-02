import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { getToken } from '../../lib/api';

const API_BASE = 'https://api.airthreads.ai:4009/api';

interface ChatTabProps {
  coachData: any;
}

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  _isTemp?: boolean;
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
      {!isUser && (
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>A</Text>
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
          {msg.content}
        </Text>
      </View>
    </View>
  );
}

export function ChatTab({ coachData }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Load messages from coachData on mount
  useEffect(() => {
    const msgs: ChatMessage[] = Array.isArray(coachData?.messages)
      ? coachData.messages
      : coachData?.messages ?? [];

    if (msgs.length > 0) {
      setMessages(msgs);
    } else {
      setMessages([
        {
          role: 'assistant',
          content:
            "Hi! I'm Anakin, your AI strength coach. Ask me anything about your training, recovery, nutrition, or programming.",
        },
      ]);
    }
  }, []);

  // Auto-scroll when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  async function handleSend() {
    const text = inputText.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const historyForRequest = messages.filter((m) => !m._isTemp).slice(-12);

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setSending(true);

    // Add a streaming placeholder for the assistant reply
    const streamId = `stream-${Date.now()}`;
    setMessages((prev) => [...prev, { role: 'assistant', content: '', id: streamId, _isTemp: true }]);

    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/coach/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          history: historyForRequest.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let msg = `Error ${response.status}`;
        try { msg = JSON.parse(errText).error ?? msg; } catch {}
        throw new Error(msg);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const raw = decoder.decode(value, { stream: true });
          // Parse SSE lines
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.chunk) {
                accumulated += parsed.chunk;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamId ? { ...m, content: accumulated } : m
                  )
                );
              } else if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (parseErr: any) {
              if (parseErr?.message && !parseErr.message.startsWith('JSON')) {
                throw parseErr;
              }
            }
          }
        }
      }

      // Mark the streaming message as final
      setMessages((prev) =>
        prev.map((m) => (m.id === streamId ? { ...m, _isTemp: false } : m))
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamId
            ? { ...m, content: err?.message ?? 'Something went wrong. Please try again.', _isTemp: false }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  const canSend = inputText.trim().length > 0 && !sending;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 160 : 30}
    >
      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((msg, idx) =>
          msg._isTemp && msg.content.length === 0 ? null : (
            <MessageBubble key={msg.id ?? `msg-${idx}`} msg={msg} />
          )
        )}

        {/* Typing indicator — only show when sending but no content streamed yet */}
        {sending && messages.every((m) => !m._isTemp || m.content.length > 0) === false && (
          <View style={[styles.bubbleRow, styles.bubbleRowAssistant]}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>A</Text>
            </View>
            <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask Anakin anything..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          maxLength={1000}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={handleSend}
        />
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
        >
          <Text style={styles.sendIcon}>➤</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
    gap: 12,
  },

  // Bubbles
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    maxWidth: '100%',
  },
  bubbleRowUser: {
    justifyContent: 'flex-end',
  },
  bubbleRowAssistant: {
    justifyContent: 'flex-start',
  },
  avatarCircle: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.primaryForeground,
  },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  typingBubble: {
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  bubbleText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  bubbleTextUser: {
    color: colors.primaryForeground,
  },
  bubbleTextAssistant: {
    color: colors.foreground,
  },

  // Input
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    color: colors.foreground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendIcon: {
    color: colors.primaryForeground,
    fontSize: 16,
    marginLeft: 2,
  },
});
