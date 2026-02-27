import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronRight, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
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
  const [mobileOpen, setMobileOpen] = useState(false);

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
      <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60 w-full min-w-0 overflow-x-hidden safe-top">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 min-w-0">
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

  const closeMobile = () => setMobileOpen(false);

  // variant === 'full'
  const navLinks = user ? (
    <>
      <Button variant="ghost" size="sm" className="rounded-xl w-full justify-start" asChild>
        <Link href="/pricing" onClick={closeMobile}>Pricing</Link>
      </Button>
      <Button variant="ghost" size="sm" className="rounded-xl w-full justify-start" asChild>
        <Link href="/history" onClick={closeMobile}>My Analyses</Link>
      </Button>
      <Button variant="ghost" size="sm" className="rounded-xl w-full justify-start" asChild>
        <Link href="/coach" onClick={closeMobile}>AI Coach</Link>
      </Button>
      <Button variant="ghost" size="sm" className="rounded-xl w-full justify-start" asChild>
        <Link href="/settings" onClick={closeMobile}>Settings</Link>
      </Button>
      <Button variant="ghost" size="sm" className="rounded-xl w-full justify-start text-muted-foreground" onClick={() => { handleLogout(); closeMobile(); }}>
        Sign out
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" size="sm" className="rounded-xl w-full justify-start" asChild>
        <Link href="/pricing" onClick={closeMobile}>Pricing</Link>
      </Button>
      <Button variant="ghost" size="sm" className="rounded-xl w-full justify-start" asChild>
        <Link href="/login" onClick={closeMobile}>Sign In</Link>
      </Button>
      <Button size="sm" className="rounded-xl w-full justify-start" asChild>
        <Link href="/register" onClick={closeMobile}>
          Get Started
          <ChevronRight className="ml-1 h-4 w-4" />
        </Link>
      </Button>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur w-full min-w-0 overflow-x-hidden safe-top">
      <div className="container-tight flex items-center justify-between gap-3 py-3 sm:py-4 min-w-0">
        <Link href="/" className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <BrandLogo height={32} className="h-8 w-auto sm:h-9" />
          <div className="leading-tight min-w-0">
            <div className="text-sm font-semibold truncate">LiftOff</div>
            <div className="text-xs text-muted-foreground hidden sm:block">AI-Powered Diagnostics</div>
          </div>
        </Link>
        {breadcrumb && (
          <div className="hidden md:flex items-center gap-2.5 shrink-0">
            <span className="text-muted-foreground/50 text-base select-none">/</span>
            {breadcrumb}
          </div>
        )}

        {/* Desktop nav — hidden on mobile */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          {rightSlot}
          {authLoading ? (
            <div className="h-8 w-24 animate-pulse rounded-xl bg-muted" />
          ) : user ? (
            <>
              <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
                {user.name ? user.name.split(' ')[0] : user.email}
              </span>
              <Button variant="ghost" size="sm" className="rounded-xl" asChild>
                <Link href="/pricing">Pricing</Link>
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl" asChild>
                <Link href="/history">My Analyses</Link>
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl" asChild>
                <Link href="/coach">AI Coach</Link>
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl" asChild>
                <Link href="/settings">Settings</Link>
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl text-muted-foreground" onClick={handleLogout}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="rounded-xl" asChild>
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

        {/* Mobile nav — hamburger + sheet */}
        <div className="flex md:hidden items-center gap-2 shrink-0">
          {authLoading ? (
            <div className="h-8 w-8 animate-pulse rounded-xl bg-muted" />
          ) : (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] sm:w-[320px] flex flex-col gap-4 pt-12">
                {user && (
                  <div className="text-sm font-medium text-foreground truncate pb-2 border-b">
                    {user.name || user.email}
                  </div>
                )}
                <nav className="flex flex-col gap-1">
                  {navLinks}
                </nav>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>
    </header>
  );
}
