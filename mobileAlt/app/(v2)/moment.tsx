// The share studio for a progress moment (spec "Progress Moments", 19 Oct
// 2026): pick a card or a photo overlay, put a photo behind an overlay, white
// or dark ink, then Share (system sheet) or Save image. Overlays also offer
// "Save overlay only" — a transparent PNG to drop on a story yourself.
// Everything is drawn with Skia from the moment's own numbers.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, useWindowDimensions, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import type { SkImage } from '@shopify/react-native-skia';
import { sceneFor, isOverlay, type ProgressMoment, type ShareableKind } from '@axiom/agent-ui-core';
import { v2, T } from '../../src/v2/theme';
import { Pressable } from '../../src/v2/primitives/Pressable';
import { TextAction } from '../../src/v2/primitives/TextAction';
import { haptics } from '../../src/v2/haptics';
import { ScenePreview } from '../../src/v2/moments/ScenePreview';
import { useShareAssets } from '../../src/v2/moments/useShareAssets';
import { exportScenePng, loadPhoto, makeMeasure } from '../../src/v2/moments/skiaShare';
import { cachedMoment, momentsApi } from '../../src/v2/moments/store';
import { runTarget, resultMessage } from '../../src/components/share/workout/shareTargets';
import { normalizePickedPhoto } from '../../src/components/share/workout/photoNormalize';

const NAMES: Record<ShareableKind, string> = {
  '3a': 'The climb', '3b': 'Goal hit', '3d': 'The cut', '3e': 'On a photo', '3f': 'Today’s label', '3g': 'The session', '2f': 'The line',
};
const GUTTER = 20;

export default function MomentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const assets = useShareAssets();
  const [m, setM] = useState<ProgressMoment | null>(() => (id ? cachedMoment(String(id)) : null));
  const [failed, setFailed] = useState(false);
  const [i, setI] = useState(0);
  const [ink, setInk] = useState<'white' | 'dark'>('white');
  const [photo, setPhoto] = useState<SkImage | null>(null);
  const [busy, setBusy] = useState<null | 'share' | 'save' | 'overlay' | 'photo'>(null);

  useEffect(() => {
    if (!id) return;
    momentsApi.get(String(id)).then(setM).catch(() => { if (!m) setFailed(true); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = m?.shareables[i] ?? null;
  const overlay = !!s && isOverlay(s.kind);
  // The preview fits the width, and leaves room below for the picker and actions.
  const previewW = Math.min(winW - GUTTER * 2, Math.round((winH * 0.56 * 300) / 533));

  const pickPhoto = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', camera ? 'Allow camera access in Settings to take a photo.' : 'Allow photo access in Settings to choose one.'); return false; }
    const r = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const a = r.canceled ? null : r.assets?.[0];
    if (!a?.uri) return false;
    setBusy('photo');
    const n = await normalizePickedPhoto(a.uri, a.width, a.height);
    const img = await loadPhoto(n.uri);
    setBusy(null);
    if (!img) { Alert.alert('Couldn’t open that photo', 'Try another one.'); return false; }
    setPhoto(img);
    haptics.select();
    return true;
  };
  const askPhoto = () => new Promise<boolean>((resolve) => Alert.alert('Add a photo', 'The numbers go on top of it.', [
    { text: 'Choose from library', onPress: () => void pickPhoto(false).then(resolve) },
    { text: 'Take a photo', onPress: () => void pickPhoto(true).then(resolve) },
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
  ]));

  const exportNow = async (withPhoto: boolean) => {
    if (!s || !assets) throw new Error('Not ready');
    const scene = sceneFor(s, { measure: makeMeasure(assets.faces), ink, preview: false, withPhoto });
    return exportScenePng(scene, assets.faces, { mark: assets.mark, photo: withPhoto ? photo : null }, `${s.kind}`);
  };

  const run = async (what: 'share' | 'save' | 'overlay') => {
    if (!m || !s || busy) return;
    // An overlay is made for a photo: ask for one before sharing or saving the full image.
    if (overlay && what !== 'overlay' && !photo && !(await askPhoto())) return;
    setBusy(what);
    try {
      const uri = await exportNow(what !== 'overlay');
      const target = what === 'share' ? 'more' : 'save';
      const r = await runTarget(target, { uri });
      if (r === 'ok') { haptics.success(); void momentsApi.shared(m.id); setM({ ...m, sharedAt: new Date().toISOString() }); }
      const msg = resultMessage(target, r);
      if (msg && target === 'save') Alert.alert(msg.title, msg.body);
    } catch {
      Alert.alert('Couldn’t make the image', 'Try again.');
    }
    setBusy(null);
  };

  const picker = useMemo(() => m?.shareables.map((x, k) => ({ x, k })) ?? [], [m]);

  if (!m || !assets) {
    return (
      <View style={[st.root, st.center, { paddingTop: insets.top }]}>
        <StatusBar style="dark" />
        {failed ? (
          <>
            <Text style={T.body}>This moment isn’t available any more.</Text>
            <TextAction primary arrow={false} onPress={() => router.back()} style={{ marginTop: 16 }}>Close</TextAction>
          </>
        ) : <ActivityIndicator color={v2.color.muted} />}
      </View>
    );
  }

  return (
    <View style={[st.root, { paddingTop: insets.top + 8 }]}>
      <StatusBar style="dark" />
      <View style={st.top}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button"><Text style={[T.body, { color: v2.color.ink }]}>Done</Text></Pressable>
        <Text style={st.eyebrow} numberOfLines={1}>{m.label.toUpperCase()}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, alignItems: 'center' }} showsVerticalScrollIndicator={false}>
        {s ? (
          <View style={{ marginTop: 12 }}>
            <ScenePreview shareable={s} width={previewW} faces={assets.faces} mark={assets.mark} photo={photo} ink={ink} />
            {busy === 'photo' ? <View style={[StyleSheet.absoluteFill, st.center]}><ActivityIndicator color="#fff" /></View> : null}
          </View>
        ) : null}

        {picker.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ alignSelf: 'stretch', marginTop: 18 }} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 12 }}>
            {picker.map(({ x, k }) => (
              <Pressable key={k} onPress={() => { haptics.select(); setI(k); }} accessibilityRole="button" accessibilityState={{ selected: k === i }} accessibilityLabel={NAMES[x.kind]}>
                <View style={[st.pick, k === i && st.pickOn]}>
                  <ScenePreview shareable={x} width={54} faces={assets.faces} mark={assets.mark} photo={photo} ink={ink} rounded={false} />
                </View>
                <Text style={[st.pickName, k === i && { color: v2.color.ink }]}>{NAMES[x.kind]}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {overlay ? (
          <View style={st.controls}>
            <TextAction muted arrow={false} size={15} onPress={() => void askPhoto()}>{photo ? 'Change photo' : 'Add a photo'}</TextAction>
            {photo ? <TextAction muted arrow={false} size={15} onPress={() => setPhoto(null)}>Remove</TextAction> : null}
            <View style={{ flex: 1 }} />
            {(['white', 'dark'] as const).map((k) => (
              <Pressable key={k} onPress={() => { haptics.select(); setInk(k); }} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: ink === k }}>
                <Text style={[st.toggle, ink === k && st.toggleOn]}>{k === 'white' ? 'White ink' : 'Dark ink'}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={st.actions}>
          <TextAction primary onPress={() => void run('share')} loading={busy === 'share'}>Share</TextAction>
          <TextAction muted arrow={false} size={15} onPress={() => void run('save')} loading={busy === 'save'}>Save image</TextAction>
          {overlay ? <TextAction muted arrow={false} size={15} onPress={() => void run('overlay')} loading={busy === 'overlay'}>Save overlay only</TextAction> : null}
        </View>
        <Text style={st.note}>{m.praise}</Text>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.white },
  center: { alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER, height: 36 },
  eyebrow: { fontFamily: v2.font.bold, fontSize: 11, letterSpacing: 1.4, color: v2.color.crimson, flexShrink: 1, textAlign: 'center' },
  pick: { borderRadius: 6, borderWidth: 1.5, borderColor: 'transparent', padding: 2 },
  pickOn: { borderColor: v2.color.ink },
  pickName: { fontFamily: v2.font.medium, fontSize: 11, color: v2.color.muted, marginTop: 4, textAlign: 'center', width: 62 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 18, alignSelf: 'stretch', paddingHorizontal: GUTTER, marginTop: 16 },
  toggle: { fontFamily: v2.font.medium, fontSize: 13, color: v2.color.muted, paddingBottom: 2 },
  toggleOn: { color: v2.color.ink, borderBottomWidth: 1.5, borderBottomColor: v2.color.ink },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 24, alignSelf: 'stretch', paddingHorizontal: GUTTER, marginTop: 22 },
  note: { fontFamily: v2.font.regular, fontSize: 13, lineHeight: 19, color: v2.color.muted, alignSelf: 'stretch', paddingHorizontal: GUTTER, marginTop: 18 },
});
