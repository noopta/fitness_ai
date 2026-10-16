/**
 * Program surfaces: guardrail badges and the check panel on the builder,
 * acknowledging a warning, publish refused and published, a refused live
 * edit, Generate with Axiom (progress, 503, success), library form
 * validation, the dossier's Intake, Nutrition and Billing tabs, and export.
 * The API module is mocked; routing uses wouter's in-memory location.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { PersonalTrainingApiError, type Client, type ProgramCheck, type TrainerProgram } from '@axiom/personal-training-core';

const api = vi.hoisted(() => {
  const names = [
    'me', 'roster', 'client', 'timeline', 'notifications', 'markNotificationsRead', 'trainerProgram', 'saveProgram', 'acknowledgeWarnings',
    'publishProgram', 'generateProgram', 'exercises', 'programs', 'createProgram', 'copyProgram', 'archiveProgram', 'intake', 'resetIntake',
    'nutrition', 'setNutritionTargets', 'billingStatus', 'offers', 'clientBilling', 'paymentRequestLink', 'contraindicationMeta',
    'createExercise', 'updateExercise', 'archiveExercise', 'practiceProfile', 'savePracticeProfile', 'uploadLogo', 'requestCheckIns', 'messageClient',
  ] as const;
  const fns = Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
  return { ...fns, exportPaths: { json: '/personal-training/export', clients: '/personal-training/export/clients.csv', workouts: '/x', measurements: '/y', contraindications: '/z' } };
});
const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('@/features/personal-training/api', () => ({ ptApi: api, streamEvents: vi.fn(), downloadFile }));
vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => <div data-testid="brand-logo" /> }));

import ProgramBuilderPage from '@/features/personal-training/pages/ProgramBuilderPage';
import ProgramsPage from '@/features/personal-training/pages/ProgramsPage';
import LibraryPage from '@/features/personal-training/pages/LibraryPage';
import TimelinePage from '@/features/personal-training/pages/TimelinePage';
import PracticeSettingsPage from '@/features/personal-training/pages/PracticeSettingsPage';

type Fn = ReturnType<typeof vi.fn>;
const fn = (k: string) => (api as unknown as Record<string, Fn>)[k];

const ME = { trainer: { id: 't1', name: 'Kofi Mensah', initials: 'KM', unit: 'kg' }, practice: { id: 'p1', name: 'Kofi Coaching', slug: 'pt-kofi', logoUrl: null } };
const maya = (over: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Maya Okafor', initials: 'MO', email: null, status: 'onPlan', channel: 'app', program: null, sessionsPerWeek: 4,
  engagement8w: [5, 5, 5, 5, 5, 5, 5, 5], engagementTrend: 'steady', joinedAt: '2026-08-01T00:00:00.000Z', contraindications: [], tags: [], state: 'active', ...over,
});

const BLOCKED: ProgramCheck = {
  publishable: false, issues: [{ level: 'warn', where: 'd1', text: 'Lower: AMRAP block has no time cap' }],
  guardrails: {
    checked: 1, ok: false, label: '1 conflict, 1 warning', unclassified: ['Turkish get-up'], unclassifiedConditions: [],
    violations: [
      { exercise: 'Back squat', pattern: 'squat', contraindicationId: 'k1', condition: 'Left knee', bodyPart: 'knee', level: 'block', reason: 'Back squat loads squat, which Left knee is not cleared for' },
      { exercise: 'Leg curl', pattern: 'knee_flexion', contraindicationId: 'k1', condition: 'Left knee', bodyPart: 'knee', level: 'warn', reason: 'Leg curl loads knee flexion; Left knee is cleared with modifications' },
    ],
  },
};
const CLEAN: ProgramCheck = { publishable: true, issues: [], guardrails: { checked: 1, ok: true, label: 'Checked against 1 contraindication', unclassified: [], unclassifiedConditions: [], violations: [] } };

const program = (over: Partial<TrainerProgram> = {}): TrainerProgram => ({
  id: 'p1', clientId: 'c1', name: 'Knee-friendly strength', description: '', status: 'draft', isTemplate: false, source: 'ai',
  doc: { weeks: [{ id: 'w1', label: 'Week 1', days: [{ id: 'd1', name: 'Lower', weekday: 1, blocks: [{ id: 'b1', kind: 'single', items: [
    { id: 'i1', name: 'Back squat', sets: 5, reps: '5' }, { id: 'i2', name: 'Leg curl', sets: 3, reps: '10' }, { id: 'i3', name: 'Hip thrust', sets: 3, reps: '8' },
  ] }] }] }] },
  annotations: [
    { target: 'program', kind: 'removed', text: 'Not programmed: box jumps, because Left knee is not cleared for plyometrics' },
    { target: 'i3', kind: 'rationale', text: 'Hip thrusts keep posterior-chain work off the knee.' },
  ],
  acknowledged: [], startDate: null, version: 1, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: new Date().toISOString(), check: BLOCKED, ...over,
});

function renderAt(path: string, ui: React.ReactElement) {
  const { hook, history } = memoryLocation({ path, record: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { history, ...render(<QueryClientProvider client={qc}><Router hook={hook}>{ui}</Router></QueryClientProvider>) };
}

const conflict = (message: string, check: ProgramCheck) => Object.assign(new PersonalTrainingApiError(message, 409), { body: { error: message, check } });

beforeEach(() => {
  for (const v of Object.values(api)) if (typeof v === 'function') (v as Fn).mockReset();
  downloadFile.mockReset();
  fn('me').mockResolvedValue(ME);
  fn('notifications').mockResolvedValue({ immediate: [], unread: 0, heldForBriefing: 0, recordedQuietly: 0 });
  fn('client').mockResolvedValue({ client: maya() });
  fn('roster').mockResolvedValue({ clients: [maya(), maya({ id: 'c2', name: 'Dami Bello', sessionsPerWeek: 3 })], counts: {} });
  fn('exercises').mockResolvedValue({ exercises: [], equipment: ['barbell', 'dumbbell', 'band'] });
  fn('timeline').mockResolvedValue({ events: [], nextCursor: null });
});

describe('builder', () => {
  it('badges refused and warned items, explains them, and shows the drafting refusals and rationale', async () => {
    fn('trainerProgram').mockResolvedValue({ program: program() });
    renderAt('/personal-training/programs/p1', <ProgramBuilderPage />);

    expect(await screen.findByDisplayValue('Knee-friendly strength')).toBeInTheDocument();
    expect(fn('trainerProgram')).toHaveBeenCalledWith('p1');
    const refusals = screen.getByRole('list', { name: 'Not programmed' });
    expect(within(refusals).getByText(/box jumps, because Left knee/)).toBeInTheDocument();

    const squat = screen.getByDisplayValue('Back squat').closest('li')!;
    expect(within(squat).getByText('Refused')).toBeInTheDocument();
    expect(within(squat).getByText('Back squat loads squat, which Left knee is not cleared for')).toBeInTheDocument();
    const curl = screen.getByDisplayValue('Leg curl').closest('li')!;
    expect(within(curl).getByText('Check')).toBeInTheDocument();
    const thrust = screen.getByDisplayValue('Hip thrust').closest('li')!;
    await userEvent.click(within(thrust).getByText('Why'));
    expect(within(thrust).getByText('Hip thrusts keep posterior-chain work off the knee.')).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: 'Safety check' });
    expect(within(panel).getByText('Turkish get-up')).toBeInTheDocument();
    expect(within(panel).getByText(/AMRAP block has no time cap/)).toBeInTheDocument();
    // Refusals are never acknowledgeable.
    expect(within(panel).getAllByRole('button', { name: /^Acknowledge/ })).toHaveLength(1);

    const publish = screen.getByRole('button', { name: 'Publish to client' });
    expect(publish).toBeDisabled();
    expect(screen.getByText('Resolve the refusal before publishing.')).toBeInTheDocument();
  });

  it('acknowledges a warning with the key the server expects', async () => {
    fn('trainerProgram').mockResolvedValue({ program: program() });
    fn('acknowledgeWarnings').mockResolvedValue({ program: program({ check: { ...BLOCKED, guardrails: { ...BLOCKED.guardrails!, violations: BLOCKED.guardrails!.violations.slice(0, 1) } } }) });
    renderAt('/personal-training/programs/p1', <ProgramBuilderPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge: Leg curl, Left knee' }));
    await waitFor(() => expect(fn('acknowledgeWarnings')).toHaveBeenCalledWith('p1', ['leg curl|k1']));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Acknowledge/ })).not.toBeInTheDocument());
  });

  it('shows the returned check when publishing is refused, and says the client was told when it succeeds', async () => {
    fn('trainerProgram').mockResolvedValue({ program: program({ check: CLEAN }) });
    fn('publishProgram')
      .mockRejectedValueOnce(conflict('This program cannot be published until the conflicts are resolved', BLOCKED))
      .mockResolvedValueOnce({ program: program({ status: 'published', check: CLEAN }) });
    renderAt('/personal-training/programs/p1', <ProgramBuilderPage />);

    const publish = await screen.findByRole('button', { name: 'Publish to client' });
    await waitFor(() => expect(publish).toBeEnabled());
    await userEvent.click(publish);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Publishing was refused. Resolve what is listed below, then publish again.')).toBeInTheDocument();
    expect(await screen.findByText('Back squat loads squat, which Left knee is not cleared for', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish to client' })).toBeDisabled();
    expect(fn('saveProgram')).not.toHaveBeenCalled();
  });

  it('publishes and confirms the message went to the client', async () => {
    fn('trainerProgram').mockResolvedValue({ program: program({ check: CLEAN }) });
    fn('publishProgram').mockResolvedValue({ program: program({ status: 'published', check: CLEAN }) });
    renderAt('/personal-training/programs/p1', <ProgramBuilderPage />);
    const publish = await screen.findByRole('button', { name: 'Publish to client' });
    await waitFor(() => expect(screen.getByText('For Maya Okafor')).toBeInTheDocument());
    await userEvent.click(publish);
    expect(await screen.findByText('Published. Maya was sent a message with a link to view it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish to client' })).not.toBeInTheDocument();
  });

  it('autosaves a draft after an edit', async () => {
    fn('trainerProgram').mockResolvedValue({ program: program({ check: CLEAN }) });
    fn('saveProgram').mockImplementation(async (_id, patch) => ({ program: program({ ...patch, check: CLEAN }) }));
    renderAt('/personal-training/programs/p1', <ProgramBuilderPage />);
    const reps = (await screen.findAllByLabelText('Reps'))[0];
    await userEvent.clear(reps);
    await userEvent.type(reps, '3');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await waitFor(() => expect(fn('saveProgram')).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const sent = fn('saveProgram').mock.calls[0][1];
    expect(sent.doc.weeks[0].days[0].blocks[0].items[0].reps).toBe('3');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('says nothing was saved when a live edit conflicts', async () => {
    fn('trainerProgram').mockResolvedValue({ program: program({ status: 'published', check: CLEAN }) });
    fn('saveProgram').mockRejectedValue(conflict("This change conflicts with the client's contraindications or has a problem to fix first. Nothing was saved.", BLOCKED));
    renderAt('/personal-training/programs/p1', <ProgramBuilderPage />);
    expect(await screen.findByText(/live for the client/)).toBeInTheDocument();
    await userEvent.type(screen.getByDisplayValue('Hip thrust'), 's');
    // A live program never autosaves.
    await new Promise((r) => setTimeout(r, 1400));
    expect(fn('saveProgram')).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Nothing was saved.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Safety check' })).getByText('Back squat')).toBeInTheDocument();
  });
});

describe('Generate with Axiom', () => {
  it('shows calm progress, then opens the new draft', async () => {
    fn('programs').mockResolvedValue({ programs: [] });
    let finish!: (v: unknown) => void;
    fn('generateProgram').mockReturnValue(new Promise((r) => { finish = r; }));
    const { history } = renderAt('/personal-training/programs', <ProgramsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate with Axiom' }));
    const dialog = await screen.findByRole('dialog', { name: 'Generate with Axiom' });
    await userEvent.selectOptions(await within(dialog).findByLabelText('Client'), 'c1');
    expect(within(dialog).getByLabelText('Days a week')).toHaveValue('4');
    const submit = within(dialog).getByRole('button', { name: 'Draft the program' });
    await userEvent.type(within(dialog).getByLabelText('Brief'), 'Short');
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Brief'), ' block for a strong squat');
    await userEvent.click(within(dialog).getByLabelText('Band'));
    await userEvent.click(submit);
    expect(await within(dialog).findByText('Reading the intake and injuries on file')).toBeInTheDocument();
    expect(fn('generateProgram')).toHaveBeenCalledWith('c1', expect.objectContaining({
      brief: 'Short block for a strong squat', weeks: 4, daysPerWeek: 4, sessionMinutes: 60, experience: 'intermediate', equipment: ['barbell', 'dumbbell'],
    }));
    finish({ program: program({ id: 'p9' }) });
    await waitFor(() => expect(history.at(-1)).toBe('/personal-training/programs/p9'));
  });

  it('says calmly when Axiom cannot draft right now', async () => {
    fn('programs').mockResolvedValue({ programs: [] });
    fn('generateProgram').mockRejectedValue(new PersonalTrainingApiError('Axiom could not draft this program right now.', 503));
    renderAt('/personal-training/programs', <ProgramsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate with Axiom' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Client'), 'c2');
    await userEvent.type(within(dialog).getByLabelText('Brief'), 'Four weeks of general strength');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Draft the program' }));
    expect(await within(dialog).findByText(/Axiom could not draft this right now/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Draft the program' })).toBeEnabled();
  });

  it('shows a 400 in the server’s words', async () => {
    fn('programs').mockResolvedValue({ programs: [] });
    fn('generateProgram').mockRejectedValue(new PersonalTrainingApiError('Give this client a link or invite them before programming for them', 409));
    renderAt('/personal-training/programs', <ProgramsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate with Axiom' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Client'), 'c2');
    await userEvent.type(within(dialog).getByLabelText('Brief'), 'Four weeks of general strength');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Draft the program' }));
    expect(await within(dialog).findByText('Give this client a link or invite them before programming for them')).toBeInTheDocument();
  });
});

describe('programs list', () => {
  it('lists programs with status, shape and source, and filters templates', async () => {
    fn('programs').mockResolvedValue({ programs: [
      { id: 'p1', clientId: 'c1', clientName: 'Maya Okafor', name: 'Knee-friendly strength', status: 'published', isTemplate: false, weeks: 6, daysPerWeek: 3, source: 'ai', updatedAt: new Date().toISOString() },
      { id: 'p2', clientId: null, name: 'Beginner full body', status: 'draft', isTemplate: true, weeks: 4, daysPerWeek: 2, source: 'manual', updatedAt: new Date().toISOString() },
    ] });
    renderAt('/personal-training/programs', <ProgramsPage />);
    expect(await screen.findByText('Knee-friendly strength')).toBeInTheDocument();
    expect(screen.getByText(/Maya Okafor · 6 weeks · 3 days a week/)).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Templates/ }));
    expect(screen.queryByText('Knee-friendly strength')).not.toBeInTheDocument();
    expect(screen.getByText('Beginner full body')).toBeInTheDocument();
  });
});

describe('library', () => {
  it('refuses a non-https video link and saves a valid exercise', async () => {
    fn('contraindicationMeta').mockResolvedValue({ bodyParts: [], patterns: ['hinge', 'hip_thrust'] });
    fn('createExercise').mockResolvedValue({ exercise: {} });
    renderAt('/personal-training/library', <LibraryPage />);
    expect(await screen.findByText(/never remove anything/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add exercise' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an exercise' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'B-stance hip thrust');
    await userEvent.click(within(dialog).getByLabelText('Hip thrust'));
    await userEvent.type(within(dialog).getByLabelText('Video link (optional)'), 'http://example.com/v');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Use an https link.')).toBeInTheDocument();
    expect(fn('createExercise')).not.toHaveBeenCalled();
    await userEvent.clear(within(dialog).getByLabelText('Video link (optional)'));
    await userEvent.type(within(dialog).getByLabelText('Video link (optional)'), 'https://example.com/v');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fn('createExercise')).toHaveBeenCalledWith(expect.objectContaining({
      name: 'B-stance hip thrust', patterns: ['hip_thrust'], videoUrl: 'https://example.com/v',
    })));
  });
});

describe('dossier tabs', () => {
  it('shows the intake with unanswered and vague fields, and resets after confirming', async () => {
    fn('intake').mockResolvedValue({ intake: {
      status: 'in_progress', completeness: 40, current: 'schedule', transcript: [{ role: 'trainer', text: 'What is your main goal?', at: '' }, { role: 'client', text: 'Get stronger', at: '' }],
      fields: [
        { key: 'goal', label: 'Goal', required: true, answer: 'Get stronger', vague: true },
        { key: 'schedule', label: 'Schedule', required: true },
      ],
    } });
    fn('resetIntake').mockResolvedValue({ intake: { status: 'not_started', completeness: 0, current: 'goal', transcript: [], fields: [] } });
    window.confirm = vi.fn(() => true);
    renderAt('/personal-training/clients/c1/intake', <TimelinePage />);
    expect(await screen.findByText('40% complete', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Vague')).toBeInTheDocument();
    expect(screen.getByText('Not answered')).toBeInTheDocument();
    expect(screen.getByText('Being asked now')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/Conversation · 2/));
    expect(screen.getByText('What is your main goal?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset intake' }));
    await waitFor(() => expect(fn('resetIntake')).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText(/starts the intake from their web link/)).toBeInTheDocument();
  });

  it('shows nutrition rollups and saves targets, clearing empty ones', async () => {
    const rollup = (d: number) => ({ windowDays: d, daysLogged: 5, avgCalories: 2104, avgProteinG: 131, avgCarbsG: 220, avgFatG: 70, caloriesOnTarget: 3, proteinOnTarget: 4 });
    const n = { targets: { calories: 2200, proteinG: 150, carbsG: null, fatG: null }, appCalorieTarget: 2400, week: rollup(7), month: rollup(28), line: 'Logged 5 of the last 7 days.', patterns: ['Protein drops at weekends'], days: [{ date: '2026-10-15', calories: 2050, proteinG: 140, carbsG: 210, fatG: 66 }] };
    fn('nutrition').mockResolvedValue({ nutrition: n });
    fn('setNutritionTargets').mockResolvedValue({ nutrition: n });
    renderAt('/personal-training/clients/c1/nutrition', <TimelinePage />);
    expect(await screen.findByText('Logged 5 of the last 7 days.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Patterns worth a conversation' })).getByText('Protein drops at weekends')).toBeInTheDocument();
    expect(screen.getByText('Their own calorie target in the app is 2,400 kcal.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Last 28 days' })).getByText('5 of 28 days logged')).toBeInTheDocument();
    expect(screen.getByText(/2,050 kcal/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Protein (g)'));
    await userEvent.type(screen.getByLabelText('Fat (g)'), '75');
    await userEvent.click(screen.getByRole('button', { name: 'Save targets' }));
    await waitFor(() => expect(fn('setNutritionTargets')).toHaveBeenCalledWith('c1', { calories: 2200, proteinG: null, carbsG: null, fatG: 75 }));
  });

  it('points to billing setup when Stripe is not connected', async () => {
    fn('billingStatus').mockResolvedValue({ status: { available: true, connected: false } });
    renderAt('/personal-training/clients/c1/billing', <TimelinePage />);
    expect(await screen.findByText(/Connect Stripe to take payments/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up billing' })).toHaveAttribute('href', '/personal-training/billing');
    expect(fn('clientBilling')).not.toHaveBeenCalled();
  });

  it('lists plans and payments and makes a payment link', async () => {
    const offer = { id: 'o1', name: '10-pack', description: '', kind: 'package', priceCents: 50000, currency: 'gbp', interval: null, intervalCount: 1, sessionCredits: 10, active: true };
    fn('billingStatus').mockResolvedValue({ status: { available: true, connected: true } });
    fn('clientBilling').mockResolvedValue({
      plans: [{ id: 'pl1', clientId: 'c1', offer, status: 'active', creditsTotal: 10, creditsUsed: 3, creditsLeft: 7, createdAt: '2026-10-01T00:00:00.000Z' }],
      payments: [{ id: 'pay1', clientId: 'c1', kind: 'checkout', amountDueCents: 50000, amountPaidCents: 50000, currency: 'gbp', status: 'paid', attemptCount: 1, paidAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' }],
    });
    fn('offers').mockResolvedValue({ offers: [offer] });
    fn('paymentRequestLink').mockResolvedValue({ url: 'https://axiomtraining.io/c/x?tab=billing&offer=o1' });
    renderAt('/personal-training/clients/c1/billing', <TimelinePage />);
    expect(await screen.findByText(/7 of 10 sessions left/)).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Offer'), 'o1');
    await userEvent.click(screen.getByRole('button', { name: 'Create payment link' }));
    expect(await screen.findByDisplayValue('https://axiomtraining.io/c/x?tab=billing&offer=o1')).toBeInTheDocument();
    expect(fn('paymentRequestLink')).toHaveBeenCalledWith('c1', 'o1');
  });
});

describe('export', () => {
  it('downloads the full JSON with auth', async () => {
    fn('practiceProfile').mockResolvedValue({ profile: { name: 'Kofi Coaching', bio: '', specialties: [], styleTags: [], languages: [], format: null, timezone: null, brandColor: null, accentColor: null, logoUrl: null, publicPage: false } });
    downloadFile.mockResolvedValue(undefined);
    renderAt('/personal-training/settings/practice', <PracticeSettingsPage />);
    expect(await screen.findByText('Everything you and your clients have in Axiom, so you can take it anywhere.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Everything (JSON)' }));
    expect(downloadFile).toHaveBeenCalledWith('/personal-training/export', 'axiom-export.json');
  });
});

describe('public page', () => {
  it('turns on the public page, shows its link, and saves it', async () => {
    fn('practiceProfile').mockResolvedValue({ profile: { name: 'Kofi Coaching', bio: '', specialties: [], styleTags: [], languages: [], format: null, timezone: null, brandColor: null, accentColor: null, logoUrl: null, publicPage: false } });
    fn('savePracticeProfile').mockImplementation(async (p) => ({ profile: { ...p, logoUrl: null } }));
    renderAt('/personal-training/settings/practice', <PracticeSettingsPage />);
    const url = `${window.location.origin}/p/pt-kofi`;
    expect(await screen.findByText(new RegExp(`enquiry form at ${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument();
    expect(screen.queryByDisplayValue(url)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Show a public page' }));
    expect(screen.getByDisplayValue(url)).toBeInTheDocument();
    expect(screen.getByText('The page goes live when you save.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fn('savePracticeProfile')).toHaveBeenCalledWith(expect.objectContaining({ publicPage: true })));
  });

  it('shows no patterns section when there are none', async () => {
    const rollup = { windowDays: 7, daysLogged: 0, avgCalories: null, avgProteinG: null, avgCarbsG: null, avgFatG: null, caloriesOnTarget: null, proteinOnTarget: null };
    fn('nutrition').mockResolvedValue({ nutrition: { targets: null, appCalorieTarget: null, week: rollup, month: { ...rollup, windowDays: 28 }, line: 'No meals logged this week.', patterns: [], days: [] } });
    renderAt('/personal-training/clients/c1/nutrition', <TimelinePage />);
    expect(await screen.findByText('No meals logged this week.')).toBeInTheDocument();
    expect(screen.queryByText('Patterns worth a conversation')).not.toBeInTheDocument();
  });
});
