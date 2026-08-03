/**
 * Feed author deduplication.
 *
 * Avatars are ~84 KB of base64 each and were serialized once per post AND
 * again for every comment author. Measured against prod on 2026-08-03 for a
 * pro user: a 35-item page carried 53 base64 blobs of which only 3 were
 * distinct — 3.45 MB of a 3.69 MB response was byte-identical duplicates,
 * which is what made every other tab hang behind it on the shared HTTP/2
 * connection.
 *
 * extractAuthors() hoists each distinct author into a lookup map and strips
 * avatarBase64 from the inline objects. These tests pin that contract.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.sharedItem = { findUnique: vi.fn(), findMany: vi.fn() };
    this.friendship = { findFirst: vi.fn(), findMany: vi.fn() };
    this.institutionMember = { findMany: vi.fn() };
    this.user = { update: vi.fn(), findUnique: vi.fn() };
    this.postReaction = { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() };
    this.postComment = { findMany: vi.fn(), create: vi.fn() };
    this.feedItem = { findMany: vi.fn() };
    this.userFeedView = { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn() };
  });
  return { PrismaClient };
});

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'user_1', email: 't@example.com', tier: 'free' };
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// social.ts -> feedService -> chatClient constructs an OpenAI client at import
// time, which throws without an API key. Stubbed the same way social.image
// does it, so this stays a pure unit test with no network dependency.
vi.mock('../services/feedService.js', () => ({
  getUserGoalTags: vi.fn(),
  getCachedFeedItems: vi.fn(),
  recordFeedViews: vi.fn(),
  maybeFetchFromSources: vi.fn(),
}));

vi.mock('../services/notificationService.js', () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));

const AVATAR_A = 'A'.repeat(84_000);
const AVATAR_B = 'B'.repeat(84_000);

let extractAuthors: (items: Array<{ kind: string; data: any }>) => Record<string, any>;

beforeAll(async () => {
  ({ extractAuthors } = await import('../routes/social.js'));
});

const post = (id: string, sharer: any, commentAuthors: any[] = []) => ({
  kind: 'post',
  data: {
    id,
    sharer: { ...sharer },
    comments: commentAuthors.map((a, i) => ({ id: `${id}-c${i}`, text: 'hi', author: { ...a } })),
  },
});

describe('extractAuthors — feed avatar deduplication', () => {
  const alice = { id: 'u_alice', name: 'Alice', username: 'alice', avatarBase64: AVATAR_A };
  const bob = { id: 'u_bob', name: 'Bob', username: 'bob', avatarBase64: AVATAR_B };

  it('collects each distinct author exactly once', () => {
    const items = [post('p1', alice, [bob, alice]), post('p2', bob, [alice])];
    const authors = extractAuthors(items);

    expect(Object.keys(authors).sort()).toEqual(['u_alice', 'u_bob']);
    expect(authors.u_alice.avatarBase64).toBe(AVATAR_A);
    expect(authors.u_bob.avatarBase64).toBe(AVATAR_B);
  });

  it('strips avatarBase64 from every inline author object', () => {
    const items = [post('p1', alice, [bob, alice])];
    extractAuthors(items);

    expect(items[0].data.sharer).not.toHaveProperty('avatarBase64');
    for (const c of items[0].data.comments) {
      expect(c.author).not.toHaveProperty('avatarBase64');
    }
  });

  it('keeps id/name/username inline so text renders without the map', () => {
    const items = [post('p1', alice)];
    extractAuthors(items);

    expect(items[0].data.sharer).toMatchObject({ id: 'u_alice', name: 'Alice', username: 'alice' });
  });

  it('actually removes the duplicate bytes', () => {
    // 6 sightings of 2 distinct avatars — the real-world shape, scaled down.
    const items = [
      post('p1', alice, [alice, bob]),
      post('p2', bob, [alice]),
      post('p3', alice),
    ];
    const before = JSON.stringify(items).length;
    const authors = extractAuthors(items);
    const after = JSON.stringify(items).length + JSON.stringify(authors).length;

    // 6 copies -> 2. Should shed roughly two-thirds of the payload.
    expect(after).toBeLessThan(before * 0.4);
  });

  it('recovers an avatar first seen on a row that omitted it', () => {
    const withoutAvatar = { id: 'u_alice', name: 'Alice', username: 'alice', avatarBase64: null };
    const items = [post('p1', withoutAvatar), post('p2', alice)];
    const authors = extractAuthors(items);

    expect(authors.u_alice.avatarBase64).toBe(AVATAR_A);
  });

  it('ignores research items and tolerates missing sharers/comments', () => {
    const items = [
      { kind: 'research', data: { title: 'Some paper', url: 'https://x' } },
      { kind: 'post', data: { id: 'p1' } },
      { kind: 'post', data: { id: 'p2', sharer: null, comments: null } },
    ];
    expect(() => extractAuthors(items)).not.toThrow();
    expect(extractAuthors(items)).toEqual({});
  });

  it('is a no-op for authors that never had an avatar', () => {
    const noAvatar = { id: 'u_carl', name: 'Carl', username: 'carl' };
    const items = [post('p1', noAvatar)];
    const authors = extractAuthors(items);

    expect(authors.u_carl).toMatchObject({ id: 'u_carl', avatarBase64: null });
  });
});
