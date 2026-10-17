import { useEffect, useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CoachMarkdown } from '@/components/CoachMarkdown';
import { affiliateFetch } from '@/lib/affiliateToken';
import { fetchAffiliateResourceText } from '@/lib/affiliateResourceText';
import { BookOpen, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

// ─── Types (mirror backend/src/services/affiliateExtras.ts) ───────────────────

export interface PaymentStructure {
  title: string;
  currency: string;
  streams: { key: string; name: string; whatYouEarn: string; howLong: string }[];
  bonusesIntro: string;
  bonuses: { key: string; name: string; description: string }[];
  paymentRules: string[];
  trainerPlans: string;
  personalTermsNote: string;
}

export interface PersonalTerms {
  commissionRate: number;
  trainerCommissionRate: number | null;
  campaignRate: number | null;
  perVideoFeeCents: number | null;
  agreementNote: string | null;
  agreementUpdatedAt: string | null;
}

export interface TrainerReferral {
  id: string;
  trainerName: string;
  organization: string | null;
  plan: string | null;
  status: string;
  startedAt: string | null;
  note: string | null;
  createdAt: string | null;
}

export interface AutoSignup {
  id: string;
  name: string;
  emailDomain: string | null;
  createdAt: string | null;
  invitedAt: string | null;
}

export interface ManualPayout {
  id: string;
  kind: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  paidAt: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string | null;
}

export const PAYMENT_STRUCTURE_SLUG = 'payment-structure';

export function cad(cents: number) {
  return `CA$${(cents / 100).toFixed(2)}`;
}

export function pct(rate: number | null | undefined) {
  if (rate === null || rate === undefined) return null;
  return `${Math.round(rate * 1000) / 10}%`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const TRAINER_STATUS_LABELS: Record<string, string> = {
  lead: 'Lead', contacted: 'Contacted', signed_up: 'Signed up', onboarded: 'Onboarded', active: 'Active', lost: 'Lost',
};
const TRAINER_STATUS_STYLES: Record<string, string> = {
  lead: 'bg-muted text-muted-foreground',
  contacted: 'bg-blue-500/10 text-blue-600',
  signed_up: 'bg-indigo-500/10 text-indigo-600',
  onboarded: 'bg-yellow-500/10 text-yellow-600',
  active: 'bg-green-500/10 text-green-600',
  lost: 'bg-red-500/10 text-red-600',
};
export const PLAN_LABELS: Record<string, string> = { free: 'Free', coach: 'Coach', pro: 'Pro', unknown: 'Unknown' };
export const PAYOUT_KIND_LABELS: Record<string, string> = {
  ugc: 'UGC', trainer_bonus: 'Trainer bonus', campaign: 'Campaign', discretionary: 'Discretionary', other: 'Other',
};

function Badge({ children, className }: { children: ReactNode; className: string }) {
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${className}`}>{children}</span>;
}

function useAffiliateJson<T>(path: string, token: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    setData(null);
    try {
      const res = await affiliateFetch(path, token);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Failed to load');
      setData(d as T);
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    }
  }

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, path]);

  return { data, error, reload: load };
}

function LoadState({ error, label, onRetry }: { error: string; label: string; onRetry: () => void }) {
  return error ? (
    <div className="flex items-center justify-between gap-3 text-sm" role="alert">
      <span className="text-destructive">{error}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  ) : (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 size={14} className="animate-spin" /> Loading {label}…
    </div>
  );
}

// ─── Your terms ───────────────────────────────────────────────────────────────

export function AffiliateTerms({ token }: { token: string }) {
  const { data, error, reload } = useAffiliateJson<{ terms: PersonalTerms; structure: PaymentStructure }>('/affiliate/terms', token);
  const [doc, setDoc] = useState<string | null>(null);
  const [docBusy, setDocBusy] = useState(false);

  async function toggleDoc() {
    if (doc !== null) { setDoc(null); return; }
    setDocBusy(true);
    try {
      setDoc(await fetchAffiliateResourceText(PAYMENT_STRUCTURE_SLUG, token));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to open document');
    } finally {
      setDocBusy(false);
    }
  }

  return (
    <Card className="p-5" data-testid="affiliate-terms">
      <h2 className="text-sm font-semibold mb-1">Your terms</h2>
      <p className="text-xs text-muted-foreground mb-4">Your personal rates, and how every commission stream works.</p>
      {!data ? <LoadState error={error} label="your terms" onRetry={reload} /> : (() => {
        const { terms, structure } = data;
        const rows: { label: string; value: string; hint: string }[] = [
          { label: 'Consumer Pro', value: pct(terms.commissionRate) ?? '—', hint: 'of every Pro payment, lifetime of the subscription' },
          { label: 'Trainer plans', value: pct(terms.trainerCommissionRate) ?? 'Set in your agreement', hint: 'of every paid trainer invoice, 12 months per trainer' },
          { label: 'Campaign / creative', value: pct(terms.campaignRate) ?? 'Set in your agreement', hint: 'of the plan price, once, on the first paid invoice' },
          { label: 'UGC per video', value: terms.perVideoFeeCents !== null ? cad(terms.perVideoFeeCents) : 'Set in your agreement', hint: 'per accepted video' },
        ];
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rows.map(r => (
                <div key={r.label} className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">{r.label}</div>
                  <div className="text-lg font-bold mt-0.5">{r.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.hint}</div>
                </div>
              ))}
            </div>

            {terms.agreementNote && (
              <div className="rounded-lg border border-border bg-muted/30 p-3" data-testid="agreement-note">
                <div className="text-xs font-medium mb-1">Agreement note</div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{terms.agreementNote}</p>
                {terms.agreementUpdatedAt && <p className="text-xs text-muted-foreground mt-1.5">Updated {formatDate(terms.agreementUpdatedAt)}</p>}
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">How you get paid</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-xs">
                    <tr><th className="px-3 py-2 font-semibold">Stream</th><th className="px-3 py-2 font-semibold">What you earn</th><th className="px-3 py-2 font-semibold">How long</th></tr>
                  </thead>
                  <tbody>
                    {structure.streams.map(s => (
                      <tr key={s.key} className="border-t border-border/50">
                        <td className="px-3 py-2 font-medium">{s.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{s.whatYouEarn}</td>
                        <td className="px-3 py-2 text-muted-foreground">{s.howLong}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{structure.trainerPlans}</p>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Bonuses</h3>
              <p className="text-xs text-muted-foreground mb-2">{structure.bonusesIntro}</p>
              <ul className="space-y-1 text-sm">
                {structure.bonuses.map(b => <li key={b.key}><strong>{b.name}</strong> <span className="text-muted-foreground">— {b.description}</span></li>)}
              </ul>
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
              {structure.paymentRules.map(r => <li key={r}>{r}</li>)}
            </ul>

            <div>
              <Button size="sm" variant="outline" onClick={toggleDoc} disabled={docBusy}>
                {docBusy ? <Loader2 size={13} className="animate-spin mr-1.5" /> : doc !== null ? <X size={13} className="mr-1.5" /> : <BookOpen size={13} className="mr-1.5" />}
                {doc !== null ? 'Close payment structure' : 'Read the full payment structure'}
              </Button>
              {doc !== null && (
                <div data-testid="terms-payment-doc" className="mt-3 rounded-md border border-border bg-muted/30 p-4 max-h-[32rem] overflow-y-auto">
                  <CoachMarkdown content={doc} />
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </Card>
  );
}

// ─── Trainer referrals ────────────────────────────────────────────────────────

export function AffiliateTrainerReferrals({ token }: { token: string }) {
  const { data, error, reload } = useAffiliateJson<{ referrals: TrainerReferral[]; autoSignups: AutoSignup[] }>('/affiliate/trainer-referrals', token);

  return (
    <Card className="p-5" data-testid="affiliate-trainer-referrals">
      <h2 className="text-sm font-semibold mb-1">Trainer referrals</h2>
      <p className="text-xs text-muted-foreground mb-4">Trainers you brought to Axiom. Paid trainer plans earn your trainer rate for 12 months per trainer.</p>
      {!data ? <LoadState error={error} label="trainer referrals" onRetry={reload} /> : (
        <div className="space-y-5">
          {data.referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Trainers you bring will appear here — tell the Axiom team who you referred.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-xs">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Trainer</th>
                    <th className="px-3 py-2 font-semibold">Organization</th>
                    <th className="px-3 py-2 font-semibold">Plan</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Started</th>
                    <th className="px-3 py-2 font-semibold">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.referrals.map(r => (
                    <tr key={r.id} className="border-t border-border/50 align-top">
                      <td className="px-3 py-2 font-medium">{r.trainerName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.organization || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.plan ? PLAN_LABELS[r.plan] ?? r.plan : '—'}</td>
                      <td className="px-3 py-2">
                        <Badge className={TRAINER_STATUS_STYLES[r.status] ?? 'bg-muted text-muted-foreground'}>{TRAINER_STATUS_LABELS[r.status] ?? r.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(r.startedAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.note || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Coach sign-ups from your link</h3>
            {data.autoSignups.length === 0 ? (
              <p className="text-xs text-muted-foreground">No coach sign-ups through your link yet. Share your link on the coaches page (add <code className="font-mono">?ref=YOURCODE</code>).</p>
            ) : (
              <div className="divide-y divide-border" data-testid="auto-signups">
                {data.autoSignups.map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{s.name}</span>
                      {s.emailDomain && <span className="text-xs text-muted-foreground ml-2">{s.emailDomain}</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                      <span>Signed up {formatDate(s.createdAt)}</span>
                      {s.invitedAt && <Badge className="bg-green-500/10 text-green-600">Invited</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── UGC & other payouts ──────────────────────────────────────────────────────

export function AffiliateManualPayouts({ token }: { token: string }) {
  const { data, error, reload } = useAffiliateJson<{ payouts: ManualPayout[]; totals: { paidCents: number; pendingCents: number } }>('/affiliate/manual-payouts', token);

  return (
    <Card className="p-5" data-testid="affiliate-manual-payouts">
      <h2 className="text-sm font-semibold mb-1">UGC &amp; other payouts</h2>
      <p className="text-xs text-muted-foreground mb-4">Content fees, bonuses and campaign commissions recorded by the Axiom team.</p>
      {!data ? <LoadState error={error} label="payouts" onRetry={reload} /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Paid</div>
              <div className="text-lg font-bold" data-testid="manual-paid-total">{cad(data.totals.paidCents)}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Pending</div>
              <div className="text-lg font-bold text-yellow-600" data-testid="manual-pending-total">{cad(data.totals.pendingCents)}</div>
            </div>
          </div>
          {data.payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payouts outside Stripe yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-xs">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Kind</th>
                    <th className="px-3 py-2 font-semibold">Description</th>
                    <th className="px-3 py-2 font-semibold text-right">Amount (CAD)</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payouts.map(p => (
                    <tr key={p.id} className="border-t border-border/50 align-top">
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(p.paidAt ?? p.createdAt)}</td>
                      <td className="px-3 py-2"><Badge className="bg-muted text-muted-foreground">{PAYOUT_KIND_LABELS[p.kind] ?? p.kind}</Badge></td>
                      <td className="px-3 py-2">
                        {p.description}
                        {p.note && <div className="text-xs text-muted-foreground mt-0.5">{p.note}</div>}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{cad(p.amountCents)}</td>
                      <td className="px-3 py-2">
                        <Badge className={p.status === 'paid' ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600'}>{p.status === 'paid' ? 'Paid' : 'Pending'}</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.reference || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Paid outside Stripe by the Axiom team. These amounts are separate from your Stripe commission payouts.</p>
        </div>
      )}
    </Card>
  );
}
