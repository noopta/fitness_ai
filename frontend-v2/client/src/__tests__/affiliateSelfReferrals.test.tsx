/**
 * "People you referred before you had a code" — affiliate dashboard card
 * (opt-in) and the admin review section.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/Navbar', () => ({ Navbar: () => null }));

import { toast } from 'sonner';
import AffiliatePage from '@/pages/affiliate';
import { AffiliateSelfReferrals } from '@/components/AffiliateSelfReferrals';
import { AdminAffiliateExtras } from '@/components/AdminAffiliateExtras';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const DASH = {
  id: 'a1', name: 'Umar', email: 'faruqanjo@gmail.com', referralCode: 'UMAR10', referralLink: 'https://axiomtraining.io?ref=UMAR10',
  active: true, onboarded: true, pendingCents: 0, paidCents: 0, activeSubscriptions: 0, commissionRate: 0.4, discountRate: 0.2,
  recentCommissions: [], payouts: [],
};

const ROWS = [
  { id: 'sr2', name: 'Sara', email: null, note: null, approxSignupDate: null, status: 'approved', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: null },
  { id: 'sr1', name: 'Ali Khan', email: 'ali@example.com', note: 'gym friend', approxSignupDate: '2026-08-01T00:00:00.000Z', status: 'submitted', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: null },
  { id: 'sr3', name: 'Zed', email: null, note: null, approxSignupDate: null, status: 'rejected', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: null },
];

type Call = { method: string; path: string; body: any; token: string | null };
let calls: Call[];
let handler: (c: Call) => Response;

beforeEach(() => {
  calls = [];
  handler = c => {
    if (c.path === '/affiliate/self-referrals' && c.method === 'GET') return json({ referrals: ROWS });
    return json({ ok: true });
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const c: Call = {
      method: init?.method ?? 'GET',
      path: new URL(url).pathname.replace(/^\/api/, ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      token: headers['X-Affiliate-Token'] ?? null,
    };
    calls.push(c);
    return handler(c);
  }));
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); sessionStorage.clear(); });

describe('AffiliatePage gating', () => {
  async function renderPage(selfReportEnabled?: boolean) {
    handler = c => {
      if (c.path === '/affiliate/me') return json({ ...DASH, ...(selfReportEnabled === undefined ? {} : { selfReportEnabled }) });
      if (c.path === '/affiliate/self-referrals') return json({ referrals: ROWS });
      return json({ error: 'nope' }, 404); // other dashboard cards show their error state
    };
    sessionStorage.setItem('affiliateToken', 'tok-umar');
    render(<AffiliatePage />);
    await screen.findByText('Welcome, Umar');
  }

  it('hidden when not enabled (or flag absent) and never calls the API', async () => {
    await renderPage(false);
    expect(screen.queryByTestId('affiliate-self-referrals')).toBeNull();
    expect(calls.some(c => c.path === '/affiliate/self-referrals')).toBe(false);
  });

  it('hidden when the flag is missing from an older backend', async () => {
    await renderPage(undefined);
    expect(screen.queryByTestId('affiliate-self-referrals')).toBeNull();
  });

  it('shown when enabled', async () => {
    await renderPage(true);
    expect(await screen.findByRole('heading', { name: 'People you referred before you had a code' })).toBeTruthy();
    expect(screen.getByText(/Only you and the Axiom team can see this list/)).toBeTruthy();
  });
});

describe('AffiliateSelfReferrals', () => {
  it('lists entries with status badges; edit/delete only on submitted rows; token in header', async () => {
    render(<AffiliateSelfReferrals token="tok-umar" />);
    const ali = await screen.findByTestId('self-referral-sr1');
    expect(within(ali).getByText('Submitted')).toBeTruthy();
    expect(within(ali).getByText('ali@example.com')).toBeTruthy();
    expect(within(ali).getByText('Aug 1, 2026')).toBeTruthy();
    expect(within(ali).getByText('gym friend')).toBeTruthy();
    expect(within(screen.getByTestId('self-referral-sr2')).getByText('Approved')).toBeTruthy();
    expect(within(screen.getByTestId('self-referral-sr3')).getByText('Not approved')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Ali Khan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit Sara' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Sara' })).toBeNull();
    expect(calls[0].token).toBe('tok-umar');
    expect(calls[0].path).toBe('/affiliate/self-referrals');
  });

  it('empty state', async () => {
    handler = () => json({ referrals: [] });
    render(<AffiliateSelfReferrals token="tok-umar" />);
    expect(await screen.findByText(/No one logged yet/)).toBeTruthy();
  });

  it('add posts the form, toasts and reloads', async () => {
    render(<AffiliateSelfReferrals token="tok-umar" />);
    await screen.findByTestId('self-referral-sr1');
    fireEvent.change(screen.getByLabelText('name'), { target: { value: '  New Person ' } });
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'new@x.com' } });
    fireEvent.change(screen.getByLabelText('sign-up date'), { target: { value: '2026-07-15' } });
    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'met at the gym' } });
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true));
    const post = calls.find(c => c.method === 'POST')!;
    expect(post.path).toBe('/affiliate/self-referrals');
    expect(post.token).toBe('tok-umar');
    expect(post.body).toEqual({ name: 'New Person', email: 'new@x.com', approxSignupDate: '2026-07-15', note: 'met at the gym' });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(calls.filter(c => c.method === 'GET').length).toBe(2));
    expect((screen.getByLabelText('name') as HTMLInputElement).value).toBe('');
  });

  it('add without a name is blocked client-side; server errors toast', async () => {
    render(<AffiliateSelfReferrals token="tok-umar" />);
    await screen.findByTestId('self-referral-sr1');
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    expect(toast.error).toHaveBeenCalledWith('Name is required');
    expect(calls.some(c => c.method === 'POST')).toBe(false);

    handler = c => (c.method === 'POST' ? json({ error: 'email: must be a valid email' }, 400) : json({ referrals: ROWS }));
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('email: must be a valid email'));
  });

  it('inline edit sends PUT with the changes', async () => {
    render(<AffiliateSelfReferrals token="tok-umar" />);
    await screen.findByTestId('self-referral-sr1');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Ali Khan' }));
    const row = screen.getByTestId('self-referral-edit-sr1');
    const nameInput = within(row).getByLabelText('Edit name') as HTMLInputElement;
    expect(nameInput.value).toBe('Ali Khan');
    expect((within(row).getByLabelText('Edit sign-up date') as HTMLInputElement).value).toBe('2026-08-01');
    fireEvent.change(nameInput, { target: { value: 'Ali K.' } });
    fireEvent.change(within(row).getByLabelText('Edit note'), { target: { value: '' } });
    fireEvent.click(within(row).getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true));
    const put = calls.find(c => c.method === 'PUT')!;
    expect(put.path).toBe('/affiliate/self-referrals/sr1');
    expect(put.body).toEqual({ name: 'Ali K.', email: 'ali@example.com', approxSignupDate: '2026-08-01', note: null });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Entry updated'));
  });

  it('delete confirms then sends DELETE', async () => {
    render(<AffiliateSelfReferrals token="tok-umar" />);
    await screen.findByTestId('self-referral-sr1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Ali Khan' }));
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE')).toBe(true));
    expect(calls.find(c => c.method === 'DELETE')!.path).toBe('/affiliate/self-referrals/sr1');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Entry deleted'));
  });

  it('a 409 on edit shows the server message', async () => {
    render(<AffiliateSelfReferrals token="tok-umar" />);
    await screen.findByTestId('self-referral-sr1');
    handler = c => (c.method === 'PUT' ? json({ error: 'This entry has already been reviewed and can no longer be changed.' }, 409) : json({ referrals: ROWS }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Ali Khan' }));
    fireEvent.click(within(screen.getByTestId('self-referral-edit-sr1')).getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This entry has already been reviewed and can no longer be changed.'));
  });
});

describe('AdminAffiliateExtras — past referrals review', () => {
  const ADMIN_ROWS = [{
    ...ROWS[1], matchedUserId: null, adminNote: null,
    suggestedMatch: { userId: 'user-1', name: 'Ali Khan', tier: 'pro', createdAt: '2026-08-02T00:00:00.000Z', referredByCode: null },
  }];

  beforeEach(() => {
    handler = c => {
      if (c.path === '/affiliates/a1/extras') return json({
        terms: { commissionRate: 0.4, trainerCommissionRate: null, campaignRate: 0.3, perVideoFeeCents: null, agreementNote: null, agreementUpdatedAt: null },
        trainerReferrals: [], autoSignups: [], manualPayouts: [], manualPayoutTotals: { paidCents: 0, pendingCents: 0 },
      });
      if (c.path === '/affiliates/a1/self-referrals') return json({ selfReportEnabled: false, referrals: ADMIN_ROWS });
      return json({ ok: true });
    };
  });

  it('toggle, suggested match and review save', async () => {
    render(<AdminAffiliateExtras affiliateId="a1" />);
    const section = await screen.findByTestId('admin-self-referrals');
    const toggle = within(section).getByLabelText('Allow this affiliate to log past referrals') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(calls.some(c => c.path === '/affiliates/a1/self-report')).toBe(true));
    expect(calls.find(c => c.path === '/affiliates/a1/self-report')!.body).toEqual({ enabled: true });

    const row = within(section).getByTestId('admin-self-referral-sr1');
    expect(within(row).getByText(/Ali Khan · pro · joined 2026-08-02/)).toBeTruthy();
    expect(within(row).getByText('gym friend')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Use suggested match for Ali Khan' }));
    fireEvent.change(within(row).getByLabelText('Review status for Ali Khan'), { target: { value: 'approved' } });
    fireEvent.change(within(row).getByLabelText('Admin note for Ali Khan'), { target: { value: 'confirmed by DM' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save review for Ali Khan' }));
    await waitFor(() => expect(calls.some(c => c.path === '/affiliates/a1/self-referrals/sr1' && c.method === 'PUT')).toBe(true));
    expect(calls.find(c => c.path === '/affiliates/a1/self-referrals/sr1')!.body).toEqual({ status: 'approved', adminNote: 'confirmed by DM', matchedUserId: 'user-1' });
  });
});
