import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { liftCoachApi } from '../../src/lib/api';
import { Analytics } from '../../src/lib/analytics';
import { Button } from '../../src/components/ui/Button';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../src/components/ui/KeyboardDoneBar';
import { MarkdownText } from '../../src/components/ui/MarkdownText';
import { colors, spacing, fontSize, fontWeight, radius } from '../../src/constants/theme';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}


const WELCOME_MESSAGE: Message = {
  role: 'assistant',
  content:
    "I'm analyzing your training data. Let me ask you a few questions to better understand your strength limiters.",
};

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const scrollViewRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    initSession();
  }, []);

  async function initSession() {
    try {
      const paramId = params.sessionId as string | undefined;
      const storedId = await AsyncStorage.getItem('axiom_session_id');
      const sid = paramId || storedId;
      if (!sid) {
        Alert.alert('Error', 'Session not found. Please start over.');
        router.replace('/diagnostic/onboarding');
        return;
      }
      if (sid !== storedId) {
        await AsyncStorage.setItem('axiom_session_id', sid);
      }
      setSessionId(sid);

      const data = await liftCoachApi.getSession(sid);
      const rawMessages: Message[] = (data.messages || data.session?.messages || [])
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content ?? m.message ?? '' }))
        // Strip the internal __init__ trigger — it's not a real user message
        .filter((m: Message) => m.content.trim() !== '__init__');

      const hasAssistantMessages = rawMessages.some((m: Message) => m.role === 'assistant');

      if (rawMessages.length === 0 || !hasAssistantMessages) {
        // New session OR resumed session where the AI's first response never saved
        setMessages(rawMessages.length > 0 ? rawMessages : [WELCOME_MESSAGE]);
        setInitialLoading(false);
        triggerInitialQuestions(sid);
      } else {
        setMessages(rawMessages);
        if (data.session?.status === 'complete' || data.status === 'complete') {
          setIsComplete(true);
        }
        setInitialLoading(false);
      }
    } catch (err: any) {
      setMessages([WELCOME_MESSAGE]);
      setInitialLoading(false);
    }
  }

  // Auto-trigger the AI's first diagnostic questions for a new session
  async function triggerInitialQuestions(sid: string) {
    setLoading(true);
    try {
      const response = await liftCoachApi.sendMessage(sid, '__init__');
      const assistantContent =
        (typeof response.message === 'string' ? response.message : response.message?.content) ||
        response.content ||
        response.reply ||
        "I've reviewed your training data. Let me ask you a few targeted questions.";

      setMessages((prev) => [...prev, { role: 'assistant', content: assistantContent }]);

      if (response.complete === true || response.message?.complete === true) {
        setIsComplete(true);
      }
    } catch {
      // Silently fail — user can type to continue the session
    } finally {
      setLoading(false);
    }
  }

  function scrollToBottom() {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages]);

  async function handleSend() {
    const content = inputText.trim();
    if (!content || loading || !sessionId) return;

    const userMessage: Message = { role: 'user', content };
    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setLoading(true);

    try {
      const response = await liftCoachApi.sendMessage(sessionId, content);
      const assistantContent =
        (typeof response.message === 'string' ? response.message : response.message?.content) ||
        response.content ||
        response.reply ||
        'I understand. Let me continue the analysis.';

      const assistantMessage: Message = { role: 'assistant', content: assistantContent };
      setMessages((prev) => [...prev, assistantMessage]);

      if (response.complete === true || response.message?.complete === true) {
        setIsComplete(true);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to send message. Please try again.');
      // Remove the user message on failure
      setMessages((prev) => prev.filter((m) => m !== userMessage));
    } finally {
      setLoading(false);
    }
  }

  async function handleGeneratePlan() {
    if (!sessionId) return;
    setGenerating(true);
    try {
      const result = await liftCoachApi.generatePlan(sessionId);
      const lift = result?.session?.selectedLift ?? result?.selectedLift ?? '';
      Analytics.diagnosticCompleted(lift);
      router.push('/diagnostic/plan');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to generate plan. Please try again.');
      setGenerating(false);
    }
  }

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: 'AI Diagnostic' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading session...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardDoneBar />
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Text style={styles.headerTitleText}>AI Diagnostic</Text>
            </View>
          ),
          headerRight: () => (
            <View style={styles.stepIndicator}>
              <Text style={styles.stepText}>Step 3</Text>
            </View>
          ),
          // Override back to go home — prevents user from stepping back through the wizard
          headerLeft: () => (
            <Pressable
              onPress={() => router.replace('/(tabs)')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ paddingHorizontal: 4 }}
            >
              <Ionicons name="close" size={22} color={colors.foreground} />
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 30}
      >
        {/* Messages */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((msg, index) => (
            <View
              key={index}
              style={[
                styles.messageRow,
                msg.role === 'user' ? styles.messageRowUser : styles.messageRowAssistant,
              ]}
            >
              {msg.role === 'assistant' && (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>A</Text>
                </View>
              )}
              <View
                style={[
                  styles.bubble,
                  msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                ]}
              >
                {msg.role === 'assistant' ? (
                  <MarkdownText
                    text={msg.content}
                    style={[styles.bubbleText, styles.bubbleTextAssistant]}
                  />
                ) : (
                  <Text style={[styles.bubbleText, styles.bubbleTextUser]}>
                    {msg.content}
                  </Text>
                )}
              </View>
            </View>
          ))}

          {/* Loading indicator for assistant response */}
          {loading && (
            <View style={[styles.messageRow, styles.messageRowAssistant]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>A</Text>
              </View>
              <View style={styles.bubbleAssistant}>
                <ActivityIndicator size="small" color={colors.primary} style={{ padding: 4 }} />
              </View>
            </View>
          )}

          {/* Generate Plan Button */}
          {isComplete && !generating && (
            <View style={styles.generateContainer}>
              <Text style={styles.generateHint}>
                Your diagnostic interview is complete.
              </Text>
              <Button
                onPress={handleGeneratePlan}
                fullWidth
                size="lg"
                style={styles.generateBtn}
              >
                Generate My Plan
              </Button>
            </View>
          )}

          {generating && (
            <View style={styles.generateContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.generatingText}>Generating your personalized plan...</Text>
            </View>
          )}
        </ScrollView>

        {/* Input Bar */}
        {!isComplete && (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder={loading ? 'Analyzing…' : 'Type your response...'}
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={1000}
              returnKeyType="default"
              editable={!loading}
              inputAccessoryViewID={KEYBOARD_DONE_ID}
            />
            <Pressable
              onPress={handleSend}
              disabled={!inputText.trim() || loading}
              style={[
                styles.sendBtn,
                (!inputText.trim() || loading) && styles.sendBtnDisabled,
              ]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="send"
                size={20}
                color={
                  !inputText.trim() || loading ? colors.mutedForeground : colors.primary
                }
              />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: fontSize.base,
    color: colors.mutedForeground,
  },

  // Header
  headerTitle: {
    alignItems: 'center',
  },
  headerTitleText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  stepIndicator: {
    backgroundColor: colors.muted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    marginRight: spacing.sm,
  },
  stepText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.mutedForeground,
  },

  // Messages
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: 4,
  },
  messageRowAssistant: {
    justifyContent: 'flex-start',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },

  // Avatar
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.primaryForeground,
  },

  // Bubbles
  bubble: {
    maxWidth: '75%',
    borderRadius: radius.lg,
    padding: spacing.sm,
    paddingHorizontal: 14,
  },
  bubbleAssistant: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 21,
  },
  bubbleTextAssistant: {
    color: colors.foreground,
  },
  bubbleTextUser: {
    color: '#ffffff',
  },

  // Generate plan
  generateContainer: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  generateHint: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  generateBtn: {
    marginTop: 4,
  },
  generatingText: {
    fontSize: fontSize.base,
    color: colors.mutedForeground,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.foreground,
    fontSize: fontSize.base,
    maxHeight: 120,
    minHeight: 44,
  },
  sendBtn: {
    padding: 10,
    marginBottom: 2,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
