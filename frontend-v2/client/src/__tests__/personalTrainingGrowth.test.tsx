/**
 * Trainer growth surfaces: clients who might need you (with a drafted
 * message), leads (follow-ups first, working a lead, making them a client,
 * the public page banner), the team (owner vs coach, invite, analytics,
 * assigning clients) and joining a practice as a co-trainer.
 * The API module is mocked; routing uses wouter's in-memory location.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { PersonalTrainingApiError, type LeadView, type RetentionRow, type TeamMember } from '@axiom/personal-training-core';

const api = vi.hoisted(() => {
  const names = [
    'me', 'roster', 'notifications', 'markNotificationsRead', 'inbox', 'sendDraft', 'undoDraft', 'redraft',
    'retention', 'draftOutreach', 'leads', 'addLead', 'updateLead', 'convertLead', 'practiceProfile',
    'team', 'inviteCoach', 'acceptCoachInvite', 'removeCoach', 'teamAnalytics', 'assignClient', 'billingStatus',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
vi.mock('@/features/personal-training/api', () => ({ ptApi: api, streamEvents: vi.fn() }));
vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => <div data-testid="brand-logo" /> }));

import RetentionPage from '@/features/personal-training/pages/RetentionPage';
import LeadsPage, { dateInputToIso, isoToDateInput } from '@/features/personal-training/pages/LeadsPage';
import TeamPage from '@/features/personal-training/pages/TeamPage';
import TeamJoinPage from '@/features/personal-training/pages/TeamJoinPage';

const ME = { trainer: { id: 't1', name: 'Kofi Mensah', initials: 'KM' }, practice: { id: 'p1', name: 'Kofi Coaching', slug: 'kofi', logoUrl: null } };

function renderAt(path: string, ui: React.ReactElement) {
  const memory = memoryLocation({ path, record: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}><Router hook={memory.hook} searchHook={memory.searchHook}>{ui}</Router></QueryClientProvider>);
  return { ...utils, history: memory.history! };
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.me.mockResolvedValue(ME);
  api.notifications.mockResolvedValue({ immediate: [], unread: 0, heldForBriefing: 0, recordedQuietly: 0 });
  api.inbox.mockResolvedValue({ threads: [] });
  api.billingStatus.mockResolvedValue({ status: { available: true, connected: true, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, currency: 'gbp', dunningNudges: true, bookingNeedsCredit: false, platformFeePercent: 0 } });
});

describe('clients who might need you', () => {
  const row = (over: Partial<RetentionRow> = {}): RetentionRow => ({
    clientId: 'c1', client: { id: 'c1', name: 'Maya Okafor', initials: 'MO' }, risk: 62, level: 'high',
    reasons: ['Two sessions missed this week', 'Plan has one session left'], intervention: { kind: 'check_in', text: 'A quick check-in about her week.' },
    engagement8w: [8, 8, 7, 6, 5, 4, 3, 3], ...over,
  });

  it('lists people with calm wording, reasons, a trend and a suggestion', async () => {
    api.retention.mockResolvedValue({ clients: [row(), row({ clientId: 'c2', client: { id: 'c2', name: 'Priya Nair', initials: 'PN' }, level: 'low', reasons: [] })] });
    renderAt('/personal-training/at-risk', <RetentionPage />);
    expect(await screen.findByText('Maya Okafor')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clients who might need you' })).toBeInTheDocument();
    expect(screen.getByText('Reach out soon')).toBeInTheDocument();
    expect(screen.getByText('Keep an eye')).toBeInTheDocument();
    expect(screen.getByText('Two sessions missed this week')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: "Maya's training over the last 8 weeks" })).toBeInTheDocument();
    expect(screen.getAllByText('A quick check-in about her week.')).toHaveLength(2);
    // Care wording only.
    expect(document.body.textContent).not.toMatch(/churn|at-risk score|flagged/i);
  });

  it('drafts a message into the edit / send / undo flow', async () => {
    const user = userEvent.setup();
    api.retention.mockResolvedValue({ clients: [row()] });
    api.draftOutreach.mockResolvedValue({ draft: { id: 'd1', clientId: 'c1', text: 'Hey Maya, how is the week going?', channel: 'app', status: 'pending' } });
    api.sendDraft.mockResolvedValue({ draft: { id: 'd1', clientId: 'c1', text: 'Hey Maya!', channel: 'app', status: 'sending', undoUntil: new Date(Date.now() + 60_000).toISOString() } });
    renderAt('/personal-training/at-risk', <RetentionPage />);
    await user.click(await screen.findByRole('button', { name: 'Draft a message to Maya Okafor' }));
    const box = await screen.findByRole('textbox', { name: 'Draft a message: Maya Okafor' });
    expect(box).toHaveValue('Hey Maya, how is the week going?');
    await user.clear(box);
    await user.type(box, 'Hey Maya!');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.sendDraft).toHaveBeenCalledWith('d1', 'Hey Maya!');
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('says everyone is on track when nobody needs a nudge', async () => {
    api.retention.mockResolvedValue({ clients: [] });
    renderAt('/personal-training/at-risk', <RetentionPage />);
    expect(await screen.findByText('Everyone is on track.')).toBeInTheDocument();
  });
});

describe('leads', () => {
  const lead = (over: Partial<LeadView> = {}): LeadView => ({
    id: 'l1', name: 'Sam Lee', email: 'sam@example.com', phone: null, goal: 'Run a half marathon', message: 'Free on weekday mornings.',
    source: 'public_page', status: 'new', clientId: null, notes: null, createdAt: '2026-10-10T10:00:00.000Z', needsFollowUp: true, ...over,
  });

  beforeEach(() => {
    api.leads.mockResolvedValue({ leads: [lead(), lead({ id: 'l2', name: 'Ana Ruiz', status: 'consult_booked', consultAt: '2026-10-20T09:00:00.000Z', needsFollowUp: false, source: 'manual' })] });
    api.practiceProfile.mockResolvedValue({ profile: { publicPage: true } });
  });

  it('shows follow-ups first with status chips and the public page link', async () => {
    renderAt('/personal-training/leads', <LeadsPage />);
    const list = await screen.findByRole('navigation', { name: 'Leads' });
    const rows = within(list).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Sam Lee');
    expect(rows[0]).toHaveTextContent('Needs follow-up');
    expect(rows[0]).toHaveTextContent('New');
    expect(rows[1]).toHaveTextContent('Consult booked');
    expect(rows[1]).toHaveTextContent(/Consult /);
    expect(await screen.findByRole('textbox', { name: 'Your public page' })).toHaveValue(`${window.location.origin}/p/kofi`);
  });

  it('points to practice settings when the public page is off', async () => {
    api.practiceProfile.mockResolvedValue({ profile: { publicPage: false } });
    renderAt('/personal-training/leads', <LeadsPage />);
    expect(await screen.findByRole('link', { name: 'Turn it on in practice settings' })).toHaveAttribute('href', '/personal-training/settings/practice');
  });

  it('works a lead and makes them a client with a link to copy', async () => {
    const user = userEvent.setup();
    api.updateLead.mockImplementation(async (_id: string, patch: Partial<LeadView>) => ({ lead: lead({ ...patch, needsFollowUp: false } as Partial<LeadView>) }));
    api.convertLead.mockResolvedValue({ client: { id: 'c9', name: 'Sam Lee' }, link: { url: 'https://axiomtraining.io/c/secret', createdAt: '2026-10-16T00:00:00.000Z' } });
    renderAt('/personal-training/leads', <LeadsPage />);
    await user.click(await screen.findByRole('button', { name: /Sam Lee/ }));
    const detail = screen.getByRole('article');
    expect(within(detail).getByText('Free on weekday mornings.')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'sam@example.com' })).toHaveAttribute('href', 'mailto:sam@example.com');

    await user.selectOptions(within(detail).getByLabelText('Status'), 'contacted');
    await user.type(within(detail).getByLabelText('Notes'), 'Called, keen');
    await user.type(within(detail).getByLabelText('Follow up on'), '2026-10-22');
    await user.click(within(detail).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateLead).toHaveBeenCalledWith('l1', { status: 'contacted', notes: 'Called, keen', followUpAt: new Date('2026-10-22T09:00:00').toISOString() }));

    await user.click(within(screen.getByRole('article')).getByRole('button', { name: 'Make them a client' }));
    expect(await screen.findByDisplayValue('https://axiomtraining.io/c/secret')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open their record' })).toHaveAttribute('href', '/personal-training/clients/c9/overview');
  });

  it('adds a lead by hand', async () => {
    const user = userEvent.setup();
    api.addLead.mockResolvedValue({ lead: lead({ id: 'l3', name: 'Jo Park', source: 'manual', needsFollowUp: false }) });
    renderAt('/personal-training/leads', <LeadsPage />);
    await user.click(await screen.findByRole('button', { name: /Add a lead/ }));
    const form = screen.getByRole('form', { name: 'Add a lead' });
    await user.type(within(form).getByLabelText('Name'), 'Jo Park');
    await user.type(within(form).getByLabelText('Phone (optional)'), '07700 900123');
    await user.click(within(form).getByRole('button', { name: 'Add lead' }));
    await waitFor(() => expect(api.addLead).toHaveBeenCalledWith({ name: 'Jo Park', phone: '07700 900123' }));
    expect(await screen.findByRole('heading', { name: 'Jo Park' })).toBeInTheDocument();
  });

  it('round-trips follow-up dates', () => {
    expect(dateInputToIso('2026-10-22')).toBe(new Date('2026-10-22T09:00:00').toISOString());
    expect(dateInputToIso('nope')).toBeNull();
    expect(isoToDateInput(new Date(2026, 9, 22, 9).toISOString())).toBe('2026-10-22');
    expect(isoToDateInput(undefined)).toBe('');
  });
});

describe('team', () => {
  const members: TeamMember[] = [
    { userId: 't1', name: 'Kofi Mensah', email: 'kofi@example.com', role: 'owner', assignedClients: 6, joinedAt: '2026-01-01T00:00:00.000Z' },
    { userId: 't2', name: 'Lena Berg', email: 'lena@example.com', role: 'coach', assignedClients: 3, joinedAt: '2026-06-01T00:00:00.000Z' },
  ];

  beforeEach(() => {
    api.team.mockResolvedValue({ members });
    api.roster.mockResolvedValue({ clients: [{ id: 'c1', name: 'Maya Okafor', initials: 'MO', status: 'onPlan', channel: 'app', assignedTrainerId: null }], counts: {} });
    api.teamAnalytics.mockResolvedValue({ trainers: [{ userId: 't1', name: 'Kofi Mensah', role: 'owner', clients: 6, needsSupport: 1, highRisk: 1, avgEngagement: 7.25, sessionsNext7d: 9, mrrCents: 36000 }] });
  });

  it('gives the owner invites, analytics, removal and assignment', async () => {
    const user = userEvent.setup();
    api.inviteCoach.mockResolvedValue({ link: 'https://axiomtraining.io/personal-training/team/join/tok', email: 'new@example.com', expiresAt: '2026-10-23T00:00:00.000Z' });
    api.removeCoach.mockResolvedValue({ ok: true });
    api.assignClient.mockResolvedValue({ ok: true });
    renderAt('/personal-training/team', <TeamPage />);

    expect(await screen.findByText('Lena Berg')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText(/3 clients/)).toBeInTheDocument();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('£360')).toBeInTheDocument();
    expect(within(table).getByText('7.3')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Their email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect(await screen.findByDisplayValue('https://axiomtraining.io/personal-training/team/join/tok')).toBeInTheDocument();
    expect(screen.getByText(/only for that email/)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Trainer for Maya Okafor' }), 't2');
    await waitFor(() => expect(api.assignClient).toHaveBeenCalledWith('c1', 't2'));

    await user.click(screen.getByRole('button', { name: 'Remove Lena Berg' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.removeCoach).toHaveBeenCalledWith('t2'));
  });

  it('hides owner-only parts from a coach', async () => {
    api.me.mockResolvedValue({ ...ME, trainer: { id: 't2', name: 'Lena Berg', initials: 'LB' } });
    api.teamAnalytics.mockRejectedValue(new PersonalTrainingApiError('Only the practice owner can do that', 403));
    renderAt('/personal-training/team', <TeamPage />);
    expect(await screen.findByText('Kofi Mensah')).toBeInTheDocument();
    expect(screen.queryByLabelText('Their email')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: 'Trainer for Maya Okafor' })).toBeInTheDocument();
  });
});

describe('joining a practice', () => {
  it('accepts and goes to the dashboard', async () => {
    const user = userEvent.setup();
    api.acceptCoachInvite.mockResolvedValue({ practice: { id: 'p1', name: 'Kofi Coaching', slug: 'kofi', logoUrl: null } });
    const { history } = renderAt('/personal-training/team/join/tok', <TeamJoinPage />);
    await user.click(screen.getByRole('button', { name: 'Join the practice' }));
    expect(api.acceptCoachInvite).toHaveBeenCalledWith('tok');
    await waitFor(() => expect(history[history.length - 1]).toBe('/personal-training'));
  });

  it("shows the server's reason on a 403", async () => {
    const user = userEvent.setup();
    api.acceptCoachInvite.mockRejectedValue(new PersonalTrainingApiError('This invite was sent to a different email address.', 403));
    renderAt('/personal-training/team/join/tok', <TeamJoinPage />);
    await user.click(screen.getByRole('button', { name: 'Join the practice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite was sent to a different email address.');
  });
});
