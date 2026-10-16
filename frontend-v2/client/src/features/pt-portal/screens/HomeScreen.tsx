// The portal's landing page: what is waiting for the client today.

import { useState } from 'react';
import { ChevronRight, ClipboardCheck, FileText, MessageCircle, MessageSquareText, Smartphone, X } from 'lucide-react';
import type { ClientGoal, PortalHome } from '@axiom/personal-training-core';
import { Card, Eyebrow, PortalButton, ProgressBar } from '../components';
import { checkInMinutes, formatDay, formatMonth, formatValue } from '../helpers';
import { usePortalNav } from '../hooks';
import { NextSessionCard } from './BookScreen';

const TIP_KEY = 'axiom.ptPortal.homeTipDismissed';

function readTipDismissed(): boolean {
  try { return window.localStorage.getItem(TIP_KEY) === '1'; } catch { return false; }
}

function GoalRow({ goal }: { goal: ClientGoal }) {
  const unit = goal.unit ? ` ${goal.unit}` : '';
  const current = goal.current === null ? 'Nothing logged yet' : `${formatValue(goal.current)}${unit}`;
  const target = goal.target === null ? null : `${formatValue(goal.target)}${unit}`;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold">{goal.label}</p>
        {goal.status === 'achieved' && <span className="shrink-0 text-xs font-semibold text-axiom-success-ink">Achieved</span>}
      </div>
      {goal.progress !== null && <div className="mt-2"><ProgressBar value={goal.progress} label={`${goal.label} progress`} /></div>}
      <p className="mt-1.5 text-xs text-axiom-zinc-600 tabular-nums">
        Now {current}{target && <> · Target {target}</>}
        {goal.daysLeft != null && goal.daysLeft >= 0 && <> · {goal.daysLeft} {goal.daysLeft === 1 ? 'day' : 'days'} left</>}
      </p>
    </li>
  );
}

export function HomeScreen({ home }: { home: PortalHome }) {
  const { go } = usePortalNav();
  const [tipHidden, setTipHidden] = useState(readTipDismissed);
  const dismissTip = () => {
    setTipHidden(true);
    try { window.localStorage.setItem(TIP_KEY, '1'); } catch { /* private mode: hidden for this visit only */ }
  };
  const goals = home.goals.filter((g) => g.status !== 'dropped');
  const trainerFirst = home.branding.trainerName.split(/\s+/)[0] || home.branding.trainerName;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">Hi {home.client.firstName}</h1>
        <p className="mt-1 text-sm text-axiom-zinc-600">
          {home.checkIns.length > 0 ? `${trainerFirst} is waiting to hear how you're doing.` : "You're all caught up."}
        </p>
      </div>

      <NextSessionCard />

      {home.checkIns.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => go({ checkin: c.id })}
          className="flex w-full items-center gap-3 rounded-2xl bg-[var(--portal-accent)] p-4 text-left text-[var(--portal-on-accent)] shadow-xs transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
        >
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-white/15"><ClipboardCheck className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Your check-in is ready</span>
            <span className="block text-sm opacity-80">
              {checkInMinutes(c.questionCount)} {checkInMinutes(c.questionCount) === 1 ? 'minute' : 'minutes'} · sent {formatDay(c.dueAt)}
            </span>
          </span>
          <ChevronRight aria-hidden className="size-5 shrink-0 opacity-80" />
        </button>
      ))}

      {(home.intake === null || home.intake.status !== 'complete') && (
        <button
          type="button"
          onClick={() => go({ tab: 'intake' })}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-background p-4 text-left shadow-xs hover:bg-axiom-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
        >
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-axiom-zinc-100"><MessageSquareText className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Tell {trainerFirst} about you</span>
            <span className="block text-sm text-axiom-zinc-600">{home.intake?.completeness ?? 0}% done</span>
            <span className="mt-2 block"><ProgressBar value={home.intake?.completeness ?? 0} label="Intake progress" /></span>
          </span>
          <ChevronRight aria-hidden className="size-5 shrink-0 text-axiom-zinc-400" />
        </button>
      )}

      <button
        type="button"
        onClick={() => go({ tab: 'messages' })}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-background p-4 text-left shadow-xs hover:bg-axiom-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
      >
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-axiom-zinc-100"><MessageCircle className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Message {trainerFirst}</span>
          <span className="block text-sm text-axiom-zinc-600">
            {home.unreadMessages > 0 ? `${home.unreadMessages} new ${home.unreadMessages === 1 ? 'message' : 'messages'}` : 'Questions, updates, how it went'}
          </span>
        </span>
        {home.unreadMessages > 0 && (
          <span className="grid min-w-6 place-items-center rounded-full bg-[var(--portal-accent)] px-2 py-0.5 text-xs font-bold text-[var(--portal-on-accent)] tabular-nums" aria-hidden>
            {home.unreadMessages}
          </span>
        )}
        <ChevronRight aria-hidden className="size-5 shrink-0 text-axiom-zinc-400" />
      </button>

      {goals.length > 0 && (
        <Card aria-labelledby="goals-h">
          <Eyebrow className="mb-3"><span id="goals-h">Your goals</span></Eyebrow>
          <ul className="divide-y divide-border">{goals.map((g) => <GoalRow key={g.id} goal={g} />)}</ul>
        </Card>
      )}

      {home.reports.length > 0 && (
        <Card aria-labelledby="reports-h">
          <Eyebrow className="mb-2"><span id="reports-h">Monthly reports</span></Eyebrow>
          <ul className="-mx-2">
            {home.reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => go({ report: r.id })}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-axiom-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
                >
                  <FileText aria-hidden className="size-4 shrink-0 text-axiom-zinc-500" />
                  <span className="min-w-0 flex-1 text-sm font-medium">{formatMonth(r.month)}</span>
                  <span className="text-xs text-axiom-zinc-500">Sent {formatDay(r.sentAt)}</span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-axiom-zinc-400" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <PortalButton variant="secondary" onClick={() => go({ tab: 'log' })}>Log a weigh-in</PortalButton>
        <PortalButton variant="secondary" onClick={() => go({ tab: 'program' })}>{home.hasProgram ? 'See my program' : 'Program'}</PortalButton>
      </div>

      {!tipHidden && (
        <aside aria-label="Tip" className="flex items-start gap-3 rounded-2xl bg-axiom-zinc-100 p-4">
          <Smartphone aria-hidden className="mt-0.5 size-5 shrink-0 text-axiom-zinc-600" />
          <p className="min-w-0 flex-1 text-sm text-axiom-zinc-600">
            <span className="font-semibold text-foreground">Save this page to your home screen.</span>{' '}
            In your browser's share menu, choose "Add to Home Screen" to come back in one tap. No app needed.
          </p>
          <button type="button" onClick={dismissTip} aria-label="Dismiss tip" className="-m-2 grid size-11 shrink-0 place-items-center rounded-xl text-axiom-zinc-500 hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20">
            <X className="size-4" />
          </button>
        </aside>
      )}
    </div>
  );
}
