/**
 * Blog: founder posts from the API merge ahead of the static guides, the
 * "Write" affordance is admin-only, and the dynamic post page 404s on
 * unknown slugs instead of rendering an empty article.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const mockParams = vi.fn(() => ({ slug: 'launch-week' }));
vi.mock('wouter', () => ({
  Link: ({ href, children, className }: any) => <a href={href} className={className}>{children}</a>,
  useLocation: () => ['/blog', vi.fn()],
  useParams: () => mockParams(),
}));

vi.mock('@/components/Navbar', () => ({ Navbar: () => <nav data-testid="navbar" /> }));
vi.mock('@/components/SEO', () => ({ SEO: () => null }));

const api = vi.hoisted(() => ({
  listPublishedPosts: vi.fn(),
  getPublishedPost: vi.fn(),
}));
vi.mock('@/lib/blogApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/blogApi')>();
  return { ...real, listPublishedPosts: api.listPublishedPosts, getPublishedPost: api.getPublishedPost };
});

import BlogIndexPage, { mergePosts } from '@/pages/blog/index';
import BlogDynamicPostPage from '@/pages/blog/post';
import { slugify } from '@/lib/blogApi';

const POST = {
  id: 'p1', slug: 'launch-week', title: 'Launch week', excerpt: 'We shipped.', category: 'Update',
  published: true, publishedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-08-30T00:00:00.000Z', readingMinutes: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: null, loading: false });
});

describe('mergePosts', () => {
  it('puts founder posts first, newest first, and never duplicates a static slug', () => {
    const statics = [{ slug: 'squat-depth-guide', title: 'Squat', excerpt: '', readingMinutes: 5, category: 'Squat' }];
    const older = { ...POST, id: 'p0', slug: 'older', publishedAt: '2026-08-01T00:00:00.000Z' };
    const clash = { ...POST, id: 'p2', slug: 'squat-depth-guide' };
    const out = mergePosts([older, POST, clash], statics);
    expect(out.map(c => c.slug)).toEqual(['launch-week', 'older', 'squat-depth-guide']);
    expect(out[0].date).toMatch(/Sep 1, 2026/);
  });
});

describe('client slugify matches server rules', () => {
  it('normalises the same way', () => {
    expect(slugify('Hello, World! v2')).toBe('hello-world-v2');
    expect(slugify('!!!')).toBe('');
  });
});

describe('BlogIndexPage', () => {
  it('renders API posts above the static guides and hides Write for non-admins', async () => {
    api.listPublishedPosts.mockResolvedValue([POST]);
    render(<BlogIndexPage />);
    await waitFor(() => expect(screen.getByText('Launch week')).toBeInTheDocument());
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(headings[0]).toBe('Launch week');
    expect(headings).toContain('How to Break a Bench Press Plateau');
    expect(screen.queryByText(/^Write$/)).not.toBeInTheDocument();
  });

  it('still renders the static guides when the API is down', async () => {
    api.listPublishedPosts.mockRejectedValue(new Error('boom'));
    render(<BlogIndexPage />);
    expect(await screen.findByText('How to Break a Bench Press Plateau')).toBeInTheDocument();
  });

  it('shows the Write link to the admin', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u0', isAdmin: true }, loading: false });
    api.listPublishedPosts.mockResolvedValue([]);
    render(<BlogIndexPage />);
    expect(await screen.findByText(/Write/)).toHaveAttribute('href', '/admin/blog');
  });
});

describe('BlogDynamicPostPage', () => {
  it('renders the post body as markdown', async () => {
    api.getPublishedPost.mockResolvedValue({ ...POST, content: '## What shipped\n\n**Bold** text' });
    render(<BlogDynamicPostPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Launch week' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'What shipped' })).toBeInTheDocument();
    expect(screen.getByText('Bold').tagName).toBe('STRONG');
    expect(api.getPublishedPost).toHaveBeenCalledWith('launch-week');
  });

  it('404s on an unknown or unpublished slug', async () => {
    api.getPublishedPost.mockResolvedValue(null);
    render(<BlogDynamicPostPage />);
    expect(await screen.findByText(/404 page not found/i)).toBeInTheDocument();
  });
});
