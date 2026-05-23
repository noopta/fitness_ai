// VoiceSheet — record a voice note, transcribe via Whisper, route into
// the Describe review flow. Spec: handoff §10, §13 (transcription provider).
//
// Provider decision: in-house chat endpoint (backend /nutrition/transcribe
// forwards to OpenAI Whisper). Records via expo-audio's useAudioRecorder,
// reads the file as base64 via expo-file-system/legacy, posts the bytes
// up. The transcript is handed back via onTranscribed — the parent
// (NutritionScreen) opens DescribeSheet pre-filled with it.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
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
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Hand off the transcript to the Describe flow. The parent opens
   * DescribeSheet with this text pre-filled, then we close ourselves.
   */
  onTranscribed: (text: string) => void;
}

type Stage = 'idle' | 'recording' | 'transcribing' | 'permission_denied' | 'error';

/** Format milliseconds → "0:23". Kept here to avoid pulling date-fns. */
function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

export function VoiceSheet({ visible, onClose, onTranscribed }: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);

  // Pre-flight: when the sheet opens, request microphone permission + set
  // the audio mode so iOS won't silently fail when the user is on a call
  // or has the side-switch on silent.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          if (!cancelled) setStage('permission_denied');
          return;
        }
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
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

  // When the sheet is dismissed mid-recording, stop the recorder so the
  // device doesn't keep the mic open in the background.
  useEffect(() => {
    if (!visible && state.isRecording) {
      recorder.stop().catch(() => {});
    }
  }, [visible, state.isRecording, recorder]);

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
      console.log('[voice] stopping recorder…');
      await recorder.stop();
      const uri = recorder.uri;
      console.log('[voice] recorder.uri =', uri);
      if (!uri) throw new Error('The recorder finished but produced no file. Try again.');

      // Confirm the file actually exists and has meaningful size before
      // base64-encoding it — earlier "doesn't do anything" reports were
      // silent failures where the recorder closed without flushing audio.
      const info = await FileSystemLegacy.getInfoAsync(uri);
      console.log('[voice] file info =', info);
      if (!info.exists) throw new Error('Recording file is missing on disk.');
      const size = (info as any).size ?? 0;
      if (size < 2000) {
        throw new Error(`Recording is too short (${size} bytes). Hold the mic and speak for a couple of seconds.`);
      }

      // Derive mime from the file extension Expo wrote. iOS HIGH_QUALITY
      // produces .m4a; Android sometimes writes .mp4 or .3gp. Sending the
      // wrong mime makes Whisper 400 with a confusing "Invalid file
      // format" error, so we mirror the actual extension.
      const lower = uri.toLowerCase();
      const mime =
        lower.endsWith('.m4a')  ? 'audio/m4a' :
        lower.endsWith('.mp4')  ? 'audio/mp4' :
        lower.endsWith('.wav')  ? 'audio/wav' :
        lower.endsWith('.webm') ? 'audio/webm' :
        lower.endsWith('.3gp')  ? 'audio/3gpp' :
        'audio/m4a';
      console.log('[voice] reading file, mime =', mime, 'size =', size);

      const base64 = await FileSystemLegacy.readAsStringAsync(uri, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      });
      console.log('[voice] base64 length =', base64.length);
      console.log('[voice] POST /nutrition/transcribe …');
      const res = await nutritionApi.transcribeAudio(base64, mime);
      console.log('[voice] transcribe response =', res);

      const text = String((res as any)?.text ?? '').trim();
      if (!text) {
        setError("Anakin couldn't make out what you said. Try once more — speak a little closer to the mic.");
        setStage('idle');
        return;
      }
      // Hand the transcript to the parent — it sets openSheet='describe'
      // with the prefill. Do NOT also call onClose() here: the parent's
      // openSheet union state means the next sheet open implicitly closes
      // this one, and calling onClose() right after would race the parent's
      // state update and stomp openSheet back to null (which is the original
      // "voice flow never reaches Describe" bug).
      setStage('idle');
      onTranscribed(text);
    } catch (e: any) {
      console.error('[voice] transcribe failed:', e?.message ?? e);
      setError(e?.message ?? 'Could not transcribe. Tap the mic to try again.');
      setStage('idle');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Voice logging"
      subtitle="Anakin transcribes what you say, then the Describe screen handles the macros."
      dismissOnBackdrop={stage !== 'transcribing'}
    >
      <View style={styles.body}>
        {stage === 'permission_denied' ? (
          <PermissionDenied onClose={onClose} />
        ) : stage === 'transcribing' ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.foreground} />
            <Text style={styles.statusText}>Transcribing…</Text>
          </View>
        ) : (
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
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

function RecordButton({
  recording, onPress, durationMs, metering,
}: {
  recording: boolean;
  onPress: () => void;
  durationMs: number;
  metering: number | null;
}) {
  // metering on iOS comes back negative-dB-ish; map a sensible range so the
  // ring grows visibly when the user is actually speaking.
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
      <TouchableOpacity style={styles.primary} onPress={onClose} accessibilityRole="button">
        <Text style={styles.primaryText}>OK</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingVertical: 12, gap: 12 },
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
  errorText: { fontSize: 12, color: colors.destructive, textAlign: 'center' },
  permIcon: {
    width: 64, height: 64, borderRadius: 999,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  heading: { fontSize: 15, fontWeight: fontWeight.bold, color: colors.foreground },
  primary: {
    paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12,
    backgroundColor: colors.primary, marginTop: 4,
  },
  primaryText: { color: colors.primaryForeground, fontSize: 13, fontWeight: fontWeight.bold },
});
