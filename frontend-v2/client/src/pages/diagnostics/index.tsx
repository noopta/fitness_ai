import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, ChevronRight, Dumbbell, MessageSquare } from 'lucide-react';
import { COPY, historyRow, homeHero, type DiagnosticListRow } from '@axiom/diagnostic-core';
import { Navbar } from '@/components/Navbar';
import { useAuth } from '@/context/AuthContext';
import { listDiagnostics } from '@/lib/diagnosticApi';
import { RichText } from '@/components/diagnostic/primitives';
import { DiagnosticPaywall } from '@/components/diagnostic/Paywall';

function rowHref(r: DiagnosticListRow): string {
  // Legacy wizard sessions keep their original pages, which read the session from localStorage.
  if (r.flow === 'wizard') return r.status === 'complete' ? '/plan' : '/diagnostic';
  return r.status === 'complete' ? `/diagnostics/${r.id}` : `/diagnostics/chat/${r.id}`;
}

function rememberLegacy(r: DiagnosticListRow) {
  if (r.flow !== 'wizard') return;
  localStorage.setItem('liftoff_session_id', r.id);
  localStorage.setItem('liftoff_selected_lift', String(r.lift));
}

/** Home (§3): greeting / dark hero / Diagnostics list / upgrade card (free only). */
export default function DiagnosticsHomePage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<DiagnosticListRow[] | null>(null);
  const [paywall, setPaywall] = useState(false);
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  useEffect(() => {
    listDiagnostics().then(setRows).catch(() => setRows([]));
  }, []);

  const hero = homeHero(rows ?? []);
  const heroHref = hero.kind === 'resume' ? `/diagnostics/chat/${hero.sessionId}` : '/diagnostics/chat';

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 pb-16 pt-8">
        <h1 className="text-[34px] font-bold leading-tight tracking-[-0.035em] text-zinc-950">
          {COPY.greeting(user?.name, new Date().getHours())}.
        </h1>

        <Link href={heroHref} className="flex min-h-[220px] flex-col justify-between gap-5 rounded-[20px] bg-zinc-950 p-6 text-white">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-white/[.12]">
            {hero.kind === 'resume' ? <MessageSquare size={20} /> : <Dumbbell size={20} />}
          </span>
          <span className="flex flex-col gap-2">
            <RichText text={hero.title} className="text-[28px] font-bold leading-[1.15] tracking-[-0.03em]" />
            <span className="text-sm leading-5 text-white/[.72]">{hero.body}</span>
            <span className="mt-1 inline-flex items-center gap-1.5 self-start rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950">
              {hero.cta}
              <ArrowRight size={16} />
            </span>
          </span>
        </Link>

        <section className="rounded-2xl border border-zinc-200 px-4 pb-1 pt-3.5" aria-label={COPY.diagnostics}>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{COPY.diagnostics}</div>
          {rows === null ? (
            <p className="py-3 text-sm text-zinc-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-3 text-sm text-zinc-500">{COPY.noDiagnostics}</p>
          ) : (
            rows.map((r, i) => {
              const row = historyRow(r);
              return (
                <Link
                  key={r.id}
                  href={rowHref(r)}
                  onClick={() => rememberLegacy(r)}
                  className={`flex items-center gap-2.5 py-3 ${i > 0 ? 'border-t border-zinc-100' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-zinc-950">{row.title}</span>
                    <span className="block truncate text-[13px] text-zinc-500">{row.subtitle}</span>
                  </span>
                  {row.confidence != null ? <span className="text-[13px] font-semibold text-zinc-600">{row.confidence}%</span> : null}
                  <ChevronRight size={16} className="text-zinc-400" aria-hidden />
                </Link>
              );
            })
          )}
        </section>

        {!isPro ? (
          <section className="flex flex-col gap-1.5 rounded-2xl border border-zinc-200 p-[18px]">
            <div className="text-[15px] font-semibold text-zinc-950">{COPY.upgradeTitle}</div>
            <p className="text-[13px] leading-[1.45] text-zinc-500">{COPY.upgradeBody}</p>
            <button
              type="button"
              onClick={() => setPaywall(true)}
              className="mt-1.5 self-start rounded-full bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white"
            >
              {COPY.startFreeMonth}
            </button>
          </section>
        ) : null}
      </main>
      <DiagnosticPaywall open={paywall} source="diagnostic_home" onClose={() => setPaywall(false)} />
    </div>
  );
}
