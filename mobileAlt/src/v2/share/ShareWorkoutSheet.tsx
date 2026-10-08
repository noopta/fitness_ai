// Share after a workout (handoff S-04). After "Session logged", and from
// You → Share. Optional, one tap to skip. Post to Friends attaches the
// workout to a feed post; Share elsewhere exports the card.

import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { v2, T } from '../theme';
import { Row } from '../primitives/Row';
import { ShareCardSheet, CARD_INK, type CardTheme } from './ShareCardSheet';
import { socialApi } from '../../lib/api';
import { qk } from '../data';
import { haptics } from '../haptics';

/** The workout as a feed post's payload — what the feed's Post renders (title, minutes, exercises). */
export interface WorkoutShare {
  title: string;
  durationMin: number | null;
  exercises: { name: string; sets: number; reps: string; weightKg: number | null }[];
  /** Display lines for the card. */
  top: string | null;
  sets: number;
  volume: string | null;
  date?: string;
}

export function ShareWorkoutSheet({ visible, onClose, workout, friendCount }: { visible: boolean; onClose: () => void; workout: WorkoutShare | null; friendCount?: number }) {
  const qc = useQueryClient();
  const [posted, setPosted] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!workout) return null;
  const post = async () => {
    if (posted || busy) return;
    setBusy(true);
    try {
      await socialApi.shareItem({ itemType: 'workout', payload: { title: workout.title, durationMin: workout.durationMin, exercises: workout.exercises }, visibility: 'friends' });
      setPosted(true); haptics.success();
      void qc.invalidateQueries({ queryKey: qk.feedPages });
    } catch { /* the row says so */ }
    setBusy(false);
  };
  const date = workout.date ?? new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <ShareCardSheet visible={visible} onClose={() => { setPosted(false); onClose(); }} title="Share it?"
      card={(theme) => <WorkoutCard theme={theme} w={workout} date={date} />}
      extra={<View style={{ marginTop: 14 }}><Row name={posted ? 'Posted to Friends' : 'Post to Friends'} sub={friendCount ? `${friendCount} people` : 'Your workout, attached'} value={posted ? '✓' : busy ? '…' : '→'} last onPress={posted ? undefined : () => void post()} /></View>} />
  );
}

function WorkoutCard({ theme, w, date }: { theme: CardTheme; w: WorkoutShare; date: string }) {
  const c = CARD_INK[theme];
  return (
    <>
      <View>
        <Text style={[T.eyebrow, { color: c.muted }]}>{[w.title, w.durationMin ? `${w.durationMin} min` : null].filter(Boolean).join(' · ').toUpperCase()}</Text>
        {w.top ? <Text style={{ fontFamily: v2.font.bold, fontSize: 52, lineHeight: 56, letterSpacing: -2, color: c.ink, marginTop: 18, fontVariant: ['tabular-nums'] }}>{w.top}</Text> : null}
        <Text style={[T.caption, { color: c.muted, marginTop: 6 }]}>{[`${w.exercises.length} exercise${w.exercises.length === 1 ? '' : 's'}`, `${w.sets} sets`, w.volume].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 }}>
        <Text style={[T.caption, { color: c.muted }]}>{date}</Text>
        <Text style={[T.captionStrong, { color: c.ink }]}>Axiom</Text>
      </View>
    </>
  );
}
