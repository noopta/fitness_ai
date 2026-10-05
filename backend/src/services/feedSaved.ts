// Feed · Saved and Search (RN spec bug fixes, 5 Oct 2026 — 3c/3d). Pure
// shaping for saved posts, saved articles and post search; social.ts loads
// the rows.

export type SavedKind = 'workout' | 'post' | 'article';

export interface SavedRow {
  kind: SavedKind;
  /** The post id (workouts, posts) or feed item id (articles). */
  id: string;
  /** "Workout · Sam" / "Post · Sam" / "Article · PubMed" */
  eyebrow: string;
  title: string;
  savedAt: string;
  url?: string | null;
}

const parse = (p: unknown): any => {
  if (p && typeof p === 'object') return p;
  try { return JSON.parse(String(p ?? '{}')); } catch { return {}; }
};

/** A post is a workout when it carries exercises (a logged session shared to the feed). */
export function isWorkoutPost(item: { itemType: string; payload: unknown }): boolean {
  if (item.itemType === 'workout') return true;
  const p = parse(item.payload);
  return Array.isArray(p?.exercises) && p.exercises.length > 0;
}

const authorName = (u: { name?: string | null; username?: string | null } | null | undefined) => u?.name || (u?.username ? `@${u.username}` : 'Someone');

/** The line a saved post reads as: its title, else its caption or text, else what it is. */
export function postTitle(item: { itemType: string; payload: unknown; caption?: string | null }): string {
  const p = parse(item.payload);
  const text = String(p?.title ?? item.caption ?? p?.text ?? '').trim();
  if (text) return text.length > 80 ? `${text.slice(0, 79).trim()}…` : text;
  if (isWorkoutPost(item)) return `${p.exercises.length} exercise${p.exercises.length === 1 ? '' : 's'}`;
  return item.itemType === 'media' ? 'Photo' : 'Post';
}

export function savedPostRow(save: { savedAt: Date; post: { id: string; itemType: string; payload: unknown; caption?: string | null; sharer?: { name?: string | null; username?: string | null } | null } }): SavedRow {
  const workout = isWorkoutPost(save.post);
  return {
    kind: workout ? 'workout' : 'post',
    id: save.post.id,
    eyebrow: `${workout ? 'Workout' : 'Post'} · ${authorName(save.post.sharer)}`,
    title: postTitle(save.post),
    savedAt: save.savedAt.toISOString(),
  };
}

export function savedArticleRow(save: { savedAt: Date; feedItem: { id: string; title: string; source?: string | null; url?: string | null } }): SavedRow {
  return {
    kind: 'article', id: save.feedItem.id,
    eyebrow: `Article · ${save.feedItem.source || 'Research'}`,
    title: save.feedItem.title,
    savedAt: save.savedAt.toISOString(),
    url: save.feedItem.url ?? null,
  };
}

/** Newest first; `type` narrows to one kind ('all' keeps everything). */
export function mergeSaved(rows: SavedRow[], type: 'all' | 'workouts' | 'posts' | 'articles' = 'all'): SavedRow[] {
  const want: Record<string, SavedKind | null> = { all: null, workouts: 'workout', posts: 'post', articles: 'article' };
  const k = want[type] ?? null;
  return rows.filter((r) => !k || r.kind === k).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Does a post match a search? Caption, text, title and exercise names, case-insensitive. */
export function postMatches(item: { payload: unknown; caption?: string | null }, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  const p = parse(item.payload);
  const hay = [item.caption, p?.text, p?.title, ...(Array.isArray(p?.exercises) ? p.exercises.map((e: any) => e?.name) : [])]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}
