import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform, Switch, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Poster } from '../src/onboarding/Poster';
import { Reveal } from '../src/onboarding/motion/Reveal';
import { scene } from '../src/onboarding/scenes/SceneStyles';
import { s } from '../src/onboarding/theme';
import { PHOTOS } from '../src/onboarding/assets/photos/manifest';
import { formAnalysisApi, type QuickVideoAnalysis } from '../src/lib/api';
import { markFormHookSeen } from '../src/onboarding/formhook/storage';
import { Analytics } from '../src/lib/analytics';

// ─────────────────────────────────────────────────────────────────────────────
// First-run form-analysis hook.
//
// Sits between the cinematic pager and the coach intake: sign-in → THIS →
// intake → plan → paywall. The bet is that a piece of real, specific coaching
// delivered in the first minute earns the 8-step intake that follows, rather
// than the intake having to earn itself cold.
//
// Built on the same Poster/Reveal/wash system as the cinematic scenes on
// purpose — the handoff from slide 7 to this screen should read as the next
// beat of one sequence, not as arriving somewhere else in the app.
//
// Stages: intro → capture → working → result → bridge → (tabs)/coach
// Every stage can be skipped. See SKIP below for why that is load-bearing.
// ─────────────────────────────────────────────────────────────────────────────

type Stage = 'intro' | 'capture' | 'working' | 'result' | 'bridge';

/**
 * Clip ceiling. Not a latency constraint — measured on the real Vertex path,
 * an 8s clip and a 15s clip both analyze in ~6.1s, because cost is in output
 * tokens not frames. 15s is a capture-quality choice: long enough for 3-5
 * working reps including the setup, short enough to keep the upload small on
 * cellular (the upload, not the inference, is the slow half).
 */
const MAX_CLIP_SECONDS = 15;

/**
 * Progress beats for the `working` stage.
 *
 * The wait is real (~6s inference plus however long the upload takes) and the
 * right move is to spend it showing work rather than hiding it. A form check
 * that returns instantly reads as canned; one that visibly reads the setup,
 * tracks the reps, then compares against something reads as rigor. Beats are
 * deliberately paced slower than the fastest possible response so the last
 * one is never truncated mid-word on a fast connection.
 */
const BEATS = [
  'Uploading your clip…',
  'Finding you in the frame…',
  'Tracking the bar path rep by rep…',
  'Checking depth, bracing and knee tracking…',
  'Writing your feedback…',
] as const;
const BEAT_MS = 2600;

export default function OnboardingFormHook() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>('intro');
  const [beat, setBeat] = useState(0);
  const [result, setResult] = useState<QuickVideoAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stills default OFF. The stills DPIA's basis is Art. 9(2)(a) explicit
  // consent, and a pre-ticked box in a first-run flow is not that — nor is it
  // the "high privacy default" the UK AADC expects of a service minors can
  // reach. Declining costs the user only the picture; all the coaching text
  // is identical either way.
  const [saveFrames, setSaveFrames] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  useEffect(() => {
    Analytics.formHookShown();
  }, []);

  // Advance the progress narrative while `working`. Stops at the last beat
  // rather than looping — a looping spinner narrative reads as stuck.
  useEffect(() => {
    if (stage !== 'working') return;
    const t = setInterval(() => setBeat((b) => Math.min(b + 1, BEATS.length - 1)), BEAT_MS);
    return () => clearInterval(t);
  }, [stage]);

  /**
   * Leave the hook and hand off to the intake. Marks the flag first so this
   * screen never reappears, whether the user finished, skipped, or bailed
   * after a failure — being asked to film yourself on every cold start would
   * be worse than never having asked.
   */
  const finish = useCallback(async (reason: 'completed' | 'skipped' | 'failed' | 'age_ineligible') => {
    Analytics.formHookFinished(reason);
    await markFormHookSeen();
    router.replace('/(tabs)/coach' as any);
  }, [router]);

  const analyze = useCallback(async (uri: string, mimeType: string) => {
    setStage('working');
    setBeat(0);
    setError(null);
    Analytics.formHookSubmitted();
    try {
      const started = await formAnalysisApi.startOnboarding(uri, mimeType, saveFrames);
      // 1.5s rather than the main screen's 4s: the quick pass lands in ~6s,
      // and a 4s poll would routinely add half again as much dead time on top
      // of a result that was already sitting there.
      const detail = await formAnalysisApi.pollUntilDone(started.id, {
        intervalMs: 1500,
        timeoutMs: 120_000,
      });
      if (cancelled.current) return;

      if (detail.status === 'failed') {
        setError(detail.errorMessage ?? "We couldn't read that clip.");
        setStage('result');
        return;
      }
      const a = detail.analysis as QuickVideoAnalysis;
      // The model is instructed to return exercise="unknown" rather than
      // invent feedback on an unreadable clip. That is the right behaviour
      // and the wrong thing to show as an aha moment, so it routes to retry.
      if (!a || a.exercise === 'unknown') {
        setError(a?.summary ?? "We couldn't tell what lift that was.");
        setStage('result');
        return;
      }
      setResult(a);
      setStage('result');
      Analytics.formHookResult(a.exercise, a.formScore);
    } catch (e: any) {
      if (cancelled.current) return;
      // The route 403s when the user is under 18 or the feature is switched
      // off server-side. Either way this screen cannot do its job, and the
      // right move is never to strand the user on it — send them to the
      // intake, which is where they were always going next.
      const msg = String(e?.message ?? '');
      if (/18 and over|age_restricted|not_enabled|not available/i.test(msg)) {
        void finish('age_ineligible');
        return;
      }
      setError(e?.message ?? 'Analysis failed.');
      setStage('result');
    }
  }, [saveFrames, finish]);

  const pick = useCallback(async (mode: 'camera' | 'library') => {
    try {
      const perm = mode === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          mode === 'camera' ? 'Camera access needed' : 'Photo access needed',
          'You can also skip this and go straight to your intake.',
        );
        return;
      }

      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['videos'],
        videoMaxDuration: MAX_CLIP_SECONDS,
        quality: 0.7,
        // Capture resolution, not just transcode quality — `quality` alone
        // leaves the clip at full sensor resolution. A 15s 1080p clip is
        // ~22MB against ~8MB at 720p, and on cellular that gap is the single
        // biggest contributor to how long this screen takes (the upload is
        // the slow half; inference is a flat ~6s).
        //
        // Two caveats, both worth knowing before trusting this: it is
        // iOS-only in expo-image-picker 55, and it governs RECORDING only —
        // a clip picked from the library uploads at whatever size it already
        // is. Android and library picks therefore still pay full freight
        // until a real compressor (react-native-compressor) is added.
        // `videoExportPreset` would cover the library case but Apple
        // deprecated the API behind it, so it is deliberately not used.
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
      };
      const res = mode === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.length) return;

      const asset = res.assets[0];
      // videoMaxDuration governs recording only, so library picks need their
      // own check. 2s of slop for container-duration rounding.
      if (asset.duration && asset.duration > (MAX_CLIP_SECONDS + 2) * 1000) {
        Alert.alert('Clip too long', `Pick something up to ${MAX_CLIP_SECONDS} seconds — a few reps is plenty.`);
        return;
      }
      void analyze(asset.uri, asset.mimeType ?? 'video/mp4');
    } catch (e: any) {
      Alert.alert('Something went wrong', e?.message ?? 'Please try again.');
    }
  }, [analyze]);


  // ── Bottom bar, mirroring OnboardingPager's so the chrome doesn't jump ──
  const Bar = ({ children }: { children: React.ReactNode }) => (
    <View
      style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom + 8, 26) }]}
      pointerEvents="box-none"
    >
      {children}
    </View>
  );

  const Primary = ({ label, onPress, icon }: { label: string; onPress: () => void; icon?: any }) => (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress} activeOpacity={0.85}>
      {icon ? <Ionicons name={icon} size={17} color="#09090b" /> : null}
      <Text style={styles.primaryText}>{label}</Text>
    </TouchableOpacity>
  );

  const Skip = ({ label = 'Skip for now' }: { label?: string }) => (
    <TouchableOpacity onPress={() => finish('skipped')} activeOpacity={0.7} style={styles.skipBtn}>
      <Text style={styles.skipText}>{label}</Text>
    </TouchableOpacity>
  );

  // ─── intro ────────────────────────────────────────────────────────────────
  if (stage === 'intro') {
    return (
      <Poster wash="Ember" photo={PHOTOS.coachSquat} lx={0.5} ly={0.38} scrim={0.86} slug="first look">
        <Reveal index={0}>
          <View style={scene.eyebrowRow}>
            <View style={[scene.eyebrowTick, { backgroundColor: '#fff' }]} />
            <Text style={scene.eyebrowText}>Before We Begin</Text>
          </View>
        </Reveal>
        <Reveal index={1}>
          <Text style={[scene.headline, { fontSize: s(40), lineHeight: s(40) * 0.99 }]}>
            Let's start with a taste of what Axiom does.
          </Text>
        </Reveal>
        <Reveal index={2}>
          <Text style={[scene.body, { marginTop: s(16) }]}>
            Film {MAX_CLIP_SECONDS} seconds of any lift — a warm-up set is perfect. You'll get
            a read on your technique, the way a coach standing next to the rack would.
          </Text>
        </Reveal>
        <Reveal index={3}>
          {/* The consent notice is load-bearing, not decoration.
              Our DPIA's lawful basis rests on consent being freely given and
              specific. In a flow where the video sits between signup and the
              product, that only holds if declining is a visibly equal option
              and the user is told what happens to the clip BEFORE they film
              it — not in a policy they never opened. Hence: what we do with
              it, who sees it, how long we keep it, stated here, with a skip
              that is a real button rather than a grey afterthought. */}
          <View style={styles.consentCard}>
            <Text style={styles.consentLine}>
              Your clip is sent to Google's Vertex AI to be analysed, then
              <Text style={styles.consentEmphasis}> permanently deleted</Text> — usually within a minute.
            </Text>
            <Text style={styles.consentLine}>
              We keep the written feedback. No one else sees it, and it is never used to
              train any model.
            </Text>
            <Text style={styles.consentLine}>
              Film only yourself, and avoid catching other people in frame.
            </Text>

            {/* Separate, unticked, and separately revocable. The written
                analysis is identical whether this is on or off — which is
                what keeps the consent freely given rather than the price of
                using the feature. */}
            <View style={styles.stillsRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.stillsTitle}>Show me the exact frame</Text>
                <Text style={styles.stillsBody}>
                  Saves one still from your clip with the moment marked, so you can see what
                  we mean. Stored with your feedback until you delete it. Off by default.
                </Text>
              </View>
              <Switch
                value={saveFrames}
                onValueChange={setSaveFrames}
                trackColor={{ false: 'rgba(255,255,255,0.20)', true: 'rgba(255,255,255,0.55)' }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </Reveal>
        <Bar>
          <Primary label="I agree — film a set" onPress={() => { Analytics.formHookConsented(); setStage('capture'); }} icon="arrow-forward" />
          <Skip label="Skip this — go to my intake" />
        </Bar>
      </Poster>
    );
  }

  // ─── capture ──────────────────────────────────────────────────────────────
  if (stage === 'capture') {
    return (
      <Poster wash="Ember" photo={PHOTOS.rackSmith} lx={0.5} ly={0.4} scrim={0.88} slug="first look">
        <Reveal index={0}>
          <Text style={[scene.headline, { fontSize: s(34), lineHeight: s(34) }]}>
            Film from the side, full body in frame.
          </Text>
        </Reveal>
        <Reveal index={1}>
          <View style={{ marginTop: s(18), gap: s(9) }}>
            {[
              'Side-on beats head-on — we need to see the hinge.',
              'Get the whole lift in: setup, reps, rack.',
              'Three to five reps is plenty.',
            ].map((t) => (
              <View key={t} style={{ flexDirection: 'row', gap: s(9) }}>
                <Text style={[scene.caption, { opacity: 0.55 }]}>—</Text>
                <Text style={[scene.caption, { flex: 1 }]}>{t}</Text>
              </View>
            ))}
          </View>
        </Reveal>
        <Bar>
          <Primary label="Record now" onPress={() => pick('camera')} icon="videocam" />
          <TouchableOpacity onPress={() => pick('library')} activeOpacity={0.7} style={styles.skipBtn}>
            <Text style={styles.skipText}>Choose an existing clip</Text>
          </TouchableOpacity>
          <Skip />
        </Bar>
      </Poster>
    );
  }

  // ─── working ──────────────────────────────────────────────────────────────
  if (stage === 'working') {
    return (
      <Poster wash="Steel" photo={PHOTOS.equipGymleco} lx={0.5} ly={0.4} scrim={0.9} slug="analyzing">
        <View style={{ gap: s(18) }}>
          <ActivityIndicator color="#fff" />
          <Text style={[scene.headline, { fontSize: s(30), lineHeight: s(30) }]}>
            {BEATS[beat]}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {BEATS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.beatDot,
                  i <= beat ? styles.beatDotOn : styles.beatDotOff,
                ]}
              />
            ))}
          </View>
          <Text style={scene.caption}>Keep the app open — this takes a few seconds.</Text>
        </View>
      </Poster>
    );
  }

  // ─── result ───────────────────────────────────────────────────────────────
  if (stage === 'result') {
    if (error || !result) {
      return (
        <Poster wash="Ash" photo={PHOTOS.gymOldschool} lx={0.5} ly={0.4} scrim={0.88} slug="first look">
          <Reveal index={0}>
            <Text style={[scene.headline, { fontSize: s(32), lineHeight: s(32) }]}>
              That clip didn't give us enough to work with.
            </Text>
          </Reveal>
          <Reveal index={1}>
            <Text style={[scene.body, { marginTop: s(14) }]}>{error}</Text>
          </Reveal>
          <Reveal index={2}>
            <Text style={[scene.caption, { marginTop: s(12) }]}>
              Try again from the side with the whole lift in frame — this one's on us, it
              doesn't count against anything.
            </Text>
          </Reveal>
          <Bar>
            <Primary label="Try another clip" onPress={() => setStage('capture')} icon="refresh" />
            <Skip label="Continue to my intake" />
          </Bar>
        </Poster>
      );
    }

    const score = Number.isFinite(result.formScore) ? result.formScore.toFixed(1) : '—';
    return (
      <Poster wash="Ember" photo={PHOTOS.coachSquat} lx={0.5} ly={0.36} scrim={0.9} slug="your read">
        <Reveal index={0}>
          <View style={scene.eyebrowRow}>
            <View style={[scene.eyebrowTick, { backgroundColor: '#fff' }]} />
            <Text style={scene.eyebrowText}>
              {result.exercise}
              {typeof result.repCount === 'number' ? ` · ${result.repCount} reps` : ''}
            </Text>
          </View>
        </Reveal>
        <Reveal index={1}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: s(6) }}>
            <Text style={[scene.bigStat, { fontSize: s(56) }]}>{score}</Text>
            <Text style={[scene.smallStat, { opacity: 0.6 }]}>/ 10</Text>
          </View>
        </Reveal>
        <Reveal index={2}>
          <Text style={[scene.headline, { fontSize: s(28), lineHeight: s(28), marginTop: s(10) }]}>
            {result.headline}
          </Text>
        </Reveal>
        <Reveal index={3}>
          <View style={styles.cueCard}>
            <Text style={styles.cueLabel}>THE CUE</Text>
            <Text style={styles.cueText}>{result.cue}</Text>
          </View>
        </Reveal>
        {result.referenceFrames?.[0]?.b64 ? (
          <Reveal index={4}>
            {/* The picture is the point: "your knees cave" lands differently
                when it is drawn on the frame it happened in. Only present
                when the user opted in AND the model could localise the
                fault — both are routinely false, so this is never assumed. */}
            <View style={styles.frameWrap}>
              <Image
                source={{ uri: `data:image/jpeg;base64,${result.referenceFrames[0].b64}` }}
                style={styles.frameImage}
                resizeMode="cover"
                accessibilityLabel={`The moment we're describing: ${result.headline}`}
              />
              <Text style={styles.frameCaption}>
                {typeof result.referenceFrames[0].timestampSec === 'number'
                  ? `${result.referenceFrames[0].timestampSec.toFixed(1)}s into your set`
                  : 'From your set'}
              </Text>
            </View>
          </Reveal>
        ) : null}
        <Reveal index={5}>
          <Text style={[scene.body, { marginTop: s(14) }]}>{result.summary}</Text>
        </Reveal>
        <Bar>
          <Primary label="That's my read — continue" onPress={() => setStage('bridge')} icon="arrow-forward" />
        </Bar>
      </Poster>
    );
  }

  // ─── bridge ───────────────────────────────────────────────────────────────
  return (
    <Poster wash="Steel" photo={PHOTOS.physiqueBack} lx={0.5} ly={0.38} scrim={0.88} slug="next">
      <Reveal index={0}>
        <View style={scene.eyebrowRow}>
          <View style={[scene.eyebrowTick, { backgroundColor: '#fff' }]} />
          <Text style={scene.eyebrowText}>That Was One Lift</Text>
        </View>
      </Reveal>
      <Reveal index={1}>
        <Text style={[scene.headline, { fontSize: s(38), lineHeight: s(38) * 0.99 }]}>
          Everything else starts with the intake.
        </Text>
      </Reveal>
      <Reveal index={2}>
        <Text style={[scene.body, { marginTop: s(16) }]}>
          What you just saw is one read on one set. The programming, the nutrition, the
          adjustments week to week — those need to know who they're for.
        </Text>
      </Reveal>
      <Reveal index={3}>
        <Text style={[scene.body, { marginTop: s(12) }]}>
          Next is our intake interview: the same questions an elite coach asks before
          writing anyone a program. It's the part that makes the rest work.
        </Text>
      </Reveal>
      <Bar>
        <Primary label="Start my intake" onPress={() => finish('completed')} icon="arrow-forward" />
      </Bar>
    </Poster>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 24,
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
  },
  primaryBtn: {
    height: 48, paddingHorizontal: 24, borderRadius: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#fff', alignSelf: 'stretch',
  },
  primaryText: { color: '#09090b', fontSize: 15, fontWeight: '600' },
  skipBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  skipText: { color: 'rgba(255,255,255,0.62)', fontSize: 13.5, fontWeight: '500' },
  beatDot: { height: 3, flex: 1, borderRadius: 2 },
  beatDotOn: { backgroundColor: '#fff' },
  beatDotOff: { backgroundColor: 'rgba(255,255,255,0.22)' },
  consentCard: {
    marginTop: 16, padding: 14, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    gap: 8,
  },
  consentLine: { color: 'rgba(255,255,255,0.80)', fontSize: 13, lineHeight: 19 },
  stillsRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 4, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.14)',
  },
  stillsTitle: { color: '#fff', fontSize: 13.5, fontWeight: '700', marginBottom: 3 },
  stillsBody: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 16.5 },
  frameWrap: { marginTop: 16, gap: 6 },
  frameImage: {
    width: '100%', aspectRatio: 3 / 4, maxHeight: 260,
    borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  frameCaption: { color: 'rgba(255,255,255,0.55)', fontSize: 11.5 },
  consentEmphasis: { color: '#fff', fontWeight: '700' },
  cueCard: {
    marginTop: 16, padding: 14, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  cueLabel: {
    color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700',
    letterSpacing: 1.8, marginBottom: 6,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  cueText: { color: '#fff', fontSize: 16, fontWeight: '600', lineHeight: 22 },
});
