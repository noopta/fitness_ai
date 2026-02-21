import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface VideoData {
  videoId: string;
  title: string;
  thumbnail: string;
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
    const query = encodeURIComponent(`${exerciseName} exercise tutorial form`);
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=1&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json() as any;

    if (!data.items || data.items.length === 0) return null;

    const item = data.items[0];
    const videoId = item.id.videoId;
    const title = item.snippet.title;
    const thumbnail = item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '';

    // Upsert cache
    await prisma.videoCache.upsert({
      where: { exerciseId },
      create: { exerciseId, videoId, title, thumbnail },
      update: { videoId, title, thumbnail, fetchedAt: new Date() }
    });

    return { videoId, title, thumbnail };
  } catch (err) {
    console.error('YouTube fetch error:', err);
    return null;
  }
}
