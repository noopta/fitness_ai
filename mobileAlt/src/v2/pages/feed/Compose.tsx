// Create a post (handoff S-01). From the Feed's + Post and a workout's Done
// screen. The audience sits top-right (Friends or Everyone). Attach a
// workout, a meal or a photo; an attached workout posts even with no caption.

import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { composeBody, type Attached } from '@axiom/agent-ui-core';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { Pressable } from '../../primitives/Pressable';
import { TextAction } from '../../primitives/TextAction';
import { Sheet } from '../../primitives/Sheet';
import { useWorkouts, useMeals, qk } from '../../data';
import { socialApi } from '../../../lib/api';
import { haptics } from '../../haptics';

const C = v2.color;
const fmtDay = (d: string) => { const x = new Date(`${String(d).slice(0, 10)}T12:00:00`); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
const exercisesOf = (w: any): any[] => { const e = typeof w?.exercises === 'string' ? (() => { try { return JSON.parse(w.exercises); } catch { return []; } })() : w?.exercises; return Array.isArray(e) ? e : []; };

export function ComposePage({ params }: { params: Record<string, string> }) {
  const router = useRouter();
  const qc = useQueryClient();
  const workouts = useWorkouts();
  const meals = useMeals();
  const wl: any[] = (Array.isArray(workouts.data) ? workouts.data : workouts.data?.workouts ?? []).slice(0, 8);
  const ml: any[] = (meals.data?.meals ?? meals.data?.entries ?? []).slice(-6).reverse();
  const preW = params.workoutId ? wl.find((w) => String(w.id) === params.workoutId) : null;
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<'friends' | 'public'>('friends');
  const [attached, setAttached] = useState<Attached>(null);
  const [image, setImage] = useState<{ uri: string; b64: string } | null>(null);
  const [picker, setPicker] = useState<null | 'workout' | 'meal' | 'audience'>(null);
  const [busy, setBusy] = useState(false);
  const att: Attached = attached ?? (preW ? { kind: 'workout', w: preW } : null);
  const canPost = !!text.trim() || !!att || !!image;
  const addPhoto = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (r.canceled || !r.assets?.[0]?.uri) return;
      const small = await ImageManipulator.manipulateAsync(r.assets[0].uri, [{ resize: { width: 1280 } }], { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (small.base64) setImage({ uri: small.uri, b64: small.base64 });
    } catch (e: any) { Alert.alert('Couldn’t add the photo', e?.message ?? ''); }
  };
  const post = async () => {
    if (!canPost || busy) return;
    setBusy(true);
    try {
      await socialApi.shareItem(composeBody(text, att, image?.b64 ?? null, audience) as any);
      haptics.success();
      await qc.invalidateQueries({ queryKey: qk.feedPages });
      router.back();
    } catch (e: any) { Alert.alert('Couldn’t post', e?.message ?? 'Try again.'); setBusy(false); }
  };
  return (
    <PushedPage back="Cancel" title=""
      right={<Pressable onPress={() => setPicker('audience')} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Audience: ${audience === 'friends' ? 'Friends' : 'Everyone'}. Change`}><Text style={[T.captionStrong, { color: C.ink }]}>{audience === 'friends' ? 'Friends' : 'Everyone'} ▾</Text></Pressable>}
      cta={{ label: 'Post', onPress: () => void post(), loading: busy }}>
      <TextInput value={text} onChangeText={setText} placeholder={att?.kind === 'workout' ? 'Say something about it (optional)' : 'What happened?'} placeholderTextColor={C.placeholder}
        style={styles.input} multiline autoFocus maxLength={2000} accessibilityLabel="Post text" />
      {att ? (
        <View style={{ marginTop: 22 }}>
          <Eyebrow>Attached</Eyebrow>
          <Row name={att.kind === 'workout' ? (att.w.title || 'Workout') : (att.m.name ?? 'Meal')}
            sub={att.kind === 'workout' ? `${fmtDay(att.w.date)} · ${exercisesOf(att.w).length} exercises` : `${Math.round(att.m.calories ?? 0)} kcal · ${Math.round(att.m.proteinG ?? 0)} g protein`}
            value="✕" last onPress={() => { setAttached(null); if (preW) router.setParams({ workoutId: '' } as any); }} />
        </View>
      ) : null}
      {image ? (
        <Pressable onPress={() => setImage(null)} accessibilityLabel="Remove photo" style={{ marginTop: 18 }}>
          <Image source={{ uri: image.uri }} style={styles.photo} resizeMode="cover" />
          <Text style={[T.caption, { marginTop: 6 }]}>Tap to remove</Text>
        </Pressable>
      ) : null}
      <View style={styles.attach}>
        {!image ? <TextAction muted arrow={false} size={15} onPress={() => void addPhoto()}>Add a photo</TextAction> : null}
        <TextAction muted arrow={false} size={15} onPress={() => setPicker('workout')}>Attach workout</TextAction>
        <TextAction muted arrow={false} size={15} onPress={() => setPicker('meal')}>Attach meal</TextAction>
      </View>
      <Sheet visible={picker === 'audience'} onClose={() => setPicker(null)} title="Who sees this?">
        <Row name="Friends" sub="People you’ve added" value={audience === 'friends' ? '✓' : undefined} onPress={() => { setAudience('friends'); setPicker(null); }} />
        <Row name="Everyone" sub="Anyone on Axiom" value={audience === 'public' ? '✓' : undefined} last onPress={() => { setAudience('public'); setPicker(null); }} />
      </Sheet>
      <Sheet visible={picker === 'workout'} onClose={() => setPicker(null)} title="Attach a workout">
        {workouts.isLoading ? <ActivityIndicator color={C.muted} /> : null}
        {wl.map((w, i) => <Row key={w.id ?? i} name={w.title || 'Workout'} sub={`${fmtDay(w.date)} · ${exercisesOf(w).length} exercises`} last={i === wl.length - 1} onPress={() => { setAttached({ kind: 'workout', w }); setPicker(null); haptics.select(); }} />)}
        {!workouts.isLoading && !wl.length ? <Text style={T.bodyMuted}>No workouts logged yet.</Text> : null}
      </Sheet>
      <Sheet visible={picker === 'meal'} onClose={() => setPicker(null)} title="Attach a meal">
        {ml.map((m, i) => <Row key={m.id ?? i} name={m.name ?? 'Meal'} sub={`${Math.round(m.calories ?? 0)} kcal`} last={i === ml.length - 1} onPress={() => { setAttached({ kind: 'meal', m }); setPicker(null); haptics.select(); }} />)}
        {!ml.length ? <Text style={T.bodyMuted}>No meals logged today.</Text> : null}
      </Sheet>
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  input: { fontFamily: v2.font.medium, fontSize: 20, lineHeight: 27, color: C.ink, minHeight: 110, textAlignVertical: 'top', padding: 0 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: C.surface },
  attach: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, rowGap: 10, marginTop: 26 },
});
