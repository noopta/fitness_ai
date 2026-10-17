import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { SELF_REFERRAL_STATUS_LABELS } from '@/components/AffiliateSelfReferrals';
import {
  cad, PAYOUT_KIND_LABELS, PLAN_LABELS, TRAINER_STATUS_LABELS,
  type PersonalTerms, type AutoSignup,
} from '@/components/AffiliateExtras';

const API = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

async function adminJson(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
  return d;
}

interface AdminTrainerReferral {
  id: string;
  trainerName: string;
  organization: string | null;
  contact: string | null;
  plan: string | null;
  status: string;
  coachBetaSignupId: string | null;
  startedAt: string | null;
  note: string | null;
}

interface AdminManualPayout {
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

interface Extras {
  terms: PersonalTerms;
  trainerReferrals: AdminTrainerReferral[];
  autoSignups: AutoSignup[];
  manualPayouts: AdminManualPayout[];
  manualPayoutTotals: { paidCents: number; pendingCents: number };
}

const input = 'w-full border rounded-md px-2.5 py-1.5 text-sm bg-background';
const label = 'text-xs text-muted-foreground mb-1 block';
const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/** Percent text ("20" or "12.5") → rate (0.2), '' → null. */
function toRate(s: string): number | null {
  if (!s.trim()) return null;
  return Math.round(Number(s) * 10) / 1000;
}
function fromRate(r: number | null) {
  return r === null || r === undefined ? '' : String(Math.round(r * 1000) / 10);
}
/** Dollars text → integer cents, '' → null. */
function toCents(s: string): number | null {
  if (!s.trim()) return null;
  return Math.round(Number(s) * 100);
}
function fromCents(c: number | null) {
  return c === null || c === undefined ? '' : (c / 100).toFixed(2);
}

// ─── Terms form ───────────────────────────────────────────────────────────────

function TermsForm({ affiliateId, terms, onSaved }: { affiliateId: string; terms: PersonalTerms; onSaved: () => void }) {
  const [f, setF] = useState({
    commission: fromRate(terms.commissionRate),
    trainer: fromRate(terms.trainerCommissionRate),
    campaign: fromRate(terms.campaignRate),
    video: fromCents(terms.perVideoFeeCents),
    note: terms.agreementNote ?? '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    const nums = [f.commission, f.trainer, f.campaign, f.video].filter(v => v.trim());
    if (nums.some(v => !Number.isFinite(Number(v)) || Number(v) < 0)) { toast.error('Rates and fees must be non-negative numbers'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        trainerCommissionRate: toRate(f.trainer),
        campaignRate: toRate(f.campaign),
        perVideoFeeCents: toCents(f.video),
        agreementNote: f.note,
      };
      if (f.commission.trim()) body.commissionRate = toRate(f.commission);
      await adminJson(`/affiliates/${affiliateId}/terms`, 'PUT', body);
      toast.success('Terms saved');
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className={label}>Consumer Pro %</label><input className={input} inputMode="decimal" value={f.commission} onChange={e => setF({ ...f, commission: e.target.value })} aria-label="Consumer Pro %" /></div>
        <div><label className={label}>Trainer %</label><input className={input} inputMode="decimal" placeholder="—" value={f.trainer} onChange={e => setF({ ...f, trainer: e.target.value })} aria-label="Trainer %" /></div>
        <div><label className={label}>Campaign %</label><input className={input} inputMode="decimal" placeholder="—" value={f.campaign} onChange={e => setF({ ...f, campaign: e.target.value })} aria-label="Campaign %" /></div>
        <div><label className={label}>Per-video fee (CA$)</label><input className={input} inputMode="decimal" placeholder="—" value={f.video} onChange={e => setF({ ...f, video: e.target.value })} aria-label="Per-video fee" /></div>
      </div>
      <div>
        <label className={label}>Agreement note (shown to the affiliate — bonus rungs, special terms)</label>
        <textarea className={`${input} min-h-[64px]`} maxLength={2000} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} aria-label="Agreement note" />
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Save size={13} className="mr-1.5" />} Save terms
        </Button>
        {terms.agreementUpdatedAt && <span className="text-xs text-muted-foreground">Last updated {dateOnly(terms.agreementUpdatedAt)}</span>}
      </div>
    </div>
  );
}

// ─── Trainer referral form ────────────────────────────────────────────────────

const EMPTY_REF = { trainerName: '', organization: '', contact: '', plan: '', status: 'lead', coachBetaSignupId: '', startedAt: '', note: '' };

function TrainerReferralForm({ affiliateId, initial, autoSignups, onDone }: {
  affiliateId: string; initial?: AdminTrainerReferral; autoSignups: AutoSignup[]; onDone: (saved: boolean) => void;
}) {
  const [f, setF] = useState(initial ? {
    trainerName: initial.trainerName, organization: initial.organization ?? '', contact: initial.contact ?? '',
    plan: initial.plan ?? '', status: initial.status, coachBetaSignupId: initial.coachBetaSignupId ?? '',
    startedAt: dateOnly(initial.startedAt), note: initial.note ?? '',
  } : EMPTY_REF);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!f.trainerName.trim()) { toast.error('Trainer name is required'); return; }
    setSaving(true);
    try {
      const body = { ...f, plan: f.plan || null, coachBetaSignupId: f.coachBetaSignupId || null, startedAt: f.startedAt || null };
      if (initial) await adminJson(`/affiliates/${affiliateId}/trainer-referrals/${initial.id}`, 'PUT', body);
      else await adminJson(`/affiliates/${affiliateId}/trainer-referrals`, 'POST', body);
      toast.success(initial ? 'Trainer referral updated' : 'Trainer referral added');
      onDone(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-3" data-testid="trainer-referral-form">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className={label}>Trainer name *</label><input className={input} maxLength={120} value={f.trainerName} onChange={e => setF({ ...f, trainerName: e.target.value })} aria-label="Trainer name" /></div>
        <div><label className={label}>Organization</label><input className={input} maxLength={160} value={f.organization} onChange={e => setF({ ...f, organization: e.target.value })} aria-label="Organization" /></div>
        <div><label className={label}>Contact (email or handle, admin only)</label><input className={input} maxLength={200} value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} aria-label="Contact" /></div>
        <div>
          <label className={label}>Plan</label>
          <select className={input} value={f.plan} onChange={e => setF({ ...f, plan: e.target.value })} aria-label="Plan">
            <option value="">—</option>
            {Object.entries(PLAN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Status</label>
          <select className={input} value={f.status} onChange={e => setF({ ...f, status: e.target.value })} aria-label="Status">
            {Object.entries(TRAINER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label className={label}>Started</label><input type="date" className={input} value={f.startedAt} onChange={e => setF({ ...f, startedAt: e.target.value })} aria-label="Started" /></div>
        <div className="sm:col-span-1">
          <label className={label}>Linked coach sign-up</label>
          <select className={input} value={f.coachBetaSignupId} onChange={e => setF({ ...f, coachBetaSignupId: e.target.value })} aria-label="Linked coach sign-up">
            <option value="">—</option>
            {autoSignups.map(s => <option key={s.id} value={s.id}>{s.name} {s.emailDomain ?? ''}</option>)}
            {f.coachBetaSignupId && !autoSignups.some(s => s.id === f.coachBetaSignupId) && <option value={f.coachBetaSignupId}>{f.coachBetaSignupId}</option>}
          </select>
        </div>
        <div className="sm:col-span-2"><label className={label}>Note (shown to the affiliate)</label><input className={input} maxLength={1000} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} aria-label="Note" /></div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Save size={13} className="mr-1.5" />} Save</Button>
        <Button size="sm" variant="outline" onClick={() => onDone(false)}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Manual payout form ───────────────────────────────────────────────────────

function ManualPayoutForm({ affiliateId, initial, onDone }: { affiliateId: string; initial?: AdminManualPayout; onDone: (saved: boolean) => void }) {
  const [f, setF] = useState(initial ? {
    kind: initial.kind, description: initial.description, amount: fromCents(initial.amountCents), status: initial.status,
    paidAt: dateOnly(initial.paidAt), reference: initial.reference ?? '', note: initial.note ?? '',
  } : { kind: 'ugc', description: '', amount: '', status: 'pending', paidAt: '', reference: '', note: '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    const cents = toCents(f.amount || '0');
    if (!f.description.trim()) { toast.error('Description is required'); return; }
    if (cents === null || !Number.isFinite(cents) || cents < 0) { toast.error('Amount must be a non-negative number'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        kind: f.kind, description: f.description, amountCents: cents, status: f.status,
        reference: f.reference, note: f.note,
      };
      // Blank paid date on a paid row → the server stamps today.
      if (f.paidAt) body.paidAt = f.paidAt;
      if (initial) await adminJson(`/affiliates/${affiliateId}/manual-payouts/${initial.id}`, 'PUT', body);
      else await adminJson(`/affiliates/${affiliateId}/manual-payouts`, 'POST', body);
      toast.success(initial ? 'Payout updated' : 'Payout recorded');
      onDone(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-3" data-testid="manual-payout-form">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={label}>Kind</label>
          <select className={input} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} aria-label="Kind">
            {Object.entries(PAYOUT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2"><label className={label}>Description * (shown to the affiliate)</label><input className={input} maxLength={300} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} aria-label="Description" /></div>
        <div><label className={label}>Amount (CA$)</label><input className={input} inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} aria-label="Amount" /></div>
        <div>
          <label className={label}>Status</label>
          <select className={input} value={f.status} onChange={e => setF({ ...f, status: e.target.value })} aria-label="Payout status">
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div><label className={label}>Paid on</label><input type="date" className={input} value={f.paidAt} onChange={e => setF({ ...f, paidAt: e.target.value })} aria-label="Paid on" /></div>
        <div><label className={label}>Reference (e-transfer #, invoice)</label><input className={input} maxLength={120} value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} aria-label="Reference" /></div>
        <div className="sm:col-span-2"><label className={label}>Note (shown to the affiliate)</label><input className={input} maxLength={1000} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} aria-label="Payout note" /></div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Save size={13} className="mr-1.5" />} Save</Button>
        <Button size="sm" variant="outline" onClick={() => onDone(false)}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Self-reported referrals (people referred before the affiliate had a code)

interface AdminSelfReferral {
  id: string;
  name: string;
  email: string | null;
  note: string | null;
  approxSignupDate: string | null;
  status: string;
  matchedUserId: string | null;
  adminNote: string | null;
  createdAt: string | null;
  suggestedMatch: { userId: string; name: string | null; tier: string | null; createdAt: string | null; referredByCode: string | null } | null;
}

function SelfReferralReviewRow({ affiliateId, row, onSaved }: { affiliateId: string; row: AdminSelfReferral; onSaved: () => void }) {
  const [status, setStatus] = useState(row.status);
  const [adminNote, setAdminNote] = useState(row.adminNote ?? '');
  const [matchedUserId, setMatchedUserId] = useState(row.matchedUserId ?? '');
  const [saving, setSaving] = useState(false);
  const m = row.suggestedMatch;

  async function save() {
    setSaving(true);
    try {
      await adminJson(`/affiliates/${affiliateId}/self-referrals/${row.id}`, 'PUT', {
        status, adminNote, matchedUserId: matchedUserId.trim() || null,
      });
      toast.success('Review saved');
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-border/50 align-top" data-testid={`admin-self-referral-${row.id}`}>
      <td className="px-2 py-2 font-medium">{row.name}</td>
      <td className="px-2 py-2 text-muted-foreground">{row.email ?? '—'}</td>
      <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{dateOnly(row.approxSignupDate) || '—'}</td>
      <td className="px-2 py-2 text-muted-foreground max-w-[200px]">{row.note ?? ''}</td>
      <td className="px-2 py-2">
        {m ? (
          <div className="space-y-1">
            <div>{m.name ?? 'User'} · {m.tier ?? '—'} · joined {dateOnly(m.createdAt) || '—'}</div>
            <div className="text-muted-foreground">code: {m.referredByCode ?? 'none'}</div>
            {matchedUserId !== m.userId && (
              <button type="button" className="underline text-xs" onClick={() => setMatchedUserId(m.userId)} aria-label={`Use suggested match for ${row.name}`}>Use this user</button>
            )}
          </div>
        ) : <span className="text-muted-foreground">No match</span>}
        <input className={`${input} mt-1`} placeholder="Matched user id" value={matchedUserId} onChange={e => setMatchedUserId(e.target.value)} aria-label={`Matched user id for ${row.name}`} />
      </td>
      <td className="px-2 py-2">
        <select className={input} value={status} onChange={e => setStatus(e.target.value)} aria-label={`Review status for ${row.name}`}>
          {Object.entries(SELF_REFERRAL_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
      <td className="px-2 py-2">
        <input className={input} maxLength={1000} placeholder="Admin only" value={adminNote} onChange={e => setAdminNote(e.target.value)} aria-label={`Admin note for ${row.name}`} />
      </td>
      <td className="px-2 py-2">
        <Button size="sm" onClick={save} disabled={saving} aria-label={`Save review for ${row.name}`}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        </Button>
      </td>
    </tr>
  );
}

function SelfReferralsReview({ affiliateId }: { affiliateId: string }) {
  const [data, setData] = useState<{ selfReportEnabled: boolean; referrals: AdminSelfReferral[] } | null>(null);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);

  async function load() {
    setError('');
    try {
      const d = await adminJson(`/affiliates/${affiliateId}/self-referrals`);
      setData({ selfReportEnabled: !!d.selfReportEnabled, referrals: Array.isArray(d.referrals) ? d.referrals : [] });
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [affiliateId]);

  async function toggle(enabled: boolean) {
    setToggling(true);
    try {
      await adminJson(`/affiliates/${affiliateId}/self-report`, 'PUT', { enabled });
      toast.success(enabled ? 'Past-referral logging enabled' : 'Past-referral logging disabled');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setToggling(false);
    }
  }

  if (error) return <div className="text-xs text-destructive" role="alert">{error} <button className="underline ml-2" onClick={load}>Retry</button></div>;
  if (!data) return <div className="flex justify-center py-2"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3" data-testid="admin-self-referrals">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={data.selfReportEnabled} disabled={toggling} onChange={e => toggle(e.target.checked)} aria-label="Allow this affiliate to log past referrals" />
        Allow this affiliate to log past referrals
      </label>
      <p className="text-xs text-muted-foreground">Approving records the decision only. It does not change a user's referral code or create commissions.</p>
      {data.referrals.length === 0 ? (
        <p className="text-xs text-muted-foreground">No past referrals logged.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-2 font-semibold">Name</th>
                <th className="px-2 py-2 font-semibold">Email</th>
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Note</th>
                <th className="px-2 py-2 font-semibold">Suggested match</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Admin note</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.referrals.map(r => (
                <SelfReferralReviewRow key={`${r.id}:${r.status}:${r.adminNote ?? ''}:${r.matchedUserId ?? ''}`} affiliateId={affiliateId} row={r} onSaved={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function AdminAffiliateExtras({ affiliateId }: { affiliateId: string }) {
  const [extras, setExtras] = useState<Extras | null>(null);
  const [error, setError] = useState('');
  const [editingRef, setEditingRef] = useState<string | null>(null); // id | 'new'
  const [editingPayout, setEditingPayout] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError('');
    try {
      setExtras(await adminJson(`/affiliates/${affiliateId}/extras`));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [affiliateId]);

  async function remove(kind: 'trainer-referrals' | 'manual-payouts', id: string, what: string) {
    if (!confirm(`Delete this ${what}?`)) return;
    setBusy(id);
    try {
      await adminJson(`/affiliates/${affiliateId}/${kind}/${id}`, 'DELETE');
      toast.success('Deleted');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function markPaid(id: string) {
    setBusy(id);
    try {
      await adminJson(`/affiliates/${affiliateId}/manual-payouts/${id}`, 'PUT', { status: 'paid' });
      toast.success('Marked paid');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="text-xs text-destructive" role="alert">{error} <button className="underline ml-2" onClick={load}>Retry</button></div>;
  if (!extras) return <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>;

  const sectionTitle = 'text-xs font-semibold text-muted-foreground uppercase tracking-wide';

  return (
    <div className="space-y-6" data-testid="admin-affiliate-extras">
      <section className="space-y-3">
        <div className={sectionTitle}>Terms</div>
        <TermsForm key={extras.terms.agreementUpdatedAt ?? 'none'} affiliateId={affiliateId} terms={extras.terms} onSaved={load} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className={sectionTitle}>Trainer referrals</div>
          {editingRef !== 'new' && <Button size="sm" variant="outline" onClick={() => setEditingRef('new')}><Plus size={13} className="mr-1.5" /> Add trainer</Button>}
        </div>
        {editingRef === 'new' && (
          <TrainerReferralForm affiliateId={affiliateId} autoSignups={extras.autoSignups} onDone={saved => { setEditingRef(null); if (saved) load(); }} />
        )}
        {extras.trainerReferrals.length === 0 && editingRef !== 'new' ? (
          <p className="text-xs text-muted-foreground">No trainer referrals recorded.</p>
        ) : (
          <div className="space-y-1">
            {extras.trainerReferrals.map(r => editingRef === r.id ? (
              <TrainerReferralForm key={r.id} affiliateId={affiliateId} initial={r} autoSignups={extras.autoSignups} onDone={saved => { setEditingRef(null); if (saved) load(); }} />
            ) : (
              <div key={r.id} className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-border/50 last:border-0">
                <div className="min-w-0">
                  <span className="font-semibold text-sm">{r.trainerName}</span>
                  {r.organization && <span className="text-muted-foreground"> · {r.organization}</span>}
                  <span className="text-muted-foreground"> · {r.plan ? PLAN_LABELS[r.plan] ?? r.plan : 'no plan'} · {TRAINER_STATUS_LABELS[r.status] ?? r.status}</span>
                  {r.startedAt && <span className="text-muted-foreground"> · since {dateOnly(r.startedAt)}</span>}
                  {r.contact && <span className="text-muted-foreground"> · {r.contact}</span>}
                  {r.note && <div className="text-muted-foreground">{r.note}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => setEditingRef(r.id)} aria-label={`Edit ${r.trainerName}`}><Pencil size={13} /></Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy === r.id} onClick={() => remove('trainer-referrals', r.id, 'trainer referral')} aria-label={`Delete ${r.trainerName}`}>
                    {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {extras.autoSignups.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {extras.autoSignups.length} coach sign-up{extras.autoSignups.length === 1 ? '' : 's'} from this affiliate's link: {extras.autoSignups.map(s => s.name).join(', ')}. Link one when adding a trainer.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className={sectionTitle}>Referred before they had a code</div>
        <SelfReferralsReview affiliateId={affiliateId} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className={sectionTitle}>
            Payouts outside Stripe · paid {cad(extras.manualPayoutTotals.paidCents)} · pending {cad(extras.manualPayoutTotals.pendingCents)}
          </div>
          {editingPayout !== 'new' && <Button size="sm" variant="outline" onClick={() => setEditingPayout('new')}><Plus size={13} className="mr-1.5" /> Add payout</Button>}
        </div>
        {editingPayout === 'new' && <ManualPayoutForm affiliateId={affiliateId} onDone={saved => { setEditingPayout(null); if (saved) load(); }} />}
        {extras.manualPayouts.length === 0 && editingPayout !== 'new' ? (
          <p className="text-xs text-muted-foreground">No manual payouts recorded.</p>
        ) : (
          <div className="space-y-1">
            {extras.manualPayouts.map(p => editingPayout === p.id ? (
              <ManualPayoutForm key={p.id} affiliateId={affiliateId} initial={p} onDone={saved => { setEditingPayout(null); if (saved) load(); }} />
            ) : (
              <div key={p.id} className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-border/50 last:border-0">
                <div className="min-w-0">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${p.status === 'paid' ? 'bg-green-500' : 'bg-yellow-400'}`} />
                  <span className="text-muted-foreground">{dateOnly(p.paidAt ?? p.createdAt)}</span>
                  <span className="ml-2 font-medium">{PAYOUT_KIND_LABELS[p.kind] ?? p.kind}</span>
                  <span className="ml-2">{p.description}</span>
                  {p.reference && <code className="ml-2 font-mono text-muted-foreground">{p.reference}</code>}
                  {p.note && <div className="text-muted-foreground">{p.note}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="font-semibold mr-2">{cad(p.amountCents)}</span>
                  {p.status !== 'paid' && (
                    <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => markPaid(p.id)}>
                      <CheckCircle2 size={13} className="mr-1" /> Mark paid
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditingPayout(p.id)} aria-label={`Edit payout ${p.description}`}><Pencil size={13} /></Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy === p.id} onClick={() => remove('manual-payouts', p.id, 'payout')} aria-label={`Delete payout ${p.description}`}>
                    {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
