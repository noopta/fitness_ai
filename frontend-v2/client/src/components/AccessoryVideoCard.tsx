import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface VideoData {
  videoId: string;
  title: string;
  thumbnail: string;
}

interface AccessoryVideoCardProps {
  exerciseId: string;
  exerciseName: string;
}

export function AccessoryVideoCard({ exerciseId, exerciseName }: AccessoryVideoCardProps) {
  const [video, setVideo] = useState<VideoData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fetched = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !fetched.current) {
          fetched.current = true;
          setLoading(true);
          fetch(`${API_BASE}/exercises/${exerciseId}/video`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?.videoId) setVideo(data); })
            .catch(() => {})
            .finally(() => setLoading(false));
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [exerciseId]);

  if (loading) {
    return (
      <div ref={ref} className="mt-2 h-24 rounded-xl bg-muted animate-pulse" />
    );
  }

  if (!video) return <div ref={ref} />;

  return (
    <div ref={ref} className="mt-2">
      {expanded ? (
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
          onClick={() => setExpanded(true)}
          className="relative w-full rounded-xl overflow-hidden group"
          aria-label={`Watch ${exerciseName} video`}
        >
          <img
            src={video.thumbnail}
            alt={video.title}
            className="w-full h-24 object-cover"
          />
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/50 transition-colors">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-white/90">
              <Play className="h-5 w-5 text-black fill-black ml-0.5" />
            </div>
          </div>
          <div className="absolute bottom-1.5 left-2 right-2 text-white text-xs font-medium truncate drop-shadow">
            {video.title}
          </div>
        </button>
      )}
    </div>
  );
}
