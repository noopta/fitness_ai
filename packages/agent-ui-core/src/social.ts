// Social screens outside chat (design handoff Wave 4: S-01, S-02, A-02). The
// decisions they make — a post's body from what's attached, where research
// sits among posts, the square of a photo under the avatar circle — pure and tested.

/** One research item after every `every` posts; with fewer posts than that, up to two at the end. */
export function interleave<P, R>(posts: P[], research: R[], every: number): ({ kind: 'post'; data: P } | { kind: 'research'; data: R })[] {
  const out: ({ kind: 'post'; data: P } | { kind: 'research'; data: R })[] = [];
  let r = 0;
  posts.forEach((p, i) => { out.push({ kind: 'post', data: p }); if ((i + 1) % every === 0 && r < research.length) out.push({ kind: 'research', data: research[r++] }); });
  if (posts.length < every) for (let k = 0; k < 2 && r < research.length; k++) out.push({ kind: 'research', data: research[r++] });
  return out;
}

export type Attached = { kind: 'workout'; w: any } | { kind: 'meal'; m: any } | null;
const exercisesOf = (w: any): any[] => { const e = typeof w?.exercises === 'string' ? (() => { try { return JSON.parse(w.exercises); } catch { return []; } })() : w?.exercises; return Array.isArray(e) ? e : []; };

/** What a new post sends to /social/share. An attached workout posts with no caption. */
export function composeBody(text: string, attached: Attached, imageBase64: string | null, audience: 'friends' | 'public') {
  const caption = text.trim();
  const extra = { ...(imageBase64 ? { imageBase64 } : {}), ...(caption ? { text: caption } : {}) };
  if (attached?.kind === 'workout') {
    const w = attached.w;
    const ex = exercisesOf(w).map((e) => ({ name: e.name, sets: Number(e.sets) || 1, reps: String(e.reps ?? ''), weightKg: e.weightKg ?? null }));
    return { itemType: 'workout', payload: { title: w.title || 'Workout', durationMin: w.duration ?? null, exercises: ex, ...extra }, caption: caption || undefined, visibility: audience };
  }
  if (attached?.kind === 'meal') {
    const m = attached.m;
    return { itemType: 'meal', payload: { name: m.name ?? 'Meal', calories: Math.round(m.calories ?? 0), proteinG: Math.round(m.proteinG ?? 0), carbsG: Math.round(m.carbsG ?? 0), fatG: Math.round(m.fatG ?? 0), ...extra }, caption: caption || undefined, visibility: audience };
  }
  if (imageBase64) return { itemType: 'media', payload: extra, caption: caption || undefined, visibility: audience };
  return { itemType: 'text', payload: { text: caption }, visibility: audience };
}

/**
 * The square of an image under the avatar viewport, in image pixels (A-02).
 * Shown "cover" (shorter side fills the viewport) × `scale`, moved by (tx, ty)
 * from centre. Clamped inside the image.
 */
export function cropRect(img: { width: number; height: number }, viewport: number, scale: number, tx: number, ty: number) {
  const k = (viewport / Math.min(img.width, img.height)) * scale;
  const size = Math.min(img.width, img.height, viewport / k);
  const x = Math.max(0, Math.min(img.width - size, img.width / 2 + (-viewport / 2 - tx) / k));
  const y = Math.max(0, Math.min(img.height - size, img.height / 2 + (-viewport / 2 - ty) / k));
  return { originX: Math.round(x), originY: Math.round(y), width: Math.round(size), height: Math.round(size) };
}
