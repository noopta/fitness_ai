/**
 * Legal pages (2026-10 audit): each policy renders with its title and the
 * shared "Last updated" date, links to the companion policies, and leaves
 * unknown facts as visible [PLACEHOLDERS] rather than invented values.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('wouter', () => ({
  Link: ({ href, children, className }: any) => <a href={href} className={className}>{children}</a>,
}));
vi.mock('@/components/Navbar', () => ({ Navbar: () => <nav data-testid="navbar" /> }));
vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => null }));

import Privacy from '@/pages/privacy';
import Terms from '@/pages/terms';
import HealthData from '@/pages/health-data';
import TrainerTerms from '@/pages/trainer-terms';
import AffiliateTerms from '@/pages/affiliate-terms';
import Accessibility from '@/pages/accessibility';

const PAGES: Array<[string, () => JSX.Element, string]> = [
  ['privacy', Privacy, 'Privacy Policy'],
  ['terms', Terms, 'Terms of Service'],
  ['health-data', HealthData, 'Consumer Health Data Privacy Policy'],
  ['trainer-terms', TrainerTerms, 'Trainer Terms'],
  ['affiliate-terms', AffiliateTerms, 'Affiliate Terms'],
  ['accessibility', Accessibility, 'Accessibility Statement'],
];

describe('legal pages', () => {
  it.each(PAGES)('%s renders title, date and placeholders', (_slug, Page, title) => {
    const { container, unmount } = render(<Page />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(title);
    expect(container.textContent).toContain('Last updated: 16 October 2026');
    expect(container.textContent).toContain('[POSTAL ADDRESS]');
    // Footer always carries the MHMDA link.
    expect(container.querySelector('a[href="/health-data"]')).not.toBeNull();
    unmount();
  });

  it('privacy names every processor and the accurate retention facts', () => {
    const { container } = render(<Privacy />);
    const t = container.textContent ?? '';
    for (const p of ['Anthropic', 'OpenAI', 'OpenRouter', 'Google Cloud', 'Stripe', 'SendGrid', 'Twilio', 'PostHog', 'Sentry', 'Expo', 'Cloudflare', 'Open Food Facts', 'USDA']) {
      expect(t).toContain(p);
    }
    expect(t).toContain('Fireworks');
    expect(t).not.toMatch(/90 days after deletion|recovery period/i);
    expect(t).toContain('7 days');
    expect(t).toContain('[EU REPRESENTATIVE]');
    expect(t).toContain('[PRIVACY CONTACT EMAIL');
  });

  it('terms carry the non-affiliation line and the web price', () => {
    const { container } = render(<Terms />);
    const t = container.textContent ?? '';
    expect(t).toContain('Axiom is not affiliated with or endorsed by the Huberman Lab podcast or any certification body.');
    expect(t).toContain('US$12.99');
  });

  it('affiliate terms state the FTC disclosure duty and CAD payouts', () => {
    const { container } = render(<AffiliateTerms />);
    const t = container.textContent ?? '';
    expect(t).toContain('16 CFR Part 255');
    expect(t).toContain('Canadian dollars (CAD)');
    expect(t).toContain('Stripe Connect Express');
  });
});
