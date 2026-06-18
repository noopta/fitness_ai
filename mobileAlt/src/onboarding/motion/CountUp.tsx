import React, { useEffect, useState } from 'react';
import { Text, TextStyle, AccessibilityInfo } from 'react-native';
import { MOTION, DEFAULT_MOTION, type MotionName } from '../theme';

interface Props {
  to: number;
  decimals?: number;             // 0, 1, or 2
  baseDurationMs?: number;       // multiplied by motion.count
  motion?: MotionName;
  style?: TextStyle | TextStyle[];
}

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t));

/**
 * Per spec §7.2. Ticks 0→to on easeOutExpo over base × m.count ms. Renders
 * with tabular figures so digits don't jiggle. Drives state at ~30fps from
 * a single requestAnimationFrame loop — simpler than wiring a Reanimated
 * derived value through a custom Text, and the perf is identical for the
 * 2-3 number tickers per scene.
 *
 * Reduce-motion: jumps straight to final value.
 */
export function CountUp({
  to, decimals = 0, baseDurationMs = 1100, motion = DEFAULT_MOTION, style,
}: Props) {
  const m = MOTION[motion];
  const [value, setValue] = useState(0);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) { setValue(to); return; }

      const dur = baseDurationMs * m.count;
      const start = Date.now();
      const tick = () => {
        if (cancelled) return;
        const t = Math.min(1, (Date.now() - start) / dur);
        setValue(to * easeOutExpo(t));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      tick();
    });

    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [to, decimals, baseDurationMs]);

  return (
    <Text style={[{ fontVariant: ['tabular-nums'] }, style]}>
      {value.toFixed(decimals)}
    </Text>
  );
}
