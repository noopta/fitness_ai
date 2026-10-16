// Dashboard shell (design handoff §6): a 232px left rail on desktop — logo,
// bell, Ask Anakin with its ⌘K hint, nav, trainer footer — and a header bar
// plus a bottom bar below 768px: four destinations and a More sheet for the rest.

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  CalendarDays, ClipboardCheck, CreditCard, Dumbbell, Inbox, LineChart, MessageCircle, MoreHorizontal, Settings, Sunrise, Users, type LucideIcon,
} from 'lucide-react';
import { COPY, type MeResponse } from '@axiom/personal-training-core';
import { BrandLogo } from '@/components/BrandLogo';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useInboxUnread } from '../businessHooks';
import { BCOPY } from '../copyBusiness';
import { NotificationBell } from './NotificationBell';
import { Avatar } from './primitives';

export type NavKey = 'briefing' | 'clients' | 'inbox' | 'checkIns' | 'progress' | 'programs' | 'schedule' | 'billing' | 'anakin' | 'settings';

const ANAKIN_HREF = '/personal-training/anakin';

type NavEntry = { key: NavKey; label: string; tabLabel?: string; icon: LucideIcon; href: string };

const NAV: NavEntry[] = [
  { key: 'briefing', label: COPY.nav.briefing, icon: Sunrise, href: '/personal-training' },
  { key: 'clients', label: COPY.nav.clients, icon: Users, href: '/personal-training/clients' },
  { key: 'inbox', label: BCOPY.nav.inbox, icon: Inbox, href: '/personal-training/inbox' },
  { key: 'checkIns', label: COPY.nav.checkIns, icon: ClipboardCheck, href: '/personal-training/check-ins' },
  { key: 'progress', label: COPY.nav.progress, icon: LineChart, href: '/personal-training/progress' },
  { key: 'programs', label: BCOPY.nav.programs, icon: Dumbbell, href: '/personal-training/programs' },
  { key: 'schedule', label: BCOPY.nav.schedule, icon: CalendarDays, href: '/personal-training/schedule' },
  { key: 'billing', label: BCOPY.nav.billing, icon: CreditCard, href: '/personal-training/billing' },
  { key: 'anakin', label: COPY.nav.anakin, tabLabel: 'Anakin', icon: MessageCircle, href: ANAKIN_HREF },
];

const SETTINGS_ENTRY: NavEntry = { key: 'settings', label: BCOPY.nav.settings, icon: Settings, href: '/personal-training/settings/notifications' };

/** The phone bar holds four destinations and More; everything else sits in the More sheet. */
const TAB_KEYS: NavKey[] = ['briefing', 'clients', 'inbox', 'checkIns'];
const TABS = NAV.filter((n) => TAB_KEYS.includes(n.key));
const MORE = [...NAV.filter((n) => !TAB_KEYS.includes(n.key)), SETTINGS_ENTRY];

function Badge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <>
      <span aria-hidden className="ml-auto grid min-w-5 place-items-center rounded-full bg-foreground px-1.5 text-[11px] font-bold leading-5 text-background tabular-nums">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">, {label}</span>
    </>
  );
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';

function NavItem({ item, active, layout, badge = 0, onNavigate }: { item: NavEntry; active: boolean; layout: 'rail' | 'tab' | 'sheet'; badge?: number; onNavigate?: () => void }) {
  const Icon = item.icon;
  const badgeLabel = BCOPY.nav.unread(badge);
  if (layout === 'sheet') {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn('flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition-colors duration-200', focusRing, active ? 'bg-axiom-zinc-100 text-foreground' : 'text-axiom-zinc-600 hover:bg-axiom-zinc-100')}
      >
        <Icon className="size-5" aria-hidden />
        {item.label}
        <Badge count={badge} label={badgeLabel} />
      </Link>
    );
  }
  if (layout === 'tab') {
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn('relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors duration-200', focusRing, active ? 'text-foreground' : 'text-axiom-zinc-500')}
      >
        <span className="relative">
          <Icon className="size-4" aria-hidden />
          {badge > 0 && <span aria-hidden className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-foreground px-1 text-[10px] font-bold leading-4 text-background">{badge > 9 ? '9+' : badge}</span>}
        </span>
        {item.tabLabel ?? item.label}
        {badge > 0 && <span className="sr-only">, {badgeLabel}</span>}
      </Link>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'transition-colors duration-200', focusRing,
        layout === 'rail'
          ? 'flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold'
          : 'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold',
        layout === 'rail'
          ? active ? 'bg-axiom-zinc-100 text-foreground' : 'text-axiom-zinc-600 hover:bg-axiom-zinc-100'
          : active ? 'text-foreground' : 'text-axiom-zinc-500',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {item.label}
      <Badge count={badge} label={badgeLabel} />
    </Link>
  );
}

function MoreTab({ active, badge }: { active: NavKey; badge: number }) {
  const [open, setOpen] = useState(false);
  const inMore = MORE.some((m) => m.key === active);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-current={inMore ? 'page' : undefined}
        onClick={() => setOpen(true)}
        className={cn('flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors duration-200', focusRing, inMore ? 'text-foreground' : 'text-axiom-zinc-500')}
      >
        <MoreHorizontal className="size-4" aria-hidden />
        {BCOPY.nav.more}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader className="mb-2 text-left">
            <SheetTitle>{BCOPY.nav.moreTitle}</SheetTitle>
            <SheetDescription className="sr-only">{COPY.productName}</SheetDescription>
          </SheetHeader>
          <nav aria-label={BCOPY.nav.more} className="flex flex-col gap-1">
            {MORE.map((item) => <NavItem key={item.key} item={item} active={item.key === active} layout="sheet" badge={item.key === 'inbox' ? badge : 0} onNavigate={() => setOpen(false)} />)}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** ⌘K / Ctrl+K from anywhere in the dashboard opens Ask Anakin with the composer focused (§6.6). */
function useAnakinShortcut() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate(`${ANAKIN_HREF}?focus=1`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}

export function Shell({
  me, active, title, children, width = 'wide',
}: { me: MeResponse; active: NavKey; title: string; children: React.ReactNode; width?: 'narrow' | 'wide' | 'full' }) {
  useAnakinShortcut();
  const unread = useInboxUnread();
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-border bg-axiom-zinc-50 p-4 md:flex">
        <div className="mb-4 flex items-center justify-between px-2">
          <Link href="/personal-training" aria-label="Axiom personal training" className={cn('rounded-lg', focusRing)}>
            <BrandLogo height={28} />
          </Link>
          <NotificationBell />
        </div>
        <Link
          href={`${ANAKIN_HREF}?focus=1`}
          className={cn('mb-4 flex h-10 items-center justify-between rounded-xl border border-border bg-background px-3 text-[13px] font-semibold shadow-xs transition-colors duration-200 hover:bg-axiom-zinc-50', focusRing)}
        >
          {COPY.nav.anakin}
          <kbd className="rounded-md bg-axiom-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-axiom-zinc-600">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </Link>
        <nav aria-label={COPY.productName} className="flex flex-col gap-1">
          {NAV.map((item) => <NavItem key={item.key} item={item} active={item.key === active} layout="rail" badge={item.key === 'inbox' ? unread : 0} />)}
        </nav>
        <div className="mt-auto flex items-center gap-3 border-t border-border px-2 pt-4">
          <Avatar initials={me.trainer.initials} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{me.trainer.name}</p>
            <p className="truncate text-xs text-axiom-zinc-500">{me.practice?.name}</p>
          </div>
          <Link
            href="/personal-training/settings/notifications"
            aria-label={COPY.notifications.settings}
            aria-current={active === 'settings' ? 'page' : undefined}
            className={cn('grid size-9 shrink-0 place-items-center rounded-xl text-axiom-zinc-600 hover:bg-axiom-zinc-100', focusRing, active === 'settings' && 'bg-axiom-zinc-100 text-foreground')}
          >
            <Settings className="size-4" aria-hidden />
          </Link>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
        <BrandLogo height={24} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</p>
        <NotificationBell />
      </header>

      <main className={cn(
        'mx-auto w-full min-w-0 px-4 pb-24 pt-4 md:px-10 md:pb-12 md:pt-12 lg:px-12',
        width === 'narrow' ? 'max-w-[880px]' : width === 'wide' ? 'max-w-[1200px]' : 'max-w-none',
      )}>
        {children}
      </main>

      <nav aria-label={COPY.productName} className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map((item) => <NavItem key={item.key} item={item} active={item.key === active} layout="tab" badge={item.key === 'inbox' ? unread : 0} />)}
        <MoreTab active={active} badge={0} />
      </nav>
    </div>
  );
}
