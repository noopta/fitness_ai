// The post menu (handoff S-03): ··· on any post. Forward and Report work on
// anyone's post, Delete only on your own. Report asks why on the next step;
// Delete confirms with what's lost.

import React, { useState } from 'react';
import { View, Text, Alert, Share, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { v2, T } from '../../theme';
import { Row } from '../../primitives/Row';
import { Sheet } from '../../primitives/Sheet';
import { TextAction } from '../../primitives/TextAction';
import { socialApi } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { qk } from '../../data';
import { haptics } from '../../haptics';
import { displayName } from './common';
import type { PostModel } from './Post';

const REASONS: { key: string; label: string; sub?: string }[] = [
  { key: 'spam', label: 'Spam' },
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'misinformation', label: 'Unsafe advice', sub: 'Training or nutrition that could hurt someone' },
  { key: 'hate', label: 'Hate' },
  { key: 'sexual', label: 'Sexual content' },
  { key: 'self_harm', label: 'Self-harm' },
  { key: 'other', label: 'Something else' },
];

export function PostMenu({ post, onClose, onDeleted }: { post: PostModel | null; onClose: () => void; onDeleted?: (id: string) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState<'menu' | 'forward' | 'report'>('menu');
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const friends = useQuery({ queryKey: ['v2', 'social', 'friends'], queryFn: () => socialApi.getFriends() as Promise<any>, enabled: step === 'forward', staleTime: 60_000 });
  if (!post) return null;
  const mine = !!user?.id && post.sharer?.id === user.id;
  const isSaved = saved ?? !!post.savedByMe;
  const close = () => { setStep('menu'); setBusy(null); setSaved(null); onClose(); };
  const toggleSave = async () => {
    const next = !isSaved; setSaved(next); haptics.light();
    try { await (next ? socialApi.savePost(post.id) : socialApi.unsavePost(post.id)); void qc.invalidateQueries({ queryKey: ['v2', 'social', 'saved'] }); } catch { setSaved(!next); }
  };
  const forward = async (f: any) => {
    setBusy(f.id);
    try { await socialApi.forwardPost(post.id, f.id); haptics.success(); Alert.alert('Sent', `Forwarded to ${displayName(f)}.`); close(); }
    catch (e: any) { Alert.alert('Couldn’t send', e?.message ?? ''); setBusy(null); }
  };
  const report = async (reason: string) => {
    setBusy(reason);
    try { await socialApi.reportPost(post.id, reason); haptics.success(); Alert.alert('Reported', 'Thanks — someone will look at it. You won’t see it once it’s reviewed.'); close(); }
    catch (e: any) { Alert.alert('Couldn’t report it', e?.message ?? ''); setBusy(null); }
  };
  const remove = () => {
    const lost = [post.reactionCount ? `${post.reactionCount} like${post.reactionCount === 1 ? '' : 's'}` : null, post.commentCount ? `${post.commentCount} comment${post.commentCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ');
    Alert.alert('Delete this post?', `${lost ? `${lost} go with it. ` : ''}This can’t be undone.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await socialApi.deletePost(post.id); haptics.success(); onDeleted?.(post.id); await qc.invalidateQueries({ queryKey: qk.feedPages }); close(); }
        catch (e: any) { Alert.alert('Couldn’t delete', e?.message ?? ''); }
      } },
    ]);
  };
  const flist: any[] = friends.data?.friends ?? (Array.isArray(friends.data) ? friends.data : []);
  return (
    <Sheet visible={!!post} onClose={close} title={step === 'forward' ? 'Forward to…' : step === 'report' ? 'What’s wrong with it?' : undefined}>
      {step === 'menu' ? (
        <View>
          <Row name="Forward to a friend" value="→" onPress={() => setStep('forward')} />
          <Row name="Share…" value="→" onPress={() => { void Share.share({ message: `${displayName(post.sharer)} on Axiom: ${String(post.caption ?? post.payload?.text ?? post.payload?.title ?? '').slice(0, 200)}` }).catch(() => {}); }} />
          <Row name={isSaved ? 'Saved' : 'Save'} value={isSaved ? '✓' : '→'} onPress={() => void toggleSave()} />
          {!mine ? <Row name="Report" sub="Spam, harassment, unsafe advice" value="→" onPress={() => setStep('report')} last={!mine} /> : null}
          {mine ? <Row name="Delete post" sub="Only on your own posts" value="→" last onPress={remove} /> : null}
          <TextAction muted arrow={false} size={15} style={{ marginTop: 16 }} onPress={close}>Cancel</TextAction>
        </View>
      ) : step === 'forward' ? (
        <View>
          {friends.isLoading ? <ActivityIndicator color={v2.color.muted} style={{ marginVertical: 12 }} /> : null}
          {flist.slice(0, 30).map((f, i) => <Row key={f.id} name={displayName(f)} sub={f.username ? `@${f.username}` : undefined} value={busy === f.id ? '…' : '→'} last={i === Math.min(flist.length, 30) - 1} onPress={busy ? undefined : () => void forward(f)} />)}
          {!friends.isLoading && !flist.length ? <Text style={T.bodyMuted}>Add a friend to forward posts.</Text> : null}
          <TextAction muted arrow={false} size={15} style={{ marginTop: 16 }} onPress={() => setStep('menu')}>← Back</TextAction>
        </View>
      ) : (
        <View>
          {REASONS.map((r, i) => <Row key={r.key} name={r.label} sub={r.sub} value={busy === r.key ? '…' : '→'} last={i === REASONS.length - 1} onPress={busy ? undefined : () => void report(r.key)} />)}
          <TextAction muted arrow={false} size={15} style={{ marginTop: 16 }} onPress={() => setStep('menu')}>← Back</TextAction>
        </View>
      )}
    </Sheet>
  );
}
