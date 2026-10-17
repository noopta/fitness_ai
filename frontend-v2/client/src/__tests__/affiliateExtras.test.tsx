/**
 * Affiliate dashboard — "Your terms", "Trainer referrals", "UGC & other
 * payouts" sections, plus the markdown payment-structure document rendered
 * inline (Resources card and terms card) through the hardened renderer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

vi.mock('@/components/Navbar', () => ({ Navbar: () => null }));

import { AffiliateTerms, AffiliateTrainerReferrals, AffiliateManualPayouts } from '@/components/AffiliateExtras';
import AffiliatePage from '@/pages/affiliate';
import { AdminAffiliateExtras } from '@/components/AdminAffiliateExtras';
import { AffiliateResources } from '@/components/AffiliateResources';

const STRUCTURE = {
  title: 'Axiom Affiliate Payment Structure',
  currency: 'CAD',
  proPriceMonthly: '$12.99/mo',
  streams: [
    { key: 'consumer_pro', name: 'Consumer Pro referrals', whatYouEarn: '40% of every Pro payment ($12.99/mo)', howLong: 'Lifetime of the subscription' },
    { key: 'trainer', name: 'Trainer referrals (paid trainer plans)', whatYouEarn: 'Commission on every paid trainer invoice at your agreed trainer rate', howLong: '12 months per trainer' },
    { key: 'campaign', name: 'Campaign / creative asset referrals', whatYouEarn: '30% of the plan price', howLong: 'Once, on the first paid invoice' },
    { key: 'ugc', name: 'Paid content commissions (UGC)', whatYouEarn: 'Per-video fee set in your agreement', howLong: 'Per accepted video' },
  ],
  bonusesIntro: 'Bonuses stack on top of your rates and never reduce them.',
  bonuses: [
    { key: 'growth', name: 'Growth ladder', description: 'One-time bonuses.' },
    { key: 'durability', name: 'Durability ladder', description: 'Tenure bonuses.' },
    { key: 'fast_start', name: 'Fast-start', description: 'First 90 days.' },
  ],
  paymentRules: ['All streams are paid monthly in CAD to your Stripe Express account.'],
  trainerPlans: 'Trainer plans: free up to 5 clients, then $49/mo (Coach) or $99/mo (Pro).',
  personalTermsNote: 'Your personal rates appear in the "Your terms" card.',
};
const TERMS = { commissionRate: 0.4, trainerCommissionRate: 0.2, campaignRate: 0.3, perVideoFeeCents: 4000, agreementNote: 'Growth rungs: 10 / 25 / 50 referrals', agreementUpdatedAt: '2026-10-01T00:00:00.000Z' };
const MD = '# Axiom Affiliate Payment Structure\n\n| # | Stream |\n|---|---|\n| 1 | Consumer Pro referrals |\n\n<script>alert(1)</script>\n\n![pixel](https://evil.test/p.png)\n';
const SIGNED = 'https://api.example.test/api/affiliate/resources/payment-structure/file?aid=a1&exp=1&sig=s';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let routes: Record<string, () => Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  routes = {
    '/affiliate/terms': () => json({ terms: TERMS, structure: STRUCTURE }),
    '/affiliate/trainer-referrals': () => json({
      referrals: [{ id: 'tr1', trainerName: 'Coach K', organization: 'K Gym', plan: 'coach', status: 'active', startedAt: '2026-09-01T00:00:00.000Z', note: 'Signed in Sept', createdAt: '2026-09-01T00:00:00.000Z' }],
      autoSignups: [
        { id: 'cb1', name: 'Jane D.', emailDomain: '@gym.com', createdAt: '2026-10-10T00:00:00.000Z', invitedAt: null },
        { id: 'cb2', name: 'Bob', emailDomain: '@fit.io', createdAt: '2026-10-11T00:00:00.000Z', invitedAt: '2026-10-12T00:00:00.000Z' },
      ],
    }),
    '/affiliate/manual-payouts': () => json({
      payouts: [
        { id: 'p2', kind: 'discretionary', description: 'Discretionary bonus', amountCents: 0, currency: 'CAD', status: 'pending', paidAt: null, reference: 'AXM-2026-10-17-BONUS', note: 'Discretionary bonus — amount to confirm', createdAt: '2026-10-17T12:00:00.000Z' },
        { id: 'p1', kind: 'ugc', description: 'Paid to date (recorded 2026-10-17)', amountCents: 16000, currency: 'CAD', status: 'paid', paidAt: '2026-10-17T12:00:00.000Z', reference: 'AXM-2026-10-17-UGC', note: null, createdAt: '2026-10-17T12:00:00.000Z' },
      ],
      totals: { paidCents: 16000, pendingCents: 0 },
    }),
    '/affiliate/resources': () => json({ resources: [
      { slug: 'payment-structure', title: 'Axiom Affiliate Payment Structure', description: 'How you get paid.', category: 'Payments', updatedAt: '2026-10-17', audience: 'general', fileName: 'payment-structure.md', sizeBytes: 1686, format: 'md' },
      { slug: 'affiliate-playbook', title: 'Axiom Affiliate Playbook', description: 'Pitch.', category: 'Knowledge base', updatedAt: '2026-10-16', audience: 'general', fileName: 'axiom-affiliate-playbook.pdf', sizeBytes: 180336, format: 'pdf' },
    ] }),
    '/affiliate/resources/payment-structure/link': () => json({ url: SIGNED, expiresAt: new Date().toISOString() }),
  };
  fetchMock = vi.fn(async (url: string) => {
    if (url === SIGNED) return new Response(MD, { status: 200, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const h = routes[path];
    return h ? h() : json({ error: 'nope' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  (window as any).open = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('AffiliateTerms', () => {
  it('shows personal rates, the agreement note and the general structure; token in header only', async () => {
    render(<AffiliateTerms token="tok-1" />);
    expect(screen.getByText(/Loading your terms/)).toBeTruthy();
    const card = await screen.findByTestId('affiliate-terms');
    await within(card).findByText('40%');
    expect(within(card).getByText('20%')).toBeTruthy();
    expect(within(card).getByText('30%')).toBeTruthy();
    expect(within(card).getByText('CA$40.00')).toBeTruthy();
    expect(within(card).getByTestId('agreement-note').textContent).toContain('Growth rungs: 10 / 25 / 50 referrals');
    expect(within(card).getByText('Consumer Pro referrals')).toBeTruthy();
    expect(within(card).getByText('Paid content commissions (UGC)')).toBeTruthy();
    expect(within(card).getByText('Growth ladder')).toBeTruthy();
    expect(within(card).getByText(/\$49\/mo \(Coach\)/)).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/affiliate\/terms$/);
    expect(url).not.toContain('tok-1');
    expect((init as RequestInit).headers).toMatchObject({ 'X-Affiliate-Token': 'tok-1' });
  });

  it('unset personal rates read "Set in your agreement" and no note box', async () => {
    routes['/affiliate/terms'] = () => json({ terms: { ...TERMS, trainerCommissionRate: null, perVideoFeeCents: null, agreementNote: null }, structure: STRUCTURE });
    render(<AffiliateTerms token="tok-1" />);
    await screen.findByText('40%');
    expect(screen.getAllByText('Set in your agreement').length).toBe(2);
    expect(screen.queryByTestId('agreement-note')).toBeNull();
  });

  it('opens the payment-structure document inline (markdown, hardened)', async () => {
    render(<AffiliateTerms token="tok-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Read the full payment structure/ }));
    const doc = await screen.findByTestId('terms-payment-doc');
    expect(within(doc).getByRole('heading', { name: 'Axiom Affiliate Payment Structure' })).toBeTruthy();
    expect(within(doc).getByRole('table')).toBeTruthy();
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('img')).toBeNull();
    expect((window as any).open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Close payment structure/ }));
    expect(screen.queryByTestId('terms-payment-doc')).toBeNull();
  });

  it('error state with retry', async () => {
    let n = 0;
    routes['/affiliate/terms'] = () => (n++ === 0 ? json({ error: 'Open your personal affiliate link to continue.' }, 401) : json({ terms: TERMS, structure: STRUCTURE }));
    render(<AffiliateTerms token="tok-1" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('40%')).toBeTruthy();
  });
});

describe('AffiliateTrainerReferrals', () => {
  it('renders the referral table with status badge and the coach sign-ups from the link', async () => {
    render(<AffiliateTrainerReferrals token="tok-1" />);
    expect(await screen.findByText('Coach K')).toBeTruthy();
    expect(screen.getByText('K Gym')).toBeTruthy();
    expect(screen.getByText('Coach')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Sep 1, 2026')).toBeTruthy();
    expect(screen.getByText('Signed in Sept')).toBeTruthy();
    const auto = screen.getByTestId('auto-signups');
    expect(within(auto).getByText('Jane D.')).toBeTruthy();
    expect(within(auto).getByText('@gym.com')).toBeTruthy();
    expect(within(auto).getByText('Invited')).toBeTruthy();
  });

  it('empty states', async () => {
    routes['/affiliate/trainer-referrals'] = () => json({ referrals: [], autoSignups: [] });
    render(<AffiliateTrainerReferrals token="tok-1" />);
    expect(await screen.findByText('Trainers you bring will appear here — tell the Axiom team who you referred.')).toBeTruthy();
    expect(screen.getByText(/No coach sign-ups through your link yet/)).toBeTruthy();
  });
});

describe('AffiliateManualPayouts', () => {
  it('renders rows, kind badges, CAD amounts and totals', async () => {
    render(<AffiliateManualPayouts token="tok-1" />);
    expect(await screen.findByText('Paid to date (recorded 2026-10-17)')).toBeTruthy();
    expect(screen.getByTestId('manual-paid-total').textContent).toBe('CA$160.00');
    expect(screen.getByTestId('manual-pending-total').textContent).toBe('CA$0.00');
    expect(screen.getByText('UGC')).toBeTruthy();
    expect(screen.getByText('Discretionary')).toBeTruthy();
    expect(screen.getByText('CA$160.00', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Pending', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('AXM-2026-10-17-UGC')).toBeTruthy();
    expect(screen.getByText('Discretionary bonus — amount to confirm')).toBeTruthy();
    expect(screen.getByText(/Paid outside Stripe by the Axiom team/)).toBeTruthy();
  });

  it('empty state keeps zero totals', async () => {
    routes['/affiliate/manual-payouts'] = () => json({ payouts: [], totals: { paidCents: 0, pendingCents: 0 } });
    render(<AffiliateManualPayouts token="tok-1" />);
    expect(await screen.findByText('No payouts outside Stripe yet.')).toBeTruthy();
    expect(screen.getByTestId('manual-paid-total').textContent).toBe('CA$0.00');
  });
});

describe('AffiliateResources — markdown document', () => {
  it('md resources get a Read button that renders inline; PDFs keep View/Download', async () => {
    render(<AffiliateResources token="tok-1" />);
    expect(await screen.findByText('Axiom Affiliate Payment Structure')).toBeTruthy();
    expect(screen.getByText(/Read online/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View Axiom Affiliate Payment Structure' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View Axiom Affiliate Playbook' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Read Axiom Affiliate Payment Structure' }));
    const doc = await screen.findByTestId('resource-doc-payment-structure');
    expect(within(doc).getByRole('heading', { name: 'Axiom Affiliate Payment Structure' })).toBeTruthy();
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('img')).toBeNull();
    expect((window as any).open).not.toHaveBeenCalled();
    const linkCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/payment-structure/link'))!;
    expect((linkCall[1] as RequestInit).headers).toMatchObject({ 'X-Affiliate-Token': 'tok-1' });
    const fileCall = fetchMock.mock.calls.find(c => c[0] === SIGNED)!;
    expect(JSON.stringify(fileCall)).not.toContain('tok-1');

    fireEvent.click(screen.getByRole('button', { name: 'Close Axiom Affiliate Payment Structure' }));
    await waitFor(() => expect(screen.queryByTestId('resource-doc-payment-structure')).toBeNull());
  });
});

describe('AffiliatePage', () => {
  it('adds the "Paid outside Stripe" tile and the three sections after Resources', async () => {
    routes['/affiliate/me'] = () => json({
      id: 'a1', name: 'Saeed', email: 's@x.com', referralCode: 'SAEED10', referralLink: 'https://axiomtraining.io?ref=SAEED10',
      active: true, onboarded: true, pendingCents: 520, paidCents: 1000, activeSubscriptions: 2, commissionRate: 0.4, discountRate: 0.2,
      manualPayoutTotals: { paidCents: 16000, pendingCents: 0 }, recentCommissions: [], payouts: [],
    });
    sessionStorage.setItem('affiliateToken', 'tok-1');
    render(<AffiliatePage />);
    expect(await screen.findByText('Paid outside Stripe')).toBeTruthy();
    expect(screen.getAllByText('CA$160.00').length).toBeGreaterThan(0);
    const order = ['Resources', 'Your terms', 'Trainer referrals', 'UGC & other payouts'].map(t => screen.getByRole('heading', { name: t }));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    sessionStorage.clear();
  });
});

describe('AdminAffiliateExtras', () => {
  it('loads terms/referrals/payouts, marks a payout paid and saves terms', async () => {
    const calls: { method: string; path: string; body: any }[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path === '/affiliates/a1/extras') return json({
        terms: TERMS, structure: STRUCTURE,
        trainerReferrals: [{ id: 'tr1', trainerName: 'Coach K', organization: 'K Gym', contact: '@k', plan: 'coach', status: 'active', coachBetaSignupId: null, startedAt: null, note: null }],
        autoSignups: [],
        manualPayouts: [{ id: 'p2', kind: 'discretionary', description: 'Discretionary bonus', amountCents: 0, currency: 'CAD', status: 'pending', paidAt: null, reference: null, note: null, createdAt: '2026-10-17T00:00:00.000Z' }],
        manualPayoutTotals: { paidCents: 16000, pendingCents: 0 },
      });
      return json({ ok: true });
    });
    render(<AdminAffiliateExtras affiliateId="a1" />);
    expect(await screen.findByText('Coach K')).toBeTruthy();
    expect(screen.getByText(/paid CA\$160\.00/)).toBeTruthy();
    expect((screen.getByLabelText('Trainer %') as HTMLInputElement).value).toBe('20');
    expect((screen.getByLabelText('Per-video fee') as HTMLInputElement).value).toBe('40.00');

    fireEvent.click(screen.getByRole('button', { name: /Mark paid/ }));
    await waitFor(() => expect(calls.some(c => c.method === 'PUT' && c.path === '/affiliates/a1/manual-payouts/p2')).toBe(true));
    expect(calls.find(c => c.method === 'PUT')!.body).toEqual({ status: 'paid' });

    fireEvent.change(screen.getByLabelText('Trainer %'), { target: { value: '12.5' } });
    fireEvent.change(screen.getByLabelText('Per-video fee'), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: /Save terms/ }));
    await waitFor(() => expect(calls.some(c => c.path === '/affiliates/a1/terms')).toBe(true));
    expect(calls.find(c => c.path === '/affiliates/a1/terms')!.body).toMatchObject({ trainerCommissionRate: 0.125, perVideoFeeCents: 5500, campaignRate: 0.3, commissionRate: 0.4 });
  });
});
