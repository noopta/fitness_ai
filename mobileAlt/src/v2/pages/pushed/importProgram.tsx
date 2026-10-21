// Training → Import a program (Oct 2026): the user's own coach's program,
// pasted or photographed, transcribed exactly as written — never rewritten.
// Preview every day first; "Make it my program" archives the current one
// (never deleted) and progression suggestions stay out of a coach's plan.

import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Image } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { TextAction } from '../../primitives/TextAction';
import { Pressable } from '../../primitives/Pressable';
import { v2, T } from '../../theme';
import { haptics } from '../../haptics';
import { apiFetch, LONG_TIMEOUT_MS } from '../../../lib/api';
import { useInvalidate } from '../../data';
import { KEYBOARD_DONE_ID } from '../../../components/ui/KeyboardDoneBar';

interface Photo { uri: string; base64: string }
interface Preview {
  id: string; name: string; coach: string | null; weeks: number; daysPerWeek: number; notes: string[]; unclear: string[];
  phases: { phaseName: string; weeksLabel: string; trainingDays: { day: string; focus: string; exercises: { exercise: string; sets: number; reps: string; intensity: string; notes?: string }[] }[] }[];
}

/** Resize to a 1,600 px long edge JPEG, as base64 (a sheet stays legible; the upload stays small). */
async function prepare(a: ImagePicker.ImagePickerAsset): Promise<Photo | null> {
  try {
    const ctx = ImageManipulator.manipulate(a.uri);
    if ((a.width ?? 0) > 1600 || (a.height ?? 0) > 1600) ctx.resize((a.width ?? 0) >= (a.height ?? 0) ? { width: 1600 } : { height: 1600 });
    const img = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    return img.base64 ? { uri: img.uri, base64: img.base64 } : null;
  } catch { return null; }
}

export function ImportProgramPage() {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [text, setText] = useState('');
  const [coach, setCoach] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState<null | 'read' | 'apply' | 'photos'>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const addPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access in Settings to add the program’s photos.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 8 - photos.length, quality: 1 });
    if (r.canceled || !r.assets?.length) return;
    setBusy('photos');
    const ready = (await Promise.all(r.assets.map(prepare))).filter((x): x is Photo => !!x);
    setPhotos((p) => [...p, ...ready].slice(0, 8));
    setBusy(null);
  };

  const read = async () => {
    if (!text.trim() && !photos.length) { Alert.alert('Nothing to import', 'Paste the program, or add photos of it.'); return; }
    setBusy('read');
    try {
      const r: Preview = await apiFetch('/programs/import-coach', { method: 'POST', timeoutMs: LONG_TIMEOUT_MS, body: JSON.stringify({ text, coach: coach.trim() || undefined, images: photos.map((p) => ({ base64: p.base64, mimeType: 'image/jpeg' })) }) });
      setPreview(r);
      haptics.success();
    } catch (e: any) {
      Alert.alert('Couldn’t read that', e?.message ?? 'Try a clearer photo, or paste it as text.');
    }
    setBusy(null);
  };

  const apply = async () => {
    if (!preview) return;
    setBusy('apply');
    try {
      await apiFetch(`/programs/import-coach/${preview.id}/apply`, { method: 'POST' });
      await invalidate.afterProgram();
      haptics.success();
      Alert.alert('It’s your program now', `${preview.name} is live. Your previous program is archived, not deleted.`);
      router.back();
    } catch (e: any) {
      Alert.alert('Couldn’t save it', e?.message ?? 'Try again.');
      setBusy(null);
    }
  };

  if (preview) {
    return (
      <PushedPage back="Import" title={preview.name} meta={`${preview.coach ? `${preview.coach} · ` : ''}${preview.daysPerWeek} days a week · ${preview.weeks} week${preview.weeks === 1 ? '' : 's'}`}
        lead="Transcribed exactly as your coach wrote it. Check it, then make it your program.">
        {preview.unclear.length ? (
          <View style={styles.unclear}>
            <Text style={[T.rowStrong, { color: v2.color.crimson }]}>Couldn’t read {preview.unclear.length === 1 ? 'one part' : `${preview.unclear.length} parts`}</Text>
            {preview.unclear.map((u, i) => <Text key={i} style={[T.caption, { marginTop: 4 }]}>“{u}”</Text>)}
            <Text style={[T.caption, { marginTop: 6 }]}>Fix it in the text and read it again, or tell Anakin after importing.</Text>
          </View>
        ) : null}
        {preview.phases.map((ph, pi) => (
          <View key={pi} style={{ marginTop: 20 }}>
            <Eyebrow>{ph.phaseName}{ph.weeksLabel ? ` · ${ph.weeksLabel}` : ''}</Eyebrow>
            <View style={{ marginTop: 8 }}>
              {ph.trainingDays.map((d, di) => (
                <View key={di} style={styles.day}>
                  <Text style={T.rowStrong}>{d.day}{d.focus ? ` · ${d.focus}` : ''}</Text>
                  {d.exercises.map((e, ei) => (
                    <Text key={ei} style={[T.body, { marginTop: 3, fontVariant: ['tabular-nums'] }]}>
                      {e.exercise} <Text style={{ color: v2.color.muted }}>{e.sets}×{e.reps}{e.intensity ? ` @ ${e.intensity}` : ''}{e.notes ? ` · ${e.notes}` : ''}</Text>
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </View>
        ))}
        {preview.notes.length ? <View style={{ marginTop: 18 }}><Eyebrow>Coach’s notes</Eyebrow>{preview.notes.map((n, i) => <Text key={i} style={[T.body, { marginTop: 6 }]}>{n}</Text>)}</View> : null}
        <View style={styles.actions}>
          <TextAction primary onPress={() => void apply()} loading={busy === 'apply'}>Make it my program</TextAction>
          <TextAction muted arrow={false} size={15} onPress={() => setPreview(null)}>Edit</TextAction>
        </View>
      </PushedPage>
    );
  }

  return (
    <PushedPage back="Training" title="Import a program" lead="Your coach’s program, exactly as they wrote it — paste it or add photos of the sheet. Nothing gets changed; progression suggestions stay out of it.">
      <Eyebrow>Paste it</Eyebrow>
      <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID} value={text} onChangeText={setText} multiline placeholder={'MON: Trap bar DL 4x3 @ 80%, Box jump 4x3…\nTUE: MMA sparring 60 min…'} placeholderTextColor={v2.color.placeholder}
        style={styles.input} textAlignVertical="top" accessibilityLabel="Program text" />
      <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID} value={coach} onChangeText={setCoach} placeholder="Coach’s name (optional)" placeholderTextColor={v2.color.placeholder} style={styles.coach} accessibilityLabel="Coach’s name" />
      <View style={{ marginTop: 22 }}><Eyebrow>Or photos of the sheet</Eyebrow></View>
      <View style={styles.photos}>
        {photos.map((p, i) => (
          <Pressable key={p.uri} onPress={() => setPhotos((x) => x.filter((_, k) => k !== i))} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
          </Pressable>
        ))}
        {photos.length < 8 ? <TextAction muted arrow={false} size={15} onPress={() => void addPhotos()} loading={busy === 'photos'}>{photos.length ? 'Add more' : 'Add photos'}</TextAction> : null}
      </View>
      <View style={styles.actions}>
        <TextAction primary onPress={() => void read()} loading={busy === 'read'}>Read it</TextAction>
      </View>
      <Row name="Or paste it to Anakin" sub="Same import, from chat" muted last style={{ marginTop: 22 }} />
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 180, borderWidth: 1, borderColor: v2.color.hairline, borderRadius: 10, padding: 12, marginTop: 8, fontFamily: v2.font.regular, fontSize: 15, lineHeight: 21, color: v2.color.ink },
  coach: { borderBottomWidth: 1, borderBottomColor: v2.color.hairline, paddingVertical: 10, marginTop: 12, fontFamily: v2.font.regular, fontSize: 15, color: v2.color.ink },
  photos: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 10 },
  thumb: { width: 64, height: 86, borderRadius: 6, backgroundColor: v2.color.surface },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 24 },
  day: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: v2.color.hairline },
  unclear: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: v2.color.surface },
});
