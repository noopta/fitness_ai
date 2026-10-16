// Sub-navigation between the dashboard's settings pages.

import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { PCOPY } from '../copyPlatform';

const PAGES = [
  { key: 'practice', label: PCOPY.settings.practice, href: '/personal-training/settings/practice' },
  { key: 'notifications', label: PCOPY.settings.notifications, href: '/personal-training/settings/notifications' },
] as const;

export function SettingsNav({ active }: { active: (typeof PAGES)[number]['key'] }) {
  return (
    <nav aria-label={PCOPY.settings.nav} className="mb-6 flex gap-5 overflow-x-auto border-b border-border">
      {PAGES.map((p) => (
        <Link
          key={p.key}
          href={p.href}
          aria-current={p.key === active ? 'page' : undefined}
          className={cn(
            '-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-0.5 pb-2 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
            p.key === active ? 'border-foreground text-foreground' : 'border-transparent text-axiom-zinc-600 hover:text-foreground',
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
