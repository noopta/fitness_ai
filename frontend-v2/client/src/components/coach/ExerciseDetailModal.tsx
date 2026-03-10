import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Loader2, Info, Dumbbell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface VideoData {
  videoId: string;
  title: string;
  thumbnail: string;
}

export interface ExerciseDetail {
  exercise: string;
  sets: number;
  reps: string;
  intensity: string;
  notes?: string;
}

interface Props {
  exercise: ExerciseDetail;
  onClose: () => void;
}

const INTENSITY_COLOR: Record<string, string> = {
  heavy: 'bg-red-500/15 text-red-600 dark:text-red-400',
  moderate: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  light: 'bg-green-500/15 text-green-600 dark:text-green-400',
  'rpe 9': 'bg-red-500/15 text-red-600',
  'rpe 8': 'bg-amber-500/15 text-amber-600',
  'rpe 7': 'bg-green-500/15 text-green-600',
};

function intensityColor(intensity: string) {
  const key = intensity.toLowerCase();
  for (const [k, v] of Object.entries(INTENSITY_COLOR)) {
    if (key.includes(k)) return v;
  }
  return 'bg-muted text-muted-foreground';
}

export function ExerciseDetailModal({ exercise, onClose }: Props) {
  const [video, setVideo] = useState<VideoData | null>(null);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoExpanded, setVideoExpanded] = useState(false);

  useEffect(() => {
    const name = encodeURIComponent(exercise.exercise);
    authFetch(`${API_BASE}/coach/exercise-video?name=${name}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.videoId) setVideo(d); })
      .catch(() => {})
      .finally(() => setVideoLoading(false));
  }, [exercise.exercise]);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <motion.div
          className="absolute inset-0 bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          className="relative bg-background w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl z-10 overflow-hidden"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-5 pb-3">
            <div className="flex items-center gap-2">
              <Dumbbell className="h-5 w-5 text-primary shrink-0" />
              <h3 className="font-bold text-lg leading-tight">{exercise.exercise}</h3>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 hover:bg-muted transition-colors ml-2 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2 px-5 pb-4">
            <Badge variant="secondary" className="text-sm font-semibold">
              {exercise.sets} sets × {exercise.reps} reps
            </Badge>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${intensityColor(exercise.intensity)}`}>
              {exercise.intensity}
            </span>
          </div>

          {/* Notes */}
          {exercise.notes && (
            <div className="mx-5 mb-4 rounded-xl bg-muted/60 px-4 py-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">{exercise.notes}</p>
            </div>
          )}

          {/* Video section */}
          <div className="px-5 pb-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Tutorial Video</p>
            {videoLoading && (
              <div className="h-36 rounded-xl bg-muted animate-pulse flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!videoLoading && !video && (
              <div className="h-28 rounded-xl bg-muted/50 border flex flex-col items-center justify-center gap-1 text-muted-foreground">
                <Play className="h-6 w-6 opacity-40" />
                <p className="text-xs">No video available</p>
              </div>
            )}

            {!videoLoading && video && (
              videoExpanded ? (
                <div className="relative rounded-xl overflow-hidden aspect-video">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1`}
                    title={video.title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <button
                  onClick={() => setVideoExpanded(true)}
                  className="relative w-full rounded-xl overflow-hidden group"
                  aria-label={`Watch ${exercise.exercise} tutorial`}
                >
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    className="w-full h-36 object-cover"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                    <div className="grid h-12 w-12 place-items-center rounded-full bg-white/90">
                      <Play className="h-6 w-6 text-black fill-black ml-0.5" />
                    </div>
                  </div>
                  <div className="absolute bottom-2 left-3 right-3 text-white text-xs font-medium truncate drop-shadow">
                    {video.title}
                  </div>
                </button>
              )
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
