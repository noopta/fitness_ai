import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

// NavbarV1 — Grouped Dropdown (Notion/Linear style)
// Primary nav items flat; social links collapsed into a "Social ▾" dropdown.
export function NavbarV1() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
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

  const displayName = user.name ? user.name.split(' ')[0] : user.email;

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

        {/* Primary nav items */}
        <div className="flex items-center gap-0.5">
          {navBtn('/workouts', 'Workouts')}
          {navBtn('/strength-profile', 'Strength Profile')}
          {navBtn('/coach', 'AI Coach')}

          {/* Social dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`rounded-lg text-sm font-medium gap-1 ${
                  ['/friends', '/messages', '/social'].includes(location)
                    ? 'bg-accent text-accent-foreground'
                    : ''
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Social
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem asChild>
                <Link href="/friends" className="cursor-pointer">Friends</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/messages" className="cursor-pointer">Messages</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/social" className="cursor-pointer">Social Feed</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {navBtn('/settings', 'Settings')}
        </div>

        {/* Right: user name + sign out */}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm font-medium text-foreground hidden sm:block truncate max-w-[120px]">
            {displayName}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg text-sm text-muted-foreground"
            onClick={handleLogout}
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
