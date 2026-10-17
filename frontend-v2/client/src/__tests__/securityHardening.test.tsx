/**
 * 2026-10 security/compliance audit — web client hardening:
 *   - shared-post videoUrl renders as a link only for http(s)
 *   - analytics consent banner + PostHog opt-out-by-default / masking
 *   - markdown renderers drop images/embeds and unsafe link schemes
 *   - coach chat 403 pro_required / 503 limit_unavailable + citation disclaimer
 *   - homepage footer carries the MHMDA Consumer Health Data link
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('wouter', () => ({
  Link: ({ href, children, className, onClick, ...rest }: any) => (
    <a href={href} className={className} onClick={onClick} data-testid={rest['data-testid']}>{children}</a>
  ),
}));

const ph = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  has_opted_in_capturing: vi.fn(() => false),
  has_opted_out_capturing: vi.fn(() => false),
}));
vi.mock('posthog-js', () => ({ default: ph, posthog: ph }));
vi.mock('posthog-js/dist/recorder', () => ({}));

import { FeedVideo, getYouTubeEmbedId } from '@/components/FeedVideo';
import { safeHttpUrl, markdownUrlTransform } from '@/lib/safeUrl';
import { ConsentBanner } from '@/components/ConsentBanner';
import { ANALYTICS_CONSENT_KEY, identifyUser } from '@/lib/analytics';
import { CoachMarkdown } from '@/components/CoachMarkdown';
import { BlogMarkdown } from '@/components/BlogMarkdown';
import { CoachSources } from '@/components/CoachSources';
import { SiteFooter } from '@/components/landing/SiteFooter';
import { streamCoachChat, CoachChatError, coachChatErrorMessage } from '@/lib/api';

// ─── videoUrl rendering ───────────────────────────────────────────────────────

describe('FeedVideo', () => {
  // (Not rendered: happy-dom would really fetch the iframe src.)
  it('recognises YouTube URLs for embedding', () => {
    expect(getYouTubeEmbedId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getYouTubeEmbedId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('renders other http(s) URLs as a noopener link', () => {
    const { container } = render(<FeedVideo videoUrl="https://vimeo.com/123" />);
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://vimeo.com/123');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:x', '//evil.com', 'not a url'])(
    'never renders %s as a link',
    (url) => {
      const { container } = render(<FeedVideo videoUrl={url} />);
      expect(container.querySelector('a')).toBeNull();
      expect(container.querySelector('iframe')).toBeNull();
      expect(screen.getByTestId('feed-video-text').textContent).toContain(url);
    },
  );

  it('does not extract embed ids from non-http URLs', () => {
    expect(getYouTubeEmbedId('javascript://youtube.com/watch?v=abcdefg')).toBeNull();
  });

  it('safeHttpUrl / markdownUrlTransform allow-lists schemes', () => {
    expect(safeHttpUrl('https://a.b/c')).toBe('https://a.b/c');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(markdownUrlTransform('mailto:hi@x.io')).toBe('mailto:hi@x.io');
    expect(markdownUrlTransform('/settings')).toBe('/settings');
    expect(markdownUrlTransform('javascript:alert(1)')).toBe('');
    expect(markdownUrlTransform('data:text/html,x')).toBe('');
  });
});

// ─── consent banner + analytics ───────────────────────────────────────────────

describe('analytics consent', () => {
  beforeEach(() => {
    localStorage.clear();
    ph.opt_in_capturing.mockClear();
    ph.opt_out_capturing.mockClear();
  });

  it('PostHog starts opted out with full session-replay masking', () => {
    const cfg = ph.init.mock.calls[0]?.[1];
    expect(cfg.opt_out_capturing_by_default).toBe(true);
    expect(cfg.session_recording).toMatchObject({ maskAllInputs: true, maskTextSelector: '*' });
    expect(cfg.disable_external_dependency_loading).toBe(true);
  });

  it('identify sends the opaque id only — no name or email', () => {
    identifyUser('user-1', { tier: 'pro', name: 'Jane', email: 'j@x.io' } as any);
    expect(ph.identify).toHaveBeenLastCalledWith('user-1', { tier: 'pro' });
  });

  it('shows the banner until a choice is made; Accept opts in', () => {
    render(<ConsentBanner />);
    expect(screen.getByTestId('consent-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /accept analytics/i }));
    expect(ph.opt_in_capturing).toHaveBeenCalled();
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe('granted');
    expect(screen.queryByTestId('consent-banner')).toBeNull();
  });

  it('"Essential only" keeps capture off', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole('button', { name: /essential only/i }));
    expect(ph.opt_in_capturing).not.toHaveBeenCalled();
    expect(ph.opt_out_capturing).toHaveBeenCalled();
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe('denied');
  });

  it('stays hidden once the visitor has chosen', () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'denied');
    render(<ConsentBanner />);
    expect(screen.queryByTestId('consent-banner')).toBeNull();
  });
});

// ─── markdown hardening ───────────────────────────────────────────────────────

describe('markdown hardening', () => {
  const evil = [
    '[click](javascript:alert(1))',
    '![pixel](https://tracker.example/p.gif)',
    '<script>alert(1)</script>',
    '<iframe src="https://evil.example"></iframe>',
    '[ok](https://example.com)',
  ].join('\n\n');

  it('CoachMarkdown drops images, raw HTML and javascript: links', () => {
    const { container } = render(<CoachMarkdown content={evil} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.toLowerCase().startsWith('javascript'))).toBe(false);
    const ok = Array.from(container.querySelectorAll('a')).find((a) => a.getAttribute('href') === 'https://example.com')!;
    expect(ok.getAttribute('rel')).toContain('noopener');
    expect(ok.getAttribute('target')).toBe('_blank');
  });

  it('BlogMarkdown blocks raw HTML and unsafe links (images allowed for posts)', () => {
    const { container } = render(<BlogMarkdown content={evil} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.toLowerCase().startsWith('javascript'))).toBe(false);
  });
});

// ─── coach chat errors + citations ────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sseResponse(lines: string[]): Response {
  return new Response(lines.map((l) => `data: ${l}\n\n`).join(''), { status: 200 });
}

describe('coach chat send path', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('403 pro_required → CoachChatError with upgrade copy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(403, { error: 'Chat with Anakin is a Pro feature', upgrade: true, code: 'pro_required' }),
    );
    const err = await streamCoachChat({ message: 'hi', onChunk: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(CoachChatError);
    expect(err.proRequired).toBe(true);
    expect(coachChatErrorMessage(err)).toMatch(/Pro feature/);
  });

  it('503 limit_unavailable → retry message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(503, { error: 'Anakin is busy right now.', code: 'limit_unavailable' }),
    );
    const err = await streamCoachChat({ message: 'hi', onChunk: () => {} }).catch((e) => e);
    expect(err.limitUnavailable).toBe(true);
    expect(err.proRequired).toBe(false);
    expect(coachChatErrorMessage(err)).toMatch(/try again/i);
  });

  it('passes stream citations and their disclaimer through', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        JSON.stringify({ chunk: 'Hello' }),
        JSON.stringify({ references: [{ speaker: 'Dr. X', episode: 'Ep 1', url: 'https://youtu.be/abc' }], disclaimer: 'Not affiliated.' }),
        '[DONE]',
      ]),
    );
    const chunks: string[] = [];
    const onReferences = vi.fn();
    await streamCoachChat({ message: 'hi', onChunk: (c) => chunks.push(c), onReferences });
    expect(chunks.join('')).toBe('Hello');
    expect(onReferences).toHaveBeenCalledWith([{ speaker: 'Dr. X', episode: 'Ep 1', url: 'https://youtu.be/abc' }], 'Not affiliated.');
  });

  it('CoachSources renders the disclaimer and only http(s) source links', () => {
    const { container } = render(
      <CoachSources
        references={[{ speaker: 'A', episode: 'E', url: 'https://youtu.be/x' }, { speaker: 'B', url: 'javascript:alert(1)' }]}
        disclaimer="Not affiliated."
      />,
    );
    expect(screen.getByTestId('coach-sources-disclaimer').textContent).toBe('Not affiliated.');
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://youtu.be/x']);
  });
});

// ─── homepage footer ──────────────────────────────────────────────────────────

describe('SiteFooter', () => {
  it('links Privacy, Terms, Consumer Health Data Privacy Policy and Accessibility', () => {
    const { container } = render(<SiteFooter />);
    const health = container.querySelector('a[href="/health-data"]')!;
    expect(health.textContent).toBe('Consumer Health Data Privacy Policy');
    for (const href of ['/privacy', '/terms', '/accessibility']) {
      expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });
});
