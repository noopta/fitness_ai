/**
 * Importing clients from a spreadsheet: upload → review → correct the layout
 * → confirm → undo, and how a "Not joined" client appears afterwards.
 * The API module is mocked; the file itself is read for real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { PersonalTrainingApiError, type Client, type ImportPreview, type SheetMapping } from '@axiom/personal-training-core';

const api = vi.hoisted(() => {
  const names = [
    'me', 'roster', 'imports', 'createImport', 'updateImportMapping', 'confirmImport', 'undoImport', 'inviteProspect', 'invite',
    'client', 'timeline', 'notifications', 'anakinFilter', 'requestCheckIns', 'messageClient',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
vi.mock('@/features/personal-training/api', () => ({ ptApi: api, streamEvents: vi.fn() }));
vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => <div data-testid="brand-logo" /> }));

import ImportPage from '@/features/personal-training/pages/ImportPage';
import RosterPage from '@/features/personal-training/pages/RosterPage';
import TimelinePage from '@/features/personal-training/pages/TimelinePage';

const ME = { trainer: { id: 't1', name: 'Kofi Mensah', initials: 'KM' }, practice: { id: 'p1', name: 'Kofi Coaching', slug: 'pt-kofi', logoUrl: null } };

const mapping = (over: Partial<SheetMapping> = {}): SheetMapping => ({
  sheet: 'Log', kind: 'workouts', headerRow: 0, columns: { client: 0, date: 1, exercise: 2, weight: 3 }, clientFrom: 'column', unit: 'kg', dateOrder: 'dmy', ...over,
});

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  id: 'imp1', fileName: 'clients.csv', status: 'review', createdAt: '2026-10-02T09:00:00.000Z',
  sheets: [{ name: 'Log', rowCount: 4, sample: [['Client', 'Date', 'Exercise', 'Load'], ['Priya Nair', '3/9/2026', 'Back squat', '60'], ['Jordan Lee', '4/9/2026', 'Deadlift', '150']], mapping: mapping() }],
  summary: { clients: 2, workouts: 2, bodyweights: 0, skippedRows: 1 },
  assumptions: ['"Log": dates like 3/4/2026 read as day/month/year'],
  warnings: ['1 row skipped: date could not be read ("Log" row 4)'],
  clients: [
    { key: 'priya nair', name: 'Priya Nair', email: null, workouts: 1, bodyweights: 0, firstDate: '2026-09-03', lastDate: '2026-09-03', matchesExisting: false, sample: [{ date: '2026-09-03', summary: 'Back squat 3×5 at 60 kg' }] },
    { key: 'jordan lee', name: 'Jordan Lee', email: 'jordan@example.com', workouts: 1, bodyweights: 0, firstDate: '2026-09-04', lastDate: '2026-09-04', matchesExisting: true, sample: [] },
  ],
  ...over,
});

const prospect: Client = {
  id: 'prospect:abc', name: 'Priya Nair', initials: 'PN', email: 'priya@example.com', avatarUrl: null, status: 'notJoined',
  statusReason: 'Not on Axiom yet · 2 imported sessions', program: null, engagement8w: [0, 0, 0, 0, 0, 0, 0, 0], engagementTrend: 'steady',
  lastCheckInAt: null, lastActiveAt: null, contraindications: [], joinedAt: '2026-10-02T09:00:00.000Z',
} as unknown as Client;

function renderAt(path: string, ui: React.ReactElement) {
  const { hook } = memoryLocation({ path });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Router hook={hook}>{ui}</Router></QueryClientProvider>);
}

const csv = (text = 'Client,Date,Exercise,Load\nPriya Nair,3/9/2026,Back squat,60\n') => new File([text], 'clients.csv', { type: 'text/csv' });
const upload = async (file: File) => userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file, { applyAccept: false });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.me.mockResolvedValue(ME);
  api.notifications.mockResolvedValue({ immediate: [], unread: 0, heldForBriefing: 0, recordedQuietly: 0 });
  api.imports.mockResolvedValue({ imports: [] });
});

describe('import page', () => {
  it('uploads the cells of the chosen file and shows what was found before importing anything', async () => {
    api.createImport.mockResolvedValue(preview());
    renderAt('/personal-training/import', <ImportPage />);
    await screen.findByRole('button', { name: 'Choose a file' });
    await upload(csv());

    expect(await screen.findByRole('heading', { name: 'Check what was found' })).toBeInTheDocument();
    expect(api.createImport).toHaveBeenCalledWith({ fileName: 'clients.csv', sheets: [{ name: 'clients', rows: [['Client', 'Date', 'Exercise', 'Load'], ['Priya Nair', '3/9/2026', 'Back squat', '60']] }] });
    expect(screen.getByText(/2 clients, 2 sessions and 0 bodyweight entries found/)).toBeInTheDocument();
    expect(screen.getByText('"Log": dates like 3/4/2026 read as day/month/year')).toBeInTheDocument();
    expect(screen.getByText('1 row skipped: date could not be read ("Log" row 4)')).toBeInTheDocument();
    const found = within(screen.getByRole('region', { name: 'Clients found' }));
    expect(found.getByText('No email')).toBeInTheDocument();
    expect(found.getByText('Already your client')).toBeInTheDocument();
    expect(screen.getByText('1 will be added as Not joined.')).toBeInTheDocument();
    expect(api.confirmImport).not.toHaveBeenCalled();
  });

  it('re-reads the file when the layout is corrected, and only then offers the import', async () => {
    api.createImport.mockResolvedValue(preview());
    api.updateImportMapping.mockResolvedValue(preview({ summary: { clients: 2, workouts: 2, bodyweights: 0, skippedRows: 0 }, sheets: [{ ...preview().sheets[0], mapping: mapping({ dateOrder: 'mdy' }) }], warnings: [] }));
    renderAt('/personal-training/import', <ImportPage />);
    await screen.findByRole('button', { name: 'Choose a file' });
    await upload(csv());
    await screen.findByRole('heading', { name: 'Check what was found' });

    await userEvent.selectOptions(screen.getByLabelText('Dates are written'), 'mdy');
    // With an unapplied change the primary action is to apply it, not to import.
    expect(screen.queryByRole('button', { name: 'Import 2 clients' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(api.updateImportMapping).toHaveBeenCalledWith('imp1', [mapping({ dateOrder: 'mdy' })]));
    expect(await screen.findByRole('button', { name: 'Import 2 clients' })).toBeInTheDocument();
    expect(screen.queryByText(/row skipped/)).not.toBeInTheDocument();
  });

  it('gives a column to one field at a time', async () => {
    api.createImport.mockResolvedValue(preview());
    api.updateImportMapping.mockResolvedValue(preview());
    renderAt('/personal-training/import', <ImportPage />);
    await screen.findByRole('button', { name: 'Choose a file' });
    await upload(csv());
    await screen.findByRole('heading', { name: 'Check what was found' });
    await userEvent.selectOptions(screen.getByLabelText('Session name'), '3');
    expect((screen.getByLabelText('Load') as HTMLSelectElement).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(api.updateImportMapping).toHaveBeenCalledWith('imp1', [mapping({ columns: { client: 0, date: 1, exercise: 2, sessionTitle: 3 } })]));
  });

  it('imports on confirm and offers the roster', async () => {
    api.createImport.mockResolvedValue(preview());
    api.confirmImport.mockResolvedValue({ import: { id: 'imp1', fileName: 'clients.csv', status: 'imported', clients: 2, workouts: 2, createdAt: '', importedAt: '2026-10-02T09:01:00.000Z' } });
    renderAt('/personal-training/import', <ImportPage />);
    await screen.findByRole('button', { name: 'Choose a file' });
    await upload(csv());
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 clients' }));
    expect(await screen.findByText('Imported 2 clients and 2 sessions.')).toBeInTheDocument();
    expect(api.confirmImport).toHaveBeenCalledWith('imp1');
    expect(screen.getByRole('link', { name: 'View roster' })).toHaveAttribute('href', '/personal-training/clients');
  });

  it('does not offer to import when nothing was found', async () => {
    api.createImport.mockResolvedValue(preview({ summary: { clients: 0, workouts: 0, bodyweights: 0, skippedRows: 0 }, clients: [], sheets: [{ ...preview().sheets[0], mapping: mapping({ kind: 'ignore', columns: {} }) }] }));
    renderAt('/personal-training/import', <ImportPage />);
    await screen.findByRole('button', { name: 'Choose a file' });
    await upload(csv());
    expect(await screen.findByText(/Nothing was found to import/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 0 clients' })).toBeDisabled();
  });

  it('explains a file it cannot read without calling the server', async () => {
    renderAt('/personal-training/import', <ImportPage />);
    await screen.findByRole('button', { name: 'Choose a file' });
    await upload(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])], 'old.xls'));
    expect(await screen.findByRole('alert')).toHaveTextContent('That file could not be read. Save it as .xlsx or .csv and try again.');
    expect(api.createImport).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason when it rejects the upload', async () => {
    api.createImport.mockRejectedValue(new PersonalTrainingApiError('No rows were found in that file', 400, null));
    renderAt('/personal-training/import', <ImportPage />);
    await screen.findByRole('button', { name: 'Choose a file' });
    await upload(csv());
    expect(await screen.findByRole('alert')).toHaveTextContent('No rows were found in that file');
  });

  it('lists past imports and undoes one only after a second, explicit press', async () => {
    api.imports.mockResolvedValue({ imports: [
      { id: 'imp0', fileName: 'march.xlsx', status: 'imported', clients: 4, workouts: 31, createdAt: '2026-09-20T09:00:00.000Z', importedAt: '2026-09-20T09:01:00.000Z' },
      { id: 'impU', fileName: 'old.csv', status: 'undone', clients: 1, workouts: 2, createdAt: '2026-09-01T09:00:00.000Z', importedAt: '2026-09-01T09:01:00.000Z' },
      { id: 'impR', fileName: 'abandoned.csv', status: 'review', clients: 0, workouts: 0, createdAt: '2026-09-01T09:00:00.000Z' },
    ] });
    api.undoImport.mockResolvedValue({ ok: true });
    renderAt('/personal-training/import', <ImportPage />);
    const past = within(await screen.findByRole('region', { name: 'Past imports' }));
    expect(past.getByText('march.xlsx')).toBeInTheDocument();
    expect(past.getByText(/4 clients · 31 sessions/)).toBeInTheDocument();
    expect(past.getByText('Undone')).toBeInTheDocument();
    expect(past.queryByText('abandoned.csv')).not.toBeInTheDocument();

    await userEvent.click(past.getByRole('button', { name: 'Undo this import' }));
    expect(api.undoImport).not.toHaveBeenCalled();
    expect(past.getByText(/removes everything this file added/)).toBeInTheDocument();
    await userEvent.click(past.getByRole('button', { name: 'Undo this import' }));
    await waitFor(() => expect(api.undoImport).toHaveBeenCalledWith('imp0'));
  });
});

describe('a client who has not joined', () => {
  it('is labelled on the roster, counted under its own filter, and reachable from the import button', async () => {
    api.roster.mockResolvedValue({ clients: [prospect], counts: { support: 0, new: 0, onPlan: 0, paused: 0, notJoined: 1 } });
    renderAt('/personal-training/clients', <RosterPage />);
    expect((await screen.findAllByText('Priya Nair')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not joined').length).toBeGreaterThan(1); // the chip and the pill
    expect(screen.getAllByText('Not on Axiom yet · 2 imported sessions').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Import clients' })).toHaveAttribute('href', '/personal-training/import');
    expect(screen.getAllByRole('link', { name: /Priya Nair/ })[0]).toHaveAttribute('href', '/personal-training/clients/prospect:abc/timeline');
  });

  it('cannot be messaged; the profile offers an invite bound to their email instead', async () => {
    api.client.mockResolvedValue({ client: prospect });
    api.timeline.mockResolvedValue({ events: [], nextCursor: null });
    api.inviteProspect.mockResolvedValue({ token: 'tok', link: 'https://axiomtraining.io/personal-training/join/tok', email: 'priya@example.com', expiresAt: '2026-10-16T09:00:00.000Z' });
    renderAt('/personal-training/clients/prospect:abc/timeline', <TimelinePage />);

    expect(await screen.findByText('Priya has not joined Axiom yet. This is their imported history.')).toBeInTheDocument();
    expect(api.client).toHaveBeenCalledWith('prospect:abc');
    expect(screen.queryByRole('button', { name: 'Message Priya' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request check-in' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Invite to Axiom' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText('Their email address')).toHaveValue('priya@example.com');
    await userEvent.click(dialog.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(api.inviteProspect).toHaveBeenCalledWith('prospect:abc', 'priya@example.com'));
    expect(await dialog.findByDisplayValue('https://axiomtraining.io/personal-training/join/tok')).toBeInTheDocument();
  });
});
