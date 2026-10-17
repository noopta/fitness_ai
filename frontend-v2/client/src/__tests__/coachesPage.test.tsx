/**
 * /coaches: the public coaching beta signup page. Renders the form, requires
 * the consent tick, posts the payload (no credentials), shows success, keeps
 * the honeypot, and sends allow-listed trainers to the PT roster.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

const mockUseAuth = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/components/Navbar', () => ({ Navbar: () => <nav data-testid="navbar" /> }));
vi.mock('@/components/SEO', () => ({ SEO: () => null }));

const { default: CoachesPage, signupPayload, sourceFromSearch, EMPTY_FIELDS, COMPARISON } = await import('@/pages/coaches');

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  mockUseAuth.mockReturnValue({ user: null, features: { personalTraining: false }, loading: false });
  fetchMock = vi.fn(async () => json(200, { ok: true, alreadyOnList: false }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function renderPage(path = '/coaches') {
  const loc = memoryLocation({ path, record: true });
  const utils = render(<Router hook={loc.hook}><CoachesPage /></Router>);
  return { ...utils, loc };
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Sam Lee');
  await user.type(screen.getByLabelText('Email'), 'sam@example.com');
}

describe('coaches page', () => {
  it('is not linked from the site footer while the beta is hidden', () => {
    // Hidden until VITE_COACH_BETA_ENABLED=1: no nav/footer links, no sitemap entry.
    renderPage();
    expect(screen.queryByTestId('link-footer-coaches')).toBeNull();
  });

  it('renders the hero, comparison (labelled approximate), FAQ and the signup form', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /coach more clients without losing the detail/i })).toBeInTheDocument();
    expect(screen.getByTestId('coach-comparison')).toBeInTheDocument();
    expect(screen.getByText(/approximate public list prices/i)).toBeInTheDocument();
    expect(screen.getByText('Is it free for trainers?')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: /join the coaching beta list/i })).toBeInTheDocument();
    for (const l of ['Name', 'Email', /main social platform/i, /handle/i, /how you coach/i, /clients right now/i, /what you use today/i, /website/i]) {
      expect(screen.getAllByLabelText(l).length).toBeGreaterThan(0);
    }
    const privacy = within(screen.getByRole('form', { name: /join the coaching beta list/i })).getByRole('link', { name: 'Privacy Policy' });
    expect(privacy.getAttribute('href')).toBe('/privacy');
  });

  it('carries no outcome statistics, ratings or endorsements', () => {
    const { container } = renderPage();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\d+\s?%(?! platform fee)/i);
    expect(text).not.toMatch(/\+\s?\d+\s?lb/i);
    expect(text).not.toMatch(/★|stars?\b|NASM|ISSA|\bACE\b|Huberman|7,000 pages|guarantee/i);
  });

  it('requires the consent tick before posting', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /join the beta list/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/tick the box/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the payload without credentials and shows the success state', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText(/main social platform/i), 'instagram');
    await user.type(screen.getByLabelText(/handle/i), '@samlifts');
    await user.selectOptions(screen.getByLabelText(/how you coach/i), 'hybrid');
    await user.selectOptions(screen.getByLabelText(/clients right now/i), '11-30');
    await user.type(screen.getByLabelText(/what you use today/i), 'Trainerize');
    await user.click(screen.getByTestId('coach-consent'));
    await user.click(screen.getByRole('button', { name: /join the beta list/i }));

    await waitFor(() => expect(screen.getByTestId('coach-signup-success')).toBeInTheDocument());
    expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText('sam@example.com')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/coach-beta\/signup$/);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('omit');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'sam@example.com', name: 'Sam Lee', socialPlatform: 'instagram', socialHandle: '@samlifts',
      coachingType: 'hybrid', clientCount: '11-30', platformToday: 'Trainerize', marketingConsent: true, company: '',
    });
  });

  it('shows an already-on-list message and server errors', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json(400, { error: 'Please check the form and try again.' }));
    renderPage();
    await fillRequired(user);
    await user.click(screen.getByTestId('coach-consent'));
    await user.click(screen.getByRole('button', { name: /join the beta list/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please check the form and try again.');

    fetchMock.mockResolvedValueOnce(json(200, { ok: true, alreadyOnList: true }));
    await user.click(screen.getByRole('button', { name: /join the beta list/i }));
    expect(await screen.findByText("You're already on the list")).toBeInTheDocument();
  });

  it('prefills the email of a signed-in non-trainer', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'me@example.com', name: null, tier: 'free' }, features: { personalTraining: false }, loading: false });
    renderPage();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('me@example.com');
  });

  it('redirects allow-listed trainers to the roster', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'pt@example.com', name: null, tier: 'pro' }, features: { personalTraining: true }, loading: false });
    const { loc, container } = renderPage();
    await waitFor(() => expect(loc.history).toContain('/personal-training/clients'));
    expect(container.querySelector('form')).toBeNull();
  });
});

describe('helpers', () => {
  it('signupPayload drops empty optional fields and keeps the honeypot as typed', () => {
    expect(signupPayload({ ...EMPTY_FIELDS, email: ' a@b.co ', marketingConsent: true, company: 'bot' }, 'ig')).toEqual({
      email: 'a@b.co', marketingConsent: true, company: 'bot', source: 'ig',
    });
  });

  it('sourceFromSearch reads ref and utm tags, capped at 120', () => {
    expect(sourceFromSearch('?ref=SAM')).toBe('SAM');
    expect(sourceFromSearch('?utm_source=ig&utm_campaign=launch')).toBe('ig/launch');
    expect(sourceFromSearch('')).toBeUndefined();
    expect(sourceFromSearch(`?ref=${'x'.repeat(300)}`)!.length).toBe(120);
  });

  it('comparison rows cover all three competitors', () => {
    for (const r of COMPARISON) expect(r.trainerize && r.truecoach && r.everfit && r.axiom).toBeTruthy();
  });
});
