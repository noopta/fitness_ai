// ProteinCelebration (web) — a small confetti + badge burst shown once when
// the user logs a day that hits their protein goal. Pure framer-motion (already
// a dependency), no extra packages. Renders a non-interactive fixed overlay
// that auto-dismisses.

import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const CONFETTI_COUNT = 32;
const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a78bfa'];
const DURATION_MS = 2200;

interface Props {
  show: boolean;
  onDone: () => void;
  label?: string;
}

export function ProteinCelebration({ show, onDone, label = 'Protein goal hit 💪' }: Props) {
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, () => ({
        left: Math.random() * 100,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: 6 + Math.random() * 8,
        delay: Math.random() * 0.35,
        drift: (Math.random() - 0.5) * 160,
        rotate: (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 540),
        duration: 1.6 + Math.random() * 0.8,
      })),
    // Re-roll each time the celebration is shown.
    [show],
  );

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(t);
  }, [show, onDone]);

  return (
    <AnimatePresence>
      {show && (
        <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
          {pieces.map((p, i) => (
            <motion.div
              key={i}
              initial={{ y: '-10vh', x: 0, opacity: 0, rotate: 0 }}
              animate={{ y: '110vh', x: p.drift, opacity: [0, 1, 1, 0], rotate: p.rotate }}
              transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
              style={{
                position: 'absolute',
                left: `${p.left}%`,
                top: 0,
                width: p.size,
                height: p.size * 0.5,
                borderRadius: 1,
                backgroundColor: p.color,
              }}
            />
          ))}
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: [0.6, 1.05, 1], opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.8, times: [0, 0.2, 0.7, 1], ease: 'easeOut' }}
              className="rounded-full bg-zinc-900 px-6 py-3 text-lg font-bold text-white shadow-xl"
            >
              {label}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
