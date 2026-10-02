/**
 * Unit tests for the Login page component.
 * Tests form submission, OAuth handling, and redirect logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from '@/pages/login';

// The page renders <Navbar variant="full" />, which itself contains a "Sign In"
// button linking to /login. A case-insensitive /^sign in$/i therefore matched
// BOTH it and the form's submit button, so every query below failed with
// "Found multiple elements". Scope to the form instead of loosening the name.
function submitButton(): HTMLElement {
  const form = document.querySelector('form');
  if (!form) throw new Error('login form not found');
  return within(form as HTMLElement).getByRole('button', { name: /^sign in/i });
}

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
    features: { onboardingFormHook: false, diagnosticFirstOnboarding: false },
    loading: false,
  }),
  postAuthDestination: (user: any, features: any) =>
    !user?.coachOnboardingDone && features?.diagnosticFirstOnboarding ? '/onboarding' : '/coach',
  DEFAULT_FEATURES: { onboardingFormHook: false, diagnosticFirstOnboarding: false },
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
    expect(submitButton()).toBeInTheDocument();
  });

  it('calls login() with email and password on form submit', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'password123');
    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  // Was asserting /onboarding. The default landing was changed to /coach — the
  // intake now lives on the Coach screen rather than a separate route — so this
  // test had been failing against correct behaviour.
  it('redirects to /coach after successful login (no saved redirect)', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'pass');
    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith('/coach');
    });
  });

  it('redirects to saved sessionStorage path after login', async () => {
    window.sessionStorage.setItem('liftoff_redirect', '/plan');
    mockLogin.mockResolvedValueOnce(undefined);
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'x@x.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'pass');
    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith('/plan');
    });
    expect(window.sessionStorage.getItem('liftoff_redirect')).toBeNull();
  });

  it('cold-starts a new diagnostic-first user in /onboarding, even over a saved redirect', async () => {
    window.sessionStorage.setItem('liftoff_redirect', '/plan');
    mockLogin.mockResolvedValueOnce(undefined);
    // /auth/me is the only response carrying coachOnboardingDone + flags
    mockRefreshUser.mockResolvedValueOnce({
      user: { id: 'u1', coachOnboardingDone: false },
      features: { onboardingFormHook: false, diagnosticFirstOnboarding: true },
    });
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'new@example.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'pass');
    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith('/onboarding');
    });
  });

  it('keeps a returning flagged user out of the diagnostic cold start', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    mockRefreshUser.mockResolvedValueOnce({
      user: { id: 'u1', coachOnboardingDone: true },
      features: { onboardingFormHook: false, diagnosticFirstOnboarding: true },
    });
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'old@example.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'pass');
    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith('/coach');
    });
  });

  it('shows an error toast when login fails', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));
    render(<Login />);

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'bad@example.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'wrongpass');
    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Invalid credentials');
    });
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it('does not submit when fields are empty', async () => {
    render(<Login />);
    await userEvent.click(submitButton());
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

// ─── Personal trainer sign-in (replaced the organization-slug sign-in) ────────

import { resolvePostAuthRedirect } from '@/pages/login';

describe('Login page — personal trainer sign-in', () => {
  beforeEach(() => {
    setupCleanURL();
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('no longer asks for an organization slug', async () => {
    render(<Login />);
    expect(screen.queryByText(/organization/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sign in as a personal trainer/i }));
    expect(screen.queryByPlaceholderText(/state-university/i)).not.toBeInTheDocument();
    expect(submitButton()).toHaveTextContent(/sign in to trainer dashboard/i);
  });

  it('lands a trainer on /personal-training, even a brand-new account headed for onboarding', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    mockRefreshUser.mockResolvedValueOnce({
      user: { coachOnboardingDone: false },
      features: { onboardingFormHook: false, diagnosticFirstOnboarding: true },
    });
    render(<Login />);
    await userEvent.click(screen.getByRole('button', { name: /sign in as a personal trainer/i }));
    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'kofi@example.com');
    await userEvent.type(screen.getByPlaceholderText(/••••••••/), 'password123');
    await userEvent.click(submitButton());
    await waitFor(() => expect(mockSetLocation).toHaveBeenCalledWith('/personal-training'));
  });

  it('remembers the trainer destination across the Google round trip', async () => {
    render(<Login />);
    await userEvent.click(screen.getByRole('button', { name: /sign in as a personal trainer/i }));
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(window.sessionStorage.getItem('liftoff_redirect')).toBe('/personal-training');
    expect(mockGoogleLogin).toHaveBeenCalled();
  });

  it('does not touch the saved redirect for an ordinary Google sign-in', async () => {
    render(<Login />);
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(window.sessionStorage.getItem('liftoff_redirect')).toBeNull();
  });
});

describe('resolvePostAuthRedirect', () => {
  it('sends new users to onboarding over an ordinary saved path', () => {
    expect(resolvePostAuthRedirect('/onboarding', '/history')).toBe('/onboarding');
    expect(resolvePostAuthRedirect('/coach', '/history')).toBe('/history');
    expect(resolvePostAuthRedirect('/coach', null)).toBe('/coach');
    expect(resolvePostAuthRedirect('/coach', '/login')).toBe('/coach');
  });

  it('lets trainer and invite paths through ahead of onboarding', () => {
    expect(resolvePostAuthRedirect('/onboarding', '/personal-training')).toBe('/personal-training');
    expect(resolvePostAuthRedirect('/onboarding', '/personal-training/join/tok-1')).toBe('/personal-training/join/tok-1');
  });
});
