// VoiceSheet — record a voice note, transcribe via Whisper, parse macros,
// review, and log. Self-contained: no handoff to DescribeSheet.
//
// Why self-contained
//   Earlier versions called `onTranscribed(text)` so the parent would dismiss
//   this sheet, then open DescribeSheet pre-filled with the transcript. That
//   produced three bad symptoms:
//     1. The user never saw their transcript — it flashed past invisibly.
//     2. Mounting a second native <Modal> while the first was still animating
//        out froze the iOS UI (iOS can only present one modal at a time and
//        the second `present` call waited on a dismissal that never came).
//     3. Even when the staging worked, the brief "sheet closes, nothing
//        happens, another sheet opens already spinning" sequence read as a
//        broken feature.
//   Doing everything inside one BottomSheet removes the dual-Modal hazard
//   entirely and lets the user see + edit the transcript before parsing.
//
// Provider: backend /nutrition/transcribe forwards to OpenAI Whisper. Recording
// uses expo-audio's useAudioRecorder; the file is read as base64 via
// expo-file-system/legacy and POSTed up.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  TextInput, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { nutritionApi } from '../../../../lib/api';
import { Analytics } from '../../../../lib/analytics';
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../../ui/KeyboardDoneBar';
import { slotForNow, todayStr, type MealSlotApi } from './sheetHelpers';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Refresh the timeline after a successful log. */
  onLogged: () => void | Promise<void>;
}

interface ParsedMeal {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

type Stage =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'transcribed'
  | 'parsing'
  | 'review'
  | 'saving'
  | 'permission_denied'
  | 'error';

const SLOTS: Array<{ key: MealSlotApi; label: string }> = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snack',     label: 'Snack' },
];

/** Format milliseconds → "0:23". */
function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

export function VoiceSheet({ visible, onClose, onLogged }: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [parsed, setParsed] = useState<ParsedMeal | null>(null);
  const [slot, setSlot] = useState<MealSlotApi>(slotForNow());

  const reset = () => {
    setStage('idle');
    setError(null);
    setTranscript('');
    setParsed(null);
    setSlot(slotForNow());
  };

  // Pre-flight: request mic permission and set audio mode whenever the sheet
  // opens. On iOS this also unblocks recording when the user is on a call or
  // has the side-switch on silent.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (cancelled) return;
        if (!perm.granted) { setStage('permission_denied'); return; }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (!cancelled) setStage('idle');
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? 'Could not access microphone.');
          setStage('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  // Fully reset when the sheet closes so the next open starts clean.
  useEffect(() => {
    if (!visible) {
      if (state.isRecording) recorder.stop().catch(() => {});
      // Defer reset to next tick so the closing animation doesn't show a
      // flash of the idle state before the sheet unmounts.
      const t = setTimeout(reset, 250);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleClose = () => {
    // Block close during in-flight operations so we don't drop responses on
    // the floor; the user can still cancel via system back/swipe on Android.
    if (stage === 'transcribing' || stage === 'parsing' || stage === 'saving') return;
    onClose();
  };

  const startRecording = async () => {
    setError(null);
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStage('recording');
    } catch (e: any) {
      setError(e?.message ?? "Couldn't start recording.");
      setStage('error');
    }
  };

  const stopAndTranscribe = async () => {
    setStage('transcribing');
    setError(null);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('The recorder finished but produced no file. Try again.');

      const info = await FileSystemLegacy.getInfoAsync(uri);
      if (!info.exists) throw new Error('Recording file is missing on disk.');
      const size = (info as any).size ?? 0;
      if (size < 2000) {
        throw new Error(`Recording is too short. Hold the mic and speak for a couple of seconds.`);
      }

      // Mirror the actual file extension — Whisper 400s on a wrong mime.
      const lower = uri.toLowerCase();
      const mime =
        lower.endsWith('.m4a')  ? 'audio/m4a' :
        lower.endsWith('.mp4')  ? 'audio/mp4' :
        lower.endsWith('.wav')  ? 'audio/wav' :
        lower.endsWith('.webm') ? 'audio/webm' :
        lower.endsWith('.3gp')  ? 'audio/3gpp' :
        'audio/m4a';

      const base64 = await FileSystemLegacy.readAsStringAsync(uri, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      });
      const res = await nutritionApi.transcribeAudio(base64, mime);
      const text = String((res as any)?.text ?? '').trim();
      if (!text) {
        setError("Anakin couldn't make out what you said. Try once more — speak a little closer to the mic.");
        setStage('idle');
        return;
      }
      setTranscript(text);
      setStage('transcribed');
    } catch (e: any) {
      setError(e?.message ?? 'Could not transcribe. Tap the mic to try again.');
      setStage('idle');
    }
  };

  const parseTranscript = async () => {
    const value = transcript.trim();
    if (!value) return;
    Keyboard.dismiss();
    setStage('parsing');
    setError(null);
    try {
      const res = await nutritionApi.parseMeal(value);
      const meal = (res as any)?.meal ?? res;
      setParsed({
        name: String(meal?.name ?? value),
        calories: Number(meal?.calories) || 0,
        proteinG: Number(meal?.proteinG) || 0,
        carbsG:   Number(meal?.carbsG)   || 0,
        fatG:     Number(meal?.fatG)     || 0,
      });
      setStage('review');
    } catch (err: any) {
      setError(err?.message ?? "Anakin couldn't parse that. Add a bit more detail and try again.");
      setStage('transcribed');
    }
  };

  const log = async () => {
    if (!parsed) return;
    Keyboard.dismiss();
    setStage('saving');
    try {
      await nutritionApi.logMeal({
        date: todayStr(),
        name: parsed.name,
        mealType: slot,
        calories: parsed.calories,
        proteinG: parsed.proteinG,
        carbsG: parsed.carbsG,
        fatG: parsed.fatG,
      });
      Analytics.foodTypedLogged({ calories: parsed.calories });
      await Promise.resolve(onLogged());
      reset();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save. Try again.');
      setStage('review');
    }
  };

  const titleFor: Record<Stage, string> = {
    idle: 'Voice logging',
    recording: 'Listening…',
    transcribing: 'Transcribing…',
    transcribed: 'Your transcript',
    parsing: 'Reading…',
    review: 'Review macros',
    saving: 'Logging…',
    permission_denied: 'Voice logging',
    error: 'Voice logging',
  };
  const subtitleFor: Record<Stage, string | undefined> = {
    idle: 'Tap the mic and describe what you ate.',
    recording: 'Tap stop when you\'re done.',
    transcribing: undefined,
    transcribed: 'Tweak the wording if needed, then get macros.',
    parsing: undefined,
    review: 'Tweak any value, then log.',
    saving: undefined,
    permission_denied: undefined,
    error: undefined,
  };

  const canDismissBackdrop =
    stage !== 'transcribing' && stage !== 'parsing' && stage !== 'saving';

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={titleFor[stage]}
      subtitle={subtitleFor[stage]}
      dismissOnBackdrop={canDismissBackdrop}
    >
      <View style={styles.body}>
        {stage === 'permission_denied' && <PermissionDenied onClose={onClose} />}

        {(stage === 'idle' || stage === 'recording' || stage === 'error') && (
          <>
            <RecordButton
              recording={stage === 'recording'}
              onPress={stage === 'recording' ? stopAndTranscribe : startRecording}
              durationMs={state.durationMillis ?? 0}
              metering={state.metering ?? null}
            />
            <Text style={styles.helperText}>
              {stage === 'recording'
                ? 'Tap to stop and transcribe.'
                : 'Tap the mic, describe your meal, then tap again to send.'}
            </Text>
          </>
        )}

        {stage === 'transcribing' && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.foreground} />
            <Text style={styles.statusText}>Transcribing…</Text>
          </View>
        )}

        {stage === 'transcribed' && (
          <TranscribedStage
            transcript={transcript}
            setTranscript={setTranscript}
            onRerecord={() => { setTranscript(''); setError(null); setStage('idle'); }}
            onSubmit={parseTranscript}
          />
        )}

        {stage === 'parsing' && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.foreground} />
            <Text style={styles.statusText}>Reading the macros…</Text>
          </View>
        )}

        {stage === 'review' && parsed && (
          <ReviewStage
            meal={parsed}
            setMeal={setParsed}
            slot={slot}
            setSlot={setSlot}
            onLog={log}
            onBack={() => setStage('transcribed')}
          />
        )}

        {stage === 'saving' && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.foreground} />
            <Text style={styles.statusText}>Logging…</Text>
          </View>
        )}

        {error && stage !== 'permission_denied' ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}
      </View>
      <KeyboardDoneBar />
    </BottomSheet>
  );
}

// ─── Stage components ────────────────────────────────────────────────────────

function RecordButton({
  recording, onPress, durationMs, metering,
}: {
  recording: boolean;
  onPress: () => void;
  durationMs: number;
  metering: number | null;
}) {
  // iOS metering is negative dB. Map -60..0 → 0..1 for a visible halo.
  const meterScale = metering != null
    ? Math.max(0, Math.min(1, (metering + 60) / 60))
    : 0;
  const haloSize = recording ? 96 + meterScale * 18 : 96;
  return (
    <View style={{ alignItems: 'center', gap: 14 }}>
      <View
        style={[
          styles.halo,
          { width: haloSize, height: haloSize, borderRadius: haloSize / 2 },
          recording && styles.haloOn,
        ]}
      >
        <TouchableOpacity
          style={[styles.mic, recording && styles.micOn]}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
        >
          <Ionicons
            name={recording ? 'stop' : 'mic'}
            size={32}
            color={recording ? '#ffffff' : colors.foreground}
          />
        </TouchableOpacity>
      </View>
      <Text style={styles.duration}>{formatDuration(durationMs)}</Text>
    </View>
  );
}

function TranscribedStage({
  transcript, setTranscript, onRerecord, onSubmit,
}: {
  transcript: string;
  setTranscript: (s: string) => void;
  onRerecord: () => void;
  onSubmit: () => void;
}) {
  return (
    <View style={{ width: '100%' }}>
      <Text style={styles.fieldLabel}>HEARD YOU SAY</Text>
      <TextInput
        style={styles.transcriptInput}
        value={transcript}
        onChangeText={setTranscript}
        multiline
        placeholder="(empty)"
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel="Transcript — editable"
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.ghost}
          onPress={onRerecord}
          accessibilityRole="button"
          accessibilityLabel="Re-record"
        >
          <Ionicons name="mic-outline" size={16} color={colors.foreground} />
          <Text style={styles.ghostText}>Re-record</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primary, !transcript.trim() && styles.primaryDisabled]}
          onPress={onSubmit}
          disabled={!transcript.trim()}
          accessibilityRole="button"
          accessibilityLabel="Get macros from this transcript"
        >
          <Text style={styles.primaryText}>Get macros</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ReviewStage({
  meal, setMeal, slot, setSlot, onLog, onBack,
}: {
  meal: ParsedMeal;
  setMeal: (m: ParsedMeal) => void;
  slot: MealSlotApi;
  setSlot: (s: MealSlotApi) => void;
  onLog: () => void;
  onBack: () => void;
}) {
  const setNum = (k: keyof Omit<ParsedMeal, 'name'>, v: string) => {
    const n = Number(v);
    setMeal({ ...meal, [k]: Number.isFinite(n) ? n : 0 });
  };
  return (
    <View style={{ width: '100%' }}>
      <TextInput
        style={styles.nameInput}
        value={meal.name}
        onChangeText={(t) => setMeal({ ...meal, name: t })}
        placeholder="Meal name"
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel="Meal name"
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />
      <View style={styles.macroGrid}>
        <MacroCell label="Kcal" value={meal.calories} onChange={(v) => setNum('calories', v)} />
        <MacroCell label="Protein" value={meal.proteinG} onChange={(v) => setNum('proteinG', v)} />
        <MacroCell label="Carbs"   value={meal.carbsG}   onChange={(v) => setNum('carbsG', v)} />
        <MacroCell label="Fat"     value={meal.fatG}     onChange={(v) => setNum('fatG', v)} />
      </View>
      <Text style={styles.fieldLabel}>SLOT</Text>
      <View style={styles.slotRow}>
        {SLOTS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.slotChip, slot === s.key && styles.slotChipOn]}
            onPress={() => setSlot(s.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: slot === s.key }}
            accessibilityLabel={`Slot ${s.label}`}
          >
            <Text style={[styles.slotChipText, slot === s.key && styles.slotChipTextOn]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghost} onPress={onBack} accessibilityRole="button">
          <Ionicons name="arrow-back" size={16} color={colors.foreground} />
          <Text style={styles.ghostText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primary}
          onPress={onLog}
          accessibilityRole="button"
          accessibilityLabel="Log meal"
        >
          <Text style={styles.primaryText}>Log meal</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MacroCell({
  label, value, onChange,
}: {
  label: string; value: number; onChange: (v: string) => void;
}) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        style={styles.macroInput}
        value={String(value)}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        accessibilityLabel={`${label} value`}
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />
    </View>
  );
}

function PermissionDenied({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.center}>
      <View style={styles.permIcon}>
        <Ionicons name="mic-off-outline" size={28} color={colors.mutedForeground} />
      </View>
      <Text style={styles.heading}>Microphone access denied</Text>
      <Text style={styles.helperText}>
        Enable microphone access in Settings to use voice logging.
      </Text>
      <TouchableOpacity style={styles.primaryStandalone} onPress={onClose} accessibilityRole="button">
        <Text style={styles.primaryText}>OK</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingVertical: 12, gap: 12, width: '100%' },
  center: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  halo: {
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  haloOn: { backgroundColor: 'rgba(239,68,68,0.18)' },
  mic: {
    width: 76, height: 76, borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  micOn: { backgroundColor: colors.destructive, borderColor: colors.destructive },
  duration: {
    fontSize: 22, fontWeight: fontWeight.bold, color: colors.foreground,
    fontVariant: ['tabular-nums'],
  },
  helperText: { fontSize: 12.5, color: colors.mutedForeground, textAlign: 'center', maxWidth: 280, lineHeight: 18 },
  statusText: { fontSize: 13, color: colors.mutedForeground, marginTop: 8 },
  errorText: { fontSize: 12, color: colors.destructive, textAlign: 'center', marginTop: 4 },
  transcriptInput: {
    backgroundColor: colors.muted,
    borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 15, color: colors.foreground,
    minHeight: 96, maxHeight: 180,
    textAlignVertical: 'top',
    lineHeight: 21,
  },
  nameInput: {
    backgroundColor: colors.muted, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.foreground,
  },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  macroCell: { flexBasis: '47%', flexGrow: 1 },
  fieldLabel: {
    fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground,
    letterSpacing: 0.8, marginTop: 12, marginBottom: 4,
  },
  macroInput: {
    backgroundColor: colors.muted, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: colors.foreground, fontVariant: ['tabular-nums'],
  },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slotChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.muted },
  slotChipOn: { backgroundColor: colors.foreground },
  slotChipText: { fontSize: 12, color: colors.foreground, fontWeight: fontWeight.medium },
  slotChipTextOn: { color: colors.primaryForeground, fontWeight: fontWeight.bold },
  actions: { flexDirection: 'row', marginTop: 14, gap: 8 },
  primary: {
    flex: 1, backgroundColor: colors.primary, borderRadius: 12, height: 46,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  primaryDisabled: { opacity: 0.55 },
  primaryStandalone: {
    paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12,
    backgroundColor: colors.primary, marginTop: 4,
  },
  primaryText: { color: colors.primaryForeground, fontSize: 14, fontWeight: fontWeight.bold, letterSpacing: 0.2 },
  ghost: {
    height: 46, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  ghostText: { color: colors.foreground, fontWeight: fontWeight.semibold, fontSize: 14 },
  permIcon: {
    width: 64, height: 64, borderRadius: 999,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  heading: { fontSize: 15, fontWeight: fontWeight.bold, color: colors.foreground },
});
