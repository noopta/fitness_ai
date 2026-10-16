import { Video, ExternalLink } from 'lucide-react';
import { safeHttpUrl } from '@/lib/safeUrl';

const YT_ID = '([A-Za-z0-9_-]{6,20})';

/** YouTube video id for an http(s) YouTube URL, else null. */
export function getYouTubeEmbedId(url: string): string | null {
  const safe = safeHttpUrl(url);
  if (!safe) return null;
  const patterns = [
    new RegExp(`^https?://(?:www\\.|m\\.)?youtube\\.com/watch\\?(?:.*&)?v=${YT_ID}`),
    new RegExp(`^https?://youtu\\.be/${YT_ID}`),
    new RegExp(`^https?://(?:www\\.)?youtube(?:-nocookie)?\\.com/(?:embed|shorts)/${YT_ID}`),
  ];
  for (const pat of patterns) {
    const m = safe.match(pat);
    if (m) return m[1];
  }
  return null;
}

/**
 * A shared post's video. YouTube → embedded player; any other http(s) URL →
 * external link; anything else (javascript:, data:, garbage) → plain text,
 * never a clickable href.
 */
export function FeedVideo({ videoUrl }: { videoUrl: string }) {
  const embedId = getYouTubeEmbedId(videoUrl);
  if (embedId) {
    return (
      <div className="rounded-xl overflow-hidden border aspect-video">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube.com/embed/${embedId}`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  const href = safeHttpUrl(videoUrl);
  if (!href) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm text-muted-foreground"
        data-testid="feed-video-text"
      >
        <Video className="h-4 w-4 shrink-0" />
        <span className="truncate">{videoUrl}</span>
      </div>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm text-primary hover:bg-muted/30 transition-colors"
    >
      <Video className="h-4 w-4 shrink-0" />
      <span className="truncate">{videoUrl}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 ml-auto" />
    </a>
  );
}
