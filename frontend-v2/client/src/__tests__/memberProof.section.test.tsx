/**
 * Member Proof section.
 *
 * The section's whole premise is "every claim attached to a logged number", so
 * these tests guard the two things that would quietly undermine it: the lift
 * data drifting from what was verified against production, and the toggle
 * silently showing the wrong subset.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberProofSection } from '@/components/landing/MemberProofSection';

vi.mock('wouter', () => ({
  Link: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a>,
}));

describe('MemberProofSection — content', () => {
  it('renders the headline and eyebrow', () => {
    render(<MemberProofSection />);
    expect(screen.getByRole('heading', { name: /same person\. different data\./i })).toBeInTheDocument();
    expect(screen.getByText(/member proof/i)).toBeInTheDocument();
  });

  it('shows both member photos with the correct alt text and lazy loading', () => {
    render(<MemberProofSection />);
    const before = screen.getByAltText('Alex before starting Axiom') as HTMLImageElement;
    const after = screen.getByAltText('Alex at his week 8 check-in') as HTMLImageElement;
    expect(before.getAttribute('src')).toBe('/alex-before.jpg');
    expect(after.getAttribute('src')).toBe('/alex-after.jpg');
    // Below the fold — must not block the initial paint.
    expect(before.getAttribute('loading')).toBe('lazy');
    expect(after.getAttribute('loading')).toBe('lazy');
  });

  it('keeps the crop origin off the head', () => {
    // 50% 10% is specified because a centred crop frames the face, not the torso.
    render(<MemberProofSection />);
    const before = screen.getByAltText('Alex before starting Axiom');
    expect(before.getAttribute('style')).toContain('50% 10%');
  });

  it('renders the testimonial verbatim', () => {
    render(<MemberProofSection />);
    expect(screen.getByText(/I definitely recommend users to try Axiom out\./)).toBeInTheDocument();
    expect(screen.getByText('Alex Hernandez')).toBeInTheDocument();
  });

  it('does NOT render an avatar for Alex — we have no photo of him', () => {
    const { container } = render(<MemberProofSection />);
    // Only the two member photos should exist in this section.
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });
});

describe('MemberProofSection — verified lift data', () => {
  it('leads with the hip thrust figures verified against production', () => {
    // 12 logged sessions, 43.09kg x 12 (95 lb) -> 88.45kg x 12 (195 lb).
    // +140 lb is the e1RM delta (Epley), which is what the column measures.
    render(<MemberProofSection />);
    const row = document.querySelector('[data-lift="Hip Thrust"]') as HTMLElement;
    expect(within(row).getByText('95 lb × 12')).toBeInTheDocument();
    expect(within(row).getByText('195 lb × 12')).toBeInTheDocument();
    expect(within(row).getByText('+140 lb')).toBeInTheDocument();
    expect(within(row).getByText('+105%')).toBeInTheDocument();
    expect(within(row).getByText('12 sessions logged')).toBeInTheDocument();
  });

  it('uses the × multiplication sign, never the letter x', () => {
    render(<MemberProofSection />);
    expect(screen.getByText('95 lb × 12')).toBeInTheDocument();
    expect(screen.queryByText(/95 lb x 12/)).not.toBeInTheDocument();
  });

  it('shows the percentage in the delta slot for Romanian Deadlift', async () => {
    // We have no verified absolute lb delta for it. Inventing one would break
    // the section's premise, so the percentage takes the slot and the caption
    // reads "e1RM".
    render(<MemberProofSection />);
    // 8th in the list, so it only exists once the table is expanded.
    await userEvent.click(screen.getByRole('button', { name: /show all 9 lifts/i }));
    const row = document.querySelector('[data-lift="Romanian Deadlift"]') as HTMLElement;
    expect(within(row).getByText('+21%')).toBeInTheDocument();
    expect(within(row).getByText('e1RM')).toBeInTheDocument();
  });
});

describe('MemberProofSection — lift table toggle', () => {
  it('starts collapsed at 5 lifts', () => {
    render(<MemberProofSection />);
    expect(screen.getByText('Hip Thrust')).toBeInTheDocument();
    expect(screen.getByText('Leg Extension')).toBeInTheDocument();   // 5th
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument(); // 9th
  });

  it('expands to all nine and back', async () => {
    render(<MemberProofSection />);
    const toggle = screen.getByRole('button', { name: /show all 9 lifts/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    const collapse = screen.getByRole('button', { name: /show top 5/i });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(collapse);
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument();
  });
});

describe('MemberProofSection — CTA', () => {
  it('routes to signup and anchors to the coaching stack', () => {
    render(<MemberProofSection />);
    expect(screen.getByRole('link', { name: /get started/i })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: /view features/i })).toHaveAttribute('href', '#coaching-stack');
  });

  it('does not mention the diagnostic — no longer the lead feature', () => {
    const { container } = render(<MemberProofSection />);
    expect(container.textContent).not.toMatch(/diagnostic/i);
  });
});
