// The header bell (design handoff §6.7): what needs the trainer now, how much
// is being held for the briefing, and how much was recorded quietly. The red
// dot appears only for unread immediate items.

import { Link } from 'wouter';
import { Bell } from 'lucide-react';
import { COPY, relativeDay } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useMarkNotificationsRead, useNotifications } from '../hooks';
import { Eyebrow } from './primitives';

export function NotificationBell({ className }: { className?: string }) {
  const feed = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = feed.data?.unread ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread ? `${COPY.notifications.bell}, ${unread} unread` : COPY.notifications.bell}
          className={cn('relative grid size-11 place-items-center rounded-xl text-axiom-zinc-600 transition-colors duration-200 hover:bg-axiom-zinc-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 md:size-9', className)}
        >
          <Bell className="size-[18px]" aria-hidden />
          {unread > 0 && <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-axiom-destructive ring-2 ring-background md:right-1.5 md:top-1.5" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(380px,calc(100vw-16px))] rounded-2xl p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <Eyebrow>{COPY.notifications.needsYou}</Eyebrow>
          {unread > 0 && (
            <Button type="button" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-axiom-zinc-600" onClick={() => markRead.mutate(undefined)}>
              {COPY.notifications.markAllRead}
            </Button>
          )}
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {(feed.data?.immediate ?? []).length === 0 && <li className="px-4 py-6 text-center text-sm text-axiom-zinc-500">{COPY.notifications.nothing}</li>}
          {feed.data?.immediate.map((n) => (
            <li key={n.id} className="border-b border-border last:border-b-0">
              <Link
                href={n.clientId ? `/personal-training/clients/${n.clientId}/timeline` : '/personal-training'}
                onClick={() => { if (!n.read) markRead.mutate([n.id]); }}
                className="flex gap-3 px-4 py-3 transition-colors duration-200 hover:bg-axiom-zinc-50"
              >
                <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-axiom-destructive')} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{n.title}{n.read ? '' : <span className="sr-only"> (unread)</span>}</span>
                  {n.body && <span className="line-clamp-2 block text-xs text-axiom-zinc-600">{n.body}</span>}
                  <span className="block text-xs text-axiom-zinc-500">{relativeDay(n.at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-axiom-zinc-600">
          <p>{COPY.notifications.held(feed.data?.heldForBriefing ?? 0)}</p>
          <p>{COPY.notifications.quiet(feed.data?.recordedQuietly ?? 0)}</p>
          <Link href="/personal-training/settings/notifications" className="inline-block pt-1 font-semibold text-foreground underline-offset-2 hover:underline">
            {COPY.notifications.settings}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
