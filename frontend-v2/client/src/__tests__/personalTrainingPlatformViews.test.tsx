/**
 * Coach-platform views: the Health tab (grouped contraindications, confirming
 * an inferred one, the exercise check), the dossier header chips and actions,
 * adding a web-link client and filtering by tag on the roster, goals and
 * measurements, photos without storage, and practice settings.
 * The API module is mocked; routing uses wouter's in-memory location.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { PersonalTrainingApiError, type Client, type Contraindication } from '@axiom/personal-training-core';

const api = vi.hoisted(() => {
  const names = [
    'me', 'roster', 'client', 'timeline', 'notifications', 'markNotificationsRead', 'anakinFilter', 'invite', 'requestCheckIns', 'messageClient',
    'overview', 'program', 'notes', 'tags', 'createLinkClient', 'patchClient', 'link', 'issueLink', 'revokeLink', 'contraindicationMeta',
    'contraindications', 'addContraindication', 'updateContraindication', 'archiveContraindication', 'checkGuardrails', 'goals', 'addGoal',
    'updateGoal', 'measurements', 'addMeasurement', 'deleteMeasurement', 'photos', 'addPhoto', 'deletePhoto', 'practiceProfile',
    'savePracticeProfile', 'uploadLogo', 'inviteProspect',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
vi.mock('@/features/personal-training/api', () => ({ ptApi: api, streamEvents: vi.fn() }));
vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => <div data-testid="brand-logo" /> }));

import RosterPage from '@/features/personal-training/pages/RosterPage';
import TimelinePage from '@/features/personal-training/pages/TimelinePage';
import PracticeSettingsPage from '@/features/personal-training/pages/PracticeSettingsPage';

const ME = { trainer: { id: 't1', name: 'Kofi Mensah', initials: 'KM' }, practice: { id: 'p1', name: 'Kofi Coaching', slug: 'pt-kofi', logoUrl: null } };

const client = (over: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Maya Okafor', initials: 'MO', email: 'maya@example.com', status: 'onPlan', channel: 'app',
  program: { blockLabel: 'Strength', week: 3, weeks: 8, goal: 'Squat 100 kg' }, sessionsPerWeek: 4,
  engagement8w: [5, 6, 7, 7, 8, 8, 9, 9], engagementTrend: 'steady', joinedAt: '2026-08-01T00:00:00.000Z',
  contraindications: [], tags: [], state: 'active', ...over,
});

const ci = (over: Partial<Contraindication>): Contraindication => ({
  id: 'r1', label: 'Left knee', active: true, bodyPart: 'knee', side: 'left', severity: 'moderate', clearance: 'not_cleared',
  source: 'trainer', extraBlocks: [], allow: [], needsReview: false, ...over,
});

const META = {
  bodyParts: [
    { key: 'knee', label: 'Knee', primary: ['squat', 'lunge'], secondary: ['knee_flexion'] },
    { key: 'shoulder', label: 'Shoulder', primary: ['overhead_press'], secondary: ['horizontal_press'] },
    { key: 'lower_back', label: 'Lower back', primary: ['hinge'], secondary: ['squat'] },
  ],
  patterns: ['squat', 'lunge', 'knee_flexion', 'overhead_press', 'horizontal_press', 'hinge', 'plyometric'],
};

function renderAt(path: string, ui: React.ReactElement) {
  const { hook } = memoryLocation({ path });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Router hook={hook}>{ui}</Router></QueryClientProvider>);
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.me.mockResolvedValue(ME);
  api.notifications.mockResolvedValue({ immediate: [], unread: 0, heldForBriefing: 0, recordedQuietly: 0 });
  api.client.mockResolvedValue({ client: client() });
  api.timeline.mockResolvedValue({ events: [], nextCursor: null });
  api.contraindicationMeta.mockResolvedValue(META);
  api.tags.mockResolvedValue({ tags: [] });
});

describe('Health tab', () => {
  const LIST = [
    ci({ id: 'inferred:client:abc', label: 'bad shoulder', bodyPart: 'shoulder', side: null, source: 'client_reported', needsReview: true, note: 'from lifting' }),
    ci({ id: 'r1' }),
    ci({ id: 'r2', label: 'Lower back strain', bodyPart: 'lower_back', side: null, clearance: 'modified' }),
    ci({ id: 'r3', label: 'Old ankle sprain', bodyPart: 'ankle_foot', side: null, clearance: 'cleared', active: false }),
  ];

  it('groups records by status and says what each refuses', async () => {
    api.contraindications.mockResolvedValue({ contraindications: LIST });
    renderAt('/personal-training/clients/c1/health', <TimelinePage />);

    const review = await screen.findByRole('region', { name: 'Needs your review' });
    expect(within(review).getByText('bad shoulder')).toBeInTheDocument();
    expect(within(review).getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(within(review).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();

    const notCleared = screen.getByRole('region', { name: 'Not cleared' });
    expect(within(notCleared).getByText('Left Knee · Moderate · Added by you')).toBeInTheDocument();
    expect(within(notCleared).getByText('Squat, Lunge, Knee flexion')).toBeInTheDocument();

    const modified = screen.getByRole('region', { name: 'Cleared with modifications' });
    expect(within(modified).getByText('Warns on')).toBeInTheDocument();
    expect(within(modified).getByText('Hinge, Squat')).toBeInTheDocument();

    const cleared = screen.getByRole('region', { name: 'Cleared or resolved' });
    expect(within(cleared).getByText('Nothing is refused while it is cleared.')).toBeInTheDocument();
  });

  it('confirms an inferred reading with its id, pre-filled from what the client wrote', async () => {
    api.contraindications.mockResolvedValue({ contraindications: LIST });
    api.addContraindication.mockResolvedValue({ contraindication: ci({ id: 'r9', label: 'bad shoulder', bodyPart: 'shoulder' }) });
    renderAt('/personal-training/clients/c1/health', <TimelinePage />);

    const review = await screen.findByRole('region', { name: 'Needs your review' });
    await userEvent.click(within(review).getByRole('button', { name: 'Confirm' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm what the client reported' });
    expect(within(dialog).getByLabelText('Condition')).toHaveValue('bad shoulder');
    expect(within(dialog).getByLabelText('Body part')).toHaveValue('shoulder');
    expect(within(dialog).getByText(/By default shoulder refuses/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Modified' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.addContraindication).toHaveBeenCalledWith('c1', expect.objectContaining({
      fromInferred: 'inferred:client:abc', bodyPart: 'shoulder', condition: 'bad shoulder', clearance: 'modified', notes: 'from lifting',
    })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('adds a record, with an extra refused pattern chosen by its label', async () => {
    api.contraindications.mockResolvedValue({ contraindications: [] });
    api.addContraindication.mockResolvedValue({ contraindication: ci({}) });
    renderAt('/personal-training/clients/c1/health', <TimelinePage />);

    expect(await screen.findByText('No injuries or conditions on file.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add injury or condition' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add injury or condition' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Condition'), 'Patellar tendinopathy');
    await userEvent.selectOptions(within(dialog).getByLabelText('Body part'), 'knee');
    await userEvent.selectOptions(within(dialog).getByLabelText('Side'), 'right');
    await userEvent.click(within(dialog).getByText('Adjust movement patterns'));
    const extra = within(dialog).getByRole('group', { name: 'Also refuse' });
    await userEvent.click(within(extra).getByLabelText('Plyometric'));
    await userEvent.click(save);
    await waitFor(() => expect(api.addContraindication).toHaveBeenCalledWith('c1', expect.objectContaining({
      condition: 'Patellar tendinopathy', bodyPart: 'knee', side: 'right', clearance: 'not_cleared', extraBlocks: ['plyometric'], allow: [],
    })));
    expect(api.addContraindication.mock.calls[0][1]).not.toHaveProperty('fromInferred');
  });

  it('archives a row after asking', async () => {
    api.contraindications.mockResolvedValue({ contraindications: [ci({ id: 'r1' })] });
    api.archiveContraindication.mockResolvedValue({ ok: true });
    const confirm = vi.fn(() => true);
    window.confirm = confirm;
    renderAt('/personal-training/clients/c1/health', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.archiveContraindication).toHaveBeenCalledWith('c1', 'r1'));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('checks exercises and shows refusals, warnings and what it could not read', async () => {
    api.contraindications.mockResolvedValue({ contraindications: [ci({})] });
    api.checkGuardrails.mockResolvedValue({ report: {
      checked: 1, ok: false, label: '1 conflict, 1 warning', unclassifiedConditions: [], unclassified: ['Turkish get-up'],
      violations: [
        { exercise: 'Back squat', pattern: 'squat', contraindicationId: 'r1', condition: 'Left knee', bodyPart: 'knee', level: 'block', reason: 'Back squat loads squat, which Left knee is not cleared for' },
        { exercise: 'Leg curl', pattern: 'knee_flexion', contraindicationId: 'r1', condition: 'Left knee', bodyPart: 'knee', level: 'warn', reason: 'Leg curl loads knee flexion; Left knee is cleared with modifications' },
      ],
    } });
    renderAt('/personal-training/clients/c1/health', <TimelinePage />);
    const box = await screen.findByRole('textbox', { name: 'Check exercises' });
    await userEvent.type(box, 'Back squat{enter}Leg curl{enter}{enter}Turkish get-up');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(api.checkGuardrails).toHaveBeenCalledWith('c1', ['Back squat', 'Leg curl', 'Turkish get-up']));

    expect(within(await screen.findByRole('region', { name: 'Refused' })).getByText('Back squat loads squat, which Left knee is not cleared for')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Warnings' })).getByText('Leg curl')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Not recognised' })).getByText('Turkish get-up')).toBeInTheDocument();
  });

  it('offers a retry when it cannot load', async () => {
    api.contraindications.mockRejectedValueOnce(new PersonalTrainingApiError('nope', 403)).mockResolvedValue({ contraindications: [] });
    renderAt('/personal-training/clients/c1/health', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No injuries or conditions on file.')).toBeInTheDocument();
  });
});

describe('dossier header', () => {
  it('pins red, amber and review chips and hides cleared ones', async () => {
    api.client.mockResolvedValue({ client: client({ contraindications: [
      ci({ id: 'a', label: 'Left knee' }),
      ci({ id: 'b', label: 'Lower back', clearance: 'modified' }),
      ci({ id: 'inferred:client:x', label: 'sore wrist', needsReview: true }),
      ci({ id: 'c', label: 'Ankle sprain', clearance: 'cleared', active: false }),
    ] }) });
    renderAt('/personal-training/clients/c1/timeline', <TimelinePage />);
    const chips = await screen.findByRole('list', { name: 'Injuries' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Left knee', 'Lower back· modified', 'sore wristReview']);
    expect(within(chips).getByRole('button', { name: /Left knee/ }).className).toMatch(/destructive/);
    expect(within(chips).getByRole('button', { name: /Lower back/ }).className).toMatch(/warning/);
    expect(within(chips).queryByText(/Ankle/)).not.toBeInTheDocument();
  });

  it('pauses a client until a date, with a reason', async () => {
    api.patchClient.mockResolvedValue({ client: client({ state: 'paused', status: 'paused', statusReason: 'Travelling · until 2030-01-02' }) });
    renderAt('/personal-training/clients/c1/timeline', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Client actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pause coaching' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pause Maya' });
    await userEvent.type(within(dialog).getByLabelText('Until (optional)'), '2030-01-02');
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Travelling');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.patchClient).toHaveBeenCalledWith('c1', {
      state: 'paused', pausedUntil: new Date('2030-01-02T00:00:00').toISOString(), stateReason: 'Travelling',
    }));
    expect(await screen.findByText('Travelling · until 2030-01-02')).toBeInTheDocument();
  });

  it('archives after confirmation and shows the way back', async () => {
    api.patchClient.mockResolvedValueOnce({ client: client({ state: 'archived' }) }).mockResolvedValueOnce({ client: client() });
    renderAt('/personal-training/clients/c1/timeline', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Client actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive client' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Maya Okafor?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.patchClient).toHaveBeenCalledWith('c1', { state: 'archived' }));
    expect(await screen.findByText(/Archived\. This client is off your roster/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore client' }));
    await waitFor(() => expect(api.patchClient).toHaveBeenLastCalledWith('c1', { state: 'active' }));
  });

  it('manages a link client’s web link: a new link warns first', async () => {
    api.client.mockResolvedValue({ client: client({ channel: 'webLink' }) });
    api.link.mockResolvedValue({ link: { url: 'https://axiomtraining.io/c/old', createdAt: '2026-10-01T00:00:00.000Z' } });
    api.issueLink.mockResolvedValue({ link: { url: 'https://axiomtraining.io/c/new', createdAt: '2026-10-16T00:00:00.000Z' } });
    renderAt('/personal-training/clients/c1/timeline', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Client actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Web link' }));
    const dialog = await screen.findByRole('dialog', { name: "Maya's web link" });
    expect(await within(dialog).findByDisplayValue('https://axiomtraining.io/c/old')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'New link' }));
    expect(within(dialog).getByText(/current one stops working/)).toBeInTheDocument();
    expect(api.issueLink).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make a new link' }));
    expect(await within(dialog).findByDisplayValue('https://axiomtraining.io/c/new')).toBeInTheDocument();
    expect(api.issueLink).toHaveBeenCalledWith('c1');
  });

  it('only lets a link client be renamed', async () => {
    renderAt('/personal-training/clients/c1/timeline', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Client actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Web link' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit contact details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Contact details' });
    expect(within(dialog).queryByLabelText('Name')).not.toBeInTheDocument();
    expect(within(dialog).getByText("An app client's name is set in their own account.")).toBeInTheDocument();
  });

  it('turns a "Not joined" client into a link client and follows them to their new record', async () => {
    api.client.mockResolvedValue({ client: client({ id: 'prospect:p1', status: 'notJoined', program: null }) });
    api.issueLink.mockResolvedValue({ link: { url: 'https://axiomtraining.io/c/p', createdAt: '2026-10-16T00:00:00.000Z' }, client: client({ id: 'u9', channel: 'webLink' }) });
    renderAt('/personal-training/clients/prospect:p1/timeline', <TimelinePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Give them a web link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Give Maya a web link' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create their link' }));
    expect(await within(dialog).findByDisplayValue('https://axiomtraining.io/c/p')).toBeInTheDocument();
    expect(api.issueLink).toHaveBeenCalledWith('prospect:p1');
  });
});

describe('roster', () => {
  const CLIENTS = [
    client({ id: 'c1', tags: ['online'] }),
    client({ id: 'c2', name: 'Dami Bello', initials: 'DB', channel: 'webLink', tags: ['online', 'vip'] }),
    client({ id: 'c3', name: 'Jordan Lee', initials: 'JL' }),
  ];
  beforeEach(() => api.roster.mockResolvedValue({ clients: CLIENTS, counts: {} }));

  it('badges link clients and filters by tag', async () => {
    renderAt('/personal-training/clients', <RosterPage />);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('Web link')).toHaveLength(1);
    const tags = screen.getByRole('group', { name: 'Tags' });
    await userEvent.click(within(tags).getByRole('button', { name: /vip/ }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('Dami Bello')).toBeInTheDocument();
    await userEvent.click(within(tags).getByRole('button', { name: 'Any tag' }));
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });

  it('adds a web-link client and shows the link to send', async () => {
    api.createLinkClient.mockResolvedValue({ client: client({ id: 'u5', name: 'Ama Boateng', channel: 'webLink' }), link: { url: 'https://axiomtraining.io/c/ama', createdAt: '2026-10-16T00:00:00.000Z' } });
    renderAt('/personal-training/clients', <RosterPage />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }));
    await userEvent.click(await screen.findByRole('button', { name: /Web link \(no install\)/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'Ama Boateng');
    await userEvent.type(screen.getByLabelText('Phone (optional)'), '+44 7700 900123');
    await userEvent.type(screen.getByLabelText('Tags (optional)'), 'online{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Create client and link' }));
    await waitFor(() => expect(api.createLinkClient).toHaveBeenCalledWith({ name: 'Ama Boateng', phone: '+44 7700 900123', tags: ['online'] }));
    expect(await screen.findByDisplayValue('https://axiomtraining.io/c/ama')).toBeInTheDocument();
    expect(screen.getByText(/Send this link yourself/)).toBeInTheDocument();
    expect(screen.getByText(/personal to this client/)).toBeInTheDocument();
  });
});

describe('Goals tab', () => {
  it('shows progress and adds a goal in the trainer’s unit', async () => {
    api.goals.mockResolvedValue({ goals: [{
      id: 'g1', metric: 'bodyweight', label: 'Bodyweight', direction: 'down', status: 'active', baseline: 90, target: 80, current: 85, unit: 'kg',
      deadline: '2030-01-01', daysLeft: 40, progress: 50,
    }] });
    api.measurements.mockResolvedValue({ measurements: [{ id: 'bw:1', kind: 'bodyweight', label: 'Bodyweight', value: 85, unit: 'kg', date: '2026-10-10', source: 'client', deletable: false }] });
    api.addGoal.mockResolvedValue({ goal: {} });
    renderAt('/personal-training/clients/c1/goals', <TimelinePage />);
    expect(await screen.findByRole('progressbar', { name: 'Bodyweight: 50% of the way' })).toBeInTheDocument();
    expect(screen.getByText('40 days left')).toBeInTheDocument();
    expect(screen.getByLabelText('Target (kg)')).toBeInTheDocument();
    // Client weigh-ins are theirs; there is nothing to delete.
    expect(screen.queryByRole('button', { name: /^Delete:/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Target (kg)'), '78');
    await userEvent.click(screen.getByRole('button', { name: 'Add goal' }));
    await waitFor(() => expect(api.addGoal).toHaveBeenCalledWith('c1', { metric: 'bodyweight', target: 78 }));
  });
});

describe('Photos tab', () => {
  it('says calmly when photo storage is not set up', async () => {
    api.photos.mockRejectedValue(new PersonalTrainingApiError('Photo storage is not set up on this server', 503));
    renderAt('/personal-training/clients/c1/photos', <TimelinePage />);
    expect(await screen.findByText(/Photo storage isn't set up yet/)).toBeInTheDocument();
    expect(api.photos).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('practice settings', () => {
  it('saves the profile with the sub-navigation in place', async () => {
    api.practiceProfile.mockResolvedValue({ profile: {
      bio: '', specialties: ['Strength'], styleTags: [], languages: [], format: null, timezone: null, brandColor: null, accentColor: null, logoUrl: null, name: 'Kofi Coaching', publicPage: false,
    } });
    api.savePracticeProfile.mockImplementation(async (p) => ({ profile: { ...p, logoUrl: null } }));
    renderAt('/personal-training/settings/practice', <PracticeSettingsPage />);
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByRole('link', { name: 'Practice' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/personal-training/settings/notifications');

    expect(await screen.findByLabelText('Practice name')).toHaveValue('Kofi Coaching');
    await userEvent.type(screen.getByLabelText('Languages'), 'English,Spanish{enter}');
    await userEvent.click(screen.getByRole('radio', { name: 'Hybrid' }));
    await userEvent.type(screen.getByLabelText('Brand colour'), '#1F6FEB');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.savePracticeProfile).toHaveBeenCalledWith({
      bio: '', specialties: ['Strength'], styleTags: [], languages: ['English', 'Spanish'], format: 'hybrid', timezone: null, brandColor: '#1F6FEB', accentColor: null, publicPage: false,
    }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('will not save a colour that is not hex', async () => {
    api.practiceProfile.mockResolvedValue({ profile: { bio: '', specialties: [], styleTags: [], languages: [], format: null, timezone: null, brandColor: null, accentColor: null, logoUrl: null, name: 'Kofi Coaching', publicPage: false } });
    renderAt('/personal-training/settings/practice', <PracticeSettingsPage />);
    await userEvent.type(await screen.findByLabelText('Accent colour'), 'blue');
    expect(screen.getByText('Use a hex colour like #1F6FEB.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});
