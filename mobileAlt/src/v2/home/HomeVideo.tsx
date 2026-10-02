// Home video background (design: "RN spec: home video background", 30 Sep).
// Replaces the engraving art, the hand warp and the in-hand orb.
//
// Frame 402 × 874 scaled by W / 402. The video sits at the top, full width,
// 402 × 700 (the file's 496:864 aspect, so nothing crops), fading to
// transparent over its bottom 28 % into the ground drawn behind the track.
// The poster frame shows first; the video fades in on its first rendered
// frame, so there is never a black box.
//
// Brief → chat: opacity 1 → 0 (750 ms) and a lift + scale (1000 ms), both on
// the shell's curve, like the art it replaces. Playback follows §5: plays only
// while home is showing in brief with the app active; paused in chat (keeping
// its time), off home, in the background, with Reduce Motion or Low Power Mode.
//
// The player is not trusted to be playing because it was told to: play is
// asked again when the item becomes ready and once more by a watchdog, a
// source that fails to load is retried from a file copied out by expo-asset,
// and what the player actually did is reported once per launch
// (`v2_home_video`) so a still background can be diagnosed without the device.

import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Battery from 'expo-battery';
import { Asset } from 'expo-asset';
import { posthog } from '../../lib/analytics';
import { v2 } from '../theme';

const VIDEO = require('../../../assets/v2/axiom-home-loop.mp4');
const POSTER = require('../../../assets/v2/axiom-home-loop-poster.jpg');
const FRAME_W = 402;
const VIDEO_H = 700;

class VideoBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn('[v2] home video failed; showing the poster', err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function useLowPowerMode() {
  const [low, setLow] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let sub: { remove: () => void } | null = null;
    Battery.isLowPowerModeEnabledAsync().then(setLow).catch(() => {});
    try { sub = Battery.addLowPowerModeListener(({ lowPowerMode }) => setLow(lowPowerMode)); } catch { /* module missing */ }
    return () => sub?.remove();
  }, []);
  return low;
}

interface Props { mode: 'brief' | 'chat'; homeVisible: boolean }

export function HomeVideo(props: Props) {
  const { width: W } = useWindowDimensions();
  const box = { width: W, height: (W * VIDEO_H) / FRAME_W };
  const poster = <Image source={POSTER} style={[StyleSheet.absoluteFill, box]} resizeMode="cover" />;
  return <VideoBoundary fallback={<Faded box={box} mode={props.mode}>{poster}</Faded>}><Player {...props} box={box} poster={poster} /></VideoBoundary>;
}

/** The lift / fade shared by the video and its poster-only fallback, plus the static bottom fade. */
function Faded({ box, mode, children }: { box: { width: number; height: number }; mode: Props['mode']; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const a = useSharedValue(mode === 'chat' ? 1 : 0);
  const t = useSharedValue(mode === 'chat' ? 1 : 0);
  useEffect(() => {
    const to = mode === 'chat' ? 1 : 0;
    a.value = withTiming(to, { duration: reduced ? 150 : v2.motion.artFade, easing: v2.motion.easeIO });
    t.value = withTiming(to, { duration: reduced ? 150 : v2.motion.artMove, easing: v2.motion.easeIO });
  }, [mode, a, t, reduced]);
  // Origin top-centre: scale about the top edge, then lift.
  const style = useAnimatedStyle(() => ({
    opacity: 1 - a.value,
    transform: [
      { translateY: -70 * (box.width / FRAME_W) * t.value },
      { translateY: -box.height / 2 }, { scale: 1 + 0.06 * t.value }, { translateY: box.height / 2 },
    ],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0 }, box, style]}>
      <MaskedView style={StyleSheet.absoluteFill}
        maskElement={<LinearGradient colors={['#000', '#000', 'transparent']} locations={[0, 0.72, 1]} style={StyleSheet.absoluteFill} />}>
        {children}
      </MaskedView>
    </Animated.View>
  );
}

/** Anything but an explicit background / inactive counts as active: the state can be unknown for a moment at launch, and no change event follows if it was already active. */
const isActive = (s: string | null | undefined) => s !== 'background' && s !== 'inactive';
let reported = false;

function Player({ mode, homeVisible, box, poster }: Props & { box: { width: number; height: number }; poster: React.ReactNode }) {
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  const [appActive, setAppActive] = useState(isActive(AppState.currentState));
  useEffect(() => { const sub = AppState.addEventListener('change', (s) => setAppActive(isActive(s))); return () => sub.remove(); }, []);

  const player = useVideoPlayer(VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    // Never interrupt the user's music or podcast.
    p.audioMixingMode = 'mixWithOthers';
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
  });

  const shouldPlay = homeVisible && mode === 'brief' && appActive && !reduced && !lowPower;
  const want = useRef(shouldPlay);
  want.current = shouldPlay;
  const seen = useRef({ status: 'idle', error: '', firstFrame: false, retried: false, replays: 0 });

  useEffect(() => {
    try { if (shouldPlay) player.play(); else player.pause(); } catch { /* released */ }
  }, [shouldPlay, player]);

  // Asking to play before the item is ready is normally honoured once it is; ask again anyway.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status, error }) => {
      seen.current.status = status;
      if (status === 'readyToPlay' && want.current) { try { player.play(); } catch { /* released */ } }
      if (status === 'error') {
        seen.current.error = String(error?.message ?? 'unknown').slice(0, 200);
        if (seen.current.retried) return;
        seen.current.retried = true;
        // The packaged source would not load: copy the asset out to a real .mp4 on disk and play that.
        void Asset.fromModule(VIDEO).downloadAsync()
          .then((a) => (a.localUri ? player.replaceAsync({ uri: a.localUri }) : undefined))
          .then(() => { if (want.current) player.play(); })
          .catch((e) => { seen.current.error += ` | retry: ${String(e?.message ?? e).slice(0, 120)}`; });
      }
    });
    return () => sub.remove();
  }, [player]);

  // Watchdog: two seconds after it should be playing, check that it is.
  useEffect(() => {
    if (!shouldPlay) return;
    const t = setTimeout(() => {
      try { if (want.current && !player.playing) { seen.current.replays += 1; player.play(); } } catch { /* released */ }
    }, 2000);
    return () => clearTimeout(t);
  }, [shouldPlay, player]);

  // One report per launch, once home has been showing for a few seconds.
  const visible = homeVisible && mode === 'brief' && appActive;
  useEffect(() => {
    if (!visible || reported) return;
    const t = setTimeout(() => {
      if (reported) return;
      reported = true;
      let playing = false, time = -1;
      try { playing = player.playing; time = Math.round(player.currentTime * 10) / 10; } catch { /* released */ }
      try {
        posthog.capture('v2_home_video', {
          playing, time, status: seen.current.status, error: seen.current.error || null, first_frame: seen.current.firstFrame,
          retried: seen.current.retried, replays: seen.current.replays, should_play: want.current,
          low_power: lowPower, reduce_motion: reduced, app_state: String(AppState.currentState), platform: Platform.OS,
        });
        void posthog.flush();
      } catch { /* analytics must never break home */ }
    }, 6000);
    return () => clearTimeout(t);
  }, [visible, player, lowPower, reduced]);

  // Poster until the first real frame, then a 200 ms fade — never a black flash.
  const shown = useSharedValue(0);
  const videoStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const still = reduced || lowPower;

  return (
    <Faded box={box} mode={mode}>
      {poster}
      {still ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, videoStyle]}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
            fullscreenOptions={{ enable: false }}
            allowsPictureInPicture={false}
            // SurfaceView ignores parent opacity and masks on some Android devices.
            surfaceType="textureView"
            onFirstFrameRender={() => { seen.current.firstFrame = true; shown.value = withTiming(1, { duration: 200 }); }}
          />
        </Animated.View>
      )}
    </Faded>
  );
}
