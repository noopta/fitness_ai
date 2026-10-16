/**
 * A practice's public page at /p/:slug: branding and profile, the enquiry
 * form (validation, honeypot, optional free consult), success, 404, and that
 * no Axiom credentials ever leave the page. Stubbed fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { PublicPractice, Slot } from '@axiom/personal-training-core';
import PublicPracticePage, { enquiryFromForm } from '@/features/pt-public/PublicPracticePage';

const PRACTICE: PublicPractice = {
  slug: 'kofi', name: 'Kofi Coaching', trainerName: 'Kofi Mensah', bio: 'Strength coach for busy people.',
  specialties: ['Strength', 'Return from injury'], styleTags: ['Calm', 'Data-led'], languages: ['English', 'Twi'],
  format: 'hybrid', brandColor: '#1e3a8a', accentColor: null, logoUrl: null, offersConsults: true,
};
const slot = (localDate: string, localMinute: number): Slot => ({ trainerId: 't1', trainerName: 'Kofi Mensah', startsAt: `${localDate}T${String(localMinute / 60).padStart(2, '0')}:00:00.000Z`, endsAt: '', location: null, localDate, localMinute });

let routes: Record<string, (init: RequestInit) => { status?: number; body: unknown }>;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  routes = {
    'GET /pt-public/kofi': () => ({ body: { practice: PRACTICE } }),
    'GET /pt-public/kofi/slots': () => ({ body: { slots: [slot('2026-10-20', 540), slot('2026-10-21', 600)] } }),
    'POST /pt-public/kofi/leads': () => ({ status: 201, body: { ok: true } }),
  };
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}): Promise<Response> => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const h = routes[`${init.method ?? 'GET'} ${path}`];
    if (!h) return json(404, { error: 'Not found' });
    const { status = 200, body } = h(init);
    return json(status, body);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderPage(slug = 'kofi') {
  const { hook } = memoryLocation({ path: `/p/${slug}` });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Router hook={hook}><Route path="/p/:slug" component={PublicPracticePage} /></Router></QueryClientProvider>);
}

describe('public practice page', () => {
  it('shows the practice, trainer, bio, chips and format, and titles the page', async () => {
    const { container } = renderPage();
    expect(await screen.findByRole('heading', { name: 'Kofi Coaching', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Coached by Kofi Mensah')).toBeInTheDocument();
    expect(screen.getByText('Strength coach for busy people.')).toBeInTheDocument();
    for (const chip of ['Strength', 'Return from injury', 'Calm', 'Twi']) expect(screen.getByText(chip)).toBeInTheDocument();
    expect(screen.getByText('Online and in person')).toBeInTheDocument();
    expect(document.title).toBe('Kofi Coaching · Kofi Mensah');
    expect((container.querySelector('[style*="--portal-accent"]') as HTMLElement).style.getPropertyValue('--portal-accent')).toBe('#1e3a8a');
  });

  it('never sends credentials or an Authorization header', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Kofi Coaching', level: 1 });
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBe('omit');
      expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization/i);
    }
  });

  it('has a hidden honeypot the visitor never reaches', async () => {
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Kofi Coaching', level: 1 });
    const pot = container.querySelector('input[name="website"]') as HTMLInputElement;
    expect(pot).toHaveAttribute('tabindex', '-1');
    expect(pot).toHaveAttribute('autocomplete', 'off');
    expect(pot.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Website' })).not.toBeInTheDocument();
  });

  it('validates, then sends an enquiry with a free consult and thanks them', async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    routes['POST /pt-public/kofi/leads'] = (init) => { posted = JSON.parse(String(init.body)); return { status: 201, body: { ok: true } }; };
    renderPage();
    await screen.findByRole('heading', { name: 'Kofi Coaching', level: 1 });

    await user.type(screen.getByLabelText('Your name'), 'Sam Lee');
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Leave an email or phone number');
    expect(posted).toBeNull();

    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.type(screen.getByLabelText('What would you like to work on?'), 'Run a half');
    await user.click(screen.getByRole('checkbox', { name: /Pick a time/ }));
    const day = await screen.findByRole('group', { name: /20 Oct|Oct 20/ });
    await user.click(within(day).getByRole('button'));
    expect(within(day).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));

    expect(await screen.findByText('Thanks, Sam.')).toBeInTheDocument();
    expect(screen.getByText(/You asked for a free consult on .*(20 Oct|Oct 20)/)).toBeInTheDocument();
    expect(posted).toEqual({ name: 'Sam Lee', email: 'sam@example.com', goal: 'Run a half', consultAt: '2026-10-20T09:00:00.000Z' });
  });

  it('shows the server message on a rate limit', async () => {
    const user = userEvent.setup();
    routes['POST /pt-public/kofi/leads'] = () => ({ status: 429, body: { error: 'Too many enquiries from this network. Try again later.' } });
    renderPage();
    await user.type(await screen.findByLabelText('Your name'), 'Sam Lee');
    await user.type(screen.getByLabelText(/^Phone/), '07700 900123');
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many enquiries');
  });

  it("says the page isn't available on a 404", async () => {
    renderPage('nobody');
    expect(await screen.findByRole('heading', { name: 'This page isn’t available.' })).toBeInTheDocument();
  });

  it('builds the enquiry the way the server checks it', () => {
    const f = { name: ' Sam ', email: '', phone: '', goal: '', message: '', website: '' };
    expect(enquiryFromForm(f, null)).toEqual({ error: expect.stringMatching(/email or phone/) });
    expect(enquiryFromForm({ ...f, email: 'bad' }, null)).toEqual({ error: expect.stringMatching(/email/) });
    expect(enquiryFromForm({ ...f, phone: '+44 7700 900123' }, null)).toEqual({ input: { name: 'Sam', phone: '+44 7700 900123' } });
    expect(enquiryFromForm({ ...f, email: 'a@b.co', website: 'spam.biz' }, 'x')).toEqual({ input: { name: 'Sam', email: 'a@b.co', consultAt: 'x', website: 'spam.biz' } });
    expect(enquiryFromForm({ ...f, name: 'S' }, null)).toEqual({ error: expect.stringMatching(/name/) });
  });
});
