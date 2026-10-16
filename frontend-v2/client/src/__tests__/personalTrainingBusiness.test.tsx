/**
 * Trainer business surfaces: the nav (More sheet, inbox badge), the inbox
 * (thread list, context strip, direct message with undo, drafted reply),
 * billing (not set up, connect, connected dashboard, offers, settings) and
 * the schedule (week actions, availability validation, booking a client).
 * The API module is mocked; routing uses wouter's in-memory location.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { BillingStatus, BookingView, InboxConversation, InboxThread, OfferView, RevenueSummary } from '@axiom/personal-training-core';

const api = vi.hoisted(() => {
  const names = [
    'me', 'roster', 'notifications', 'markNotificationsRead', 'inbox', 'inboxThread', 'draftInboxReply', 'messageClient', 'sendDraft', 'undoDraft', 'redraft',
    'billingStatus', 'connectStripe', 'saveBillingSettings', 'offers', 'createOffer', 'archiveOffer', 'revenue',
    'availability', 'setAvailability', 'bookings', 'bookSession', 'updateBooking',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
vi.mock('@/features/personal-training/api', () => ({ ptApi: api, streamEvents: vi.fn() }));
vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => <div data-testid="brand-logo" /> }));

import InboxPage from '@/features/personal-training/pages/InboxPage';
import BillingPage, { offerFromForm } from '@/features/personal-training/pages/BillingPage';
import SchedulePage from '@/features/personal-training/pages/SchedulePage';

const ME = { trainer: { id: 't1', name: 'Kofi Mensah', initials: 'KM' }, practice: { id: 'p1', name: 'Kofi Coaching', slug: 'pt-kofi', logoUrl: null } };

const thread = (over: Partial<InboxThread> = {}): InboxThread => ({
  clientId: 'c1', client: { id: 'c1', name: 'Maya Okafor', initials: 'MO', status: 'support', channel: 'app' },
  lastMessage: { body: 'Knee is sore again', at: new Date().toISOString(), fromClient: true }, unread: 2, awaitingReply: true, ...over,
});

const CONVO: InboxConversation = {
  client: { id: 'c1', name: 'Maya Okafor', initials: 'MO', status: 'support', channel: 'app' },
  context: {
    status: 'support', statusReason: 'Missed two sessions', block: { blockLabel: 'Strength', week: 3, weeks: 8, goal: 'Squat 100 kg' },
    lastSessionAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), contraindications: ['Left knee'], goals: ['Squat 100 kg'], nutrition: 'Logged 4 of 7 days',
  },
  messages: [
    { id: 'm1', body: 'How did it go?', at: '2026-10-14T09:00:00.000Z', fromClient: false },
    { id: 'm2', body: 'Knee is sore again', at: '2026-10-14T10:00:00.000Z', fromClient: true },
  ],
};

const STATUS = (over: Partial<BillingStatus> = {}): BillingStatus => ({
  available: true, connected: true, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, currency: 'gbp',
  dunningNudges: true, bookingNeedsCredit: false, platformFeePercent: 0, ...over,
});

const OFFER: OfferView = { id: 'o1', name: 'Monthly coaching', description: '', kind: 'subscription', priceCents: 6000, currency: 'gbp', interval: 'month', intervalCount: 1, sessionCredits: 4, active: true };

const REVENUE: RevenueSummary = {
  currency: 'gbp', mrrCents: 240000, collected30Cents: 180000, activeSubscriptions: 40, pastDue: 2, failingCents: 12000, churned30: 1, churnRate30: 2.5,
  perOffer: [{ offerId: 'o1', name: 'Monthly coaching', active: 40, sold30: 3 }],
  recent: [{ id: 'pay1', clientId: 'c1', kind: 'invoice', amountDueCents: 6000, amountPaidCents: 6000, currency: 'gbp', status: 'paid', attemptCount: 1, paidAt: '2026-10-10T00:00:00.000Z', createdAt: '2026-10-10T00:00:00.000Z' }],
  platformFeePercent: 0,
};

function renderAt(path: string, ui: React.ReactElement) {
  const { hook, searchHook } = memoryLocation({ path });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Router hook={hook} searchHook={searchHook}>{ui}</Router></QueryClientProvider>);
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  (window.location.assign as ReturnType<typeof vi.fn>).mockClear?.();
  api.me.mockResolvedValue(ME);
  api.notifications.mockResolvedValue({ immediate: [], unread: 0, heldForBriefing: 0, recordedQuietly: 0 });
  api.inbox.mockResolvedValue({ threads: [thread(), thread({ clientId: 'c2', client: { id: 'c2', name: 'Priya Nair', initials: 'PN', status: 'onPlan', channel: 'webLink' }, unread: 0, awaitingReply: false, lastMessage: { body: 'Thanks!', at: '2026-10-01T10:00:00.000Z', fromClient: false } })] });
  api.inboxThread.mockResolvedValue(CONVO);
  api.roster.mockResolvedValue({ clients: [{ id: 'c1', name: 'Maya Okafor', initials: 'MO', status: 'onPlan', channel: 'app' }], counts: {} });
});

describe('dashboard nav', () => {
  it('links the business surfaces, badges unread messages, and keeps the phone bar to five', async () => {
    const user = userEvent.setup();
    renderAt('/personal-training/inbox', <InboxPage />);
    await screen.findByText('Maya Okafor');
    const [rail, bar] = screen.getAllByRole('navigation', { name: /personal training/i });
    expect(within(rail).getByRole('link', { name: /Inbox.*2 unread messages/ })).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/personal-training/billing');
    expect(within(bar).getAllByRole('link')).toHaveLength(4);

    await user.click(within(bar).getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog');
    for (const name of ['Programs', 'Schedule', 'Billing', 'Settings']) expect(within(sheet).getByRole('link', { name })).toBeInTheDocument();
  });
});

describe('inbox', () => {
  it('lists threads with awaiting, unread and web-link badges', async () => {
    renderAt('/personal-training/inbox', <InboxPage />);
    const list = await screen.findByRole('navigation', { name: 'Inbox' });
    const rows = within(list).getAllByRole('link');
    expect(rows[0]).toHaveTextContent('Maya Okafor');
    expect(rows[0]).toHaveTextContent('Awaiting reply');
    expect(rows[0]).toHaveTextContent('2 unread messages');
    expect(rows[1]).toHaveTextContent('Web link');
    expect(rows[1]).toHaveTextContent('You: Thanks!');
  });

  it('shows the context strip and sends a direct message with undo', async () => {
    const user = userEvent.setup();
    api.messageClient.mockResolvedValue({ draft: { id: 'd1', clientId: 'c1', text: 'Rest it', channel: 'app', status: 'sending', undoUntil: new Date(Date.now() + 60_000).toISOString() } });
    api.undoDraft.mockResolvedValue({ draft: { id: 'd1', clientId: 'c1', text: 'Rest it', channel: 'app', status: 'pending' } });
    renderAt('/personal-training/inbox/c1', <InboxPage />);

    const ctx = await screen.findByRole('region', { name: 'Client context' });
    expect(within(ctx).getByText('Missed two sessions')).toBeInTheDocument();
    expect(within(ctx).getByText('Strength · week 3 of 8')).toBeInTheDocument();
    expect(within(ctx).getByText('Left knee')).toBeInTheDocument();
    expect(within(ctx).getByText('Logged 4 of 7 days')).toBeInTheDocument();
    expect(within(ctx).getByRole('link', { name: /Open client record/ })).toHaveAttribute('href', '/personal-training/clients/c1/overview');
    expect(screen.getByRole('log')).toHaveTextContent('Knee is sore again');

    await user.type(screen.getByLabelText('Message Maya'), 'Rest it');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.messageClient).toHaveBeenCalledWith('c1', 'Rest it');
    expect(await screen.findByText('Sent. Delivered when the undo window closes.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.undoDraft).toHaveBeenCalledWith('d1'));
    expect(await screen.findByLabelText('Message Maya')).toHaveValue('Rest it');
  });

  it('drafts a reply for the trainer to edit and send', async () => {
    const user = userEvent.setup();
    api.draftInboxReply.mockResolvedValue({ draft: { id: 'd2', clientId: 'c1', text: 'Sorry to hear that, Maya.', channel: 'app', status: 'pending' } });
    api.sendDraft.mockResolvedValue({ draft: { id: 'd2', clientId: 'c1', text: 'Sorry to hear that.', channel: 'app', status: 'sending', undoUntil: new Date(Date.now() + 60_000).toISOString() } });
    renderAt('/personal-training/inbox/c1', <InboxPage />);
    await user.click(await screen.findByRole('button', { name: /Draft a reply/ }));
    const box = await screen.findByLabelText('Message Maya');
    expect(box).toHaveValue('Sorry to hear that, Maya.');
    await user.clear(box);
    await user.type(box, 'Sorry to hear that.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.sendDraft).toHaveBeenCalledWith('d2', 'Sorry to hear that.');
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });
});

describe('billing', () => {
  it('says so when payments are not set up on the server', async () => {
    api.billingStatus.mockResolvedValue({ status: STATUS({ available: false, connected: false, chargesEnabled: false }) });
    renderAt('/personal-training/billing', <BillingPage />);
    expect(await screen.findByText("Payments aren't set up on this server yet.")).toBeInTheDocument();
  });

  it('explains the 0% fee and sends the trainer to Stripe', async () => {
    const user = userEvent.setup();
    api.billingStatus.mockResolvedValue({ status: STATUS({ connected: false, chargesEnabled: false }) });
    api.connectStripe.mockResolvedValue({ url: 'https://connect.stripe.com/setup/abc' });
    renderAt('/personal-training/billing', <BillingPage />);
    expect(await screen.findByText('0% platform fee')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Connect Stripe/ }));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://connect.stripe.com/setup/abc'));
  });

  it('asks Stripe again on return from onboarding', async () => {
    api.billingStatus.mockResolvedValue({ status: STATUS() });
    api.revenue.mockResolvedValue({ revenue: REVENUE });
    api.offers.mockResolvedValue({ offers: [OFFER] });
    renderAt('/personal-training/billing?connect=done', <BillingPage />);
    await waitFor(() => expect(api.billingStatus).toHaveBeenCalledWith(true));
  });

  it('shows revenue, creates and archives offers, and saves settings', async () => {
    const user = userEvent.setup();
    api.billingStatus.mockResolvedValue({ status: STATUS() });
    api.revenue.mockResolvedValue({ revenue: REVENUE });
    api.offers.mockResolvedValue({ offers: [OFFER] });
    api.createOffer.mockResolvedValue({ offer: { ...OFFER, id: 'o2', name: '10-pack', kind: 'package', interval: null, priceCents: 45000, sessionCredits: 10 } });
    api.archiveOffer.mockResolvedValue({ ok: true });
    api.saveBillingSettings.mockResolvedValue({ status: STATUS({ bookingNeedsCredit: true }) });
    renderAt('/personal-training/billing', <BillingPage />);

    expect(await screen.findByText('Monthly recurring')).toBeInTheDocument();
    expect(screen.getByText('£2,400')).toBeInTheDocument();
    expect(screen.getByText('2.5%')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Monthly coaching');

    await user.click(screen.getByRole('button', { name: /New offer/ }));
    const form = screen.getByRole('form', { name: 'New offer' });
    await user.type(within(form).getByLabelText('Name'), '10-pack');
    await user.type(within(form).getByLabelText('Price (GBP)'), '450');
    await user.click(within(form).getByRole('radio', { name: 'Session package' }));
    await user.type(within(form).getByLabelText('Sessions included'), '10');
    await user.click(within(form).getByRole('button', { name: 'Create offer' }));
    await waitFor(() => expect(api.createOffer).toHaveBeenCalledWith({ name: '10-pack', kind: 'package', priceCents: 45000, sessionCredits: 10 }));
    expect(await screen.findByText('Offer created.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive Monthly coaching' }));
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.archiveOffer).toHaveBeenCalledWith('o1'));

    await user.click(screen.getByRole('switch', { name: 'Booking needs a session credit' }));
    await waitFor(() => expect(api.saveBillingSettings).toHaveBeenCalledWith({ bookingNeedsCredit: true }));
  });

  it('turns the offer form into cents and checks it', () => {
    const base = { name: 'Monthly', description: '', kind: 'subscription' as const, price: '59.99', interval: 'month' as const, intervalCount: '1', sessions: '' };
    expect(offerFromForm(base)).toEqual({ offer: { name: 'Monthly', kind: 'subscription', priceCents: 5999, interval: 'month', intervalCount: 1, sessionCredits: null } });
    expect(offerFromForm({ ...base, price: 'abc' })).toEqual({ error: expect.stringMatching(/price/) });
    expect(offerFromForm({ ...base, kind: 'package', sessions: '' })).toEqual({ error: expect.stringMatching(/Sessions/) });
    expect(offerFromForm({ ...base, kind: 'one_time', sessions: '3' })).toEqual({ offer: { name: 'Monthly', kind: 'one_time', priceCents: 5999 } });
  });
});

describe('schedule', () => {
  const booking = (over: Partial<BookingView> = {}): BookingView => {
    const start = new Date(); start.setHours(10, 0, 0, 0);
    const end = new Date(start); end.setHours(11);
    return { id: 'b1', clientId: 'c1', clientName: 'Maya Okafor', trainerId: 't1', startsAt: start.toISOString(), endsAt: end.toISOString(), status: 'booked', source: 'portal', usedCredit: true, location: 'Studio', notes: null, ...over };
  };

  beforeEach(() => {
    api.bookings.mockResolvedValue({ bookings: [booking()] });
    api.availability.mockResolvedValue({ windows: [{ id: 'w1', weekday: 1, startMinute: 540, endMinute: 720, slotMinutes: 60, location: null }] });
  });

  it('lists this week with complete, no-show and cancel', async () => {
    const user = userEvent.setup();
    api.updateBooking.mockImplementation(async (id: string, status: BookingView['status']) => ({ booking: booking({ id, status }) }));
    renderAt('/personal-training/schedule', <SchedulePage />);
    expect(await screen.findByText('Maya Okafor')).toBeInTheDocument();
    expect(screen.getByText('Booked by client')).toBeInTheDocument();
    const [from, to] = [api.bookings.mock.calls[0][0].from, api.bookings.mock.calls[0][0].to];
    expect(new Date(to).getTime() - new Date(from).getTime()).toBeGreaterThanOrEqual(6.9 * 86_400_000);

    await user.click(screen.getByRole('button', { name: 'Cancel: Maya Okafor' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel session' }));
    await waitFor(() => expect(api.updateBooking).toHaveBeenCalledWith('b1', 'cancelled'));
  });

  it('validates availability before saving and then saves', async () => {
    const user = userEvent.setup();
    api.setAvailability.mockImplementation(async (windows: unknown[]) => ({ windows }));
    renderAt('/personal-training/schedule', <SchedulePage />);
    await screen.findByLabelText('Day', { selector: '#aw-0-day' });

    await user.click(screen.getByRole('button', { name: /Add window/ }));
    // The new window lands on the same Monday, 9–12: an overlap.
    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    expect(await screen.findAllByText(/Overlaps another Monday window/)).toHaveLength(2);
    expect(api.setAvailability).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText('Day', { selector: '#aw-1-day' }), '3');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    await waitFor(() => expect(api.setAvailability).toHaveBeenCalledWith([
      { weekday: 1, startMinute: 540, endMinute: 720, slotMinutes: 60, location: null },
      { weekday: 3, startMinute: 540, endMinute: 720, slotMinutes: 60, location: null },
    ]));
    expect(await screen.findByText('Availability saved.')).toBeInTheDocument();
  });

  it('books a client for a date and time', async () => {
    const user = userEvent.setup();
    api.bookSession.mockResolvedValue({ booking: booking({ id: 'b2' }) });
    renderAt('/personal-training/schedule', <SchedulePage />);
    await screen.findByText('Maya Okafor', { selector: 'p' });
    await user.selectOptions(screen.getByLabelText('Client'), 'c1');
    const date = screen.getByLabelText('Date');
    await user.clear(date);
    await user.type(date, '2026-11-02');
    await user.click(screen.getByRole('button', { name: 'Book session' }));
    await waitFor(() => expect(api.bookSession).toHaveBeenCalledWith({ clientId: 'c1', startsAt: new Date('2026-11-02T09:00:00').toISOString(), minutes: 60 }));
    expect(await screen.findByText('Session booked.')).toBeInTheDocument();
  });
});
