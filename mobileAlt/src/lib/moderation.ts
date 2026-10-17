/**
 * Report + block, shared by classic and v2 (App Store Guideline 1.2: every
 * piece of user-generated content — posts, comments, DMs, profiles — needs a
 * way to report it and to block its author).
 *
 * Native Alerts on purpose: they work identically on both UIs. Android shows
 * at most three Alert buttons, hence two reasons + Cancel; anything needing
 * detail goes to support@axiomtraining.io (Settings → Contact).
 */
import { Alert } from 'react-native';
import { socialApi } from './api';

export type ReportTarget = 'post' | 'comment' | 'message' | 'user';

const NOUN: Record<ReportTarget, string> = { post: 'post', comment: 'comment', message: 'message', user: 'person' };

/** Ask why, then file the report. Never throws. */
export function reportContent(itemId: string, targetType: ReportTarget, onDone?: () => void): void {
  if (!itemId) return;
  const file = async (reason: string) => {
    try {
      await socialApi.reportPost(itemId, reason, targetType);
      Alert.alert('Reported', 'Thanks — we review every report within 24 hours.');
      onDone?.();
    } catch (e: any) {
      Alert.alert('Couldn’t report it', e?.message || 'Please try again, or email support@axiomtraining.io.');
    }
  };
  Alert.alert(`Report this ${NOUN[targetType]}?`, 'What’s wrong with it?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Spam', onPress: () => { void file('spam'); } },
    { text: 'Abusive or unsafe', style: 'destructive', onPress: () => { void file('harassment'); } },
  ]);
}

/** Confirm, then block. `onBlocked` runs after the server confirms. */
export function confirmBlock(userId: string, name: string | null | undefined, onBlocked?: () => void): void {
  if (!userId) return;
  const who = name || 'this person';
  Alert.alert(`Block ${who}?`, 'They won’t be able to message you or see your posts, and you won’t see theirs. They aren’t told.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Block', style: 'destructive', onPress: async () => {
        try {
          await socialApi.blockUserById(userId);
          Alert.alert('Blocked', `You won’t see ${who} any more.`);
          onBlocked?.();
        } catch (e: any) {
          Alert.alert('Couldn’t block', e?.message || 'Please try again.');
        }
      },
    },
  ]);
}

/** Confirm, then unblock. */
export function confirmUnblock(userId: string, name: string | null | undefined, onUnblocked?: () => void): void {
  if (!userId) return;
  const who = name || 'this person';
  Alert.alert(`Unblock ${who}?`, 'You’ll be able to see each other again. Friendship isn’t restored.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Unblock', onPress: async () => {
        try {
          await socialApi.unblockUser(userId);
          onUnblocked?.();
        } catch (e: any) {
          Alert.alert('Couldn’t unblock', e?.status === 404
            ? 'Unblocking isn’t available yet. Email support@axiomtraining.io and we’ll do it for you.'
            : (e?.message || 'Please try again.'));
        }
      },
    },
  ]);
}

/**
 * The "…" menu for a person: Report / Block (or Unblock). For a message or a
 * comment pass `content` so Report files against that item.
 */
export function userSafetyMenu(opts: {
  userId: string;
  name?: string | null;
  blocked?: boolean;
  content?: { id: string; type: Exclude<ReportTarget, 'user'> };
  onBlockChange?: (blocked: boolean) => void;
}): void {
  const { userId, name, blocked, content, onBlockChange } = opts;
  if (!userId) return;
  Alert.alert(name || 'Options', undefined, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: content ? `Report ${NOUN[content.type]}` : 'Report',
      onPress: () => reportContent(content?.id ?? userId, content?.type ?? 'user'),
    },
    blocked
      ? { text: 'Unblock', onPress: () => confirmUnblock(userId, name, () => onBlockChange?.(false)) }
      : { text: 'Block', style: 'destructive', onPress: () => confirmBlock(userId, name, () => onBlockChange?.(true)) },
  ]);
}
