// Form check · record (handoff T-16). A dark capture surface, like the meal
// camera. Pick the lift, film from the side, and the set goes to the same
// analysis pipeline the classic screen uses (async upload → poll). The result
// opens when it's ready and is filed in Archive; reference stills are kept
// only if asked for, and stay private.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Switch } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { v2, T } from '../../src/v2/theme';
import { Pressable } from '../../src/v2/primitives/Pressable';
import { TextAction } from '../../src/v2/primitives/TextAction';
import { ProgressHairline } from '../../src/v2/charts';
import { formAnalysisApi } from '../../src/lib/api';
import { haptics } from '../../src/v2/haptics';
import { qk } from '../../src/v2/data';

let vision: any = null;
try { vision = require('react-native-vision-camera'); } catch { vision = null; }

const LIFTS = ['Squat', 'Bench', 'Deadlift', 'Other'] as const;
const GUIDE: Record<(typeof LIFTS)[number], string> = {
  Squat: 'Hip height, side on. Your whole body in frame.',
  Bench: 'Bench height, side on. Bar and elbows in frame.',
  Deadlift: 'Hip height, side on. Bar, hips and head in frame.',
  Other: 'Side on, whole body in frame.',
};
const MAX_S = 60;

export default function FormCheckScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ lift?: string }>();
  const camRef = useRef<any>(null);
  const hasCam = !!vision?.Camera;
  const device = hasCam ? vision.useCameraDevice('back') : null;
  const perm = hasCam ? vision.useCameraPermission() : { hasPermission: false, requestPermission: async () => false };
  useEffect(() => { if (hasCam && !perm.hasPermission) void perm.requestPermission(); }, [hasCam]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = LIFTS.find((l) => l.toLowerCase() === String(params.lift ?? '').toLowerCase()) ?? 'Squat';
  const [lift, setLift] = useState<(typeof LIFTS)[number]>(initial);
  const [stage, setStage] = useState<'aim' | 'recording' | 'review' | 'uploading' | 'reading'>('aim');
  const [clip, setClip] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const [keepStills, setKeepStills] = useState(false);
  const timer = useRef<any>(null);
  useEffect(() => () => clearInterval(timer.current), []);

  const start = () => {
    if (!camRef.current) return;
    haptics.light(); setSecs(0); setStage('recording');
    timer.current = setInterval(() => setSecs((s) => { if (s + 1 >= MAX_S) stop(); return s + 1; }), 1000);
    camRef.current.startRecording({
      fileType: 'mp4',
      onRecordingFinished: (v: any) => { clearInterval(timer.current); setClip(v.path.startsWith('file://') ? v.path : `file://${v.path}`); setStage('review'); },
      onRecordingError: (e: any) => { clearInterval(timer.current); setStage('aim'); Alert.alert('Couldn’t record', e?.message ?? 'Try again.'); },
    });
  };
  const stop = () => { try { void camRef.current?.stopRecording(); } catch { /* already stopped */ } };
  const analyze = async () => {
    if (!clip) return;
    setStage('uploading');
    try {
      const started = await formAnalysisApi.start(clip, 'video/mp4', lift === 'Other' ? undefined : lift, keepStills);
      haptics.success(); setStage('reading');
      void qc.invalidateQueries({ queryKey: qk.diagnostics });
      void qc.invalidateQueries({ queryKey: qk.trainingOverview });
      // Wait here if they stay; the result is in Archive either way.
      try { await (formAnalysisApi as any).pollUntilDone(started.id, { intervalMs: 4000 }); } catch { /* still running; Archive has it */ }
      router.replace({ pathname: '/form-analysis', params: { id: started.id } } as any);
    } catch (e: any) {
      setStage('review');
      if (e?.status === 429) Alert.alert('Daily limit reached', 'Free plan: one form check a day. Pro is unlimited.', [{ text: 'Not now', style: 'cancel' }, { text: 'See Pro', onPress: () => router.push({ pathname: '/(v2)/paywall', params: { gate: '1' } } as any) }]);
      else Alert.alert('Couldn’t upload that', e?.message ?? 'Try again.');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Pressable onPress={() => (stage === 'recording' ? stop() : router.back())} hitSlop={10}><Text style={[T.body, { color: v2.color.darkMuted }]}>{stage === 'review' ? 'Cancel' : 'Close'}</Text></Pressable>
        <Text style={[T.captionStrong, { color: v2.color.darkInk }]}>{lift} · side view</Text>
        <Text style={[T.caption, T.num, { color: stage === 'recording' ? v2.color.crimson : v2.color.darkMuted, minWidth: 40, textAlign: 'right' }]}>{stage === 'recording' ? `0:${String(secs).padStart(2, '0')}` : ''}</Text>
      </View>
      <View style={styles.viewfinder}>
        {hasCam && device && perm.hasPermission && (stage === 'aim' || stage === 'recording') ? (
          <vision.Camera ref={camRef} style={StyleSheet.absoluteFill} device={device} isActive video audio={false} />
        ) : (
          <View style={styles.center}>
            <Text style={[T.body, { color: v2.color.darkMuted, textAlign: 'center' }]}>
              {stage === 'review' ? 'Got the set.' : stage === 'uploading' ? 'Sending the set…' : stage === 'reading' ? 'Reading your set — about a minute. You can leave; it’ll be in Archive.' : !hasCam ? 'The camera isn’t available in this version.' : 'Allow camera access to film your set.'}
            </Text>
            {stage === 'uploading' || stage === 'reading' ? <View style={{ width: 160, marginTop: 18 }}><ProgressHairline fraction={stage === 'reading' ? 0.7 : 0.3} /></View> : null}
          </View>
        )}
      </View>
      {stage === 'aim' || stage === 'recording' ? (
        <>
          <Text style={[T.caption, { color: v2.color.darkMuted, textAlign: 'center', marginTop: 14 }]}>{GUIDE[lift]}</Text>
          <View style={styles.lifts}>
            {LIFTS.map((l) => (
              <Pressable key={l} onPress={() => { if (stage === 'aim') { haptics.select(); setLift(l); } }} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: lift === l }}>
                <Text style={[T.captionStrong, { color: lift === l ? v2.color.darkInk : v2.color.darkMuted }]}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ alignItems: 'center', marginTop: 18 }}>
            <Pressable onPress={stage === 'recording' ? stop : start} disabled={!hasCam || !perm.hasPermission} style={[styles.shutter, (!hasCam || !perm.hasPermission) && { opacity: 0.4 }]} accessibilityLabel={stage === 'recording' ? 'Stop recording' : 'Start recording'}>
              <View style={stage === 'recording' ? styles.stopInner : styles.recInner} />
            </Pressable>
          </View>
        </>
      ) : stage === 'review' ? (
        <View style={{ marginTop: 18 }}>
          <View style={styles.stillsRow}>
            <View style={{ flex: 1 }}>
              <Text style={[T.body, { color: v2.color.darkInk }]}>Keep reference stills</Text>
              <Text style={[T.caption, { color: v2.color.darkMuted }]}>Private — for comparing later. Off keeps nothing.</Text>
            </View>
            <Switch value={keepStills} onValueChange={setKeepStills} />
          </View>
          <View style={styles.actions}>
            <TextAction primary onPress={() => void analyze()}>Check my form</TextAction>
            <TextAction muted tone="dark" arrow={false} size={15} onPress={() => { setClip(null); setStage('aim'); }}>Retake</TextAction>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.ink, paddingHorizontal: v2.space.gutter },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  viewfinder: { flex: 1, marginTop: 14, borderRadius: 16, overflow: 'hidden', backgroundColor: '#18181b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  lifts: { flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 14 },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: v2.color.darkInk, alignItems: 'center', justifyContent: 'center' },
  recInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: v2.color.crimson },
  stopInner: { width: 26, height: 26, borderRadius: 5, backgroundColor: v2.color.crimson },
  stillsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 20 },
});
