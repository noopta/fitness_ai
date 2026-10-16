// Links between the programs pages: the programs list and the exercise library.

import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { PRG } from '../copyPrograms';

const PAGES = [
  { key: 'programs', label: PRG.list.title, href: '/personal-training/programs' },
  { key: 'library', label: PRG.library.title, href: '/personal-training/library' },
] as const;

export function ProgramsNav({ active }: { active: (typeof PAGES)[number]['key'] }) {
  return (
    <nav aria-label={PRG.list.title} className="mb-6 flex gap-5 overflow-x-auto border-b border-border">
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
