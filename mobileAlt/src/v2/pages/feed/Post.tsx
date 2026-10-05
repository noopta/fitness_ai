// One feed post, no card (bug fixes 5 Oct 2026, 3a):
//   avatar 28 + name 15/600 + "· 2 h"
//   eyebrow "PULL · 61 MIN"
//   hero — a PR (34/700 number + 13/600 crimson "Deadlift PR") or three stat columns (20/700 + 12 label)
//   optional caption, 15 pt
//   actions 13/600 muted: Like · N (ink once liked) · Comment · N · Save
// Posts are separated by a #e4e4e7 hairline; 18 pt vertical padding.

import React, { memo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { v2, T } from '../../theme';
import { haptics } from '../../haptics';
import { socialApi } from '../../../lib/api';
import { sessionTitle } from '../../format';
import { Avatar, ago, displayName } from './common';

const C = v2.color;
const KG_TO_LB = 2.2046226218;

export interface PostModel {
  id: string;
  sharer: any;
  createdAt: string;
  itemType: string;
  payload: any;
  caption?: string | null;
  reactionCount: number;
  likedByMe: boolean;
  commentCount: number;
  savedByMe?: boolean;
}

type Hero = { kind: 'pr'; value: string; label: string } | { kind: 'stats'; cols: { value: string; label: string }[] } | null;

const short = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : Math.round(n).toLocaleString());

/** What the post is about, as the eyebrow: "PULL · 61 MIN". Null for a post that isn't a session. */
export function postEyebrow(p: PostModel): string | null {
  const pl = p.payload ?? {};
  const exercises: any[] = Array.isArray(pl.exercises) ? pl.exercises : [];
  if (!exercises.length && !pl.pr) return null;
  const title = pl.title ? sessionTitle(pl.title) : 'Workout';
  const mins = Number(pl.durationMin);
  return [title, mins > 0 ? `${Math.round(mins)} min` : null].filter(Boolean).join(' · ').toUpperCase();
}

/** A PR beats the stats; stats need exercises. Loads show in the viewer's unit. */
export function postHero(p: PostModel, unit: 'lbs' | 'kg'): Hero {
  const pl = p.payload ?? {};
  if (pl.pr) {
    const kg = Number(pl.pr.valueKg);
    const value = Number.isFinite(kg) && kg > 0 ? String(Math.round(unit === 'kg' ? kg : kg * KG_TO_LB)) : String(pl.pr.value ?? '');
    return value ? { kind: 'pr', value, label: `${pl.pr.lift ?? 'Lift'} PR` } : null;
  }
  const exercises: any[] = Array.isArray(pl.exercises) ? pl.exercises : [];
  if (!exercises.length) return null;
  let sets = 0, volKg = 0;
  for (const e of exercises) {
    const s = Math.max(1, Number(e.sets) || 1);
    const reps = Number(String(e.reps ?? '').match(/\d+/)?.[0]) || 0;
    const kg = Number(e.weightKg) || (Number(e.weight) > 0 ? (e.unit === 'kg' ? Number(e.weight) : Number(e.weight) / KG_TO_LB) : 0);
    sets += s; volKg += s * reps * kg;
  }
  const cols = [{ value: String(exercises.length), label: exercises.length === 1 ? 'Exercise' : 'Exercises' }, { value: String(sets), label: 'Sets' }];
  if (volKg > 0) cols.push({ value: short(unit === 'kg' ? volKg : volKg * KG_TO_LB), label: unit === 'kg' ? 'kg moved' : 'lb moved' });
  else if (Number(pl.durationMin) > 0) cols.push({ value: String(Math.round(pl.durationMin)), label: 'Minutes' });
  return { kind: 'stats', cols };
}

export const Post = memo(function Post({ post, unit, onOpen, onComment, onAuthor }: {
  post: PostModel; unit: 'lbs' | 'kg'; onOpen?: (p: PostModel) => void; onComment: (p: PostModel) => void; onAuthor: (p: PostModel) => void;
}) {
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.reactionCount);
  const [saved, setSaved] = useState(!!post.savedByMe);
  const eyebrow = postEyebrow(post);
  const hero = postHero(post, unit);
  const caption = String(post.caption ?? post.payload?.text ?? '').trim();

  const like = async () => {
    haptics.light();
    const next = !liked;
    setLiked(next); setLikes((n) => n + (next ? 1 : -1));
    try { const r: any = await socialApi.reactToPost(post.id); if (typeof r?.liked === 'boolean' && r.liked !== next) { setLiked(r.liked); setLikes((n) => n + (r.liked ? 1 : -1)); } }
    catch { setLiked(!next); setLikes((n) => n + (next ? -1 : 1)); }
  };
  const save = async () => {
    haptics.light();
    const next = !saved;
    setSaved(next);
    try { await (next ? socialApi.savePost(post.id) : socialApi.unsavePost(post.id)); } catch { setSaved(!next); }
  };

  return (
    <View style={styles.post}>
      <Pressable onPress={() => onAuthor(post)} style={styles.head} accessibilityRole="button" accessibilityLabel={`${displayName(post.sharer)}, ${ago(post.createdAt)} ago`}>
        <Avatar user={post.sharer} size={28} />
        <Text style={styles.name} numberOfLines={1}>{displayName(post.sharer)}</Text>
        <Text style={styles.when}>· {ago(post.createdAt)}</Text>
      </Pressable>

      <Pressable onPress={onOpen ? () => onOpen(post) : undefined} disabled={!onOpen}>
        {eyebrow ? <Text style={[T.eyebrow, { marginTop: 14 }]}>{eyebrow}</Text> : null}
        {hero?.kind === 'pr' ? (
          <View style={styles.prRow}>
            <Text style={styles.prValue}>{hero.value}</Text>
            <Text style={styles.prLabel}>{hero.label}</Text>
          </View>
        ) : hero?.kind === 'stats' ? (
          <View style={styles.stats}>
            {hero.cols.map((c) => (
              <View key={c.label} style={{ flex: 1 }}>
                <Text style={styles.statValue}>{c.value}</Text>
                <Text style={styles.statLabel}>{c.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {caption ? <Text style={[T.body, { marginTop: 12 }]}>{caption}</Text> : null}
      </Pressable>

      <View style={styles.actions}>
        <Pressable onPress={() => void like()} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: liked }} accessibilityLabel={`Like, ${likes}`}>
          <Text style={[styles.action, liked && { color: C.ink }]}>Like · {likes}</Text>
        </Pressable>
        <Pressable onPress={() => { haptics.select(); onComment(post); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Comment, ${post.commentCount}`}>
          <Text style={styles.action}>Comment · {post.commentCount}</Text>
        </Pressable>
        <Pressable onPress={() => void save()} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: saved }}>
          <Text style={[styles.action, saved && { color: C.ink }]}>{saved ? 'Saved' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  post: { paddingVertical: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20, color: C.ink, flexShrink: 1 },
  when: { fontFamily: v2.font.regular, fontSize: 15, lineHeight: 20, color: C.muted },
  prRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 6 },
  prValue: { fontFamily: v2.font.bold, fontSize: 34, lineHeight: 39, letterSpacing: -0.68, color: C.ink, fontVariant: ['tabular-nums'] },
  prLabel: { fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 18, color: C.crimson },
  stats: { flexDirection: 'row', gap: 12, marginTop: 8 },
  statValue: { fontFamily: v2.font.bold, fontSize: 20, lineHeight: 25, color: C.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: v2.font.regular, fontSize: 12, lineHeight: 16, color: C.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 20, marginTop: 14 },
  action: { fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 18, color: C.muted },
});
