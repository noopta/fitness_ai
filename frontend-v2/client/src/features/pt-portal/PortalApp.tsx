// The no-install client portal at /c/:token. The secret link in the URL is
// the client's only key: no Axiom account, no session cookie. One page, with
// the screen chosen by query parameters (?tab=, ?checkin=, ?report=) so the
// links in the trainer's emails and DMs open the right thing directly.

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CreditCard, Dumbbell, Home, ImageIcon, LinkIcon, MessageCircle, MoreHorizontal, NotebookPen } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { PortalHome } from '@axiom/personal-training-core';
import { cn } from '@/lib/utils';
import { createPortalClient, isInactiveLinkError, type FullPortalApi } from './api';
import { LoadFailed, PracticeMark, SkeletonBlock } from './components';
import { accentVars } from './helpers';
import { PortalApiContext, useHome, usePortalNav, type PortalTab } from './hooks';
import { BillingScreen } from './screens/BillingScreen';
import { BookScreen } from './screens/BookScreen';
import { CheckInScreen } from './screens/CheckInScreen';
import { HomeScreen } from './screens/HomeScreen';
import { IntakeScreen } from './screens/IntakeScreen';
import { LogScreen } from './screens/LogScreen';
import { MessagesScreen } from './screens/MessagesScreen';
import { PhotosScreen } from './screens/PhotosScreen';
import { ProgramScreen } from './screens/ProgramScreen';
import { ReportScreen } from './screens/ReportScreen';

type Dest = { id: PortalTab; label: string; icon: typeof Home };

/** The bar holds four destinations and More; the rest live in the More sheet. */
const BAR: Dest[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'book', label: 'Book', icon: CalendarDays },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'log', label: 'Log', icon: NotebookPen },
];
const MORE: Dest[] = [
  { id: 'program', label: 'Program', icon: Dumbbell },
  { id: 'photos', label: 'Photos', icon: ImageIcon },
  { id: 'billing', label: 'Pay', icon: CreditCard },
];

/** Keep search engines away from a page whose URL is a credential. */
function useNoIndex() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
}

function Column({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={cn('mx-auto w-full max-w-[560px] px-4', className)} style={style}>{children}</div>;
}

export function InactiveLink() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-axiom-zinc-50 px-4">
      <div role="alert" className="w-full max-w-[420px] rounded-2xl border border-border bg-background p-8 text-center shadow-xs">
        <span aria-hidden className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-axiom-zinc-100 text-axiom-zinc-600"><LinkIcon className="size-5" /></span>
        <h1 className="text-[19px] font-semibold tracking-[-0.01em]">This link is no longer active.</h1>
        <p className="mt-2 text-sm text-axiom-zinc-600">Ask your trainer for a new one.</p>
      </div>
    </main>
  );
}

function LoadingShell() {
  return (
    <main aria-busy="true" aria-label="Loading" className="min-h-screen bg-axiom-zinc-50">
      <Column className="pt-5">
        <div className="mb-8 flex items-center gap-3"><SkeletonBlock className="size-10 rounded-xl" /><div className="space-y-1.5"><SkeletonBlock className="h-4 w-36" /><SkeletonBlock className="h-3 w-24" /></div></div>
        <SkeletonBlock className="mb-2 h-8 w-40" />
        <SkeletonBlock className="mb-6 h-4 w-56" />
        <SkeletonBlock className="mb-3 h-20 w-full rounded-2xl" />
        <SkeletonBlock className="h-20 w-full rounded-2xl" />
      </Column>
    </main>
  );
}

const barItem = (selected: boolean) => cn(
  'relative flex min-h-[3.5rem] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors',
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-ring/20',
  selected ? 'text-foreground' : 'text-axiom-zinc-500 hover:text-foreground',
);

function Indicator({ on }: { on: boolean }) {
  return <span aria-hidden className={cn('absolute inset-x-4 top-0 h-[3px] rounded-b-full', on ? 'bg-[var(--portal-accent)]' : 'bg-transparent')} />;
}

/**
 * Bottom navigation: links with aria-current rather than tabs, since each
 * destination is its own screen with its own URL. More opens a sheet.
 */
function TabBar({ active, unread, onSelect, style }: { active: PortalTab | null; unread: number; onSelect: (t: PortalTab) => void; style?: React.CSSProperties }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = MORE.some((m) => m.id === active);
  return (
    <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-[560px]">
        {BAR.map(({ id, label, icon: Icon }) => {
          const selected = active === id;
          return (
            <li key={id} className="flex flex-1">
              <button type="button" aria-current={selected ? 'page' : undefined} onClick={() => onSelect(id)} className={barItem(selected)}>
                <Indicator on={selected} />
                <span className="relative">
                  <Icon aria-hidden className="size-5" />
                  {id === 'messages' && unread > 0 && (
                    <span aria-hidden className="absolute -right-2.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--portal-accent)] px-1 text-[10px] font-bold leading-4 text-[var(--portal-on-accent)]">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </span>
                <span>{label}{id === 'messages' && unread > 0 && <span className="sr-only">, {unread} unread</span>}</span>
              </button>
            </li>
          );
        })}
        <li className="flex flex-1">
          <button type="button" aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={inMore ? 'page' : undefined} onClick={() => setMoreOpen(true)} className={barItem(inMore)}>
            <Indicator on={inMore} />
            <MoreHorizontal aria-hidden className="size-5" />
            <span>More</span>
          </button>
        </li>
      </ul>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-[560px] rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]" style={style}>
          <SheetHeader className="mb-2 text-left">
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">Other sections of your page</SheetDescription>
          </SheetHeader>
          <ul className="space-y-1">
            {MORE.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={active === id ? 'page' : undefined}
                  onClick={() => { setMoreOpen(false); onSelect(id); }}
                  className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20', active === id ? 'bg-axiom-zinc-100' : 'hover:bg-axiom-zinc-50')}
                >
                  <Icon aria-hidden className="size-5 text-axiom-zinc-600" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

function Portal({ home }: { home: PortalHome }) {
  const { tab, checkIn, report, go } = usePortalNav();
  const { branding } = home;

  useEffect(() => {
    const prev = document.title;
    document.title = `${branding.practiceName} · Axiom`;
    return () => { document.title = prev; };
  }, [branding.practiceName]);

  const activeTab: PortalTab | null = checkIn || report || tab === 'intake' ? null : tab;
  // The sheet renders in a portal outside this root, so it gets the accent too.
  const accent = accentVars(branding.brandColor) as React.CSSProperties;
  const screenName = checkIn ? 'Check-in' : report ? 'Report' : tab === 'intake' ? 'Intake' : [...BAR, ...MORE].find((d) => d.id === tab)?.label ?? 'Home';
  const screen = checkIn ? <CheckInScreen key={checkIn} id={checkIn} />
    : report ? <ReportScreen key={report} id={report} trainerName={branding.trainerName} />
    : tab === 'log' ? <LogScreen weightUnit={home.client.unit} />
    : tab === 'photos' ? <PhotosScreen enabled={home.photosEnabled !== false} />
    : tab === 'intake' ? <IntakeScreen trainerName={branding.trainerName} />
    : tab === 'messages' ? <MessagesScreen trainerName={branding.trainerName} />
    : tab === 'program' ? <ProgramScreen />
    : tab === 'book' ? <BookScreen trainerName={branding.trainerName} />
    : tab === 'billing' ? <BillingScreen />
    : <HomeScreen home={home} />;

  return (
    <div className="min-h-screen bg-axiom-zinc-50 text-foreground" style={accent}>
      <header className="border-b border-border bg-background">
        <Column className="flex items-center gap-3 py-3">
          <PracticeMark branding={branding} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight">{branding.practiceName}</p>
            <p className="truncate text-xs text-axiom-zinc-600">with {branding.trainerName}</p>
          </div>
        </Column>
      </header>
      <main
        id="portal-panel"
        aria-label={screenName}
        className="overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5"
      >
        <Column>{screen}</Column>
      </main>
      <TabBar active={activeTab} unread={home.unreadMessages} onSelect={(t) => go({ tab: t })} style={accent} />
    </div>
  );
}

function PortalRoot() {
  const home = useHome();
  if (home.isPending) return <LoadingShell />;
  if (home.isError) {
    if (isInactiveLinkError(home.error)) return <InactiveLink />;
    return <main className="flex min-h-screen items-center bg-axiom-zinc-50"><Column><LoadFailed onRetry={() => home.refetch()} /></Column></main>;
  }
  return <Portal home={home.data} />;
}

/** Exported for tests, which hand in an API built on a mocked fetch. */
export function PortalWithApi({ api, inactive }: { api: FullPortalApi; inactive?: boolean }) {
  useNoIndex();
  if (inactive) return <InactiveLink />;
  return <PortalApiContext.Provider value={api}><PortalRoot /></PortalApiContext.Provider>;
}

export default function PortalApp() {
  const { token } = usePortalNav();
  const qc = useQueryClient();
  const [inactive, setInactive] = useState(false);
  const api = useMemo(() => createPortalClient(token, { onInactive: () => setInactive(true) }), [token]);

  // The cache keys are not per link: never let one link's data show under another.
  useEffect(() => {
    setInactive(false);
    return () => { qc.removeQueries({ queryKey: ['pt-portal'] }); };
  }, [qc, token]);

  if (!token) return <InactiveLink />;
  return <PortalWithApi key={token} api={api} inactive={inactive} />;
}
