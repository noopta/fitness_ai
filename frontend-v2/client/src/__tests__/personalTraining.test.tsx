/**
 * Personal-training dashboard views: the access gate, the roster and the
 * client timeline. The API module is mocked; routing uses wouter's in-memory
 * location so the real <Link> and useRoute run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { PersonalTrainingApiError, type Client, type TimelineEvent } from '@axiom/personal-training-core';

const api = vi.hoisted(() => ({
  me: vi.fn(), createPractice: vi.fn(), roster: vi.fn(), client: vi.fn(), timeline: vi.fn(),
  invite: vi.fn(), invitePreview: vi.fn(), acceptInvite: vi.fn(), notifications: vi.fn(), markNotificationsRead: vi.fn(), anakinFilter: vi.fn(),
  requestCheckIns: vi.fn(), messageClient: vi.fn(), overview: vi.fn(), program: vi.fn(), notes: vi.fn(),
}));
vi.mock('@/features/personal-training/api', () => ({ ptApi: api }));
vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => <div data-testid="brand-logo" /> }));

import RosterPage from '@/features/personal-training/pages/RosterPage';
import TimelinePage from '@/features/personal-training/pages/TimelinePage';
import JoinPage from '@/features/personal-training/pages/JoinPage';

const ME = { trainer: { id: 't1', name: 'Kofi Mensah', initials: 'KM' }, practice: { id: 'p1', name: 'Kofi Coaching', slug: 'pt-kofi', logoUrl: null } };

const client = (over: Partial<Client>): Client => ({
  id: 'c1', name: 'Maya Okafor', initials: 'MO', email: 'maya@example.com', status: 'onPlan', channel: 'app',
  program: { blockLabel: 'Strength', week: 3, weeks: 8, goal: 'Squat 100 kg' },
  sessionsPerWeek: 4,
  engagement8w: [5, 6, 7, 7, 8, 8, 9, 9], engagementTrend: 'steady', joinedAt: '2026-08-01T00:00:00.000Z',
  contraindications: [], ...over,
});

const CLIENTS = [
  client({ id: 'c1', status: 'support', statusReason: 'No session logged in 9 days', engagementTrend: 'falling' }),
  client({ id: 'c2', name: 'Dami Bello', initials: 'DB', email: 'dami@example.com', status: 'new', program: null }),
  client({ id: 'c3', name: 'Jordan Lee', initials: 'JL', email: 'jordan@example.com' }),
];

function renderAt(path: string, ui: React.ReactElement) {
  const { hook } = memoryLocation({ path });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>{ui}</Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.me.mockResolvedValue(ME);
  api.notifications.mockResolvedValue({ immediate: [], unread: 0, heldForBriefing: 0, recordedQuietly: 0 });
  api.roster.mockResolvedValue({ clients: CLIENTS, counts: { all: 3, support: 1, new: 1, onPlan: 1, paused: 0 } });
});

describe('access gate', () => {
  it('says the feature is not enabled and requests no client data', async () => {
    api.me.mockRejectedValue(new PersonalTrainingApiError('Not found', 404));
    renderAt('/personal-training/clients', <RosterPage />);
    expect(await screen.findByText(/not enabled for this account/i)).toBeInTheDocument();
    expect(api.roster).not.toHaveBeenCalled();
  });

  it('walks a trainer with no practice through setup', async () => {
    api.me.mockResolvedValueOnce({ ...ME, practice: null });
    api.createPractice.mockResolvedValue({ practice: ME.practice });
    renderAt('/personal-training', <RosterPage />);
    const submit = await screen.findByRole('button', { name: /create practice/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/practice name/i), 'Kofi Coaching');
    await userEvent.click(submit);
    await waitFor(() => expect(api.createPractice).toHaveBeenCalledWith('Kofi Coaching'));
    // me is refetched after setup and the roster takes over.
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
  });
});

describe('roster', () => {
  it('lists clients with status in words, the reason, and a link to the timeline', async () => {
    renderAt('/personal-training/clients', <RosterPage />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Maya Okafor')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Might need support')).toBeInTheDocument();
    expect(within(rows[0]).getByText('No session logged in 9 days')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/personal-training/clients/c1/timeline');
    expect(within(rows[0]).getByRole('img', { name: 'Engagement falling over 8 weeks' })).toBeInTheDocument();
    expect(within(rows[1]).getByText('No program yet')).toBeInTheDocument();
    expect(screen.getByText('3 clients')).toBeInTheDocument();
    expect(screen.queryByText(/at risk/i)).not.toBeInTheDocument();
  });

  it('narrows by status chip and by search, keeping chip counts honest', async () => {
    renderAt('/personal-training/clients', <RosterPage />);
    const table = await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /might need support/i }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /might need support/i })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: /^all/i }));
    await userEvent.type(screen.getByRole('searchbox'), 'dami');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^all/i })).toHaveTextContent('1');

    await userEvent.click(screen.getByRole('button', { name: /paused/i }));
    expect(screen.getByText(/no clients match/i)).toBeInTheDocument();
  });

  it('shows an empty state with the invite action', async () => {
    api.roster.mockResolvedValue({ clients: [], counts: { all: 0, support: 0, new: 0, onPlan: 0, paused: 0 } });
    renderAt('/personal-training/clients', <RosterPage />);
    expect(await screen.findByText('No clients yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invite client/i })).toBeInTheDocument();
  });

  it('offers a retry when the roster fails', async () => {
    // A 4xx is surfaced at once; 5xx responses are retried quietly by the hook first.
    api.roster.mockRejectedValueOnce(new PersonalTrainingApiError('boom', 403)).mockResolvedValue({ clients: CLIENTS, counts: {} });
    renderAt('/personal-training/clients', <RosterPage />);
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('links every surface from the nav and marks the current one', async () => {
    renderAt('/personal-training/clients', <RosterPage />);
    await screen.findByRole('table');
    const rail = screen.getAllByRole('navigation', { name: /personal training/i })[0];
    expect(within(rail).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/personal-training', '/personal-training/clients', '/personal-training/check-ins', '/personal-training/progress', '/personal-training/anakin',
    ]);
    expect(within(rail).getByRole('link', { name: /clients/i })).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getByRole('link', { name: /briefing/i })).not.toHaveAttribute('aria-current');
  });

  it('creates an invite link from the dialog', async () => {
    api.invite.mockResolvedValue({ token: 't', link: 'https://axiomtraining.io/personal-training/join/t', email: null, expiresAt: '2026-10-09T00:00:00.000Z' });
    renderAt('/personal-training/clients', <RosterPage />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /invite client/i }));
    await userEvent.click(await screen.findByRole('button', { name: /create invite link/i }));
    await waitFor(() => expect(api.invite).toHaveBeenCalledWith(undefined));
    expect(await screen.findByDisplayValue('https://axiomtraining.io/personal-training/join/t')).toBeInTheDocument();
  });
});

describe('client timeline', () => {
  const ev = (id: string, at: string, over: Partial<TimelineEvent> = {}): TimelineEvent =>
    ({ id, clientId: 'c1', kind: 'workout', at, title: 'Lower', body: 'Back squat 3×5 at 100 kg', ...over });

  beforeEach(() => {
    api.client.mockResolvedValue({
      client: client({
        status: 'support', statusReason: 'No session logged in 9 days',
        contraindications: [{ label: 'Left knee', active: true }, { label: 'Shoulder', active: false }],
      }),
    });
  });

  it('shows the header, injuries and events, and loads earlier pages by cursor', async () => {
    api.timeline
      .mockResolvedValueOnce({
        events: [
          ev('workout:2', '2026-09-30T10:00:00.000Z', { flag: { label: 'PR · Back squat', tone: 'green' } }),
          ev('program:1', '2026-09-29T10:00:00.000Z', { kind: 'program', title: 'Add 2.5 kg to bench', ai: true }),
        ],
        nextCursor: 'cur-1',
      })
      .mockResolvedValueOnce({ events: [ev('checkin:1', '2026-09-20T10:00:00.000Z', { kind: 'checkin', title: 'Wellness check-in' })], nextCursor: null });

    renderAt('/personal-training/clients/c1/timeline', <TimelinePage />);
    expect(await screen.findByRole('heading', { name: 'Maya Okafor' })).toBeInTheDocument();
    expect(screen.getByText('Left knee')).toBeInTheDocument();
    expect(screen.getByText(/shoulder · cleared/i)).toBeInTheDocument();
    expect(await screen.findByText('PR · Back squat')).toBeInTheDocument();
    expect(screen.getByText('Add 2.5 kg to bench')).toBeInTheDocument();
    expect(api.timeline).toHaveBeenCalledWith('c1', [], null);

    await userEvent.click(screen.getByRole('button', { name: /load earlier/i }));
    expect(await screen.findByText('Wellness check-in')).toBeInTheDocument();
    expect(api.timeline).toHaveBeenLastCalledWith('c1', [], 'cur-1');
    expect(screen.queryByRole('button', { name: /load earlier/i })).not.toBeInTheDocument();
  });

  it('refetches for a single kind when a filter chip is chosen', async () => {
    api.timeline.mockResolvedValue({ events: [], nextCursor: null });
    renderAt('/personal-training/clients/c1/timeline', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check-in' }));
    await waitFor(() => expect(api.timeline).toHaveBeenLastCalledWith('c1', ['checkin'], null));
    expect(await screen.findByText(/nothing of that kind/i)).toBeInTheDocument();
  });

  it('says so when the client is not on this roster', async () => {
    api.client.mockRejectedValue(new PersonalTrainingApiError('Client not found', 404));
    api.timeline.mockResolvedValue({ events: [], nextCursor: null });
    renderAt('/personal-training/clients/nope/timeline', <TimelinePage />);
    expect(await screen.findByText(/not on your roster/i)).toBeInTheDocument();
  });
});

describe('join page', () => {
  it('states what is shared before the client accepts', async () => {
    api.invitePreview.mockResolvedValue({ practice: ME.practice, trainerName: 'Kofi Mensah', email: null, expiresAt: '2026-10-09T00:00:00.000Z' });
    api.acceptInvite.mockResolvedValue({ practice: ME.practice });
    renderAt('/personal-training/join/tok-1', <JoinPage />);
    expect(await screen.findByRole('heading', { name: 'Join Kofi Coaching' })).toBeInTheDocument();
    expect(screen.getByText(/Kofi Mensah will be able to see your workouts, check-ins, bodyweight, program and any injuries/i)).toBeInTheDocument();
    expect(api.acceptInvite).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /share my training and join/i }));
    expect(await screen.findByText('You are connected.')).toBeInTheDocument();
    expect(api.acceptInvite).toHaveBeenCalledWith('tok-1');
  });

  it('explains an invite issued to a different email', async () => {
    api.invitePreview.mockResolvedValue({ practice: ME.practice, trainerName: 'Kofi Mensah', email: 'x@example.com', expiresAt: '2026-10-09T00:00:00.000Z' });
    api.acceptInvite.mockRejectedValue(new PersonalTrainingApiError('This invite was issued to a different email address.', 403));
    renderAt('/personal-training/join/tok-1', <JoinPage />);
    await userEvent.click(await screen.findByRole('button', { name: /share my training and join/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/different email address/i);
  });

  it('handles a dead invite', async () => {
    api.invitePreview.mockRejectedValue(new PersonalTrainingApiError('Invite expired', 400));
    renderAt('/personal-training/join/tok-1', <JoinPage />);
    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
  });
});
