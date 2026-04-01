import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface VideoData {
  videoId: string;
  title: string;
  thumbnail: string;
}

// Checks the Videos API (part=status) to find the first actually-embeddable video.
// The search endpoint's videoEmbeddable=true filter is unreliable — this is the authoritative check.
async function pickEmbeddable(
  items: Array<{ id: { videoId: string }; snippet: any }>,
  apiKey: string,
): Promise<{ id: string; snippet: any } | null> {
  if (items.length === 0) return null;
  const ids = items.map((i) => i.id.videoId).join(',');
  const url = `https://www.googleapis.com/youtube/v3/videos?part=status&id=${ids}&key=${apiKey}`;
  try {
    const res = await fetch(url);
    const data = await res.json() as any;
    const embeddableIds = new Set<string>(
      (data.items ?? []).filter((v: any) => v.status?.embeddable === true).map((v: any) => v.id),
    );
    const match = items.find((i) => embeddableIds.has(i.id.videoId));
    return match ? { id: match.id.videoId, snippet: match.snippet } : null;
  } catch {
    // If status check fails, fall back to first result
    return { id: items[0].id.videoId, snippet: items[0].snippet };
  }
}

async function searchYouTube(exerciseName: string, suffix: string, apiKey: string): Promise<VideoData | null> {
  const query = encodeURIComponent(`${exerciseName} ${suffix}`);
  // Fetch 5 candidates so pickEmbeddable has options to choose from
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&videoEmbeddable=true&maxResults=5&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json() as any;

  if (data.error) {
    const code = data.error.code;
    if (code === 403) {
      console.error('YouTube API quota exceeded or access forbidden:', data.error.message);
    } else {
      console.error('YouTube API error:', code, data.error.message);
    }
    return null;
  }

  if (!data.items || data.items.length === 0) return null;

  const item = await pickEmbeddable(data.items, apiKey);
  if (!item) return null;

  return {
    videoId: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
  };
}

export async function getExerciseVideo(exerciseId: string, exerciseName: string): Promise<VideoData | null> {
  // Check cache first
  const cached = await prisma.videoCache.findUnique({ where: { exerciseId } });
  if (cached) {
    const age = Date.now() - cached.fetchedAt.getTime();
    if (age < TTL_MS) {
      return { videoId: cached.videoId, title: cached.title, thumbnail: cached.thumbnail };
    }
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('YOUTUBE_API_KEY not set');
    return null;
  }

  try {
    // Primary search — specific query
    let video = await searchYouTube(exerciseName, 'exercise tutorial form', apiKey);

    // Fallback — simpler query if primary returns nothing embeddable
    if (!video) {
      video = await searchYouTube(exerciseName, 'exercise how to', apiKey);
    }

    if (!video) return null;

    // Upsert cache
    await prisma.videoCache.upsert({
      where: { exerciseId },
      create: { exerciseId, videoId: video.videoId, title: video.title, thumbnail: video.thumbnail },
      update: { videoId: video.videoId, title: video.title, thumbnail: video.thumbnail, fetchedAt: new Date() }
    });

    return video;
  } catch (err) {
    console.error('YouTube fetch error:', err);
    return null;
  }
}
