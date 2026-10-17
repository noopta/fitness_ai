/**
 * Affiliate dashboard — Resources section: lists enablement docs from the API
 * (token in the X-Affiliate-Token header) and opens each via a short-lived
 * signed link in a new tab, never putting the affiliate token in a URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { AffiliateResources } from '@/components/AffiliateResources';
import { toast } from 'sonner';

const RESOURCES = [
  {
    slug: 'outreach-guide', title: 'Axiom Affiliate Outreach Guide', description: 'Who to target and how.',
    category: 'Outreach', updatedAt: '2026-10-16', audience: 'trainer-plan', fileName: 'axiom-affiliate-outreach-guide.pdf', sizeBytes: 86528,
  },
  {
    slug: 'affiliate-playbook', title: 'Axiom Affiliate Playbook', description: 'The 30-second pitch and more.',
    category: 'Knowledge base', updatedAt: '2026-10-16', audience: 'general', fileName: 'axiom-affiliate-playbook.pdf', sizeBytes: 180336,
  },
];
const SIGNED = 'https://api.example.test/api/affiliate/resources/outreach-guide/file?aid=a1&exp=1&sig=s';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;
let openMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/affiliate/resources')) return json({ resources: RESOURCES });
    if (url.includes('/affiliate/resources/outreach-guide/link')) return json({ url: SIGNED, expiresAt: new Date().toISOString() });
    return json({ error: 'nope' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  openMock = vi.fn(() => null);
  vi.stubGlobal('open', openMock);
  (window as any).open = openMock;
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('AffiliateResources', () => {
  it('renders a card per document with category, date and size', async () => {
    render(<AffiliateResources token="tok-1" />);
    expect(screen.getByText(/Loading resources/)).toBeTruthy();
    expect(await screen.findByText('Axiom Affiliate Outreach Guide')).toBeTruthy();
    expect(screen.getByText('Axiom Affiliate Playbook')).toBeTruthy();
    expect(screen.getByText('Outreach')).toBeTruthy();
    expect(screen.getByText('Knowledge base')).toBeTruthy();
    expect(screen.getAllByText(/Updated Oct 16, 2026/).length).toBe(2);
    expect(screen.getByText(/85 KB/)).toBeTruthy();
    expect(screen.getByText(/176 KB/)).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/affiliate\/resources$/);
    expect(url).not.toContain('tok-1');
    expect((init as RequestInit).headers).toMatchObject({ 'X-Affiliate-Token': 'tok-1' });
  });

  it('View fetches a signed link and opens it in a new tab', async () => {
    render(<AffiliateResources token="tok-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'View Axiom Affiliate Outreach Guide' }));
    await waitFor(() => expect(openMock).toHaveBeenCalledWith(SIGNED, '_blank', 'noopener'));
    const linkCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/link'))!;
    expect((linkCall[1] as RequestInit).headers).toMatchObject({ 'X-Affiliate-Token': 'tok-1' });
    expect(String(openMock.mock.calls[0][0])).not.toContain('tok-1');
  });

  it('Download opens the signed link with download=1', async () => {
    render(<AffiliateResources token="tok-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download Axiom Affiliate Outreach Guide' }));
    await waitFor(() => expect(openMock).toHaveBeenCalledWith(`${SIGNED}&download=1`, '_blank', 'noopener'));
  });

  it('shows an error toast when the link cannot be minted', async () => {
    render(<AffiliateResources token="tok-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'View Axiom Affiliate Playbook' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'));
    expect(openMock).not.toHaveBeenCalled();
  });

  it('shows the error state when the list fails, and retries', async () => {
    fetchMock.mockImplementationOnce(async () => json({ error: 'Resources are available once your affiliate account is active.' }, 403));
    render(<AffiliateResources token="tok-1" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/available once your affiliate account is active/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Axiom Affiliate Playbook')).toBeTruthy();
  });

  it('shows the empty state when there are no documents', async () => {
    fetchMock.mockImplementationOnce(async () => json({ resources: [] }));
    render(<AffiliateResources token="tok-1" />);
    expect(await screen.findByText(/No resources yet/)).toBeTruthy();
  });
});
