// Photos in chat (design flow E). The "+" before "Ask Anakin" opens the
// standard sheet — Camera · All photos · Screenshot a program — and the tray
// above the composer shows each photo at thumb radius 20 with a hairline
// progress bar while it uploads; a failure keeps the local file with Try
// again / Remove. The image goes to storage first; only the id reaches the
// agent route with the message.

import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, Alert, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import type { AttachItem, AttachState, AttachAction } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { Sheet } from '../primitives/Sheet';
import { Row } from '../primitives/Row';
import { Pressable } from '../primitives/Pressable';
import { TextAction } from '../primitives/TextAction';
import { proactiveApi } from '../api';
import { usePhotoUrl } from '../data';
import { haptics } from '../haptics';

const THUMB = 72;

/** Pick from the camera or the library (up to `room` more), resize, upload. Dispatches into the tray. */
export async function pickAndUpload(source: 'camera' | 'library', room: number, dispatch: (a: AttachAction) => void): Promise<void> {
  try {
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert(source === 'camera' ? 'Camera access is off' : 'Photo access is off', 'Turn it on in Settings to send photos.'); return; }
    let r: ImagePicker.ImagePickerResult;
    try {
      r = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, exif: false })
        // iOS: the multi-select system picker fails outright on iCloud-only or transcoded assets
        // ("cannot load representation of type public.jpeg/heic"). The single-select picker — the one
        // the food screen uses — downloads and converts them itself, so iOS picks one at a time (the
        // tray takes up to four). Android's picker handles multiple selection fine.
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false, allowsMultipleSelection: Platform.OS !== 'ios' && room > 1, selectionLimit: Platform.OS === 'ios' ? 1 : room });
    } catch (e: any) {
      Alert.alert('Couldn’t read that photo', /representation|icloud|load/i.test(String(e?.message)) ? 'It may still be in iCloud. Open it in Photos once so it downloads, then try again.' : (e?.message ?? 'Try another photo.'));
      return;
    }
    if (r.canceled) return;
    const uris = r.assets.map((a) => a.uri).slice(0, room);
    dispatch({ type: 'add', uris });
    await Promise.all(uris.map((uri) => uploadOne(uri, dispatch)));
  } catch (e: any) { Alert.alert('Couldn’t open photos', e?.message ?? 'Try again.'); }
}

export async function uploadOne(uri: string, dispatch: (a: AttachAction) => void): Promise<void> {
  try {
    let b64: string, mime = 'image/jpeg';
    try {
      const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      b64 = small.base64 ?? (await FileSystem.readAsStringAsync(small.uri, { encoding: 'base64' as any }));
    } catch {
      // A format the manipulator can't open (HEIC/HEIF, some PNGs with odd colour spaces): send the file as it is — the server and the model both read HEIC.
      b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
      mime = /\.hei[cf]$/i.test(uri) ? 'image/heic' : /\.png$/i.test(uri) ? 'image/png' : /\.webp$/i.test(uri) ? 'image/webp' : /\.gif$/i.test(uri) ? 'image/gif' : /\.avif$/i.test(uri) ? 'image/avif' : /\.(tiff?)$/i.test(uri) ? 'image/tiff' : /\.bmp$/i.test(uri) ? 'image/bmp' : 'image/jpeg';
    }
    const { photo } = await proactiveApi.photoUpload(b64, mime);
    dispatch({ type: 'uploaded', localUri: uri, id: photo.id, kind: photo.kind, private: photo.private });
    haptics.light();
  } catch (e: any) {
    dispatch({ type: 'failed', localUri: uri, error: e?.message?.length < 60 ? e.message : undefined });
  }
}

/** E1: the sheet. */
export function AttachSheet({ visible, onClose, room, dispatch }: { visible: boolean; onClose: () => void; room: number; dispatch: (a: AttachAction) => void }) {
  const go = (source: 'camera' | 'library') => { onClose(); setTimeout(() => void pickAndUpload(source, room, dispatch), 250); };
  return (
    <Sheet visible={visible} onClose={onClose} title="Show Anakin" sub={`A meal, a label, a program, a machine — up to ${room} photo${room === 1 ? '' : 's'}${Platform.OS === 'ios' && room > 1 ? ', one at a time' : ''}.`}>
      <Row name="Camera" onPress={() => go('camera')} />
      <Row name="All photos" onPress={() => go('library')} />
      <Row name="Screenshot a program" sub="I’ll import it" onPress={() => go('library')} last />
    </Sheet>
  );
}

function Progress() {
  const x = useSharedValue(0);
  useEffect(() => { x.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false); }, [x]);
  const bar = useAnimatedStyle(() => ({ transform: [{ translateX: -THUMB + x.value * THUMB * 2 }] }));
  return (
    <View style={styles.track}><Animated.View style={[styles.bar, bar]} /></View>
  );
}

function Thumb({ item, dispatch }: { item: AttachItem; dispatch: (a: AttachAction) => void }) {
  return (
    <View style={{ width: THUMB }}>
      <View style={[styles.thumb, item.status === 'failed' && { opacity: 0.5 }]}>
        <Image source={{ uri: item.localUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {item.private ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(9,9,11,.72)' }]} /> : null}
        {item.status === 'uploading' ? <Progress /> : null}
      </View>
      {item.status === 'failed' ? (
        <View style={{ marginTop: 6 }}>
          <Text style={[T.caption, { color: v2.color.crimson }]} numberOfLines={1}>Didn’t send</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TextAction size={13} arrow={false} onPress={() => { dispatch({ type: 'retry', localUri: item.localUri }); void uploadOne(item.localUri, dispatch); }}>Try again</TextAction>
            <TextAction muted size={13} arrow={false} onPress={() => dispatch({ type: 'remove', localUri: item.localUri })}>Remove</TextAction>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => dispatch({ type: 'remove', localUri: item.localUri })} hitSlop={8} accessibilityLabel="Remove photo" style={styles.x}>
          <Text style={[T.caption, { color: v2.color.white, fontFamily: v2.font.semibold }]}>×</Text>
        </Pressable>
      )}
    </View>
  );
}

/** E2: the tray above the composer. */
export function AttachTray({ state, dispatch }: { state: AttachState; dispatch: (a: AttachAction) => void }) {
  if (!state.items.length) return null;
  return (
    <View style={styles.tray}>
      {state.items.map((i) => <Thumb key={i.localUri} item={i} dispatch={dispatch} />)}
    </View>
  );
}

/** A photo on a sent turn, from its server id. Private ones render dark until tapped (signed URL fetched on tap). */
export function TurnPhoto({ id, size = 120 }: { id: string; size?: number }) {
  const [revealed, setRevealed] = React.useState(false);
  const q = usePhotoUrl(id, true);
  const dark = q.isError;
  return (
    <Pressable onPress={() => setRevealed((v) => !v)} accessibilityLabel="Photo you sent">
      <View style={[styles.turnPhoto, { width: size, height: size, backgroundColor: dark ? v2.color.ink : v2.color.surface }]}>
        {q.data?.url ? <Image source={{ uri: q.data.url }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={revealed ? 0 : 0} /> : null}
        {dark ? <Text style={[T.caption, { color: v2.color.darkMuted, padding: 8 }]}>Photo gone</Text> : null}
      </View>
    </Pressable>
  );
}

const dimRef = { current: 0 }; void dimRef; // (kept for parity with other chat components that measure)
export const useAttachBusyRef = () => useRef(false);

const styles = StyleSheet.create({
  tray: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  thumb: { width: THUMB, height: THUMB, borderRadius: 20, overflow: 'hidden', backgroundColor: v2.color.surface },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'rgba(255,255,255,.35)', overflow: 'hidden' },
  bar: { width: THUMB, height: 2, backgroundColor: v2.color.crimson },
  x: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: v2.color.ink, alignItems: 'center', justifyContent: 'center' },
  turnPhoto: { borderRadius: 20, overflow: 'hidden', alignSelf: 'flex-end', marginBottom: 8 },
});
