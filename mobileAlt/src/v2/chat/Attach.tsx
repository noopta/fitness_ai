// Photos and a set clip in chat (design v4, flows E and H1).
//
//   AttachButton  32pt filled circle (surface, ink +); inverts to ink with × while the sheet is open
//   AttachSheet   six icon tiles — Camera · Photos · Form check · Meal · Label · Program — then
//                 RECENT (four tiles, numbered as you pick) and All photos →; Add N → / Cancel.
//                 Meal, Label and Program set the intent so Anakin knows what to do with the
//                 image before reading it. Form check records or chooses a clip.
//   StagedTray    inside the composer: 64pt thumbs with × badges, a dashed + tile for more, a
//                 caption naming the count and the intent — or the clip with its length and the
//                 lift pills (the same four as formcheck.tsx). Up to four photos, or one clip.
//   SendButton    a filled crimson circle whenever something is staged, even with no text.
//   TurnPhoto / TurnVideo   what a sent turn shows in the You column.
//
// Photos upload to storage as soon as they're staged; only ids reach the agent
// route. A clip uploads on send through the existing form-analysis pipeline.

import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, Alert, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useRouter } from 'expo-router';
import { Camera, Image as ImageIcon, Video, Utensils, ScanLine, FileText, X, Plus, ArrowUp, Play } from 'lucide-react-native';
import { LIFT_PILLS, INTENT_LABEL, clipLabel, clipRows, stagedCaption, stagedClip, type AttachItem, type AttachState, type AttachAction, type AttachIntent, type Lift, type ClipRow } from '@axiom/agent-ui-core';
import { Row } from '../primitives/Row';
import { v2, T } from '../theme';
import { Sheet } from '../primitives/Sheet';
import { Pressable } from '../primitives/Pressable';
import { TextAction } from '../primitives/TextAction';
import { proactiveApi } from '../api';
import { usePhotoUrl } from '../data';
import { haptics } from '../haptics';

const THUMB = 64;
const TILE = 72;
type Dispatch = (a: AttachAction) => void;

// ── Picking and uploading ───────────────────────────────────────────────────

/** Pick from the camera or the library (up to `room` more), resize, upload. Dispatches into the tray. */
export async function pickAndUpload(source: 'camera' | 'library', room: number, dispatch: Dispatch, intent: AttachIntent | null): Promise<void> {
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
    await Promise.all(uris.map((uri) => uploadOne(uri, dispatch, intent)));
  } catch (e: any) { Alert.alert('Couldn’t open photos', e?.message ?? 'Try again.'); }
}

export async function uploadOne(uri: string, dispatch: Dispatch, intent: AttachIntent | null): Promise<void> {
  try {
    let b64: string, mime = 'image/jpeg';
    try {
      // 1400 px at 0.75 keeps a plate or a label readable and the JSON body under ~1 MB (base64 adds a third); the route takes 10 MB regardless.
      const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1400 } }], { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      b64 = small.base64 ?? (await FileSystem.readAsStringAsync(small.uri, { encoding: 'base64' as any }));
    } catch {
      // A format the manipulator can't open (HEIC/HEIF, some PNGs with odd colour spaces): send the file as it is — the server and the model both read HEIC.
      b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
      mime = /\.hei[cf]$/i.test(uri) ? 'image/heic' : /\.png$/i.test(uri) ? 'image/png' : /\.webp$/i.test(uri) ? 'image/webp' : /\.gif$/i.test(uri) ? 'image/gif' : /\.avif$/i.test(uri) ? 'image/avif' : /\.(tiff?)$/i.test(uri) ? 'image/tiff' : /\.bmp$/i.test(uri) ? 'image/bmp' : 'image/jpeg';
    }
    const { photo } = await proactiveApi.photoUpload(b64, mime, intent);
    dispatch({ type: 'uploaded', localUri: uri, id: photo.id, kind: photo.kind, private: photo.private });
    haptics.light();
  } catch (e: any) {
    dispatch({ type: 'failed', localUri: uri, error: e?.status === 413 ? 'Too large' : e?.status === 404 ? 'Photos aren’t on for you yet' : (typeof e?.message === 'string' && e.message.length < 40 ? e.message : undefined) });
  }
}

/**
 * H1 "choose a video". Not the system picker: PHPicker fails outright on clips that aren't on the phone
 * (PHPhotosErrorDomain — iCloud-optimised storage), and that can't be caught before the pick. Our own
 * list reads the library through MediaLibrary and asks it to download the one chosen.
 */
export async function recentClips(): Promise<ClipRow[]> {
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) throw new Error('Photo access is off. Turn it on in Settings to send a set.');
  const page = await MediaLibrary.getAssetsAsync({ first: 40, mediaType: 'video', sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
  return clipRows(page.assets.map((a) => ({ id: a.id, duration: a.duration, creationTime: a.creationTime, width: a.width, height: a.height })));
}
/** Resolve a chosen clip to a local file (downloading from iCloud when needed) and stage it. */
export async function stageClip(row: ClipRow, dispatch: Dispatch): Promise<void> {
  const info = await MediaLibrary.getAssetInfoAsync(row.id, { shouldDownloadFromNetwork: true });
  const uri = info.localUri ?? info.uri;
  if (!uri || uri.startsWith('ph://')) throw new Error('That clip is still in iCloud. Open it in Photos once so it downloads, then try again.');
  dispatch({ type: 'add', uris: [uri], media: 'video', durationSec: row.seconds });
  haptics.light();
}

// ── The attach and send controls ────────────────────────────────────────────

export function AttachButton({ open, staged, onPress, dark }: { open: boolean; staged: boolean; onPress: () => void; dark?: boolean }) {
  const inverted = open;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={open ? 'Close' : 'Show Anakin a photo or a set'}>
      <View style={[styles.circle, { backgroundColor: inverted ? v2.color.ink : dark ? 'rgba(255,255,255,.14)' : v2.color.surface }]}>
        {inverted ? <X size={16} color={v2.color.white} strokeWidth={2} /> : <Plus size={16} color={staged ? v2.color.crimson : dark ? v2.color.darkInk : v2.color.ink} strokeWidth={2} />}
      </View>
    </Pressable>
  );
}

export function SendButton({ ready, onPress }: { ready: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} disabled={!ready} accessibilityRole="button" accessibilityLabel="Send">
      <View style={[styles.circle, { backgroundColor: ready ? v2.color.crimson : 'transparent' }]}>
        <ArrowUp size={16} color={ready ? v2.color.white : v2.color.placeholder} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

// ── E1 · the sheet ──────────────────────────────────────────────────────────

interface Recent { id: string; uri: string }
async function recentPhotos(): Promise<Recent[]> {
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) return [];
    const page = await MediaLibrary.getAssetsAsync({ first: 4, mediaType: 'photo', sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
    // iOS hands back ph:// URLs RN's Image can't draw; the local file path draws. iCloud-only photos are skipped, not downloaded.
    const shown = Platform.OS === 'ios'
      ? await Promise.all(page.assets.map(async (a) => { try { const info = await MediaLibrary.getAssetInfoAsync(a, { shouldDownloadFromNetwork: false }); return info.localUri ? { id: a.id, uri: info.localUri } : null; } catch { return null; } }))
      : page.assets.map((a) => ({ id: a.id, uri: a.uri }));
    return shown.filter((x): x is Recent => !!x);
  } catch { return []; }
}

function Tile({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.tileWrap}>
      <View style={styles.tile}>{icon}</View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

export function AttachSheet({ visible, onClose, room, dispatch, intent }: { visible: boolean; onClose: () => void; room: number; dispatch: Dispatch; intent: AttachIntent | null }) {
  const router = useRouter();
  const [recent, setRecent] = useState<Recent[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  // Form check → the clip list replaces the tiles until a clip is chosen or the sheet closes.
  const [clips, setClips] = useState<ClipRow[] | null>(null);
  const [clipBusy, setClipBusy] = useState<string | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  useEffect(() => { if (!visible) { setPicked([]); setClips(null); setClipBusy(null); setClipError(null); return; } let live = true; void recentPhotos().then((r) => { if (live) setRecent(r); }); return () => { live = false; }; }, [visible]);
  const openClips = async () => { setClipError(null); try { setClips(await recentClips()); } catch (e: any) { setClips([]); setClipError(e?.message ?? 'Couldn’t read your videos.'); } };
  const chooseClip = async (row: ClipRow) => {
    setClipBusy(row.id); setClipError(null);
    try { await stageClip(row, dispatch); onClose(); }
    catch (e: any) { setClipError(e?.message ?? 'Couldn’t open that clip.'); }
    finally { setClipBusy(null); }
  };
  const after = (fn: () => void) => { onClose(); setTimeout(fn, 250); };
  const tag = (i: AttachIntent) => { haptics.select(); dispatch({ type: 'intent', intent }); dispatch({ type: 'intent', intent: i }); after(() => void pickAndUpload('library', room, dispatch, i)); };
  const togglePick = (id: string) => { haptics.select(); setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room ? [...p, id] : p)); };
  const addPicked = () => {
    const uris = picked.map((id) => recent.find((r) => r.id === id)?.uri).filter((u): u is string => !!u);
    dispatch({ type: 'add', uris });
    after(() => { void Promise.all(uris.map((u) => uploadOne(u, dispatch, intent))); });
  };
  const ico = { size: 22, strokeWidth: v2.tabBar.stroke, color: v2.color.ink };
  if (clips !== null) {
    return (
      <Sheet visible={visible} onClose={onClose} title="Form check" sub="Film your top set from the side, or pick a clip you already have.">
        <Row name="Record a set" sub="Opens the camera · side view" onPress={() => after(() => router.push({ pathname: '/(v2)/formcheck', params: { from: 'chat' } } as any))} />
        {clips.map((r, i) => <Row key={r.id} name={r.name} sub={clipBusy === r.id ? 'Fetching the clip…' : r.sub} value={clipBusy === r.id ? '…' : undefined} onPress={clipBusy ? undefined : () => void chooseClip(r)} last={i === clips.length - 1} />)}
        {!clips.length && !clipError ? <Text style={[T.bodyMuted, { marginTop: 12 }]}>No sets between 3 s and 3 min in your library yet.</Text> : null}
        {clipError ? <Text style={[T.caption, { color: v2.color.crimson, marginTop: 12 }]}>{clipError}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 24, marginTop: 20 }}>
          <TextAction muted size={15} arrow={false} onPress={() => setClips(null)}>Back</TextAction>
          <TextAction muted size={15} arrow={false} onPress={onClose}>Cancel</TextAction>
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet visible={visible} onClose={onClose} title="Show Anakin">
      <View style={styles.grid}>
        <Tile icon={<Camera {...ico} />} label="Camera" onPress={() => after(() => void pickAndUpload('camera', room, dispatch, intent))} />
        <Tile icon={<ImageIcon {...ico} />} label="Photos" onPress={() => after(() => void pickAndUpload('library', room, dispatch, intent))} />
        <Tile icon={<Video {...ico} />} label="Form check" onPress={() => { haptics.select(); void openClips(); }} />
        <Tile icon={<Utensils {...ico} />} label="Meal" onPress={() => tag('meal')} />
        <Tile icon={<ScanLine {...ico} />} label="Label" onPress={() => tag('label')} />
        <Tile icon={<FileText {...ico} />} label="Program" onPress={() => tag('program')} />
      </View>
      {recent.length ? (
        <View style={{ marginTop: 22 }}>
          <View style={styles.recentHead}>
            <Text style={T.eyebrow}>Recent</Text>
            <TextAction muted size={13} onPress={() => after(() => void pickAndUpload('library', room, dispatch, intent))}>All photos</TextAction>
          </View>
          <View style={styles.recentRow}>
            {recent.map((r) => {
              const n = picked.indexOf(r.id);
              return (
                <Pressable key={r.id} onPress={() => togglePick(r.id)} accessibilityRole="button" accessibilityLabel={n >= 0 ? `Photo picked, number ${n + 1}` : 'Pick this photo'}>
                  <View style={[styles.recent, n >= 0 && { borderWidth: 2, borderColor: v2.color.ink }]}>
                    <Image source={{ uri: r.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    {n >= 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{n + 1}</Text></View> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 24, marginTop: 20 }}>
        {picked.length ? <TextAction primary size={15} onPress={addPicked}>Add {picked.length}</TextAction> : null}
        <TextAction muted size={15} arrow={false} onPress={onClose}>Cancel</TextAction>
      </View>
    </Sheet>
  );
}

// ── E1b · staged, inside the composer ───────────────────────────────────────

function Progress() {
  const x = useSharedValue(0);
  useEffect(() => { x.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false); }, [x]);
  const bar = useAnimatedStyle(() => ({ transform: [{ translateX: -THUMB + x.value * THUMB * 2 }] }));
  return <View style={styles.track}><Animated.View style={[styles.bar, bar]} /></View>;
}

function Thumb({ item, dispatch, intent }: { item: AttachItem; dispatch: Dispatch; intent: AttachIntent | null }) {
  const video = item.media === 'video';
  return (
    <View style={{ width: THUMB }}>
      <View style={[styles.thumb, video && { backgroundColor: v2.color.ink }, item.status === 'failed' && { opacity: 0.5 }]}>
        {!video ? <Image source={{ uri: item.localUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Play size={18} color={v2.color.white} strokeWidth={2} />}
        {item.private ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(9,9,11,.72)' }]} /> : null}
        {video ? <Text style={styles.clipLen}>{clipLabel(item.durationSec)}</Text> : null}
        {item.status === 'uploading' ? <Progress /> : null}
      </View>
      <Pressable onPress={() => dispatch({ type: 'remove', localUri: item.localUri })} hitSlop={8} accessibilityLabel="Remove" style={styles.x}>
        <X size={11} color={v2.color.white} strokeWidth={2.5} />
      </Pressable>
      {item.status === 'failed' ? (
        <View style={{ marginTop: 4 }}>
          <Text style={[T.caption, { color: v2.color.crimson, fontSize: 11, lineHeight: 14 }]} numberOfLines={2}>{item.error ?? 'Didn’t send'}</Text>
          <TextAction size={12} arrow={false} onPress={() => { dispatch({ type: 'retry', localUri: item.localUri }); void uploadOne(item.localUri, dispatch, intent); }}>Try again</TextAction>
        </View>
      ) : null}
    </View>
  );
}

export function StagedTray({ state, dispatch, onMore }: { state: AttachState; dispatch: Dispatch; onMore: () => void }) {
  if (!state.items.length) return null;
  const clip = stagedClip(state);
  const room = clip ? 0 : 4 - state.items.length;
  return (
    <View style={styles.tray}>
      <View style={styles.trayRow}>
        {state.items.map((i) => <Thumb key={i.localUri} item={i} dispatch={dispatch} intent={state.intent} />)}
        {room > 0 ? (
          <Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel="Add another photo">
            <View style={styles.more}><Plus size={16} color={v2.color.muted} strokeWidth={1.75} /></View>
          </Pressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
          {clip ? (
            <View style={styles.pills}>
              {LIFT_PILLS.map((l) => (
                <Pressable key={l} onPress={() => { haptics.select(); dispatch({ type: 'lift', lift: l as Lift }); }} accessibilityRole="button" accessibilityState={{ selected: state.lift === l }}>
                  <View style={[styles.pill, state.lift === l && styles.pillOn]}><Text style={[styles.pillText, state.lift === l && { color: v2.color.white }]}>{l}</Text></View>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={T.caption} numberOfLines={3}>{stagedCaption(state)}</Text>
          )}
        </View>
      </View>
      {clip ? <Text style={[T.caption, { marginTop: 6 }]}>{stagedCaption(state)}{state.items[0].status === 'failed' ? ` · ${state.items[0].error}` : ''}</Text> : null}
    </View>
  );
}

// ── What a sent turn shows ──────────────────────────────────────────────────

/** A photo on a sent turn, from its server id. Private ones render dark until the URL resolves. */
export function TurnPhoto({ id, size = 120 }: { id: string; size?: number }) {
  const q = usePhotoUrl(id, true);
  const gone = q.isError;
  return (
    <View style={[styles.turnPhoto, { width: size, height: size, backgroundColor: gone ? v2.color.ink : v2.color.surface }]} accessible accessibilityLabel="Photo you sent">
      {q.data?.url ? <Image source={{ uri: q.data.url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      {gone ? <Text style={[T.caption, { color: v2.color.darkMuted, padding: 8 }]}>Photo gone</Text> : null}
    </View>
  );
}

/** H2: the clip on the sent turn — dark tile, play glyph, "Squat · 0:24". Tapping opens the analysis when it exists. */
export function TurnVideo({ video }: { video: { analysisId: string | null; lift: string; seconds: number | null } }) {
  const router = useRouter();
  const open = () => { if (video.analysisId) router.push({ pathname: '/form-analysis', params: { id: video.analysisId } } as any); };
  return (
    <Pressable onPress={open} disabled={!video.analysisId} accessibilityRole="button" accessibilityLabel={`${video.lift} set video, ${clipLabel(video.seconds)}`}>
      <View style={styles.turnVideo}>
        <View style={styles.playCircle}><Play size={14} color={v2.color.white} strokeWidth={2} /></View>
        <Text style={styles.clipTag}>{video.lift} · {clipLabel(video.seconds)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  tileWrap: { width: TILE, alignItems: 'center' },
  tile: { width: TILE, height: TILE, borderRadius: 16, backgroundColor: v2.color.surface, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 18, color: v2.color.ink, marginTop: 6 },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  recentRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  recent: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden', backgroundColor: v2.color.surface },
  badge: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: v2.color.ink, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: v2.font.bold, fontSize: 11, color: v2.color.white },
  tray: { paddingTop: 10, paddingBottom: 4 },
  trayRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  thumb: { width: THUMB, height: THUMB, borderRadius: 14, overflow: 'hidden', backgroundColor: v2.color.surface, alignItems: 'center', justifyContent: 'center' },
  clipLen: { position: 'absolute', left: 6, bottom: 4, fontFamily: v2.font.semibold, fontSize: 11, color: v2.color.white },
  more: { width: THUMB, height: THUMB, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: v2.color.hairline, alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'rgba(255,255,255,.35)', overflow: 'hidden' },
  bar: { width: THUMB, height: 2, backgroundColor: v2.color.crimson },
  x: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: v2.color.ink, alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: v2.color.surface, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: v2.color.ink },
  pillText: { fontFamily: v2.font.semibold, fontSize: 12, color: v2.color.ink },
  turnPhoto: { borderRadius: 20, overflow: 'hidden', alignSelf: 'flex-end', marginBottom: 8 },
  turnVideo: { width: 150, height: 104, borderRadius: 16, backgroundColor: v2.color.ink, alignSelf: 'flex-end', marginBottom: 8, alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.22)', alignItems: 'center', justifyContent: 'center' },
  clipTag: { position: 'absolute', left: 8, bottom: 8, fontFamily: v2.font.semibold, fontSize: 11, color: v2.color.white, backgroundColor: 'rgba(0,0,0,.45)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
});
export const INTENT_LABELS = INTENT_LABEL;
