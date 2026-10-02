// Dashboard shell (design handoff §6): a 232px left rail on desktop, and a
// header bar plus bottom tab bar below 768px. Surfaces that are not built yet
// stay in the nav, disabled at 40% opacity, so the layout does not shift as
// they ship.

import { Link } from 'wouter';
import { ClipboardCheck, LineChart, MessageCircle, Sunrise, Users, type LucideIcon } from 'lucide-react';
import { COPY, type MeResponse } from '@axiom/personal-training-core';
import { BrandLogo } from '@/components/BrandLogo';
import { cn } from '@/lib/utils';
import { Avatar } from './primitives';

type NavKey = 'briefing' | 'clients' | 'checkIns' | 'progress' | 'anakin';

const NAV: { key: NavKey; label: string; icon: LucideIcon; href?: string }[] = [
  { key: 'briefing', label: COPY.nav.briefing, icon: Sunrise },
  { key: 'clients', label: COPY.nav.clients, icon: Users, href: '/personal-training/clients' },
  { key: 'checkIns', label: COPY.nav.checkIns, icon: ClipboardCheck },
  { key: 'progress', label: COPY.nav.progress, icon: LineChart },
  { key: 'anakin', label: COPY.nav.anakin, icon: MessageCircle },
];

function NavItem({ item, active, layout }: { item: (typeof NAV)[number]; active: boolean; layout: 'rail' | 'tab' }) {
  const Icon = item.icon;
  const base = layout === 'rail'
    ? 'flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold'
    : 'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold';
  const label = layout === 'tab' && item.key === 'anakin' ? 'Anakin' : item.label;

  if (!item.href) {
    return (
      <span aria-disabled="true" title={COPY.nav.comingSoon} className={cn(base, 'cursor-default text-axiom-zinc-600 opacity-40')}>
        <Icon className="size-4" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        base,
        'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
        layout === 'rail'
          ? active ? 'bg-axiom-zinc-100 text-foreground' : 'text-axiom-zinc-600 hover:bg-axiom-zinc-100'
          : active ? 'text-foreground' : 'text-axiom-zinc-500',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

export function Shell({
  me, active, title, children, wide = true,
}: { me: MeResponse; active: NavKey; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-border bg-axiom-zinc-50 p-4 md:flex">
        <Link href="/personal-training/clients" className="mb-6 flex items-center gap-2 px-2" aria-label="Axiom personal training">
          <BrandLogo height={28} />
        </Link>
        <nav aria-label={COPY.productName} className="flex flex-col gap-1">
          {NAV.map((item) => <NavItem key={item.key} item={item} active={item.key === active} layout="rail" />)}
        </nav>
        <div className="mt-auto flex items-center gap-3 border-t border-border px-2 pt-4">
          <Avatar initials={me.trainer.initials} size={32} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{me.trainer.name}</p>
            <p className="truncate text-xs text-axiom-zinc-500">{me.practice?.name}</p>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
        <BrandLogo height={24} />
        <p className="text-[13px] font-semibold">{title}</p>
      </header>

      <main className={cn('mx-auto w-full min-w-0 px-4 pb-24 pt-4 md:px-10 md:pb-12 md:pt-12 lg:px-12', wide ? 'max-w-[1200px]' : 'max-w-[880px]')}>
        {children}
      </main>

      <nav aria-label={COPY.productName} className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((item) => <NavItem key={item.key} item={item} active={item.key === active} layout="tab" />)}
      </nav>
    </div>
  );
}
