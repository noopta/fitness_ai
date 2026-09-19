// The post-log celebration + share builder (Shareable Workout Log spec §1–2, 7–9).
//
// Opens immediately after a workout is saved: congratulates the user (PR-aware
// copy), shows a live preview of the selected card, a branch-aware template
// picker, photo + theme controls, and a primary Share + secondary Save to Photos.
// Sharing is always optional and never blocks — logging is already complete.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  useWindowDimensions, AccessibilityInfo, Alert, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, fontSize, fontWeight } from '../../../constants/theme';
import {
  ShareableWorkout, ShareDraft, ShareTemplate, ShareTheme,
  DEFAULT_CROP, NO_PHOTO_TEMPLATES, PHOTO_TEMPLATES, PHOTO_REQUIRED, HAS_THEME_TOGGLE,
} from './types';
import { refFor, EXPORT_WIDTH } from './tokens';
import { displayShareable } from './format';
import { useUnits } from '../../../context/UnitsContext';
import { ShareCard } from './ShareCard';
import { ThemeToggle, TemplatePicker } from './controls';
import { captureCard, captureCardBase64 } from './captureAndExport';
import { normalizePickedPhoto } from './photoNormalize';
import { ShareTargetRow } from './ShareTargetRow';
import {
  detectTargets, runTarget, needsBase64, resultMessage,
  ShareTargetDef, ShareTargetId,
} from './shareTargets';

const THEME_KEY = '@axiom_share_theme';

interface Props {
  visible: boolean;
  shareable: ShareableWorkout | null;
  onClose: () => void;
}

/** Fit a ref-aspect card into the available box. */
function fitFrame(availW: number, availH: number, template: ShareTemplate) {
  const ref = refFor(template);
  let w = availW;
  let h = (availW * ref.h) / ref.w;
  if (h > availH) {
    h = availH;
    w = (availH * ref.w) / ref.h;
  }
  return { w, h };
}

export function WorkoutCelebrationSheet({ visible, shareable, onClose }: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { unit } = useUnits();
  const captureRefView = useRef<View>(null);

  // The backend builds `shareable` in lb; render it in the sharer's unit.
  const display = useMemo(
    () => (shareable ? displayShareable(shareable, unit) : null),
    [shareable, unit],
  );

  const [draft, setDraft] = useState<ShareDraft>({ template: 'hero', theme: 'dark', photo: null });
  const [busy, setBusy] = useState<ShareTargetId | null>(null);
  const [targets, setTargets] = useState<ShareTargetDef[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  // Normalizing a picked photo (EXIF bake + downscale) takes ~100-250ms; the
  // photo button shows a spinner rather than appearing to do nothing.
  const [photoBusy, setPhotoBusy] = useState(false);

  // Reset + restore last theme choice each open.
  useEffect(() => {
    if (!visible) return;
    setBusy(null);
    setPhotoNote(null);
    AsyncStorage.getItem(THEME_KEY).then((t) => {
      const theme: ShareTheme = t === 'light' ? 'light' : 'dark';
      setDraft({ template: 'hero', theme, photo: null });
    });
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    // Capability-detect per open: Save flips on the first launch of a binary
    // that carries expo-media-library, without needing a restart.
    detectTargets().then(setTargets).catch(() => setTargets([]));
  }, [visible]);

  if (!shareable || !display) return null;

  const hasPhoto = !!draft.photo;
  const branchTemplates = hasPhoto ? PHOTO_TEMPLATES : NO_PHOTO_TEMPLATES;
  const showToggle = HAS_THEME_TOGGLE[draft.template];
  const isPhotoTemplate = PHOTO_REQUIRED[draft.template];
  const shareDisabled = PHOTO_REQUIRED[draft.template] && !draft.photo;

  // Header copy — clipped, second person, no exclamation marks.
  const pr = display.pr;
  const headline = pr ? 'New PR.' : 'Session logged.';
  const subline = pr
    ? `${pr.lift} ${pr.metric} ${pr.value} ${pr.unit}`
    : display.title;

  // Preview frame — leave room for header + controls.
  const availW = Math.min(screenW - spacing.lg * 2, 360);
  const availH = screenH * 0.46;
  const frame = fitFrame(availW, availH, draft.template);

  function setTheme(theme: ShareTheme) {
    setDraft((d) => ({ ...d, theme }));
    AsyncStorage.setItem(THEME_KEY, theme).catch(() => {});
  }

  function selectTemplate(template: ShareTemplate) {
    setDraft((d) => ({ ...d, template }));
  }

  function updateCrop(crop: { scale: number; offsetX: number; offsetY: number }) {
    setDraft((d) => (d.photo ? { ...d, photo: { ...d.photo, crop } } : d));
  }

  async function pickPhoto() {
    setPhotoNote(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      // Permission denied → stay on the no-photo branch with a single inline note.
      setPhotoNote('Photo access is off — sharing the generated card instead.');
      setDraft((d) => ({ ...d, photo: null, template: 'hero' }));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      // We do our own framing in PhotoWindow; EXIF is normalized away below, so
      // there is nothing useful to carry through from the asset's metadata.
      exif: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];

    // Bake EXIF orientation into the pixels BEFORE the photo reaches the card
    // (spec §6). Without this the preview and the exported PNG disagree about
    // rotation — see photoNormalize.ts. Cheap (~100-250ms) and never throws.
    setPhotoBusy(true);
    let normalized;
    try {
      normalized = await normalizePickedPhoto(asset.uri, asset.width, asset.height);
    } finally {
      setPhotoBusy(false);
    }

    setDraft((d) => ({
      ...d,
      photo: { uri: normalized.uri, crop: DEFAULT_CROP },
      template: PHOTO_TEMPLATES.includes(d.template) ? d.template : 'heroPhoto',
    }));
  }

  function removePhoto() {
    setDraft((d) => ({ ...d, photo: null, template: 'hero' }));
  }

  async function onTarget(id: ShareTargetId) {
    if (shareDisabled || busy) return;
    setBusy(id);
    try {
      // One capture per invocation. Clipboard needs the bytes inline; every
      // other target works from the cache file.
      const uri = await captureCard(captureRefView, draft.template);
      if (!uri) return;
      const base64 = needsBase64(id)
        ? (await captureCardBase64(captureRefView, draft.template)) ?? undefined
        : undefined;

      const result = await runTarget(id, { uri, base64 });
      const msg = resultMessage(id, result);
      if (msg) Alert.alert(msg.title, msg.body);
    } catch (err) {
      console.warn('[celebration] target failed', id, err);
      Alert.alert('Could not share', 'Something went wrong creating your card. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'slide'}
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
        {/* Dismiss */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Celebration header */}
          <View style={styles.header}>
            <View style={styles.badge}>
              <Ionicons name={pr ? 'trophy' : 'checkmark'} size={26} color={colors.primaryForeground} />
            </View>
            <Text style={styles.headline}>{headline}</Text>
            <Text style={styles.subline} numberOfLines={2}>{subline}</Text>
          </View>

          {/* Live preview */}
          <View style={[styles.previewWrap, { width: frame.w, height: frame.h }]}>
            <ShareCard
              data={display}
              draft={draft}
              frameW={frame.w}
              interactive={isPhotoTemplate && hasPhoto}
              onCropChange={updateCrop}
            />

            {/* Theme toggle — chrome floating over the preview (excluded from capture) */}
            {showToggle ? (
              <View
                pointerEvents="box-none"
                style={[
                  styles.toggleOverlay,
                  draft.template === 'heroPhoto'
                    ? { top: frame.h * 0.41, right: spacing.sm }
                    : { top: spacing.sm, left: 0, right: 0, alignItems: 'center' },
                ]}
              >
                <ThemeToggle
                  value={draft.theme}
                  onChange={setTheme}
                  surface={draft.template === 'heroPhoto' ? draft.theme : draft.theme}
                />
              </View>
            ) : null}
          </View>

          {/* Photo framing hint */}
          {isPhotoTemplate && hasPhoto ? (
            <Text style={styles.hint}>Pinch & drag to frame · double-tap to reset</Text>
          ) : null}
          {photoNote ? <Text style={styles.note}>{photoNote}</Text> : null}

          {/* Template picker */}
          <TemplatePicker templates={branchTemplates} value={draft.template} onSelect={selectTemplate} />

          {/* Photo controls */}
          <View style={styles.photoRow}>
            {hasPhoto ? (
              <>
                <TouchableOpacity style={styles.ghostBtn} onPress={pickPhoto} disabled={photoBusy}>
                  {photoBusy
                    ? <ActivityIndicator size="small" color={colors.foreground} />
                    : <Ionicons name="swap-horizontal" size={16} color={colors.foreground} />}
                  <Text style={styles.ghostBtnText}>{photoBusy ? 'Preparing…' : 'Change photo'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={removePhoto}>
                  <Ionicons name="trash-outline" size={16} color={colors.foreground} />
                  <Text style={styles.ghostBtnText}>Remove</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.ghostBtn} onPress={pickPhoto} disabled={photoBusy}>
                {photoBusy
                  ? <ActivityIndicator size="small" color={colors.foreground} />
                  : <Ionicons name="image-outline" size={16} color={colors.foreground} />}
                <Text style={styles.ghostBtnText}>{photoBusy ? 'Preparing…' : 'Add a photo'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>

        {/* Export targets (spec §7) — one tap per destination. */}
        <View style={styles.actions}>
          <ShareTargetRow
            targets={targets}
            busy={busy}
            disabled={shareDisabled}
            onPress={onTarget}
          />
        </View>

        {/* Off-screen full-resolution capture card — only the card layers, no chrome. */}
        <View style={styles.offscreen} pointerEvents="none">
          <ShareCard
            ref={captureRefView}
            data={display}
            draft={draft}
            frameW={EXPORT_WIDTH}
            captureMode
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end' },
  closeBtn: { padding: spacing.xs },
  scroll: { alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md },
  header: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  badge: {
    width: 56, height: 56, borderRadius: radius.full, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  headline: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.foreground, textAlign: 'center' },
  subline: { fontSize: fontSize.base, color: colors.mutedForeground, textAlign: 'center', maxWidth: 300 },
  previewWrap: {
    borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.muted,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  toggleOverlay: { position: 'absolute' },
  hint: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center' },
  note: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center', maxWidth: 320 },
  photoRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
  },
  ghostBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
  offscreen: { position: 'absolute', left: -100000, top: 0, width: EXPORT_WIDTH },
});
