/**
 * Conversational lift diagnostic (web). Exercises the real shared controller
 * and reducer through the page, with only the transport mocked: every action
 * leaves one bubble, the composer swaps per stage, failures render in-thread
 * with Retry (no toasts), and verdicts grade visibly.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Verdict } from '@axiom/diagnostic-core';

const api = vi.hoisted(() => ({
  load: vi.fn(),
  sendTurn: vi.fn(),
  uploadVideo: vi.fn(),
  videoStatus: vi.fn(),
  getReport: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('@/lib/diagnosticApi', () => ({
  diagnosticApi: api,
  readVideoDuration: vi.fn(async () => 10),
  shareDiagnostic: vi.fn(async () => 'https://axiomtraining.io/diagnostics/x'),
  listDiagnostics: vi.fn(async () => []),
  getPublicReport: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('wouter', () => ({
  useParams: () => ({}),
  useLocation: () => ['/diagnostics/chat', vi.fn()],
  Link: ({ href, children, className }: any) => <a href={href} className={className}>{children}</a>,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Sam', tier: 'free' }, loading: false, refreshUser: vi.fn(async () => ({})) }),
}));
vi.mock('@/lib/units', () => ({ useUnits: () => ({ isMetric: false }) }));
vi.mock('@/lib/analytics', () => ({
  WebAnalytics: { diagnosticStarted: vi.fn(), diagnosticCompleted: vi.fn(), diagnosticVerdictViewed: vi.fn(), paywallViewed: vi.fn(), upgradeTapped: vi.fn() },
  posthog: { capture: vi.fn() },
  trackPageTime: () => () => {},
}));

import DiagnosticChatPage from '@/pages/diagnostics/chat';
import { ReportView } from '@/components/diagnostic/ReportView';

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as any;
});

function verdict(grade: 0 | 1 | 2, over: Partial<Verdict> = {}): Verdict {
  return {
    sessionId: 's1',
    lift: 'flat_bench_press',
    grade,
    confidence: 70,
    ratiosLogged: grade,
    hasVideo: false,
    answersGiven: 3,
    limiter: { phase: 'lockout', hypothesisKey: 'triceps_deficit', hypothesisLabel: 'Triceps lockout strength' },
    evidence: [{ tag: 'RATIO', text: 'Close Grip Bench Press is 73% of your bench — below the 85–95% norm, so triceps lag.' }],
    candidates: [{ key: 'triceps_deficit', label: 'Triceps lockout strength', score: 82, rank: grade === 2 ? 'primary' : grade === 1 ? 'leading' : 'open' }],
    charts: grade === 2 ? { indices: { triceps_index: 78 }, efficiency: 71 } : null,
    video: null,
    validationTest: grade < 2 ? { description: 'Paused close-grip test', howToRun: 'Work up to a 3RM.' } : null,
    fix: { locked: true, accessoryCount: 3 },
    trackNextTime: [],
    missingLifts: ['overhead_press'],
    createdAt: '2026-09-13T00:00:00Z',
    ...over,
  };
}

const userBubbles = () => screen.queryAllByText((_, el) => !!el?.className?.toString().includes('rounded-[16px_16px_4px_16px]'));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.sendTurn.mockResolvedValue({});
  toast.error.mockClear();
});

describe('diagnostic chat page', () => {
  it('opens on the lift chips and moves to the numbers composer after a pick', async () => {
    render(<DiagnosticChatPage />);
    expect(screen.getByText('Which lift are we diagnosing?')).toBeInTheDocument();
    expect(screen.getByText('1 / 7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Flat Bench Press' }));
    await waitFor(() => expect(screen.getByLabelText('Weight (lb)')).toBeInTheDocument());
    expect(screen.getByText('2 / 7')).toBeInTheDocument();
    expect(userBubbles()).toHaveLength(1);
    expect(api.sendTurn).toHaveBeenCalledWith(expect.any(String), expect.any(String), { type: 'lift', lift: 'flat_bench_press' });
  });

  it('a failed send stays in the thread greyed with "Didn\'t send · Retry" — no toast — and Retry resends', async () => {
    api.sendTurn.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
    render(<DiagnosticChatPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Deadlift' }));
    await waitFor(() => expect(screen.getByText("Didn't send")).toBeInTheDocument());
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText("Didn't send")).not.toBeInTheDocument());
    expect(api.sendTurn).toHaveBeenCalledTimes(2);
    expect(api.sendTurn.mock.calls[0][1]).toBe(api.sendTurn.mock.calls[1][1]);
    expect(userBubbles()).toHaveLength(1);
  });

  it('collects accessories with the numeric composer: counter, Skip below minimum, Move on at two', async () => {
    render(<DiagnosticChatPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Flat Bench Press' }));
    const fill = async (w: string) => {
      await waitFor(() => expect(screen.getByLabelText('Weight (lb)')).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText('Weight (lb)'), { target: { value: w } });
      fireEvent.change(screen.getByLabelText('Sets'), { target: { value: '3' } });
      fireEvent.change(screen.getByLabelText('Reps'), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    };
    await fill('225');
    await waitFor(() => expect(screen.getByText('0 of 2 minimum')).toBeInTheDocument());
    expect(screen.getAllByText('Close Grip Bench Press').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move on' })).not.toBeInTheDocument();
    await fill('185');
    await waitFor(() => expect(screen.getByText('1 of 2 minimum')).toBeInTheDocument());
    await fill('205');
    await waitFor(() => expect(screen.getByText('2 logged · 3 sharpens it')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Move on' })).toBeInTheDocument();
    expect(screen.getByText(/a third sharpens it/)).toBeInTheDocument();
  });

  it('resumes a saved thread by replaying its turns through the web transport', async () => {
    api.load.mockResolvedValue({
      session: { id: 's1', lift: 'flat_bench_press', flow: 'conversation', createdAt: '' },
      turns: [
        { clientTurnId: 'a', seq: 0, input: { type: 'lift', lift: 'flat_bench_press' }, result: {}, createdAt: '' },
        { clientTurnId: 'b', seq: 1, input: { type: 'main', set: { weight: 225, sets: 3, reps: 5, unit: 'lb' } }, result: {}, createdAt: '' },
      ],
      limit: { reached: false },
    });
    const { DiagnosticController } = await import('@axiom/diagnostic-core');
    const c = new DiagnosticController(api as any, { sessionId: 's1' });
    await c.start();
    expect(c.getState().stage).toBe('acc');
    expect(c.getState().thread.filter((t) => t.kind === 'user').map((t: any) => t.text)).toEqual(['Flat Bench Press', '225 lb · 3 × 5']);
  });
});

describe('report view grades', () => {
  const noop = () => {};

  it('2+ ratios: "Lockout strength." with charts and the locked fix', () => {
    render(<ReportView verdict={verdict(2)} onClose={noop} onUpgrade={noop} />);
    expect(screen.getByRole('heading', { name: 'Lockout strength.' })).toBeInTheDocument();
    expect(screen.getByLabelText('Strength profile')).toBeInTheDocument();
    expect(screen.getByText('Your fix is ready')).toBeInTheDocument();
    expect(screen.queryByText(/Not enough lifts logged/)).not.toBeInTheDocument();
  });

  it('1 ratio: "Likely lockout strength." — charts replaced by the note, validation + sharpen shown', () => {
    const onAdd = vi.fn();
    render(<ReportView verdict={verdict(1)} onClose={noop} onUpgrade={noop} onAddNumbers={onAdd} />);
    expect(screen.getByRole('heading', { name: 'Likely lockout strength.' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Strength profile')).not.toBeInTheDocument();
    expect(screen.getByText(/Not enough lifts logged/)).toBeInTheDocument();
    expect(screen.getByText('Paused close-grip test')).toBeInTheDocument();
    expect(screen.getByText('Log your Overhead Press')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add the missing numbers' }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('0 ratios: "Probably lockout — untested." under Closest read, selling the confirmation test', () => {
    render(<ReportView verdict={verdict(0)} onClose={noop} onUpgrade={noop} />);
    expect(screen.getByRole('heading', { name: 'Probably lockout — untested.' })).toBeInTheDocument();
    expect(screen.getByText('Closest read')).toBeInTheDocument();
    expect(screen.getByText('Confirm it first')).toBeInTheDocument();
  });

  it('confidence is displayed as a number', () => {
    render(<ReportView verdict={verdict(2, { confidence: 76 })} onClose={noop} onUpgrade={noop} />);
    expect(screen.getByText(/76% confidence/)).toBeInTheDocument();
  });

  it('an unlocked fix shows the protocol in place', () => {
    const v = verdict(2, {
      fix: {
        locked: false,
        primary: { name: 'Flat Bench Press', sets: 4, reps: '5', intensity: 'RIR 2', restMinutes: 3 },
        accessories: [{ exerciseId: 'jm_press', name: 'JM Press', sets: 3, reps: '8', why: 'Lockout' }],
        progression: ['Add 5 lb'],
      },
    });
    render(<ReportView verdict={v} onClose={noop} onUpgrade={noop} />);
    const fix = screen.getByText('Your fix').closest('section')!;
    expect(within(fix).getByText('JM Press')).toBeInTheDocument();
    expect(screen.queryByText('Your fix is ready')).not.toBeInTheDocument();
  });
});
