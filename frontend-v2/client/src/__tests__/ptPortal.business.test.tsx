/**
 * Client portal, phase 3: booking (open slots, slot taken, no credit,
 * cancelling with the notice rule), paying (picked offer, checkout, thank-you,
 * manage) and the five-item bar with More. Real PortalApp, stubbed fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { BookingView, ClientPlanView, OfferView, PortalHome, Slot } from '@axiom/personal-training-core';
import PortalApp from '@/features/pt-portal/PortalApp';
import { cancelMessage, totalCredits } from '@/features/pt-portal/screens/BookScreen';

const HOME: PortalHome = {
  client: { firstName: 'Maya', name: 'Maya Okafor', unit: 'kg' },
  branding: { practiceName: 'Kofi Coaching', trainerName: 'Kofi Mensah', logoUrl: null, brandColor: null, accentColor: null },
  checkIns: [], goals: [], unreadMessages: 0, hasProgram: false, intake: { status: 'complete', completeness: 100 }, photosEnabled: true, reports: [],
};

const inDays = (d: number, h = 10) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x; };
const slot = (localDate: string, localMinute: number): Slot => ({ trainerId: 't1', trainerName: 'Kofi Mensah', startsAt: `${localDate}T${String(localMinute / 60).padStart(2, '0')}:00:00.000Z`, endsAt: '', location: 'Studio', localDate, localMinute });
const booking = (over: Partial<BookingView> = {}): BookingView => ({
  id: 'b1', clientId: 'c1', clientName: 'Maya', trainerId: 't1', startsAt: inDays(3).toISOString(), endsAt: inDays(3, 11).toISOString(),
  status: 'booked', source: 'portal', usedCredit: true, location: 'Studio', notes: null, ...over,
});
const OFFERS: OfferView[] = [
  { id: 'o1', name: 'Monthly coaching', description: 'Program, check-ins, 4 sessions', kind: 'subscription', priceCents: 6000, currency: 'gbp', interval: 'month', intervalCount: 1, sessionCredits: 4, active: true },
  { id: 'o2', name: '10-session pack', description: '', kind: 'package', priceCents: 45000, currency: 'gbp', interval: null, intervalCount: 1, sessionCredits: 10, active: true },
];
const plan = (creditsLeft: number): ClientPlanView => ({ id: 'pl1', clientId: 'c1', offer: OFFERS[1], status: 'active', creditsTotal: 10, creditsUsed: 10 - creditsLeft, creditsLeft, createdAt: '2026-10-01T00:00:00.000Z' });

type Handler = (init: RequestInit) => { status?: number; body: unknown };
let routes: Record<string, Handler>;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const calls = (key: string) => fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? 'GET'} ${new URL(url).pathname.replace(/^\/api/, '').split('?')[0]}` === key);

beforeEach(() => {
  window.localStorage.clear();
  (window.location.assign as ReturnType<typeof vi.fn>).mockClear?.();
  routes = {
    'GET /pt-portal/home': () => ({ body: HOME }),
    'GET /pt-portal/bookings': () => ({ body: { bookings: [] } }),
    'GET /pt-portal/slots': () => ({ body: { slots: [slot('2026-10-20', 540), slot('2026-10-20', 600), slot('2026-10-21', 1080)] } }),
    'GET /pt-portal/billing': () => ({ body: { available: true, offers: OFFERS, plans: [plan(3)], payments: [] } }),
  };
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}): Promise<Response> => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const handler = routes[`${init.method ?? 'GET'} ${path}`];
    if (!handler) return json(404, { error: 'Not found' });
    const { status = 200, body } = handler(init);
    return json(status, body);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderPortal(search = '') {
  const { hook, searchHook } = memoryLocation({ path: `/c/tok${search}` });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook} searchHook={searchHook}><Route path="/c/:token" component={PortalApp} /></Router>
    </QueryClientProvider>,
  );
}

describe('navigation', () => {
  it('keeps five items in the bar and the rest under More', async () => {
    const user = userEvent.setup();
    renderPortal();
    await screen.findByRole('heading', { name: 'Hi Maya' });
    const bar = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Home', 'Book', 'Messages', 'Log', 'More']);
    await user.click(within(bar).getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Pay' }));
    expect(await screen.findByRole('heading', { name: 'Pay' })).toBeInTheDocument();
  });

  it('shows the next session on Home', async () => {
    routes['GET /pt-portal/bookings'] = () => ({ body: { bookings: [booking()] } });
    renderPortal();
    expect(await screen.findByRole('button', { name: /Your next session/ })).toBeInTheDocument();
  });

  it('counts credits on live plans only', () => {
    expect(totalCredits([{ status: 'active', creditsLeft: 3 }, { status: 'canceled', creditsLeft: 5 }, { status: 'complete', creditsLeft: 2 }])).toBe(5);
  });
});

describe('booking', () => {
  it('groups open times by day and books one', async () => {
    const user = userEvent.setup();
    let posted: unknown = null;
    routes['POST /pt-portal/bookings'] = (init) => { posted = JSON.parse(String(init.body)); return { status: 201, body: { booking: booking({ id: 'b9' }) } }; };
    renderPortal('?tab=book');

    expect(await screen.findByText('3 sessions left on your plan')).toBeInTheDocument();
    const groups = await screen.findAllByRole('group');
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getAllByRole('button')).toHaveLength(2);

    await user.click(within(groups[0]).getAllByRole('button')[0]);
    expect(await screen.findByText(/This uses one session from your plan/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(posted).toEqual({ startsAt: '2026-10-20T09:00:00.000Z', trainerId: 't1' }));
    expect(await screen.findByText(/^Booked:/)).toBeInTheDocument();
  });

  it('refreshes the open times when the slot was just taken', async () => {
    const user = userEvent.setup();
    routes['POST /pt-portal/bookings'] = () => ({ status: 409, body: { error: 'That time is no longer available', code: 'slot_taken' } });
    renderPortal('?tab=book');
    const groups = await screen.findAllByRole('group');
    const before = calls('GET /pt-portal/slots').length;
    await user.click(within(groups[1]).getByRole('button'));
    await user.click(await screen.findByRole('button', { name: 'Book' }));
    expect(await screen.findByText('Someone just took that time. Here is what is open now.')).toBeInTheDocument();
    await waitFor(() => expect(calls('GET /pt-portal/slots').length).toBeGreaterThan(before));
  });

  it('points to Pay when there are no sessions left', async () => {
    const user = userEvent.setup();
    routes['GET /pt-portal/billing'] = () => ({ body: { available: true, offers: OFFERS, plans: [plan(0)], payments: [] } });
    routes['POST /pt-portal/bookings'] = () => ({ status: 409, body: { error: 'You have no sessions left. Buy a package or ask your trainer.', code: 'no_credit' } });
    renderPortal('?tab=book');
    const groups = await screen.findAllByRole('group');
    await user.click(within(groups[0]).getAllByRole('button')[0]);
    await user.click(await screen.findByRole('button', { name: 'Book' }));
    expect(await screen.findByText(/no sessions left/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See plans and pay' }));
    expect(await screen.findByRole('heading', { name: 'Pay' })).toBeInTheDocument();
  });

  it('cancels with notice and reports the credit coming back', async () => {
    const user = userEvent.setup();
    let credits = 3;
    routes['GET /pt-portal/bookings'] = () => ({ body: { bookings: [booking()] } });
    routes['GET /pt-portal/billing'] = () => ({ body: { available: true, offers: OFFERS, plans: [plan(credits)], payments: [] } });
    routes['DELETE /pt-portal/bookings/b1'] = () => { credits = 4; return { body: { booking: booking({ status: 'cancelled', creditReturned: true }) } }; };
    renderPortal('?tab=book');

    await user.click(await screen.findByRole('button', { name: /^Cancel session on/ }));
    expect(await screen.findByText(/more than 24 hours away, so your session credit comes back/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel session' }));
    expect(await screen.findByText('Session cancelled. Your session credit is back.')).toBeInTheDocument();
  });

  it('warns that a late cancel uses the credit', async () => {
    const user = userEvent.setup();
    const soon = new Date(Date.now() + 3 * 3_600_000);
    routes['GET /pt-portal/bookings'] = () => ({ body: { bookings: [booking({ startsAt: soon.toISOString(), endsAt: new Date(soon.getTime() + 3_600_000).toISOString() })] } });
    routes['DELETE /pt-portal/bookings/b1'] = () => ({ body: { booking: booking({ status: 'cancelled', creditReturned: false }) } });
    renderPortal('?tab=book');
    await user.click(await screen.findByRole('button', { name: /^Cancel session on/ }));
    expect(await screen.findByText(/less than 24 hours away, so the session credit won't come back/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel session' }));
    expect(await screen.findByText(/With less than 24 hours' notice, the session credit is used/)).toBeInTheDocument();
  });
});

describe('cancel notice from the server', () => {
  it('uses the notice hours each booking carries', async () => {
    const user = userEvent.setup();
    // 30 hours away: inside a 48-hour rule.
    const at = new Date(Date.now() + 30 * 3_600_000);
    routes['GET /pt-portal/bookings'] = () => ({ body: { bookings: [booking({ startsAt: at.toISOString(), endsAt: new Date(at.getTime() + 3_600_000).toISOString(), cancelNoticeHours: 48 })] } });
    renderPortal('?tab=book');
    await user.click(await screen.findByRole('button', { name: /^Cancel session on/ }));
    expect(await screen.findByText(/less than 48 hours away, so the session credit won't come back/)).toBeInTheDocument();
  });

  it('words the result from creditReturned', () => {
    const b = booking({ status: 'cancelled', cancelNoticeHours: 12 });
    expect(cancelMessage({ ...b, creditReturned: true })).toMatch(/credit is back/);
    expect(cancelMessage({ ...b, creditReturned: false })).toMatch(/less than 12 hours' notice/);
    expect(cancelMessage({ ...b, usedCredit: false })).toBe('Session cancelled.');
  });
});

describe('paying', () => {
  it('highlights the offer from the trainer link and goes to checkout', async () => {
    const user = userEvent.setup();
    let posted: unknown = null;
    routes['POST /pt-portal/billing/checkout'] = (init) => { posted = JSON.parse(String(init.body)); return { body: { url: 'https://checkout.stripe.com/c/abc' } }; };
    renderPortal('?tab=billing&offer=o2');

    expect(await screen.findByText('Picked for you')).toBeInTheDocument();
    const picked = screen.getByText('Picked for you').parentElement!;
    expect(picked).toHaveTextContent('10-session pack');
    expect(picked).toHaveTextContent('£450');
    expect(screen.getByText('Monthly coaching').closest('div')!.parentElement).toHaveTextContent('/ month');

    await user.click(within(picked).getByRole('button', { name: /Buy/ }));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/abc'));
    expect(posted).toEqual({ offerId: 'o2' });
  });

  it('thanks the client on return and opens card management', async () => {
    const user = userEvent.setup();
    routes['POST /pt-portal/billing/manage'] = () => ({ body: { url: 'https://billing.stripe.com/p/xyz' } });
    renderPortal('?tab=billing&paid=1');
    expect(await screen.findByText("Thank you, you're paid up.")).toBeInTheDocument();
    expect(screen.getByText('3 of 10 sessions left')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Manage card \/ cancel/ }));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://billing.stripe.com/p/xyz'));
  });

  it('is friendly when the trainer cannot take payments', async () => {
    routes['GET /pt-portal/billing'] = () => ({ body: { available: false, offers: [], plans: [], payments: [] } });
    renderPortal('?tab=billing');
    expect(await screen.findByText("Payments aren't open here yet")).toBeInTheDocument();
  });
});
