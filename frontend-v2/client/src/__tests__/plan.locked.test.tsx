/**
 * Diagnostic-first onboarding: the plan page must survive the server's
 * stripped response shape (no bench_day_plan) and sell the missing
 * prescription with the locked card instead of crashing on it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Plan from '@/pages/plan';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSetLocation = vi.fn();
const mockGetCachedPlan = vi.fn();
const mockGeneratePlan = vi.fn();
const mockVerdictViewed = vi.fn();
const mockPaywallViewed = vi.fn();

vi.mock('wouter', () => ({
  useLocation: () => ['/plan', mockSetLocation],
  Link: ({ href, children, className }: any) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock('@/lib/api', () => ({
  liftCoachApi: {
    getCachedPlan: (...args: any[]) => mockGetCachedPlan(...args),
    generatePlan: (...args: any[]) => mockGeneratePlan(...args),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, features: { onboardingFormHook: false, diagnosticFirstOnboarding: true }, loading: false }),
}));

vi.mock('@/lib/analytics', () => ({
  WebAnalytics: {
    diagnosticVerdictViewed: (locked: boolean) => mockVerdictViewed(locked),
    paywallViewed: (source: string) => mockPaywallViewed(source),
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
}));

// The chat wrapper must pass the results through, everything else can be inert.
vi.mock('@/components/ResultsChat', () => ({
  ResultsChat: ({ resultsContent }: any) => <div data-testid="results">{resultsContent}</div>,
}));
vi.mock('@/components/Navbar', () => ({ Navbar: () => <nav /> }));
vi.mock('@/components/StrengthRadar', () => ({ StrengthRadar: () => <div /> }));
vi.mock('@/components/PhaseBreakdown', () => ({ PhaseBreakdown: () => <div /> }));
vi.mock('@/components/HypothesisRankings', () => ({ HypothesisRankings: () => <div /> }));
vi.mock('@/components/EfficiencyGauge', () => ({ EfficiencyGauge: () => <div /> }));
vi.mock('@/components/ShareAnalysis', () => ({ ShareAnalysis: () => <div /> }));
vi.mock('@/components/UpgradePrompt', () => ({ UpgradePrompt: () => <div /> }));
vi.mock('@/components/AccessoryVideoCard', () => ({ AccessoryVideoCard: () => <div /> }));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className, asChild }: any) =>
    asChild ? <span className={className}>{children}</span> : (
      <button onClick={onClick} className={className}>{children}</button>
    ),
}));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
}));
vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('@/components/ui/separator', () => ({
  Separator: () => <hr />,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Exactly what the backend's stripPrescription() returns: diagnosis and the
// rest of the plan intact, bench_day_plan gone, locked marker + preview added.
const lockedPlan = {
  selected_lift: 'flat_bench_press',
  diagnosis: [
    {
      limiter: 'triceps',
      limiterName: 'Triceps Strength',
      confidence: 0.82,
      evidence: ['Close-grip ratio is low relative to your bench'],
    },
  ],
  prescription_locked: true,
  prescription_preview: { accessory_count: 4 },
  progression_rules: ['Add 5 lb when all sets hit the top of the rep range'],
  track_next_time: ['Bar speed on your last rep'],
};

const fullPlan = {
  ...lockedPlan,
  prescription_locked: undefined,
  prescription_preview: undefined,
  bench_day_plan: {
    primary_lift: {
      exercise_id: 'flat_bench_press',
      exercise_name: 'Flat Bench Press',
      sets: 4,
      reps: '5',
      intensity: 'RPE 8',
      rest_minutes: 3,
    },
    accessories: [
      {
        exercise_id: 'cgbp',
        exercise_name: 'Close-Grip Bench Press',
        sets: 3,
        reps: '8-10',
        why: 'Targets the triceps weak link',
        category: 'strength',
      },
    ],
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Plan page — locked prescription (diagnostic-first free tier)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem('liftoff_session_id', 'sess-1');
    window.localStorage.setItem('liftoff_selected_lift', 'flat_bench_press');
    mockGetCachedPlan.mockResolvedValue({ plan: lockedPlan });
  });

  it('renders the verdict and the locked card without crashing on the missing bench_day_plan', async () => {
    render(<Plan />);

    // Verdict still renders in full
    expect(await screen.findAllByText('Triceps Strength')).not.toHaveLength(0);
    expect(screen.getAllByText(/close-grip ratio is low/i).length).toBeGreaterThan(0);

    // Locked card
    expect(screen.getByText('Your fix is ready')).toBeInTheDocument();
    expect(screen.getByText(/4 accessories chosen for you, with sets, loads and progression rules/i)).toBeInTheDocument();
    expect(screen.getByText(/unlock the adaptive program \+ ai coach that fixes this and keeps adjusting/i)).toBeInTheDocument();
    expect(screen.getByText(/first month free · cancel anytime/i)).toBeInTheDocument();

    const cta = screen.getByRole('link', { name: /start your free month/i });
    expect(cta).toHaveAttribute('href', '/pricing');
  });

  it('hides every prescription surface while locked', async () => {
    render(<Plan />);
    await screen.findByText('Your fix is ready');

    expect(screen.queryByText('Primary Lift')).not.toBeInTheDocument();
    expect(screen.queryByText('Close-Grip Bench Press')).not.toBeInTheDocument();
    expect(screen.queryByText('Progression Rules')).not.toBeInTheDocument();
    expect(screen.queryByText(/copy plan/i)).not.toBeInTheDocument();
  });

  it('fires verdict + paywall analytics exactly once', async () => {
    render(<Plan />);
    await screen.findByText('Your fix is ready');

    await waitFor(() => expect(mockVerdictViewed).toHaveBeenCalledWith(true));
    expect(mockVerdictViewed).toHaveBeenCalledTimes(1);
    expect(mockPaywallViewed).toHaveBeenCalledTimes(1);
    expect(mockPaywallViewed).toHaveBeenCalledWith('diagnostic_verdict');
  });

  it('never writes a locked plan into the localStorage cache', async () => {
    render(<Plan />);
    await screen.findByText('Your fix is ready');

    expect(window.localStorage.getItem('liftoff_plan_sess-1')).toBeNull();
  });

  it('drops a stale locked plan from cache instead of trusting it', async () => {
    // e.g. cached pre-upgrade; the server now returns the full plan
    window.localStorage.setItem('liftoff_plan_sess-1', JSON.stringify(lockedPlan));
    mockGetCachedPlan.mockResolvedValue({ plan: fullPlan });

    render(<Plan />);

    expect(await screen.findByText('Primary Lift')).toBeInTheDocument();
    expect(screen.queryByText('Your fix is ready')).not.toBeInTheDocument();
    // Refetched full plan is cached again
    expect(JSON.parse(window.localStorage.getItem('liftoff_plan_sess-1')!).bench_day_plan).toBeTruthy();
  });
});

describe('Plan page — full plan unchanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem('liftoff_session_id', 'sess-1');
    mockGetCachedPlan.mockResolvedValue({ plan: fullPlan });
  });

  it('renders the prescription and no locked card', async () => {
    render(<Plan />);

    expect(await screen.findByText('Primary Lift')).toBeInTheDocument();
    expect(screen.getByText('Close-Grip Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Progression Rules')).toBeInTheDocument();
    expect(screen.queryByText('Your fix is ready')).not.toBeInTheDocument();

    await waitFor(() => expect(mockVerdictViewed).toHaveBeenCalledWith(false));
    expect(mockPaywallViewed).not.toHaveBeenCalled();
  });
});
