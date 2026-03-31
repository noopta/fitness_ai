import { Link, useLocation } from 'wouter';
import {
  Dumbbell, TrendingUp, Bot, UserPlus,
  MessageCircle, Rss, Settings, LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useLocation as useNav } from 'wouter';

// NavbarV2 — Icon-only with Tooltips (Slack/Figma style)
// Compact top bar; icons with tooltips; avatar dropdown for sign out.
export function NavbarV2() {
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

  const items: { href: string; icon: React.ReactNode; label: string }[] = [
    { href: '/workouts',        icon: <Dumbbell className="h-4 w-4" />,       label: 'Workouts' },
    { href: '/strength-profile',icon: <TrendingUp className="h-4 w-4" />,     label: 'Strength Profile' },
    { href: '/coach',           icon: <Bot className="h-4 w-4" />,            label: 'AI Coach' },
    { href: '/friends',         icon: <UserPlus className="h-4 w-4" />,       label: 'Friends' },
    { href: '/messages',        icon: <MessageCircle className="h-4 w-4" />,  label: 'Messages' },
    { href: '/social',          icon: <Rss className="h-4 w-4" />,            label: 'Social Feed' },
    { href: '/settings',        icon: <Settings className="h-4 w-4" />,       label: 'Settings' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur w-full">
      <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-3 shrink-0">
          <BrandLogo height={28} className="h-7 w-auto" />
        </Link>

        {/* Icon nav items */}
        <div className="flex items-center gap-0.5">
          {items.map(({ href, icon, label }) => {
            const active = location === href;
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-9 w-9 rounded-lg ${active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    asChild
                  >
                    <Link href={href}>{icon}</Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Right: avatar dropdown */}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-8 w-8 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">
                {user.name || user.email}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer gap-2"
                onClick={handleLogout}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
