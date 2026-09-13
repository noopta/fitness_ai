/**
 * Unit tests for the VerifyEmail page: code submission, resend cooldown,
 * the send-failed banner, and the missing-email fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VerifyEmail from '@/pages/verify-email';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockVerifyEmail = vi.fn();
const mockResendVerification = vi.fn();
const mockSetLocation = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    verifyEmail: mockVerifyEmail,
    resendVerification: mockResendVerification,
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
  toast: {
    error: (msg: string) => mockToastError(msg),
    success: (msg: string) => mockToastSuccess(msg),
  },
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/components/Navbar', () => ({ Navbar: () => <nav /> }));
vi.mock('@/components/SEO', () => ({ SEO: () => null }));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, type, disabled }: any) => (
    <button onClick={onClick} type={type} disabled={disabled}>{children}</button>
  ),
}));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />,
}));
vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: any) => <label>{children}</label>,
}));

function setSearch(search: string) {
  // Same pattern as login.page.test.tsx — happy-dom's history.replaceState
  // doesn't reflect into window.location.search.
  Object.defineProperty(window, 'location', {
    value: { search, pathname: '/verify-email', href: `http://localhost/verify-email${search}` },
    writable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearch('?email=test%40example.com');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VerifyEmail page', () => {
  it('shows the target email from the query string', () => {
    render(<VerifyEmail />);
    expect(screen.getByText('test@example.com')).toBeTruthy();
    expect(screen.getByText(/sent a 6-digit code/i)).toBeTruthy();
  });

  it('submits the code and routes to /coach on success', async () => {
    mockVerifyEmail.mockResolvedValue(undefined);
    render(<VerifyEmail />);

    await userEvent.type(screen.getByPlaceholderText('123456'), '482913');
    await userEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    await waitFor(() => {
      expect(mockVerifyEmail).toHaveBeenCalledWith('test@example.com', '482913');
      expect(mockSetLocation).toHaveBeenCalledWith('/coach');
    });
  });

  it('surfaces a server rejection without navigating', async () => {
    mockVerifyEmail.mockRejectedValue(new Error("That code didn't match. Try again."));
    render(<VerifyEmail />);

    await userEvent.type(screen.getByPlaceholderText('123456'), '000000');
    await userEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("That code didn't match. Try again.");
    });
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it('keeps the Verify button disabled until 6 digits are entered', async () => {
    render(<VerifyEmail />);
    const button = screen.getByRole('button', { name: /^verify$/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.type(screen.getByPlaceholderText('123456'), '12345');
    expect(button.disabled).toBe(true);
    await userEvent.type(screen.getByPlaceholderText('123456'), '6');
    expect(button.disabled).toBe(false);
  });

  it('leads with the resend prompt when the initial send failed (codeSent=0)', () => {
    setSearch('?email=test%40example.com&codeSent=0');
    render(<VerifyEmail />);
    expect(screen.getByText(/couldn't send a code/i)).toBeTruthy();
  });

  it('resend success shows a toast; cooldown response starts the countdown', async () => {
    mockResendVerification.mockResolvedValueOnce({ sent: true });
    render(<VerifyEmail />);

    await userEvent.click(screen.getByRole('button', { name: /resend code/i }));
    await waitFor(() => {
      expect(mockResendVerification).toHaveBeenCalledWith('test@example.com');
      expect(mockToastSuccess).toHaveBeenCalled();
    });

    mockResendVerification.mockResolvedValueOnce({ sent: false, reason: 'cooldown', cooldownRemainingSec: 42 });
    await userEvent.click(screen.getByRole('button', { name: /resend code/i }));
    await waitFor(() => {
      expect(screen.getByText(/resend in 42s/i)).toBeTruthy();
    });
  });

  it('falls back to a restart link when no email is in the URL', () => {
    setSearch('');
    render(<VerifyEmail />);
    expect(screen.getByText(/don't know which account/i)).toBeTruthy();
    expect(screen.getByText(/back to sign up/i)).toBeTruthy();
  });
});
