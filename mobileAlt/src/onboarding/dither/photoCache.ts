import { Skia, type SkImage } from '@shopify/react-native-skia';
import { Asset } from 'expo-asset';

// Decoded-image cache keyed by the require()'d asset module id. The pager mounts
// only the active scene (and remounts it on every arrival), so without this each
// photo re-decodes on navigation — you see the deep-wash + accent bloom first,
// then the dithered photo pops in. Preloading every photo once, up front, makes
// useImage resolve instantly so the scene paints complete on its first frame.
const cache = new Map<number, SkImage>();

/** Synchronous lookup for an already-decoded photo (null if not preloaded yet). */
export function getCachedPhoto(source: number | null | undefined): SkImage | null {
  if (source == null) return null;
  return cache.get(source) ?? null;
}

/** Decode + cache all photos. Safe to call repeatedly; already-cached ids skip. */
export async function preloadPhotos(sources: Array<number>): Promise<void> {
  await Promise.all(
    sources.map(async (src) => {
      if (cache.has(src)) return;
      try {
        const asset = Asset.fromModule(src);
        if (!asset.downloaded) await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        if (!uri) return;
        const data = await Skia.Data.fromURI(uri);
        const img = Skia.Image.MakeImageFromEncoded(data);
        if (img) cache.set(src, img);
      } catch {
        // Non-fatal: DitherImage falls back to its own async useImage decode.
      }
    }),
  );
}
