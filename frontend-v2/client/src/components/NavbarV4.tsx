import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useLocation as useNav } from 'wouter';

// NavbarV4 — Avatar Dropdown (GitHub/Vercel style)
// Minimal top bar: logo, 3 primary items inline, then a full avatar dropdown.
export function NavbarV4() {
  const { user, logout } = useAuth();
  const [, navigate] = useNav();
  const [location] = useLocation();

  async function handleLogout() {
    try {
      await logout();
      navigate('/');
    } catch {
      toast.error('Logout failed.');
    }
  }

  if (!user) return null;

  const initials = user.name
    ? user.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : (user.email ?? 'U')[0].toUpperCase();

  function navBtn(href: string, label: string) {
    const active = location === href;
    return (
      <Button
        key={href}
        variant="ghost"
        size="sm"
        className={`rounded-lg text-sm font-medium ${active ? 'bg-accent text-accent-foreground' : ''}`}
        asChild
      >
        <Link href={href}>{label}</Link>
      </Button>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur w-full">
      <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2.5">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-4 shrink-0">
          <BrandLogo height={30} className="h-[30px] w-auto" />
          <span className="font-semibold text-sm">Axiom</span>
        </Link>

        {/* 3 primary items */}
        <div className="flex items-center gap-0.5">
          {navBtn('/workouts', 'Workouts')}
          {navBtn('/coach', 'AI Coach')}
          {navBtn('/strength-profile', 'Strength')}
        </div>

        {/* Right: avatar dropdown with all pages */}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-8 w-8 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-2 py-1.5">
                <p className="text-xs font-semibold text-foreground truncate">{user.name ?? 'Account'}</p>
                {user.email && (
                  <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                )}
              </div>
              <DropdownMenuSeparator />

              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-2 py-1">
                App
              </DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/workouts" className="cursor-pointer">Workouts</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/strength-profile" className="cursor-pointer">Strength Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/history" className="cursor-pointer">History</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/coach" className="cursor-pointer">AI Coach</Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-2 py-1">
                Social
              </DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/friends" className="cursor-pointer">Friends</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/messages" className="cursor-pointer">Messages</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/social" className="cursor-pointer">Social Feed</Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-2 py-1">
                Account
              </DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/settings" className="cursor-pointer">Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer"
                onClick={handleLogout}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
