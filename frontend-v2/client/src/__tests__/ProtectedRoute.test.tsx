/**
 * Unit tests for the ProtectedRoute component.
 * Tests that unauthenticated users are redirected and authenticated users see content.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProtectedRoute from '@/components/ProtectedRoute';

// ─── Mock AuthContext ─────────────────────────────────────────────────────────

const mockUseAuth = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ─── Mock wouter ──────────────────────────────────────────────────────────────

const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/onboarding', mockSetLocation],
}));

// ─── Test component ───────────────────────────────────────────────────────────

function ProtectedContent() {
  return <div data-testid="protected-content">Secret content</div>;
}

afterEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProtectedRoute', () => {
  it('shows a loading state while auth is resolving', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    render(<ProtectedRoute component={ProtectedContent} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders nothing and redirects to /login when user is null after loading', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    render(<ProtectedRoute component={ProtectedContent} />);

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith('/login');
    });
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('saves the current path to sessionStorage before redirecting', async () => {
    // Simulate that user is on /plan
    Object.defineProperty(window, 'location', {
      value: { pathname: '/plan', search: '', href: 'http://localhost/plan' },
      writable: true,
    });

    mockUseAuth.mockReturnValue({ user: null, loading: false });
    render(<ProtectedRoute component={ProtectedContent} />);

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith('/login');
    });
    // The redirect path is saved for post-login navigation
    expect(window.sessionStorage.getItem('liftoff_redirect')).toBe('/plan');
  });

  it('renders the protected component when user is authenticated', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', name: 'Alice', email: 'a@a.com', tier: 'free' },
      loading: false,
    });
    render(<ProtectedRoute component={ProtectedContent} />);

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });
    expect(screen.getByText('Secret content')).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it('does not redirect while loading is still true', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    render(<ProtectedRoute component={ProtectedContent} />);

    // Give time for any effects to run
    await new Promise(r => setTimeout(r, 50));
    expect(mockSetLocation).not.toHaveBeenCalled();
  });
});
