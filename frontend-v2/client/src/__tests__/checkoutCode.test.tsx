/**
 * Code-first referrals on the web: "Have a referral code?" on pricing (and the
 * other checkout surfaces), on register, and the affiliate dashboard's
 * "Your code" card.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/Navbar', () => ({ Navbar: () => null }));
vi.mock('@/components/SEO', () => ({ SEO: () => null }));
vi.mock('@/components/InAppBrowserWarning', () => ({ InAppBrowserWarning: () => null }));
vi.mock('@/lib/analytics', () => ({
  WebAnalytics: new Proxy({}, { get: () => vi.fn() }),
  trackPageTime: () => () => {},
}));

const auth = vi.hoisted(() => ({
  user: null as any,
  register: vi.fn(async (..._a: any[]) => null),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user, features: {}, loading: false,
    register: auth.register, googleLogin: vi.fn(), refreshUser: vi.fn(async () => null),
  }),
  postAuthDestination: () => '/dashboard',
  DEFAULT_FEATURES: {},
}));

import Pricing from '@/pages/pricing';
import Register from '@/pages/register';
import AffiliatePage from '@/pages/affiliate';
import { checkoutBody } from '@/lib/checkout';
import { REFERRAL_STORAGE_KEY } from '@/lib/referral';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const VALID: Record<string, unknown> = { valid: true, code: 'SAEED10', discountPercent: 20, trialDays: 30, affiliateFirstName: 'Saeed' };
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map(([u, init]) => ({ path: new URL(String(u)).pathname.replace(/^\/api/, ''), init: init as RequestInit | undefined }));

beforeEach(() => {
  localStorage.clear();
  auth.user = null;
  auth.register.mockClear();
  fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const m = /^\/affiliate\/code\/([^/]+)\/validate$/.exec(path);
    if (m) return json(decodeURIComponent(m[1]) === 'SAEED10' ? VALID : { valid: false });
    if (path === '/payments/create-checkout') return json({ url: 'https://checkout.stripe.test/s' });
    return json({ error: 'nope' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('pricing: "Have a referral code?"', () => {
  it('apply → validates (uppercased), stores axiom_referral, shows the applied offer and passes the code to checkout', async () => {
    auth.user = { id: 'u1', tier: 'free', name: 'A', email: 'a@x.co' };
    const hrefSet = vi.fn();
    const loc = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...loc, pathname: '/pricing', search: '', set href(v: string) { hrefSet(v); }, get href() { return 'http://localhost/pricing'; } } });

    render(<Pricing />);
    fireEvent.click(screen.getByTestId('referral-toggle'));
    fireEvent.change(screen.getByTestId('referral-input'), { target: { value: ' saeed10 ' } });
    fireEvent.click(screen.getByTestId('referral-apply'));

    const applied = await screen.findByTestId('referral-applied');
    expect(applied.textContent).toContain('SAEED10');
    expect(applied.textContent).toContain('20% off for life + 30-day trial applied');
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBe('SAEED10');
    expect(calls().some(c => c.path === '/affiliate/code/SAEED10/validate')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Upgrade to Pro/ }));
    await waitFor(() => expect(calls().some(c => c.path === '/payments/create-checkout')).toBe(true));
    const co = calls().find(c => c.path === '/payments/create-checkout')!;
    expect(JSON.parse(String(co.init!.body))).toEqual({ referralCode: 'SAEED10' });
    await waitFor(() => expect(hrefSet).toHaveBeenCalledWith('https://checkout.stripe.test/s'));
    Object.defineProperty(window, 'location', { configurable: true, value: loc });
  });

  it('unknown code → "Code not recognised", nothing stored', async () => {
    render(<Pricing />);
    fireEvent.click(screen.getByTestId('referral-toggle'));
    fireEvent.change(screen.getByTestId('referral-input'), { target: { value: 'nope99' } });
    fireEvent.click(screen.getByTestId('referral-apply'));
    expect((await screen.findByTestId('referral-error')).textContent).toBe('Code not recognised');
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
    expect(screen.queryByTestId('referral-applied')).toBeNull();
  });

  it('shows a stored code (from a ?ref= link) with a remove link that clears it', async () => {
    localStorage.setItem(REFERRAL_STORAGE_KEY, 'SAEED10');
    render(<Pricing />);
    const applied = await screen.findByTestId('referral-applied');
    await waitFor(() => expect(applied.textContent).toContain('20% off for life + 30-day trial applied'));
    fireEvent.click(within(applied).getByTestId('referral-remove'));
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('referral-toggle')).toBeTruthy();
  });

  it('a stale stored code that no longer validates is dropped', async () => {
    localStorage.setItem(REFERRAL_STORAGE_KEY, 'OLDCODE');
    render(<Pricing />);
    expect((await screen.findByTestId('referral-error')).textContent).toBe('Code OLDCODE not recognised');
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });
});

describe('checkoutBody', () => {
  it('explicit code wins, undefined falls back to the stored code, null sends none', () => {
    localStorage.setItem(REFERRAL_STORAGE_KEY, 'KAVI10');
    expect(checkoutBody({ referralCode: 'saeed10', returnPath: '/x' })).toEqual({ referralCode: 'SAEED10', returnPath: '/x' });
    expect(checkoutBody()).toEqual({ referralCode: 'KAVI10' });
    expect(checkoutBody({ referralCode: null })).toEqual({});
  });
});

describe('register', () => {
  it('shows the stored code as applied and sends it as referralCode', async () => {
    localStorage.setItem(REFERRAL_STORAGE_KEY, 'SAEED10');
    render(<Register />);
    const applied = await screen.findByTestId('referral-applied');
    expect(applied.textContent).toMatch(/Referral code SAEED10/);

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Pat' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'pat@x.co' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '1990-01-01' } });
    fireEvent.click(document.getElementById('register-terms')!);
    fireEvent.click(document.getElementById('register-health')!);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(auth.register).toHaveBeenCalled());
    expect(auth.register.mock.calls[0][4]).toBe('SAEED10');
    // Kept so it also reaches create-checkout after sign-up.
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBe('SAEED10');
  });

  it('lets a visitor enter a code there too', async () => {
    render(<Register />);
    fireEvent.click(screen.getByTestId('referral-toggle'));
    fireEvent.change(screen.getByTestId('referral-input'), { target: { value: 'saeed10' } });
    fireEvent.click(screen.getByTestId('referral-apply'));
    expect((await screen.findByTestId('referral-applied')).textContent).toContain('SAEED10');
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBe('SAEED10');
  });
});

describe('affiliate dashboard: "Your code" card', () => {
  it('shows the code large + copyable, code-first copy, the optional link and the in-app warning', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname.replace(/^\/api/, '');
      if (path === '/affiliate/me') return json({
        id: 'a1', name: 'Saeed', email: 's@x.com', referralCode: 'SAEED10', referralLink: 'https://axiomtraining.io?ref=SAEED10',
        active: true, onboarded: true, pendingCents: 0, paidCents: 0, activeSubscriptions: 0, commissionRate: 0.4, discountRate: 0.2,
        recentCommissions: [], payouts: [],
      });
      return json({ error: 'nope' }, 404);
    });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    sessionStorage.setItem('affiliateToken', 'tok-1');
    render(<AffiliatePage />);
    const card = await screen.findByTestId('affiliate-code-card');
    expect(within(card).getByRole('heading', { name: 'Your code' })).toBeTruthy();
    expect(screen.queryByText('Your Referral Link')).toBeNull();
    expect(within(card).getByTestId('affiliate-code').textContent).toBe('SAEED10');
    expect(card.textContent).toContain('Tell people to enter this code at checkout on axiomtraining.io — they get 20% off Pro for life plus a 30-day trial, and you earn 40% of every payment.');
    expect(within(card).getByTestId('affiliate-code-warning').textContent).toBe('Codes only work on web checkout. Apple and Google in-app purchases cannot take a code and are not attributed.');
    expect(card.textContent).toContain('Optional link (pre-fills the code)');
    fireEvent.click(within(card).getByRole('button', { name: /Copy code/ }));
    expect(writeText).toHaveBeenCalledWith('SAEED10');

    const how = screen.getByRole('heading', { name: 'How it works' }).parentElement!;
    expect(how.textContent).toMatch(/enter it at checkout on axiomtraining\.io/);
    expect(how.textContent).not.toMatch(/clicks it/);
    sessionStorage.clear();
  });
});
