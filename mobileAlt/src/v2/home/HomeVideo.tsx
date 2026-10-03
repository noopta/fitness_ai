// Home video — the Dreamcore home (RN spec "Dreamcore home + lag-free brief →
// chat", 2 Oct; playback rules from the 30 Sep video spec §5–§7).
//
// Layers, bottom → top, all full screen: the poster (shown at once), the
// video (fades in over the poster on its first frame), the six-stop scrim
// that keeps the header readable on the sky and white text at 4.5:1 over the
// street. The file is 720 × 1260 (the 768 × 1344 source, silent); it covers
// the screen by height, with its horizontal focus at 42 %.
//
// One player for the life of the agent-first app: `HomeVideoProvider` sits at
// the v2 root, above the track and the stack, so navigation and tab switches
// never recreate it. The file has no audio track and the player is muted at
// volume 0, mixing with others — it can't take the user's music.
//
// Brief → chat is the shell's progress value `p`, read on the UI thread:
// opacity 1 − p, lift −70p, scale 1 + .06p. Playback: paused the moment chat
// opens (the decoder is freed for the morph), played again once the close has
// landed, and otherwise only while home shows in brief with the app active —
// never with Reduce Motion or Low Power Mode.
//
// The player is not trusted to be playing because it was told to: play is
// asked again when the item becomes ready and once more by a watchdog, a
// source that fails to load is retried from a file copied out by expo-asset,
// and what the player actually did is reported once per launch
// (`v2_home_video`) so a still background can be diagnosed without the device.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import * as Battery from 'expo-battery';
import { Asset } from 'expo-asset';
import { posthog } from '../../lib/analytics';

const VIDEO = require('../../../assets/v2/axiom-home-dreamcore.mp4');
const POSTER = require('../../../assets/v2/axiom-home-dreamcore-poster.jpg');
/** The file's aspect (720 × 1260, from the 768 × 1344 source). */
const ASPECT = 720 / 1260;
/** Horizontal focus: how much of the overflow is cut from the left. */
const FOCUS_X = 0.42;
/** The design frame and where the orb sits in the video in it (spec §1.2). */
const FRAME = { w: 402, h: 874 };
const ORB = { x: 110, y: 400, r: 44 };

const SCRIM = {
  colors: ['rgba(14,26,64,.38)', 'rgba(14,26,64,0)', 'rgba(20,16,24,0)', 'rgba(20,16,24,.55)', 'rgba(16,12,18,.86)', 'rgba(12,10,14,.94)'] as const,
  locations: [0, 0.16, 0.52, 0.7, 0.86, 1] as const,
};

/** The video's box on this screen: full height, width by aspect, cropped with the focus at 42 %. */
export function videoBox(W: number, H: number) {
  const width = H * ASPECT;
  return { width, height: H, left: (W - width) * FOCUS_X };
}

/**
 * Where the orb in the video is on this screen — the flight's start point.
 * Mapped through the same crop as the video, so it lands on the orb on any
 * aspect ratio, not just the design frame's.
 */
export function videoOrb(W: number, H: number) {
  const f = videoBox(FRAME.w, FRAME.h);
  const u = (ORB.x - f.left) / f.width;
  const v = ORB.y / FRAME.h;
  const b = videoBox(W, H);
  return { x: b.left + u * b.width, y: v * H, r: ORB.r * (H / FRAME.h) };
}

// ── The one player ───────────────────────────────────────────────────────────

interface Seen { status: string; error: string; firstFrame: boolean; retried: boolean; replays: number }
interface HomeVideoCtx { player: VideoPlayer; seen: React.MutableRefObject<Seen>; want: React.MutableRefObject<boolean> }
const Ctx = createContext<HomeVideoCtx | null>(null);

export function HomeVideoProvider({ children }: { children: React.ReactNode }) {
  const player = useVideoPlayer(VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    p.volume = 0;
    // Never interrupt the user's music or podcast.
    p.audioMixingMode = 'mixWithOthers';
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
  });
  const seen = useRef<Seen>({ status: 'idle', error: '', firstFrame: false, retried: false, replays: 0 });
  const want = useRef(false);

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

  const value = useMemo(() => ({ player, seen, want }), [player]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The home player, for pausing it the instant chat opens. Null outside the provider. */
export function useHomePlayer(): VideoPlayer | null {
  return useContext(Ctx)?.player ?? null;
}

// ── The layer ────────────────────────────────────────────────────────────────

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

class VideoBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn('[v2] home video failed; showing the poster', err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Anything but an explicit background / inactive counts as active: the state can be unknown for a moment at launch, and no change event follows if it was already active. */
const isActive = (s: string | null | undefined) => s !== 'background' && s !== 'inactive';
let reported = false;

interface Props { mode: 'brief' | 'chat'; progress: SharedValue<number>; homeVisible: boolean }

export const HomeVideo = React.memo(function HomeVideo(props: Props) {
  const { width: W, height: H } = useWindowDimensions();
  const box = videoBox(W, H);
  const s = W / FRAME.w;
  const p = props.progress;
  // The whole layer — poster, video, scrim — fades and lifts away as chat opens.
  const layer = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ translateY: -70 * s * p.value }, { scale: 1 + 0.06 * p.value }],
  }));
  const poster = <Image source={POSTER} style={[styles.media, box]} resizeMode="cover" />;
  const ctx = useContext(Ctx);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, layer]}>
      {poster}
      {ctx ? <VideoBoundary fallback={null}><Player {...props} ctx={ctx} box={box} /></VideoBoundary> : null}
      <LinearGradient colors={SCRIM.colors} locations={SCRIM.locations} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
});

function Player({ mode, progress, homeVisible, ctx, box }: Props & { ctx: HomeVideoCtx; box: ReturnType<typeof videoBox> }) {
  const { player, seen, want } = ctx;
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  const [appActive, setAppActive] = useState(isActive(AppState.currentState));
  useEffect(() => { const sub = AppState.addEventListener('change', (s) => setAppActive(isActive(s))); return () => sub.remove(); }, []);
  // Play again only once the close has landed (spec §2.5); the open pauses at once.
  const [settled, setSettled] = useState(true);
  useAnimatedReaction(() => progress.value <= 0.001, (now, prev) => { if (now !== prev) runOnJS(setSettled)(now); }, [progress]);

  const shouldPlay = homeVisible && mode === 'brief' && settled && appActive && !reduced && !lowPower;
  want.current = shouldPlay;

  useEffect(() => {
    try { if (shouldPlay) player.play(); else player.pause(); } catch { /* released */ }
  }, [shouldPlay, player]);

  // Watchdog: two seconds after it should be playing, check that it is.
  useEffect(() => {
    if (!shouldPlay) return;
    const t = setTimeout(() => {
      try { if (want.current && !player.playing) { seen.current.replays += 1; player.play(); } } catch { /* released */ }
    }, 2000);
    return () => clearTimeout(t);
  }, [shouldPlay, player]); // eslint-disable-line react-hooks/exhaustive-deps

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
          video: 'dreamcore',
        });
        void posthog.flush();
      } catch { /* analytics must never break home */ }
    }, 6000);
    return () => clearTimeout(t);
  }, [visible, player, lowPower, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poster until the first real frame, then 250 ms — never a black flash.
  const shown = useSharedValue(seen.current.firstFrame ? 1 : 0);
  const videoStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  if (reduced || lowPower) return null;
  return (
    <Animated.View style={[styles.media, box, videoStyle]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        // SurfaceView ignores parent opacity and transforms on Android.
        surfaceType="textureView"
        onFirstFrameRender={() => { seen.current.firstFrame = true; shown.value = withTiming(1, { duration: 250 }); }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  media: { position: 'absolute', top: 0 },
});
