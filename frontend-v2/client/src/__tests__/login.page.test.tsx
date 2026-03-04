/**
 * Unit tests for the Login page component.
 * Tests form submission, OAuth handling, and redirect logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from '@/pages/login';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLogin = vi.fn();
const mockGoogleLogin = vi.fn();
const mockRefreshUser = vi.fn();
const mockSetLocation = vi.fn();
const mockToastError = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    googleLogin: mockGoogleLogin,
    refreshUser: mockRefreshUser,
    user: null,
    loading: false,
  }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/', mockSetLocation],
  Link: ({ href, children, className }: any) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock('sonner', () => ({
  toast: { error: (msg: string) => mockToastError(msg), success: vi.fn() },
}));

// Mock framer-motion to render children without animation overhead
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock BrandLogo
vi.mock('@/components/BrandLogo', () => ({
  BrandLogo: () => <div data-testid="brand-logo" />,
}));

// Mock UI components minimally
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, type, disabled, className, variant }: any) => (
    <button onClick={onClick} type={type} disabled={disabled} className={className} data-variant={variant}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: ({ type, placeholder, value, onChange, required }: any) => (
    <input type={type} placeholder={placeholder} value={value} onChange={onChange} required={required} />
  ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: any) => <label>{children}</label>,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupCleanURL() {
  Object.defineProperty(window, 'location', {
    value: { search: '', pathname: '/login', href: 'http://localhost/login' },
    writable: true,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Login page — form', () => {
  beforeEach(() => {
    setupCleanURL();
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('renders the sign-in form', () => {
    render(<Login />);
    expect(screen.getByPlaceholderText(/you@example\.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/••••••••/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('calls login() with email and password on form submit', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('redirects to /onboarding after successful login (no saved redirect)', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'pass');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith('/onboarding');
    });
  });

  it('redirects to saved sessionStorage path after login', async () => {
    window.sessionStorage.setItem('liftoff_redirect', '/plan');
    mockLogin.mockResolvedValueOnce(undefined);
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'x@x.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'pass');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith('/plan');
    });
    expect(window.sessionStorage.getItem('liftoff_redirect')).toBeNull();
  });

  it('shows an error toast when login fails', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'bad@example.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Invalid credentials');
    });
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it('does not submit when fields are empty', async () => {
    render(<Login />);
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(mockLogin).not.toHaveBeenCalled();
  });
});

describe('Login page — Google OAuth', () => {
  beforeEach(() => {
    setupCleanURL();
    vi.clearAllMocks();
  });

  it('calls googleLogin() when Continue with Google is clicked', async () => {
    render(<Login />);
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(mockGoogleLogin).toHaveBeenCalledTimes(1);
  });
});

describe('Login page — auth=error query param', () => {
  it('shows an error toast on auth=error and clears the URL', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?auth=error', pathname: '/login', href: 'http://localhost/login?auth=error' },
      writable: true,
    });
    window.history.replaceState = vi.fn();

    render(<Login />);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/google sign.in failed/i)
      );
    });
    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/login');
  });
});
