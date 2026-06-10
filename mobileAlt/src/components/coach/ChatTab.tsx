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
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { coachApi, getToken } from '../../lib/api';
import { Analytics } from '../../lib/analytics';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../ui/KeyboardDoneBar';
import { MarkdownText } from '../ui/MarkdownText';

const API_BASE = 'https://api.airthreads.ai:4009/api';

// Shape of the proposal the agent returns. Discriminated union — new kinds
// added on the backend can be ignored gracefully (we just don't render
// them). Mirrors backend/src/agent/types.ts AgentProposal.
type AgentProposal =
  | { kind: 'program_update'; summary: string; updatedProgram: any; changedDays?: string[] }
  | { kind: 'workout_swap'; summary: string; rationale: string; proposedWeek: any[]; sourceDate: string; chosenSessionName: string };

interface ChatTabProps {
  coachData: any;
  /**
   * Pre-fill the message composer when the user lands here from a suggested
   * prompt on the Overview tab. Used to reduce the "blank cursor" friction
   * that left only 18 of 116 Coach openers actually starting a conversation.
   */
  initialPrompt?: string;
  /** Called once the initial prompt has been written into the input. */
  onInitialPromptConsumed?: () => void;
}

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  _isTemp?: boolean;
  /** Set when the assistant turn included an agent tool proposal. */
  proposal?: AgentProposal;
  /** Set after a proposal has been applied or dismissed by the user. */
  proposalState?: 'applied' | 'dismissed' | 'applying' | 'failed';
}

interface ProposalCardProps {
  proposal: AgentProposal;
  state: ChatMessage['proposalState'];
  onApply: () => void;
  onDismiss: () => void;
}

// Inline card surfaced below an assistant message when the agent returned a
// proposal (currently only program_update). Apply persists via the
// /coach/agent/confirm-proposal route, which runs the same goal-preserving
// validation as a direct /coach/program write — the agent does NOT mutate
// state on its own.
function ProposalCard({ proposal, state, onApply, onDismiss }: ProposalCardProps) {
  const isTerminal = state === 'applied' || state === 'dismissed';
  const isSwap = proposal.kind === 'workout_swap';
  const eyebrow =
    state === 'applied' ? (isSwap ? 'Week applied' : 'Applied') :
    state === 'dismissed' ? 'Dismissed' :
    (isSwap ? 'Proposed swap' : 'Proposed change');
  const icon = isSwap ? 'swap-horizontal' : 'construct-outline';

  // For workout_swap, the most useful preview is the resolved week — show
  // each day's session name (or Rest) so the user can verify spacing before
  // tapping Apply. For program_update, the agent already wrote a summary
  // and a list of changedDays we can render verbatim.
  const swapWeek = isSwap ? (proposal as any).proposedWeek as Array<any> | undefined : undefined;
  return (
    <View style={styles.proposalCard}>
      <View style={styles.proposalHeader}>
        <Ionicons name={icon as any} size={16} color={colors.primary} />
        <Text style={styles.proposalEyebrow}>{eyebrow}</Text>
      </View>
      <Text style={styles.proposalSummary}>{proposal.summary}</Text>
      {isSwap && (proposal as any).rationale ? (
        <Text style={styles.proposalDays}>{(proposal as any).rationale}</Text>
      ) : null}
      {isSwap && swapWeek && swapWeek.length > 0 ? (
        <View style={{ gap: 2, marginTop: 4 }}>
          {swapWeek.map((d: any) => (
            <Text key={d.date} style={styles.proposalDays}>
              {d.dayLabel ?? d.date.slice(5)}: {d.session?.day ?? 'Rest'}{d.isSwapped ? ' ←' : ''}
            </Text>
          ))}
        </View>
      ) : null}
      {!isSwap && (proposal as any).changedDays && (proposal as any).changedDays.length > 0 ? (
        <Text style={styles.proposalDays}>
          Affects: {(proposal as any).changedDays.join(', ')}
        </Text>
      ) : null}
      {!isTerminal ? (
        <View style={styles.proposalActions}>
          <Pressable
            style={[styles.proposalBtn, styles.proposalBtnGhost]}
            onPress={onDismiss}
            disabled={state === 'applying'}
          >
            <Text style={styles.proposalBtnGhostText}>Not now</Text>
          </Pressable>
          <Pressable
            style={[styles.proposalBtn, styles.proposalBtnPrimary, state === 'applying' && { opacity: 0.6 }]}
            onPress={onApply}
            disabled={state === 'applying'}
          >
            {state === 'applying' ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={styles.proposalBtnPrimaryText}>Apply</Text>
            )}
          </Pressable>
        </View>
      ) : null}
      {state === 'failed' ? (
        <Text style={styles.proposalError}>Couldn't apply — please try again.</Text>
      ) : null}
    </View>
  );
}

function MessageBubble({
  msg,
  onApplyProposal,
  onDismissProposal,
}: {
  msg: ChatMessage;
  onApplyProposal: (msgId: string) => void;
  onDismissProposal: (msgId: string) => void;
}) {
  const isUser = msg.role === 'user';
  return (
    <View>
      <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
        {!isUser && (
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>A</Text>
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
          {isUser ? (
            <Text style={[styles.bubbleText, styles.bubbleTextUser]}>{msg.content}</Text>
          ) : (
            <MarkdownText text={msg.content} style={[styles.bubbleText, styles.bubbleTextAssistant]} />
          )}
        </View>
      </View>
      {msg.proposal && msg.id ? (
        <ProposalCard
          proposal={msg.proposal}
          state={msg.proposalState}
          onApply={() => onApplyProposal(msg.id!)}
          onDismiss={() => onDismissProposal(msg.id!)}
        />
      ) : null}
    </View>
  );
}

export function ChatTab({ coachData, initialPrompt, onInitialPromptConsumed }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Seed the composer when arriving via a suggested-prompt chip. Notify the
  // parent so it can clear its pending-prompt state once consumed.
  useEffect(() => {
    if (initialPrompt && initialPrompt.length > 0) {
      setInputText(initialPrompt);
      onInitialPromptConsumed?.();
    }
  }, [initialPrompt, onInitialPromptConsumed]);

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

    Analytics.coachMessageSent(text.length);

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setSending(true);

    // Placeholder for the assistant reply — replaced with the agent result.
    const streamId = `stream-${Date.now()}`;
    setMessages((prev) => [...prev, { role: 'assistant', content: '', id: streamId, _isTemp: true }]);

    try {
      // coachApi.sendAgent calls /coach/agent (the tool-use loop). Server
      // manages conversation history so we don't pass it. Falls back to the
      // classic /coach/chat endpoint if the agent is disabled (404).
      const result: any = await coachApi.sendAgent(text);
      const reply: string = result?.reply ?? result?.message ?? '';
      const proposal: AgentProposal | undefined =
        result?.proposal && typeof result.proposal === 'object' ? result.proposal : undefined;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamId
            ? { ...m, content: reply || "I'm here but didn't generate a reply this time.", _isTemp: false, proposal }
            : m
        )
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

  // Apply a proposal: persists via /coach/agent/confirm-proposal which runs
  // the same goal-preserving validation as a direct PUT /coach/program. On
  // success we mark the card terminal so it can't be re-applied.
  async function handleApplyProposal(msgId: string) {
    const target = messages.find((m) => m.id === msgId);
    const proposal = target?.proposal;
    if (!proposal) return;
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, proposalState: 'applying' } : m)));
    try {
      // The two proposal kinds have different apply payloads; the
      // /coach/agent/confirm-proposal route discriminates on which field is
      // present (updatedProgram vs proposedWeek).
      if (proposal.kind === 'workout_swap') {
        await coachApi.confirmProposal({ proposedWeek: (proposal as any).proposedWeek, reason: 'Agent swap' });
      } else {
        await coachApi.confirmProposal({ updatedProgram: (proposal as any).updatedProgram });
      }
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, proposalState: 'applied' } : m)));
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, proposalState: 'failed' } : m)));
    }
  }

  function handleDismissProposal(msgId: string) {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, proposalState: 'dismissed' } : m)));
  }

  const canSend = inputText.trim().length > 0 && !sending;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 160 : 30}
    >
      <KeyboardDoneBar />
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
            <MessageBubble
              key={msg.id ?? `msg-${idx}`}
              msg={msg}
              onApplyProposal={handleApplyProposal}
              onDismissProposal={handleDismissProposal}
            />
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
          inputAccessoryViewID={KEYBOARD_DONE_ID}
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

  // Proposal card (agent tool-call surface)
  proposalCard: {
    marginTop: 8,
    marginLeft: 40, // align with assistant bubble (avatar width)
    padding: spacing.md,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    gap: 6,
  },
  proposalHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proposalEyebrow: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  proposalSummary: { fontSize: fontSize.sm, color: colors.foreground, lineHeight: 20 },
  proposalDays: { fontSize: fontSize.xs, color: colors.mutedForeground },
  proposalActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  proposalBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proposalBtnGhost: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  proposalBtnGhostText: { fontSize: fontSize.sm, color: colors.foreground, fontWeight: fontWeight.semibold },
  proposalBtnPrimary: { backgroundColor: colors.foreground },
  proposalBtnPrimaryText: { fontSize: fontSize.sm, color: colors.primaryForeground, fontWeight: fontWeight.semibold },
  proposalError: { fontSize: fontSize.xs, color: '#ef4444', marginTop: 6 },

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
