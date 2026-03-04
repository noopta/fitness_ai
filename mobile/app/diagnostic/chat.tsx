import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { liftCoachApi, storage } from '@/lib/api';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

type Msg = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
};

function formatBoldText(content: string) {
  const parts = content.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={i} style={{ fontWeight: fontWeight.bold, color: colors.foreground }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return <Text key={i}>{part}</Text>;
  });
}

function ChatBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <View style={styles.bubbleHeader}>
          <View style={[styles.avatarBox, isUser && styles.avatarBoxUser]}>
            <Ionicons
              name={isUser ? 'person' : 'hardware-chip'}
              size={14}
              color={isUser ? colors.primaryForeground : colors.foreground}
            />
          </View>
          <View style={styles.bubbleContent}>
            <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
              {formatBoldText(msg.content)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function LoadingBubble() {
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, styles.bubbleAssistant]}>
        <View style={styles.bubbleHeader}>
          <View style={styles.avatarBox}>
            <Ionicons name="hardware-chip" size={14} color={colors.primary} />
          </View>
          <Text style={styles.loadingText}>AI is analyzing...</Text>
        </View>
      </View>
    </View>
  );
}

export default function DiagnosticChatScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: 'm0',
      role: 'assistant',
      content: "I'll ask a few quick questions to isolate your sticking point. Short answers are perfect.",
    },
  ]);
  const [value, setValue] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);

  useEffect(() => {
    (async () => {
      const storedSessionId = await storage.get('liftoff_session_id');
      if (!storedSessionId) {
        Alert.alert('Error', 'No session found. Please start from the beginning.');
        router.replace('/diagnostic/onboarding');
        return;
      }
      setSessionId(storedSessionId);
      await loadMessages(storedSessionId);
    })();
  }, []);

  async function loadMessages(sid: string) {
    setInitialLoading(true);
    try {
      const response = await liftCoachApi.getSession(sid);
      const existingMessages = response.messages || (response as any).session?.messages || [];

      if (existingMessages.length > 0) {
        const loadedMessages = existingMessages.map((msg: any, idx: number) => ({
          id: `loaded-${idx}`,
          role: msg.role,
          content: msg.content,
        }));
        setMessages([messages[0], ...loadedMessages]);
        setQuestionCount(existingMessages.filter((m: any) => m.role === 'user').length);
      } else {
        await getFirstQuestion(sid);
      }
    } catch {
      await getFirstQuestion(sid);
    } finally {
      setInitialLoading(false);
    }
  }

  async function getFirstQuestion(sid: string) {
    try {
      const response = await liftCoachApi.sendMessage(sid, 'start');
      const aiMsg = response.message || response.aiResponse || '';
      if (!response.complete && aiMsg) {
        setMessages(prev => [
          ...prev,
          { id: `a-${Date.now()}`, role: 'assistant', content: aiMsg },
        ]);
      }
    } catch {
      Alert.alert('Error', 'Failed to load initial question.');
    }
  }

  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages.length]);

  async function send(text: string) {
    if (!text.trim() || loading || !sessionId) return;

    const userMessage: Msg = { id: `u-${Date.now()}`, role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMessage]);
    setValue('');
    setLoading(true);

    try {
      const response = await liftCoachApi.sendMessage(sessionId, text.trim());

      const aiMsg = response.message || response.aiResponse || '';

      if (response.complete) {
        setDone(true);
        setMessages(prev => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: aiMsg || "That's enough signal. I have what I need to create your personalized plan.",
          },
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          { id: `a-${Date.now()}`, role: 'assistant', content: aiMsg },
        ]);
      }

      setQuestionCount(prev => prev + 1);
    } catch {
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle}>Step 3 of 4</Text>
          <Text style={styles.navSubtitle}>
            {questionCount > 0 ? `${questionCount} questions answered` : 'Diagnostic Interview'}
          </Text>
        </View>
        <View style={styles.statusBadge}>
          <Ionicons
            name={done ? 'checkmark-circle' : 'hardware-chip'}
            size={14}
            color={colors.primary}
          />
          <Text style={styles.statusText}>{done ? 'Complete' : 'In progress'}</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.chatContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map(m => (
            <ChatBubble key={m.id} msg={m} />
          ))}
          {(loading || initialLoading) && <LoadingBubble />}
        </ScrollView>

        {done ? (
          <View style={styles.doneBar}>
            <Text style={styles.doneText}>Ready to generate your plan.</Text>
            <Button onPress={() => router.push('/diagnostic/plan')} size="lg">
              Generate Plan
            </Button>
          </View>
        ) : (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.chatInput}
              value={value}
              onChangeText={setValue}
              placeholder={loading ? 'AI is thinking...' : 'Type your answer...'}
              placeholderTextColor={colors.mutedForeground}
              editable={!loading && !done}
              onSubmitEditing={() => send(value)}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[styles.sendButton, (!value.trim() || loading) && styles.sendButtonDisabled]}
              onPress={() => send(value)}
              disabled={!value.trim() || loading || done}
            >
              <Ionicons name="send" size={18} color={colors.primaryForeground} />
            </TouchableOpacity>
          </View>
        )}

        {!done && (
          <View style={styles.hintBar}>
            <Text style={styles.hintText}>
              Short answers are fine — e.g. "lockout", "drifts to face", "triceps give out"
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  navbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  navCenter: { alignItems: 'center' },
  navTitle: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  navSubtitle: { color: colors.mutedForeground, fontSize: fontSize.xs, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.secondary, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  statusText: { color: colors.mutedForeground, fontSize: fontSize.xs },
  chatContent: { padding: spacing.lg, paddingBottom: 16, gap: 10 },
  bubbleRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '85%', borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: colors.primary },
  bubbleAssistant: { backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border },
  bubbleHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  avatarBox: {
    width: 28, height: 28, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  avatarBoxUser: { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.3)' },
  bubbleContent: { flex: 1 },
  bubbleText: { color: colors.foreground, fontSize: fontSize.sm, lineHeight: 20 },
  bubbleTextUser: { color: colors.primaryForeground },
  loadingText: { color: colors.mutedForeground, fontSize: fontSize.sm, marginTop: 4 },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  chatInput: {
    flex: 1, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.foreground, fontSize: fontSize.base,
  },
  sendButton: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.5 },
  doneBar: {
    padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, gap: 12,
  },
  doneText: { color: colors.mutedForeground, fontSize: fontSize.sm, textAlign: 'center' },
  hintBar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  hintText: { color: colors.mutedForeground, fontSize: fontSize.xs, textAlign: 'center' },
});
