import { Link, useLocation } from 'wouter';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

interface NavbarProps {
  variant?: 'full' | 'step';
  /** Step-mode only: page title shown under logo (e.g. "Strength snapshot") */
  title?: string;
  /** Step-mode only: subtitle under title */
  subtitle?: string;
  /** Step-mode only: right-side step indicator text (e.g. "Step 2 of 4") */
  stepLabel?: string;
  /** Full-mode only: extra content rendered on the right alongside auth buttons */
  rightSlot?: React.ReactNode;
  /** Full-mode only: breadcrumb shown next to logo with a "/" divider */
  breadcrumb?: React.ReactNode;
}

export function Navbar({ variant = 'full', title, subtitle, stepLabel, rightSlot, breadcrumb }: NavbarProps) {
  const { user, loading: authLoading, logout } = useAuth();
  const [, navigate] = useLocation();

  async function handleLogout() {
    try {
      await logout();
      navigate('/');
    } catch {
      toast.error('Logout failed.');
    }
  }

  if (variant === 'step') {
    return (
      <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
            <BrandLogo height={36} className="h-9 w-auto" />
            <div className="leading-tight">
              <div className="text-sm font-semibold">{title || 'LiftOff'}</div>
              {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
            </div>
          </Link>
          {stepLabel && (
            <div className="hidden text-xs text-muted-foreground sm:block">{stepLabel}</div>
          )}
        </div>
      </header>
    );
  }

  // variant === 'full'
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="container-tight flex items-center justify-between py-4">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="inline-flex items-center gap-3">
            <BrandLogo height={36} className="h-9 w-auto" />
            <div className="leading-tight">
              <div className="text-sm font-semibold">LiftOff</div>
              <div className="text-xs text-muted-foreground">AI-Powered Diagnostics</div>
            </div>
          </Link>
          {breadcrumb && (
            <>
              <span className="text-muted-foreground/50 text-base select-none">/</span>
              {breadcrumb}
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {rightSlot}
          {authLoading ? (
            <div className="h-8 w-24 animate-pulse rounded-xl bg-muted" />
          ) : user ? (
            <>
              <span className="hidden md:block text-sm font-medium text-foreground truncate max-w-[140px]">
                {user.name ? user.name.split(' ')[0] : user.email}
              </span>
              <Button variant="ghost" size="sm" className="rounded-xl hidden sm:inline-flex" asChild>
                <Link href="/pricing">Pricing</Link>
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl hidden sm:inline-flex" asChild>
                <Link href="/history">My Analyses</Link>
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl hidden sm:inline-flex" asChild>
                <Link href="/coach">AI Coach</Link>
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl hidden sm:inline-flex" asChild>
                <Link href="/settings">Settings</Link>
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl text-muted-foreground" onClick={handleLogout}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="rounded-xl hidden sm:inline-flex" asChild>
                <Link href="/pricing">Pricing</Link>
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl" asChild>
                <Link href="/login">Sign In</Link>
              </Button>
              <Button size="sm" className="rounded-xl" asChild>
                <Link href="/register">
                  Get Started
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
