/**
 * Personal-training dashboard: briefing, check-ins, progress, notification
 * settings, the client's check-in form and the Ask Anakin roster filter.
 * The API module is mocked; routing uses wouter's in-memory location.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import {
  PersonalTrainingApiError,
  type BriefingItem, type BriefingResponse, type CheckIn, type Client, type NotificationSettings, type ProgressResponse,
} from '@axiom/personal-training-core';

const api = vi.hoisted(() => {
  const names = [
    'me', 'roster', 'briefing', 'resolveItem', 'undoItem', 'sendDraft', 'undoDraft', 'redraft', 'checkIns', 'requestCheckIns',
    'sendRoutineReplies', 'markCheckInRead', 'schedules', 'saveSchedule', 'deleteSchedule', 'checkInRequest', 'submitCheckIn', 'progress',
    'report', 'patchReport', 'sendReport', 'undoReport', 'anakinThreads', 'anakinThread', 'anakinFilter', 'addScheduled', 'setScheduled',
    'removeScheduled', 'notifications', 'markNotificationsRead', 'notificationSettings', 'saveNotificationSettings', 'invite',
    'client', 'timeline', 'overview', 'program', 'notes', 'addNote', 'updateNote', 'deleteNote', 'messageClient',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
const streamEvents = vi.hoisted(() => vi.fn());
vi.mock('@/features/personal-training/api', () => ({ ptApi: api, streamEvents }));
vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => <div data-testid="brand-logo" /> }));

import BriefingPage from '@/features/personal-training/pages/BriefingPage';
import CheckInsPage from '@/features/personal-training/pages/CheckInsPage';
import CheckInAnswerPage from '@/features/personal-training/pages/CheckInAnswerPage';
import ProgressPage from '@/features/personal-training/pages/ProgressPage';
import NotificationSettingsPage from '@/features/personal-training/pages/NotificationSettingsPage';
import RosterPage from '@/features/personal-training/pages/RosterPage';
import TimelinePage from '@/features/personal-training/pages/TimelinePage';

const ME = { trainer: { id: 't1', name: 'Kofi Mensah', initials: 'KM' }, practice: { id: 'p1', name: 'Kofi Coaching', slug: 'pt-kofi', logoUrl: null } };
const future = () => new Date(Date.now() + 60_000).toISOString();

const item = (over: Partial<BriefingItem> = {}): BriefingItem => ({
  id: 'i1', clientId: 'c1',
  client: { id: 'c1', name: 'Maya Okafor', initials: 'MO', status: 'support', meta: 'Strength · week 6 of 12' },
  severity: 'attention', headline: 'Maya mentioned pain', detail: '"Knee has been sore." — in a message on 24 Sep.',
  suggestion: { kind: 'message', text: 'Ease off for now, Maya.', draftId: 'd1' },
  draft: { id: 'd1', clientId: 'c1', text: 'Ease off for now, Maya.', channel: 'app', status: 'pending' },
  primaryLabel: 'Send reply', secondaryLabel: 'Edit draft', guardrail: { checked: 1, label: 'Checked against 1 contraindication' },
  evidence: { reasons: ['Wrote "Knee has been sore" in a message on 24 Sep', 'Active injury on file: Left knee'], sources: [{ kind: 'message', id: 'm', label: 'Message, 24 Sep' }] },
  dataThrough: '2026-09-24T10:00:00.000Z', ...over,
});

const briefing = (over: Partial<BriefingResponse> = {}): BriefingResponse => ({
  trainerFirstName: 'Kofi', today: '2026-10-02', clientCount: 10, stale: false, loggedSince: 0,
  rosterStats: { checkInsThisWeek: 6, adherence7d: 82, prs7d: 3 },
  briefing: {
    id: 'b1', date: '2026-10-02', generatedAt: '2026-10-02T10:02:00.000Z', status: 'ready',
    summary: { attention: 1, look: 1, onPlan: 8 },
    items: [item(), item({ id: 'i2', clientId: 'c2', severity: 'look', headline: 'Bench press has stalled', guardrail: undefined, primaryLabel: 'Send message', client: { id: 'c2', name: 'Priya Nair', initials: 'PN', status: 'onPlan', meta: 'Strength · week 5 of 12' } })],
    onPlanClients: [{ id: 'c3', name: 'Jordan Lee', initials: 'JL' }], scheduled: [],
  },
  ...over,
});

function renderAt(path: string, ui: React.ReactElement) {
  const { hook } = memoryLocation({ path });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Router hook={hook}>{ui}</Router></QueryClientProvider>);
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  streamEvents.mockReset();
  api.me.mockResolvedValue(ME);
  api.notifications.mockResolvedValue({ immediate: [], unread: 0, heldForBriefing: 3, recordedQuietly: 12 });
});

describe('morning briefing', () => {
  it('shows who needs the trainer, with the suggestion and guardrail badge', async () => {
    api.briefing.mockResolvedValue(briefing());
    renderAt('/personal-training', <BriefingPage />);
    expect(await screen.findByRole('heading', { name: "Let's get to work, Kofi." })).toBeInTheDocument();
    expect(screen.getByText('1 client needs you today. 1 is worth a look. 8 are on plan.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '0 of 2 handled' })).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Maya mentioned pain' });
    expect(within(card).getByText('Checked against 1 contraindication')).toBeInTheDocument();
    expect(within(card).getByText('Nothing sends without you')).toBeInTheDocument();
    expect(streamEvents).not.toHaveBeenCalled();
  });

  it('shows the evidence on request', async () => {
    api.briefing.mockResolvedValue(briefing());
    renderAt('/personal-training', <BriefingPage />);
    const card = await screen.findByRole('article', { name: 'Maya mentioned pain' });
    expect(within(card).queryByText(/Active injury on file/)).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Why am I seeing this?' }));
    expect(within(card).getByText('Active injury on file: Left knee')).toBeInTheDocument();
    expect(within(card).getByText('Sources: Message, 24 Sep')).toBeInTheDocument();
  });

  it('sends the edited draft, collapses the card and offers undo', async () => {
    api.briefing.mockResolvedValue(briefing());
    const resolved = item({ draft: { ...item().draft, status: 'sending', undoUntil: future() }, resolution: { action: 'messaged', at: new Date().toISOString(), summary: 'Maya Okafor — Message sent · logged to audit trail', undoUntil: future() } });
    api.resolveItem.mockResolvedValue({ item: resolved });
    api.undoItem.mockResolvedValue({ item: item() });
    renderAt('/personal-training', <BriefingPage />);
    const card = await screen.findByRole('article', { name: 'Maya mentioned pain' });

    await userEvent.click(within(card).getByRole('button', { name: 'Edit draft' }));
    const box = within(card).getByRole('textbox', { name: 'Draft message' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Rest the knee this week.');
    await userEvent.click(within(card).getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(api.resolveItem).toHaveBeenCalledWith('i1', 'messaged', 'Rest the knee this week.'));
    expect(await screen.findByText('Maya Okafor — Message sent · logged to audit trail')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '1 of 2 handled' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Maya mentioned pain' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.undoItem).toHaveBeenCalledWith('i1'));
    expect(await screen.findByRole('article', { name: 'Maya mentioned pain' })).toBeInTheDocument();
  });

  it('dismisses without sending anything', async () => {
    api.briefing.mockResolvedValue(briefing());
    api.resolveItem.mockResolvedValue({ item: item({ resolution: { action: 'dismissed', at: new Date().toISOString(), summary: 'Maya Okafor — Dismissed · logged to audit trail', undoUntil: future() } }) });
    renderAt('/personal-training', <BriefingPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss: Maya Okafor' }));
    await waitFor(() => expect(api.resolveItem).toHaveBeenCalledWith('i1', 'dismissed', undefined));
  });

  it('all clear: one hero card with roster stats, no empty groups', async () => {
    api.briefing.mockResolvedValue(briefing({ briefing: { ...briefing().briefing!, items: [], summary: { attention: 0, look: 0, onPlan: 10 } } }));
    renderAt('/personal-training', <BriefingPage />);
    expect(await screen.findByRole('heading', { name: 'All clear.' })).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.queryByText(/Needs attention/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ask Anakin about your roster/ })).toBeInTheDocument();
  });

  it('stale: shows the earlier briefing with a banner and writes today\'s in the background', async () => {
    api.briefing.mockResolvedValue(briefing({ stale: true, loggedSince: 2 }));
    streamEvents.mockReturnValue(new Promise(() => {}));
    renderAt('/personal-training', <BriefingPage />);
    const banner = await screen.findByText(/2 clients have logged since then/);
    expect(banner).toHaveTextContent("Today's briefing is being written.");
    expect(screen.getByRole('article', { name: 'Maya mentioned pain' })).toHaveTextContent(/Based on data through/);
    expect(streamEvents).toHaveBeenCalledTimes(1);
  });

  it('streams cards as they arrive when nothing is stored, then swaps in the finished briefing', async () => {
    api.briefing.mockResolvedValue(briefing({ briefing: null }));
    let emit: (e: any) => void = () => {};
    streamEvents.mockImplementation((_path: string, _init: unknown, onEvent: (e: any) => void) => { emit = onEvent; return new Promise(() => {}); });
    renderAt('/personal-training', <BriefingPage />);
    expect(await screen.findByText("Reading 10 clients' last 24 hours")).toBeInTheDocument();
    emit({ type: 'source', source: 'workouts' });
    emit({ type: 'item', item: item() });
    expect(await screen.findByRole('article', { name: 'Maya mentioned pain' })).toBeInTheDocument();
    emit({ type: 'done', briefing: briefing().briefing });
    expect(await screen.findByRole('article', { name: 'Bench press has stalled' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Briefing ready, 2 items');
  });

  it('new trainer: a setup checklist beside a sample card, and nothing is generated', async () => {
    api.briefing.mockResolvedValue(briefing({ clientCount: 0, briefing: null }));
    renderAt('/personal-training', <BriefingPage />);
    expect(await screen.findByRole('heading', { name: 'Set up your first briefing' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Invite your clients/ })).toHaveAttribute('href', '/personal-training/clients');
    expect(streamEvents).not.toHaveBeenCalled();
  });
});

describe('check-ins', () => {
  const checkIn = (over: Partial<CheckIn> = {}): CheckIn => ({
    id: 'k1', clientId: 'c1', client: { id: 'c1', name: 'Maya Okafor', initials: 'MO' }, submittedAt: new Date().toISOString(), channel: 'app',
    classification: 'flag', summary: 'Energy 2/5, pain mentioned. They wrote: "Left knee still hurts."',
    signals: [{ label: 'Energy 2/5', tone: 'red' }, { label: 'Pain mentioned', tone: 'red' }],
    answers: [{ question: 'Any pain or niggles?', answer: 'Left knee still hurts.' }],
    evidence: { reasons: ['Rated energy 2 out of 5'], sources: [{ kind: 'checkin', id: 'k1', label: 'This check-in' }] },
    draft: { id: 'd9', clientId: 'c1', text: 'Thanks for telling me, Maya.', channel: 'app', status: 'pending' }, ...over,
  });

  beforeEach(() => {
    api.roster.mockResolvedValue({ clients: [], counts: {} });
    api.checkIns.mockResolvedValue({
      checkIns: [checkIn(), checkIn({ id: 'k2', clientId: 'c2', client: { id: 'c2', name: 'Jordan Lee', initials: 'JL' }, classification: 'routine', summary: 'Steady week.', signals: [] })],
      missed: [{ id: 'x', client: { id: 'c3', name: 'Sam Whitfield', initials: 'SW' }, dueAt: new Date().toISOString(), status: 'missed', path: ['Check-in sent 28 Sep', 'Nudged 29 Sep, no reply', 'Flagged in your briefing'] }],
      routinePending: 1,
    });
  });

  it('lists check-ins, shows what was read and why, and the missed escalation', async () => {
    renderAt('/personal-training/check-ins', <CheckInsPage />);
    expect(await screen.findByText('Sam Whitfield')).toBeInTheDocument();
    expect(screen.getByText(/Check-in sent 28 Sep → Nudged 29 Sep, no reply → Flagged in your briefing/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Maya Okafor/ }));
    const detail = screen.getByRole('article', { name: 'Maya Okafor check-in' });
    expect(within(detail).getByText('Axiom read this')).toBeInTheDocument();
    expect(within(detail).getByText('Pain mentioned')).toBeInTheDocument();
    expect(within(detail).getByText('Left knee still hurts.')).toBeInTheDocument();
    expect(within(detail).getByRole('textbox', { name: 'Draft message' })).toHaveValue('Thanks for telling me, Maya.');
  });

  it('sends a reply only when Send is pressed, then offers undo', async () => {
    api.sendDraft.mockResolvedValue({ draft: { id: 'd9', clientId: 'c1', text: 'Thanks for telling me, Maya.', channel: 'app', status: 'sending', undoUntil: future() } });
    renderAt('/personal-training/check-ins', <CheckInsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Maya Okafor/ }));
    expect(api.sendDraft).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.sendDraft).toHaveBeenCalledWith('d9', 'Thanks for telling me, Maya.'));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('offers a batch send for routine replies only', async () => {
    api.sendRoutineReplies.mockResolvedValue({ sent: 1 });
    renderAt('/personal-training/check-ins', <CheckInsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send all routine replies (1)' }));
    expect(api.sendRoutineReplies).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('1 routine reply sent.')).toBeInTheDocument();
  });

  it('configures the schedule: questions can be reordered, typed and saved', async () => {
    api.schedules.mockResolvedValue({ schedules: [{ id: null, clientId: null, frequency: 'weekly', dayOfWeek: 0, hour: 18, questions: [{ id: 'a', text: 'Energy?', type: 'scale' }, { id: 'b', text: 'Pain?', type: 'text' }], nudgeAfterHours: 24, flagAfterHours: 48, pauseAfterMisses: 2, active: false }] });
    api.saveSchedule.mockResolvedValue({ schedule: {} });
    renderAt('/personal-training/check-ins', <CheckInsPage />);
    await userEvent.click(await screen.findByRole('radio', { name: 'Configure' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Move down: question 1' }));
    await userEvent.click(screen.getByRole('switch'));
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(api.saveSchedule).toHaveBeenCalled());
    const saved = api.saveSchedule.mock.calls[0][0];
    expect(saved.questions.map((q: any) => q.id)).toEqual(['b', 'a']);
    expect(saved).toMatchObject({ active: true, clientId: null, dayOfWeek: 0, hour: 18 });
  });
});

describe('client check-in form', () => {
  it('requires the scale answers and submits them as numbers', async () => {
    api.checkInRequest.mockResolvedValue({ id: 'k1', practiceName: 'Kofi Coaching', trainerName: 'Kofi Mensah', status: 'due', dueAt: new Date().toISOString(), questions: [{ id: 'energy', text: 'How was your energy?', type: 'scale', signal: 'energy' }, { id: 'pain', text: 'Any pain?', type: 'text', signal: 'pain' }] });
    api.submitCheckIn.mockResolvedValue({ ok: true });
    renderAt('/personal-training/check-in/k1', <CheckInAnswerPage />);
    const submit = await screen.findByRole('button', { name: 'Send check-in' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: '4 out of 5' }));
    await userEvent.type(screen.getByLabelText('Any pain?'), 'None');
    await userEvent.click(submit);
    await waitFor(() => expect(api.submitCheckIn).toHaveBeenCalledWith('k1', { energy: 4, pain: 'None' }));
    expect(await screen.findByText('Thanks. Your trainer has it.')).toBeInTheDocument();
  });

  it('says so when the check-in is not this user\'s', async () => {
    api.checkInRequest.mockRejectedValue(new PersonalTrainingApiError('Check-in not found', 404));
    renderAt('/personal-training/check-in/k1', <CheckInAnswerPage />);
    expect(await screen.findByText('This check-in is not available.')).toBeInTheDocument();
  });
});

describe('progress', () => {
  const data: ProgressResponse = {
    lift: 'squat', weeks: 6, unit: 'kg', kpis: { progressing: 1, plateau: 1, prsThisMonth: 4 },
    lifts: [{ key: 'squat', label: 'Squat' }, { key: 'bench', label: 'Bench press' }],
    rows: [
      { clientId: 'c1', client: { id: 'c1', name: 'Maya Okafor', initials: 'MO' }, lift: 'Squat', e1rm: 117, series: [117, 117, 117, 117, 117, 117], change: 0, adherence: 60, status: 'plateau' },
      { clientId: 'c2', client: { id: 'c2', name: 'Jordan Lee', initials: 'JL' }, lift: 'Squat', e1rm: 130, series: [120, 122, 125, 127, 128, 130], change: 10, adherence: 95, status: 'progressing' },
    ],
  };

  it('shows KPIs and each client\'s trend with status in words', async () => {
    api.progress.mockResolvedValue(data);
    renderAt('/personal-training/progress', <ProgressPage />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Plateau')).toBeInTheDocument();
    expect(within(rows[0]).getByText('117 kg')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('img', { name: 'Maya Okafor, Squat: Plateau' })).toBeInTheDocument();
    expect(within(rows[1]).getByText('+10 kg')).toBeInTheDocument();
    expect(screen.getByText('PRs this month').previousSibling).toHaveTextContent('4');
  });

  it('filters to plateaus and switches lift', async () => {
    api.progress.mockResolvedValue(data);
    renderAt('/personal-training/progress', <ProgressPage />);
    const table = await screen.findByRole('table');
    await userEvent.click(screen.getByRole('switch', { name: /Only plateaus and regressions/ }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Bench press' }));
    await waitFor(() => expect(api.progress).toHaveBeenLastCalledWith('bench', 6));
  });
});

describe('notification settings', () => {
  const settings: NotificationSettings = {
    rules: [
      { eventType: 'painReported', label: 'Pain reported', group: 'Safety', tier: 'immediate', defaultTier: 'immediate', locked: true, perWeek: 0.5 },
      { eventType: 'pr', label: 'New PR', group: 'Client activity', tier: 'briefing', defaultTier: 'briefing', perWeek: 3 },
    ],
    tierCounts: { immediate: 1, briefing: 1, timeline: 0 }, weeklyEstimate: 2, channels: { push: true, email: false }, quietHours: { start: 21, end: 7 }, overrides: [],
  };

  it('will not offer "timeline only" for a safety event', async () => {
    api.notificationSettings.mockResolvedValue(settings);
    api.roster.mockResolvedValue({ clients: [], counts: {} });
    renderAt('/personal-training/settings/notifications', <NotificationSettingsPage />);
    expect(await screen.findByText('About 2 alerts a week at these settings')).toBeInTheDocument();
    const pain = screen.getByRole('radiogroup', { name: 'Pain reported' });
    expect(within(pain).getByRole('radio', { name: 'Timeline only' })).toBeDisabled();
    expect(within(pain).getByRole('radio', { name: 'Timeline only' })).toHaveAttribute('title', 'Safety events always reach you');
    expect(within(screen.getByRole('radiogroup', { name: 'New PR' })).getByRole('radio', { name: 'Timeline only' })).toBeEnabled();
  });

  it('saves a tier change on its own and shows the new estimate', async () => {
    api.notificationSettings.mockResolvedValue(settings);
    api.roster.mockResolvedValue({ clients: [], counts: {} });
    api.saveNotificationSettings.mockResolvedValue({ ...settings, weeklyEstimate: 5, rules: [settings.rules[0], { ...settings.rules[1], tier: 'immediate' }] });
    renderAt('/personal-training/settings/notifications', <NotificationSettingsPage />);
    const pr = await screen.findByRole('radiogroup', { name: 'New PR' });
    await userEvent.click(within(pr).getByRole('radio', { name: 'Immediately' }));
    expect(api.saveNotificationSettings).toHaveBeenCalledWith({ rules: { pr: 'immediate' } });
    expect(await screen.findByText('About 5 alerts a week at these settings')).toBeInTheDocument();
  });
});

describe('Ask Anakin roster filter', () => {
  const client = (id: string, name: string): Client => ({
    id, name, initials: name.slice(0, 2).toUpperCase(), email: null, status: 'onPlan', channel: 'app', program: null, sessionsPerWeek: 3,
    engagement8w: [5, 5, 5, 5, 5, 5, 5, 5], engagementTrend: 'steady', joinedAt: '2026-08-01T00:00:00.000Z', contraindications: [],
  });

  it('restores the filter from the URL: banner, matching clients only, Anakin\'s evidence as the reason', async () => {
    api.roster.mockResolvedValue({ clients: [client('c1', 'Maya Okafor'), client('c2', 'Jordan Lee')], counts: {} });
    api.anakinFilter.mockResolvedValue({ question: 'Who is on a plateau on squat?', rows: [{ clientId: 'c1', evidence: 'Squat estimated 1RM flat at 117 kg over 6 weeks' }] });
    renderAt('/personal-training/clients?anakin=t1:m1', <RosterPage />);
    expect(await screen.findByText('Ask Anakin filter · Who is on a plateau on squat?')).toBeInTheDocument();
    expect(api.anakinFilter).toHaveBeenCalledWith('t1', 'm1');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Squat estimated 1RM flat at 117 kg over 6 weeks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });
});

describe('notification bell', () => {
  it('shows a dot only for unread immediate items, with held and quiet counts', async () => {
    api.briefing.mockResolvedValue(briefing());
    api.notifications.mockResolvedValue({
      immediate: [{ id: 'n1', clientId: 'c1', eventType: 'painReported', title: 'Maya Okafor reported pain', body: 'In a message', at: new Date().toISOString(), read: false }],
      unread: 1, heldForBriefing: 3, recordedQuietly: 12,
    });
    renderAt('/personal-training', <BriefingPage />);
    const bell = (await screen.findAllByRole('button', { name: 'Notifications, 1 unread' }))[0];
    await userEvent.click(bell);
    expect(await screen.findByText('Maya Okafor reported pain')).toBeInTheDocument();
    expect(screen.getByText("3 updates held for tomorrow's briefing")).toBeInTheDocument();
    expect(screen.getByText('12 logs recorded quietly')).toBeInTheDocument();
  });
});

describe('client dossier tabs', () => {
  const maya: Client = {
    id: 'c1', name: 'Maya Okafor', initials: 'MO', email: null, status: 'support', statusReason: 'No session logged in 9 days', channel: 'app',
    program: { blockLabel: 'Strength', week: 6, weeks: 12, goal: 'Squat 100 kg' }, sessionsPerWeek: 4,
    engagement8w: [8, 8, 8, 8, 8, 8, 4, 0], engagementTrend: 'falling', joinedAt: '2026-06-01T00:00:00.000Z', contraindications: [{ label: 'Left knee', active: true }],
  };
  beforeEach(() => {
    api.client.mockResolvedValue({ client: maya });
    api.timeline.mockResolvedValue({ events: [], nextCursor: null });
  });

  it('every tab is a working tab, and the URL decides which is open', async () => {
    api.overview.mockResolvedValue({
      summary: { text: 'Maya is in week 6 of 12 of Strength. Squat has stalled.', updatedAt: new Date().toISOString(), evidence: { reasons: ['Saved program: Strength, week 6 of 12'], sources: [{ kind: 'program', id: 'c1', label: 'Saved program' }] } },
      stats: [{ label: 'Squat est. 1RM', value: '117 kg', delta: '0 kg', tone: 'amber' }, { label: '4-week adherence', value: '60%', delta: '10 of 16 sessions' }],
      block: maya.program, openItems: [{ id: 'BRF-PAIN', headline: 'Maya mentioned pain', detail: 'In a message.', severity: 'attention' }], recentPrs: [],
    });
    renderAt('/personal-training/clients/c1/overview', <TimelinePage />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Timeline', 'Program', 'Notes']);
    for (const t of tabs) expect(t).toBeEnabled();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Maya is in week 6 of 12 of Strength. Squat has stalled.')).toBeInTheDocument();
    expect(screen.getByText('117 kg')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Week 6 of 12' })).toBeInTheDocument();
    expect(screen.getByText('Maya mentioned pain')).toBeInTheDocument();
    expect(api.timeline).not.toHaveBeenCalled();
  });

  it('shows the program read-only with the current phase named', async () => {
    api.program.mockResolvedValue({ program: {
      goal: 'Squat 100 kg', daysPerWeek: 4, totalWeeks: 12, currentWeek: 6, startedAt: '2026-08-20T00:00:00.000Z',
      phases: [
        { name: 'Foundation', weeksLabel: 'Weeks 1 to 4', rationale: '', current: false, days: [] },
        { name: 'Strength', weeksLabel: 'Weeks 5 to 8', rationale: 'Heavier triples', current: true, days: [{ day: 'Monday', focus: 'Lower', exercises: [{ name: 'Back squat', scheme: '5×3 · RPE 8', target: '100 kg' }] }] },
      ],
      pending: [{ id: 'p1', title: 'Hold back squat load this week', reasoning: 'RPE climbed', proposedAt: new Date().toISOString() }],
    } });
    renderAt('/personal-training/clients/c1/program', <TimelinePage />);
    expect(await screen.findByText('Week 6 of 12 · 4 days a week · started 20 Aug')).toBeInTheDocument();
    expect(screen.getByText('Current phase')).toBeInTheDocument();
    expect(screen.getByText('Back squat')).toBeInTheDocument();
    expect(screen.getByText('5×3 · RPE 8 · 100 kg')).toBeInTheDocument();
    expect(screen.getByText('Hold back squat load this week')).toBeInTheDocument();
    expect(screen.getByText(/Programs are edited by the client/)).toBeInTheDocument();
  });

  it('says so when there is no program', async () => {
    api.program.mockResolvedValue({ program: null });
    renderAt('/personal-training/clients/c1/program', <TimelinePage />);
    expect(await screen.findByText('This client has no program yet.')).toBeInTheDocument();
  });

  it('adds a private note', async () => {
    api.notes.mockResolvedValue({ notes: [{ id: 'n1', body: 'Prefers mornings.', authorName: 'Kofi Mensah', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
    api.addNote.mockResolvedValue({ note: {} });
    renderAt('/personal-training/clients/c1/notes', <TimelinePage />);
    expect(await screen.findByText('Prefers mornings.')).toBeInTheDocument();
    expect(screen.getByText('Private to your practice. Clients never see these.')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add note' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Add note' }), 'Travelling next week');
    await userEvent.click(add);
    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith('c1', 'Travelling next week'));
  });

  it('messages the client only on Send, then offers undo that restores the text', async () => {
    api.messageClient.mockResolvedValue({ draft: { id: 'd1', clientId: 'c1', text: 'How did Thursday go?', channel: 'app', status: 'sending', undoUntil: future() } });
    api.undoDraft.mockResolvedValue({ draft: { id: 'd1', clientId: 'c1', text: 'How did Thursday go?', channel: 'app', status: 'pending' } });
    renderAt('/personal-training/clients/c1/timeline', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Message Maya' }));
    const send = await screen.findByRole('button', { name: 'Send message' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Write a message' }), 'How did Thursday go?');
    expect(api.messageClient).not.toHaveBeenCalled();
    await userEvent.click(send);
    await waitFor(() => expect(api.messageClient).toHaveBeenCalledWith('c1', 'How did Thursday go?'));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.undoDraft).toHaveBeenCalledWith('d1'));
    expect(await screen.findByRole('textbox', { name: 'Write a message' })).toHaveValue('How did Thursday go?');
  });

  it('requests a check-in from the header and reports when one is already waiting', async () => {
    api.requestCheckIns.mockResolvedValue({ requested: 0 });
    renderAt('/personal-training/clients/c1/timeline', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Request check-in' }));
    expect(api.requestCheckIns).toHaveBeenCalledWith(['c1']);
    expect(await screen.findByText('They already have a check-in waiting.')).toBeInTheDocument();
  });
});
