import { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Dumbbell, TrendingUp, Bot, UserPlus,
  MessageCircle, Rss, Settings, LogOut, Clock,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { useLocation as useNav } from 'wouter';

interface NavbarV3Props {
  children?: ReactNode;
}

// NavbarV3 — Sidebar Navigation (Linear/Notion style)
// Layout component: fixed left sidebar (w-56) + main content area for children.
export default function NavbarV3({ children }: NavbarV3Props) {
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

  if (!user) return <>{children}</>;

  const displayName = user.name ?? user.email ?? 'User';

  const navItems: { href: string; icon: React.ReactNode; label: string }[] = [
    { href: '/workouts',         icon: <Dumbbell className="h-4 w-4" />,       label: 'Workouts' },
    { href: '/history',          icon: <Clock className="h-4 w-4" />,           label: 'History' },
    { href: '/strength-profile', icon: <TrendingUp className="h-4 w-4" />,     label: 'Strength Profile' },
    { href: '/coach',            icon: <Bot className="h-4 w-4" />,            label: 'AI Coach' },
    { href: '/friends',          icon: <UserPlus className="h-4 w-4" />,       label: 'Friends' },
    { href: '/messages',         icon: <MessageCircle className="h-4 w-4" />,  label: 'Messages' },
    { href: '/social',           icon: <Rss className="h-4 w-4" />,            label: 'Social Feed' },
    { href: '/settings',         icon: <Settings className="h-4 w-4" />,       label: 'Settings' },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-56 border-r bg-background flex flex-col z-40">
        {/* Logo */}
        <div className="px-4 py-4 border-b">
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo height={28} className="h-7 w-auto" />
            <span className="font-semibold text-sm">Axiom</span>
          </Link>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {navItems.map(({ href, icon, label }) => {
            const active = location === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                {icon}
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer: user + sign out */}
        <div className="px-2 py-3 border-t space-y-0.5">
          <div className="px-3 py-1.5">
            <p className="text-xs font-medium text-foreground truncate">{displayName}</p>
            {user.name && user.email && (
              <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="ml-56 flex-1 min-h-screen">
        {children}
      </div>
    </div>
  );
}
