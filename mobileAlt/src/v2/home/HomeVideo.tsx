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

import React, { useEffect, useState } from 'react';
import { AppState, Image, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Battery from 'expo-battery';
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

function Player({ mode, homeVisible, box, poster }: Props & { box: { width: number; height: number }; poster: React.ReactNode }) {
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => { const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active')); return () => sub.remove(); }, []);

  const player = useVideoPlayer(VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    // Never interrupt the user's music or podcast.
    p.audioMixingMode = 'mixWithOthers';
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
  });

  const shouldPlay = homeVisible && mode === 'brief' && appActive && !reduced && !lowPower;
  useEffect(() => {
    try { if (shouldPlay) player.play(); else player.pause(); } catch { /* released */ }
  }, [shouldPlay, player]);

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
            onFirstFrameRender={() => { shown.value = withTiming(1, { duration: 200 }); }}
          />
        </Animated.View>
      )}
    </Faded>
  );
}
