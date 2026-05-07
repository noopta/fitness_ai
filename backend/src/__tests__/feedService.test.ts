import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted before any module-level code runs, so we
// build the mocks inside and re-export references for the test body to use.
vi.mock('@prisma/client', () => {
  const feedItem = { findMany: vi.fn() };
  const userFeedView = { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn() };
  const PrismaClient = vi.fn(function (this: any) {
    this.feedItem = feedItem;
    this.userFeedView = userFeedView;
  });
  return { PrismaClient, __mocks: { feedItem, userFeedView } };
});

vi.mock('openai', () => ({ default: vi.fn(function (this: any) {}) }));

import { getFeedItemsForTags, recordFeedViews, invalidateResearchCache, getCachedFeedItems } from '../services/feedService.js';
import * as prismaMod from '@prisma/client';
const { feedItem: feedItemMock, userFeedView: userFeedViewMock } = (prismaMod as any).__mocks;

function makeItem(id: string, tags: string[], fetchedAt = new Date()) {
  return {
    id,
    externalId: `ext:${id}`,
    type: 'research',
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    url: `https://example.com/${id}`,
    source: 'PubMed',
    tags: JSON.stringify(tags),
    publishedAt: null,
    fetchedAt,
  };
}

beforeEach(() => {
  feedItemMock.findMany.mockReset();
  userFeedViewMock.findMany.mockReset();
  userFeedViewMock.createMany.mockReset();
  userFeedViewMock.create.mockReset();
  invalidateResearchCache();
});

describe('getFeedItemsForTags', () => {
  it('returns top items by tag overlap when no user is provided', async () => {
    feedItemMock.findMany.mockResolvedValue([
      makeItem('a', ['strength']),
      makeItem('b', ['nutrition']),
      makeItem('c', ['strength', 'hypertrophy']),
    ]);

    const result = await getFeedItemsForTags(['strength'], 2);
    expect(result.items).toHaveLength(2);
    // 'c' (overlap=1) and 'a' (overlap=1) tied; 'b' (overlap=0) excluded
    expect(result.items.map(i => i.id)).toContain('a');
    expect(result.items.map(i => i.id)).toContain('c');
    expect(result.exhausted).toBe(false);
  });

  it('regression: excludes items the user has already viewed', async () => {
    // This is the pull-to-refresh bug: every refresh used to return the same
    // top items. Now we filter by userFeedView.
    feedItemMock.findMany.mockResolvedValue([
      makeItem('a', ['strength']),
      makeItem('b', ['strength']),
      makeItem('c', ['strength']),
    ]);
    userFeedViewMock.findMany.mockResolvedValue([
      { feedItemId: 'a' },
      { feedItemId: 'b' },
    ]);

    const result = await getFeedItemsForTags(['strength'], 10, {
      excludeSeenForUserId: 'user_1',
    });
    expect(result.items.map(i => i.id)).toEqual(['c']);
    expect(result.exhausted).toBe(true); // wanted 10 but only 1 unseen
  });

  it('falls back to seen items when allowSeenFallback is on and pool exhausted', async () => {
    feedItemMock.findMany.mockResolvedValue([
      makeItem('a', ['strength']),
      makeItem('b', ['strength']),
    ]);
    userFeedViewMock.findMany.mockResolvedValue([
      { feedItemId: 'a' },
      { feedItemId: 'b' },
    ]);

    const result = await getFeedItemsForTags(['strength'], 5, {
      excludeSeenForUserId: 'user_1',
      allowSeenFallback: true,
    });
    expect(result.items).toHaveLength(2);
    expect(result.exhausted).toBe(true);
  });

  it('returns empty array when nothing matches and no fallback', async () => {
    feedItemMock.findMany.mockResolvedValue([
      makeItem('a', ['strength']),
    ]);
    userFeedViewMock.findMany.mockResolvedValue([{ feedItemId: 'a' }]);

    const result = await getFeedItemsForTags(['strength'], 10, {
      excludeSeenForUserId: 'user_1',
    });
    expect(result.items).toHaveLength(0);
    expect(result.exhausted).toBe(true);
  });
});

describe('recordFeedViews', () => {
  it('uses createMany for batch inserts', async () => {
    userFeedViewMock.createMany.mockResolvedValue({ count: 2 });
    await recordFeedViews('user_1', ['a', 'b']);
    expect(userFeedViewMock.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user_1', feedItemId: 'a' },
        { userId: 'user_1', feedItemId: 'b' },
      ],
    });
  });

  it('falls back to per-item create when createMany rejects (e.g. SQLite duplicate)', async () => {
    userFeedViewMock.createMany.mockRejectedValue(new Error('unique violation'));
    userFeedViewMock.create.mockResolvedValue({});
    await recordFeedViews('user_1', ['a', 'b']);
    expect(userFeedViewMock.create).toHaveBeenCalledTimes(2);
  });

  it('no-ops on empty input', async () => {
    await recordFeedViews('user_1', []);
    expect(userFeedViewMock.createMany).not.toHaveBeenCalled();
  });
});

describe('getCachedFeedItems', () => {
  it('uses different cache keys for excludeSeen vs not', async () => {
    feedItemMock.findMany.mockResolvedValue([makeItem('a', ['strength'])]);
    userFeedViewMock.findMany.mockResolvedValue([]);

    await getCachedFeedItems('u', ['strength'], 10, { excludeSeen: true });
    await getCachedFeedItems('u', ['strength'], 10, { excludeSeen: false });
    // Cache miss → DB hit twice
    expect(feedItemMock.findMany).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh bypasses cache', async () => {
    feedItemMock.findMany.mockResolvedValue([makeItem('a', ['strength'])]);
    userFeedViewMock.findMany.mockResolvedValue([]);

    await getCachedFeedItems('u', ['strength'], 10, { excludeSeen: true });
    await getCachedFeedItems('u', ['strength'], 10, { excludeSeen: true });
    // Second call hits cache
    expect(feedItemMock.findMany).toHaveBeenCalledTimes(1);

    await getCachedFeedItems('u', ['strength'], 10, { excludeSeen: true, forceRefresh: true });
    expect(feedItemMock.findMany).toHaveBeenCalledTimes(2);
  });
});
