/**
 * AdminRoute: admin-only pages (/admin/affiliates, /admin/blog) must render the
 * plain 404 for anyone who isn't on the server allowlist — signed-out users,
 * members, affiliates — and never the page shell.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminRoute from '@/components/AdminRoute';

const mockUseAuth = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

function AdminContent() {
  return <div data-testid="admin-content">All affiliates</div>;
}

afterEach(() => vi.clearAllMocks());

describe('AdminRoute', () => {
  it('shows loading while auth resolves', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    render(<AdminRoute component={AdminContent} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
  });

  it('renders 404 for a signed-out visitor', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    render(<AdminRoute component={AdminContent} />);
    expect(screen.getByText(/404 page not found/i)).toBeInTheDocument();
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
  });

  it('renders 404 for a signed-in non-admin (e.g. an affiliate with an account)', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'affiliate@x.com', isAdmin: false }, loading: false });
    render(<AdminRoute component={AdminContent} />);
    expect(screen.getByText(/404 page not found/i)).toBeInTheDocument();
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
  });

  it('renders 404 when the server omitted the flag entirely', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'someone@x.com' }, loading: false });
    render(<AdminRoute component={AdminContent} />);
    expect(screen.getByText(/404 page not found/i)).toBeInTheDocument();
  });

  it('renders the page for the admin', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u0', email: 'inquiries@axiomtraining.io', isAdmin: true }, loading: false });
    render(<AdminRoute component={AdminContent} />);
    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
  });
});
