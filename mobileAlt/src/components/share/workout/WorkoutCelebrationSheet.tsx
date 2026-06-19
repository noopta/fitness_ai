// The post-log celebration + share builder (Shareable Workout Log spec §1–2, 7–9).
//
// Opens immediately after a workout is saved: congratulates the user (PR-aware
// copy), shows a live preview of the selected card, a branch-aware template
// picker, photo + theme controls, and a primary Share + secondary Save to Photos.
// Sharing is always optional and never blocks — logging is already complete.

import React, { useEffect, useRef, useState } from 'react';
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
import { ShareCard } from './ShareCard';
import { ThemeToggle, TemplatePicker } from './controls';
import { captureCard, shareCardImage, saveToPhotos } from './captureAndExport';

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
  const captureRefView = useRef<View>(null);

  const [draft, setDraft] = useState<ShareDraft>({ template: 'hero', theme: 'dark', photo: null });
  const [busy, setBusy] = useState<null | 'share' | 'save'>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);

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
  }, [visible]);

  if (!shareable) return null;

  const hasPhoto = !!draft.photo;
  const branchTemplates = hasPhoto ? PHOTO_TEMPLATES : NO_PHOTO_TEMPLATES;
  const showToggle = HAS_THEME_TOGGLE[draft.template];
  const isPhotoTemplate = PHOTO_REQUIRED[draft.template];
  const shareDisabled = PHOTO_REQUIRED[draft.template] && !draft.photo;

  // Header copy — clipped, second person, no exclamation marks.
  const pr = shareable.pr;
  const headline = pr ? 'New PR.' : 'Session logged.';
  const subline = pr
    ? `${pr.lift} ${pr.metric} ${pr.value} ${pr.unit}`
    : shareable.title;

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
    });
    if (res.canceled || !res.assets?.[0]) return;
    setDraft((d) => ({
      ...d,
      photo: { uri: res.assets[0].uri, crop: DEFAULT_CROP },
      template: PHOTO_TEMPLATES.includes(d.template) ? d.template : 'heroPhoto',
    }));
  }

  function removePhoto() {
    setDraft((d) => ({ ...d, photo: null, template: 'hero' }));
  }

  async function onShare() {
    if (shareDisabled || busy) return;
    setBusy('share');
    try {
      const uri = await captureCard(captureRefView, draft.template);
      if (uri) await shareCardImage(uri);
    } catch (err) {
      console.warn('[celebration] share failed', err);
      Alert.alert('Could not share', 'Something went wrong creating your card. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (shareDisabled || busy) return;
    setBusy('save');
    try {
      const uri = await captureCard(captureRefView, draft.template);
      if (!uri) return;
      const result = await saveToPhotos(uri);
      if (result === 'saved') Alert.alert('Saved', 'Your card was saved to Photos.');
      else if (result === 'denied') Alert.alert('Photo access needed', 'Enable photo access in Settings to save your card.');
      else Alert.alert('Save unavailable', 'Saving to Photos isn’t available yet on this build — you can still Share.');
    } catch (err) {
      console.warn('[celebration] save failed', err);
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
              data={shareable}
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
                <TouchableOpacity style={styles.ghostBtn} onPress={pickPhoto}>
                  <Ionicons name="swap-horizontal" size={16} color={colors.foreground} />
                  <Text style={styles.ghostBtnText}>Change photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={removePhoto}>
                  <Ionicons name="trash-outline" size={16} color={colors.foreground} />
                  <Text style={styles.ghostBtnText}>Remove</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.ghostBtn} onPress={pickPhoto}>
                <Ionicons name="image-outline" size={16} color={colors.foreground} />
                <Text style={styles.ghostBtnText}>Add a photo</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.shareBtn, (shareDisabled || busy) && styles.btnDisabled]}
            onPress={onShare}
            disabled={shareDisabled || !!busy}
            activeOpacity={0.85}
          >
            {busy === 'share' ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Ionicons name="share-outline" size={18} color={colors.primaryForeground} />
                <Text style={styles.shareBtnText}>Share</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveBtn, (shareDisabled || busy) && styles.btnDisabled]}
            onPress={onSave}
            disabled={shareDisabled || !!busy}
            activeOpacity={0.7}
          >
            {busy === 'save' ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <Text style={styles.saveBtnText}>Save to Photos</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Off-screen full-resolution capture card — only the card layers, no chrome. */}
        <View style={styles.offscreen} pointerEvents="none">
          <ShareCard
            ref={captureRefView}
            data={shareable}
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
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: 16,
  },
  shareBtnText: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
  saveBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  saveBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  btnDisabled: { opacity: 0.4 },
  offscreen: { position: 'absolute', left: -100000, top: 0, width: EXPORT_WIDTH },
});
