/**
 * Unit tests for the AuthContext / AuthProvider.
 * Mocks global fetch so no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '@/context/AuthContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockUser = { id: 'u1', name: 'Alice', email: 'alice@example.com', tier: 'free' };

function createFetchMock(response: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
  });
}

// A simple consumer component for testing context values
function AuthConsumer({ action }: { action?: string }) {
  const { user, loading, login, logout, refreshUser } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user ? user.email : 'null'}</div>
      <div data-testid="name">{user?.name ?? 'no-name'}</div>
      <div data-testid="tier">{user?.tier ?? 'no-tier'}</div>
      {action === 'login' && (
        <button onClick={() => login('test@example.com', 'pass123')}>Login</button>
      )}
      {action === 'logout' && (
        <button onClick={() => logout()}>Logout</button>
      )}
      {action === 'refresh' && (
        <button onClick={() => refreshUser()}>Refresh</button>
      )}
    </div>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthProvider — initial state', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts with loading=true and user=null', async () => {
    // Delay resolution so we can observe the loading state
    let resolve: (v: any) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise(r => { resolve = r; })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(
      <AuthProvider><AuthConsumer /></AuthProvider>
    );

    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('null');

    // Resolve the pending /auth/me call
    await act(async () => {
      resolve!({ ok: false, status: 401, json: async () => ({}) });
    });

    unmount();
  });

  it('sets user after successful /auth/me on mount', async () => {
    vi.stubGlobal('fetch', createFetchMock({ user: mockUser }));

    render(<AuthProvider><AuthConsumer /></AuthProvider>);

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false')
    );

    expect(screen.getByTestId('user').textContent).toBe(mockUser.email);
    expect(screen.getByTestId('name').textContent).toBe(mockUser.name);
    expect(screen.getByTestId('tier').textContent).toBe(mockUser.tier);
  });

  it('leaves user=null when /auth/me returns 401', async () => {
    vi.stubGlobal('fetch', createFetchMock({ error: 'Unauthorized' }, 401));

    render(<AuthProvider><AuthConsumer /></AuthProvider>);

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false')
    );

    expect(screen.getByTestId('user').textContent).toBe('null');
  });
});

describe('AuthProvider — login', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sets user after successful login', async () => {
    // First call: /auth/me on mount (returns no user)
    // Second call: /auth/login (returns user)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user: mockUser }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<AuthProvider><AuthConsumer action="login" /></AuthProvider>);

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false')
    );

    await userEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe(mockUser.email)
    );
  });

  it('throws when login returns an API error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }) // /auth/me
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Invalid credentials' }) }); // /auth/login

    vi.stubGlobal('fetch', fetchMock);

    let caughtError: Error | null = null;

    function LoginThrower() {
      const { login, loading } = useAuth();
      return (
        <button
          onClick={() => login('x@x.com', 'wrong').catch(e => { caughtError = e; })}
          disabled={loading}
        >
          Login
        </button>
      );
    }

    render(<AuthProvider><LoginThrower /></AuthProvider>);
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(caughtError).not.toBeNull());
    expect(caughtError!.message).toContain('Invalid credentials');
  });
});

describe('AuthProvider — logout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clears user after logout', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user: mockUser }) }) // /auth/me
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) }); // /auth/logout

    vi.stubGlobal('fetch', fetchMock);

    render(<AuthProvider><AuthConsumer action="logout" /></AuthProvider>);

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe(mockUser.email)
    );

    await userEvent.click(screen.getByRole('button', { name: /logout/i }));

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('null')
    );
  });
});

describe('AuthProvider — refreshUser', () => {
  afterEach(() => vi.restoreAllMocks());

  it('updates user state when refreshUser is called', async () => {
    const updatedUser = { ...mockUser, name: 'Alice Updated' };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }) // initial /auth/me
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user: updatedUser }) }); // refreshUser call

    vi.stubGlobal('fetch', fetchMock);

    render(<AuthProvider><AuthConsumer action="refresh" /></AuthProvider>);

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false')
    );

    expect(screen.getByTestId('user').textContent).toBe('null');

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe(updatedUser.email)
    );
    expect(screen.getByTestId('name').textContent).toBe('Alice Updated');
  });
});
