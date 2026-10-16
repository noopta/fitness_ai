/**
 * Client portal at /c/:token, end to end against a mocked fetch: the home
 * screen, a dead link, a deep-linked check-in, messages and the program.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { CheckInRequest, PortalHome, PortalMessage } from '@axiom/personal-training-core';
import PortalApp from '@/features/pt-portal/PortalApp';

const TOKEN = 'sekret_tok_9f8e7d';

const HOME: PortalHome = {
  client: { firstName: 'Maya', name: 'Maya Okafor', unit: 'kg' },
  branding: { practiceName: 'Kofi Coaching', trainerName: 'Kofi Mensah', logoUrl: null, brandColor: '#1e3a8a', accentColor: null },
  checkIns: [{ id: 'ck1', dueAt: '2026-10-12T09:00:00.000Z', questionCount: 5 }],
  goals: [
    { id: 'g1', metric: 'bodyweight', label: 'Reach 70 kg', direction: 'down', status: 'active', baseline: 76, target: 70, current: 73, unit: 'kg', progress: 50 },
    { id: 'g2', metric: 'custom', label: 'Run a 10k', direction: 'up', status: 'active', baseline: null, target: 10, current: 6, unit: 'km', progress: null },
  ],
  unreadMessages: 2,
  hasProgram: false,
  intake: null,
  photosEnabled: true,
  reports: [{ id: 'r1', month: '2026-09', title: 'Your 2026-09 report', sentAt: '2026-10-01T10:00:00.000Z' }],
};

const CHECKIN: CheckInRequest = {
  id: 'ck1', practiceName: 'Kofi Coaching', trainerName: 'Kofi Mensah', status: 'due', dueAt: '2026-10-12T09:00:00.000Z',
  questions: [
    { id: 'energy', text: 'How is your energy?', type: 'scale', signal: 'energy' },
    { id: 'notes', text: 'Anything else?', type: 'text' },
  ],
};

type Handler = (init: RequestInit) => { status?: number; body: unknown };
let routes: Record<string, Handler>;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  window.localStorage.clear();
  routes = {
    'GET /pt-portal/home': () => ({ body: HOME }),
    'GET /pt-portal/check-ins/ck1': () => ({ body: CHECKIN }),
    'POST /pt-portal/check-ins/ck1': () => ({ body: { ok: true } }),
    'GET /pt-portal/messages': () => ({ body: { messages: [] } }),
    'GET /pt-portal/program': () => ({ body: { program: null } }),
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

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPortal(search = '') {
  const { hook, searchHook } = memoryLocation({ path: `/c/${TOKEN}${search}` });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <Router hook={hook} searchHook={searchHook}>
        <Route path="/c/:token" component={PortalApp} />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

describe('portal home', () => {
  it('shows the branded header, due check-in, goals, unread messages and reports', async () => {
    const { container } = renderPortal();
    expect(await screen.findByRole('heading', { name: 'Hi Maya' })).toBeInTheDocument();

    expect(screen.getByText('Kofi Coaching')).toBeInTheDocument();
    expect(screen.getByText('with Kofi Mensah')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Your check-in is ready\s*2 minutes/ })).toBeInTheDocument();

    // A goal with progress gets a bar; one without shows current vs target only.
    expect(screen.getByRole('progressbar', { name: 'Reach 70 kg progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByRole('progressbar', { name: 'Run a 10k progress' })).not.toBeInTheDocument();
    expect(screen.getByText(/Now 6 km · Target 10 km/)).toBeInTheDocument();

    expect(screen.getByText('2 new messages')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Messages\s*,\s*2 unread$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /September 2026/ })).toBeInTheDocument();

    expect(document.title).toBe('Kofi Coaching · Axiom');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(/noindex/);
    // Brand colour reaches the root as the accent, with white text on navy.
    const root = container.querySelector('[style*="--portal-accent"]') as HTMLElement;
    expect(root.style.getPropertyValue('--portal-accent')).toBe('#1e3a8a');
    expect(root.style.getPropertyValue('--portal-on-accent')).toBe('#ffffff');
    // The token is a credential and never appears on the page.
    expect(container.textContent).not.toContain(TOKEN);
  });

  it('authenticates with the link, never with cookies', async () => {
    renderPortal();
    await screen.findByRole('heading', { name: 'Hi Maya' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/pt-portal\/home$/);
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>).Authorization).toBe(`PtLink ${TOKEN}`);
  });

  it('remembers a dismissed home-screen tip', async () => {
    const user = userEvent.setup();
    const first = renderPortal();
    await screen.findByRole('heading', { name: 'Hi Maya' });
    await user.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    expect(screen.queryByText(/Save this page to your home screen/)).not.toBeInTheDocument();
    first.unmount();

    renderPortal();
    await screen.findByRole('heading', { name: 'Hi Maya' });
    expect(screen.queryByText(/Save this page to your home screen/)).not.toBeInTheDocument();
  });

  it('shows a friendly page when the link is no longer active', async () => {
    routes['GET /pt-portal/home'] = () => ({ status: 404, body: { error: 'This link is no longer active.', code: 'link_inactive' } });
    renderPortal();
    expect(await screen.findByRole('heading', { name: 'This link is no longer active.' })).toBeInTheDocument();
    expect(screen.getByText('Ask your trainer for a new one.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});

describe('portal check-in deep link', () => {
  it('opens ?checkin= directly and submits the answers', async () => {
    const user = userEvent.setup();
    let posted: unknown = null;
    routes['POST /pt-portal/check-ins/ck1'] = (init) => { posted = JSON.parse(String(init.body)); return { body: { ok: true } }; };
    renderPortal('?checkin=ck1');

    expect(await screen.findByRole('heading', { name: 'Check-in for Kofi Mensah' })).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send check-in' });
    expect(send).toBeDisabled();

    await user.click(within(screen.getByRole('radiogroup')).getByRole('radio', { name: '4 out of 5' }));
    await user.type(screen.getByLabelText('Anything else?'), 'Slept badly');
    await user.click(send);

    expect(await screen.findByText('Thanks. Your trainer has it.')).toBeInTheDocument();
    expect(posted).toEqual({ answers: { energy: 4, notes: 'Slept badly' } });
  });

  it('shows a submitted check-in as closed', async () => {
    routes['GET /pt-portal/check-ins/ck1'] = () => ({ body: { ...CHECKIN, status: 'submitted' } });
    renderPortal('?checkin=ck1');
    expect(await screen.findByText('This check-in has already been sent.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send check-in' })).not.toBeInTheDocument();
  });
});

describe('portal messages and program', () => {
  it('appends a sent message straight away', async () => {
    const user = userEvent.setup();
    const gate: { release: () => void } = { release: () => {} };
    const sent: PortalMessage = { id: 'm9', fromClient: true, body: 'See you Tuesday', at: new Date().toISOString() };
    routes['GET /pt-portal/messages'] = () => ({ body: { messages: [{ id: 'm1', fromClient: false, body: 'How was the session?', at: '2026-10-14T10:00:00.000Z' }] } });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST' && url.endsWith('/pt-portal/messages')) {
        await new Promise<void>((r) => { gate.release = r; });
        return json(201, { message: sent });
      }
      return original(url, init);
    });

    renderPortal('?tab=messages');
    expect(await screen.findByText('How was the session?')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Message Kofi Mensah'), 'See you Tuesday');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByText('See you Tuesday')).toBeInTheDocument();
    expect(screen.getByText('Sending…')).toBeInTheDocument();
    gate.release();
    await waitFor(() => expect(screen.queryByText('Sending…')).not.toBeInTheDocument());
    expect(screen.getByText('See you Tuesday')).toBeInTheDocument();
  });

  it('says when there is no program yet', async () => {
    renderPortal('?tab=program');
    expect(await screen.findByText("Your trainer hasn't shared a program here yet.")).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Program' })).toHaveAttribute('aria-selected', 'true');
  });
});
