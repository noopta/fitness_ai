// Wellness check-in (design handoff H-04). Sleep, energy, mood and stress as
// tap rows; leave any of them blank. Only what you tap is saved — nothing is
// estimated from another answer. Sleep is the one Anakin needs to adjust the
// day, so it's the one that has to be there.

import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Pressable } from '../../primitives/Pressable';
import { TextAction } from '../../primitives/TextAction';
import { coachApi } from '../../../lib/api';
import { todayStr } from '../../../lib/localDate';
import { useInvalidate } from '../../data';
import { haptics } from '../../haptics';

const SLEEP = [{ label: '<5', hours: 4.5 }, { label: '5–6', hours: 5.5 }, { label: '6–7', hours: 6.5 }, { label: '7–8', hours: 7.5 }, { label: '8+', hours: 8.5 }];
const FIVE = [1, 2, 3, 4, 5];

function Scale({ title, value, labels, onPick }: { title: string; value: number | null; labels: (string | number)[]; onPick: (i: number | null) => void }) {
  return (
    <View style={{ marginTop: 22 }}>
      <View style={styles.scaleHead}>
        <Text style={T.rowStrong}>{title}</Text>
        <Text style={T.caption}>{value == null ? 'Not set' : String(labels[value])}</Text>
      </View>
      <View style={styles.chips}>
        {labels.map((l, i) => (
          <Pressable key={String(l)} onPress={() => { haptics.select(); onPick(value === i ? null : i); }} style={[styles.chip, value === i && styles.chipOn]}
            accessibilityRole="button" accessibilityState={{ selected: value === i }} accessibilityLabel={`${title} ${l}`}>
            <Text style={[styles.chipText, value === i && styles.chipTextOn]}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function CheckinPage() {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [sleep, setSleep] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const day = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  const save = async () => {
    if (sleep == null) { Alert.alert('How did you sleep?', 'Sleep is the one Anakin needs to adjust today. The rest can stay blank.'); return; }
    setBusy(true);
    try {
      // Stress is on the app's 1–10 scale: the five chips map to 2, 4, 6, 8, 10.
      await coachApi.postAnsweredCheckin({
        date: todayStr(), sleepHours: SLEEP[sleep].hours,
        ...(energy != null ? { energy: energy + 1 } : {}),
        ...(mood != null ? { mood: mood + 1 } : {}),
        ...(stress != null ? { stress: (stress + 1) * 2 } : {}),
      });
      await invalidate.afterSchedule();
      haptics.success();
      router.back();
    } catch (e: any) { Alert.alert('Couldn\'t save the check-in', e?.message ?? 'Try again.'); setBusy(false); }
  };

  return (
    <PushedPage back="Back" meta={day} title="How are you today?">
      <Scale title="Sleep" value={sleep} labels={SLEEP.map((x) => x.label)} onPick={setSleep} />
      <Scale title="Energy" value={energy} labels={FIVE} onPick={setEnergy} />
      <Scale title="Mood" value={mood} labels={FIVE} onPick={setMood} />
      <Scale title="Stress" value={stress} labels={FIVE} onPick={setStress} />
      <Text style={[T.caption, { marginTop: 18 }]}>Leave any of them blank. I adjust today from what you give me.</Text>
      <View style={styles.actions}>
        <TextAction primary onPress={() => void save()} loading={busy}>Save</TextAction>
        <TextAction muted arrow={false} onPress={() => router.back()}>Skip</TextAction>
      </View>
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  scaleHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chips: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: v2.color.hairline, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: v2.color.ink, borderColor: v2.color.ink },
  chipText: { fontFamily: v2.font.semibold, fontSize: 14, color: v2.color.ink },
  chipTextOn: { color: v2.color.white },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 30 },
});
