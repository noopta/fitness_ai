import { useEffect, useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { affiliateFetch } from '@/lib/affiliateToken';
import { Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

// People an affiliate referred before they had a code. Mirrors
// backend/src/services/affiliateSelfReports.ts (affiliate view: no review
// fields beyond the status).

export interface SelfReferral {
  id: string;
  name: string;
  email: string | null;
  note: string | null;
  approxSignupDate: string | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export const SELF_REFERRAL_STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted', matched: 'Matched', approved: 'Approved', rejected: 'Not approved',
};
const STATUS_STYLES: Record<string, string> = {
  submitted: 'bg-muted text-muted-foreground',
  matched: 'bg-blue-500/10 text-blue-600',
  approved: 'bg-green-500/10 text-green-600',
  rejected: 'bg-red-500/10 text-red-600',
};

const input = 'w-full border rounded-md px-2.5 py-1.5 text-sm bg-background';
const labelCls = 'text-xs text-muted-foreground mb-1 block';

/** Today in the viewer's local timezone, YYYY-MM-DD. */
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateOnly(iso: string | null) {
  return iso ? iso.slice(0, 10) : '';
}
function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

async function send(path: string, token: string, method: string, body?: unknown) {
  const res = await affiliateFetch(path, token, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error === 'not_enabled' ? 'This section is not enabled for your account.' : d.error || `Request failed (${res.status})`);
  return d;
}

type FormState = { name: string; email: string; approxSignupDate: string; note: string };
const EMPTY: FormState = { name: '', email: '', approxSignupDate: '', note: '' };

function toBody(f: FormState) {
  return {
    name: f.name.trim(),
    email: f.email.trim() || null,
    approxSignupDate: f.approxSignupDate || null,
    note: f.note.trim() || null,
  };
}

function validate(f: FormState): string | null {
  if (!f.name.trim()) return 'Name is required';
  if (f.approxSignupDate && f.approxSignupDate > todayIso()) return 'The sign-up date can’t be in the future';
  return null;
}

function Fields({ f, setF, prefix }: { f: FormState; setF: (f: FormState) => void; prefix: string }) {
  return (
    <>
      <div><label className={labelCls}>Name *</label><input className={input} maxLength={120} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} aria-label={`${prefix}name`} /></div>
      <div><label className={labelCls}>Email (optional)</label><input type="email" className={input} maxLength={254} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} aria-label={`${prefix}email`} /></div>
      <div><label className={labelCls}>Approx. sign-up date (optional)</label><input type="date" className={input} max={todayIso()} value={f.approxSignupDate} onChange={e => setF({ ...f, approxSignupDate: e.target.value })} aria-label={`${prefix}sign-up date`} /></div>
      <div><label className={labelCls}>Note (optional)</label><input className={input} maxLength={1000} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} aria-label={`${prefix}note`} /></div>
    </>
  );
}

function EditRow({ row, token, onDone }: { row: SelfReferral; token: string; onDone: (saved: boolean) => void }) {
  const [f, setF] = useState<FormState>({ name: row.name, email: row.email ?? '', approxSignupDate: dateOnly(row.approxSignupDate), note: row.note ?? '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    const err = validate(f);
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      await send(`/affiliate/self-referrals/${encodeURIComponent(row.id)}`, token, 'PUT', toBody(f));
      toast.success('Entry updated');
      onDone(true);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-border/50" data-testid={`self-referral-edit-${row.id}`}>
      <td colSpan={6} className="px-3 py-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Fields f={f} setF={setF} prefix="Edit " />
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Save size={13} className="mr-1.5" />} Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDone(false)}><X size={13} className="mr-1.5" /> Cancel</Button>
        </div>
      </td>
    </tr>
  );
}

export function AffiliateSelfReferrals({ token }: { token: string }) {
  const [rows, setRows] = useState<SelfReferral[] | null>(null);
  const [error, setError] = useState('');
  const [f, setF] = useState<FormState>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError('');
    try {
      const d = await send('/affiliate/self-referrals', token, 'GET');
      setRows(Array.isArray(d.referrals) ? d.referrals : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    }
  }
  useEffect(() => { if (token) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const err = validate(f);
    if (err) { toast.error(err); return; }
    setAdding(true);
    try {
      await send('/affiliate/self-referrals', token, 'POST', toBody(f));
      toast.success('Saved. The Axiom team will review it.');
      setF(EMPTY);
      await load();
    } catch (e2: any) {
      toast.error(e2?.message || 'Failed to save');
    } finally {
      setAdding(false);
    }
  }

  async function remove(row: SelfReferral) {
    if (!window.confirm(`Delete ${row.name}?`)) return;
    setBusy(row.id);
    try {
      await send(`/affiliate/self-referrals/${encodeURIComponent(row.id)}`, token, 'DELETE');
      toast.success('Entry deleted');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5" data-testid="affiliate-self-referrals">
      <h2 className="text-sm font-semibold mb-1">People you referred before you had a code</h2>
      <p className="text-xs text-muted-foreground mb-4">
        The Axiom team reviews these and confirms them. Only you and the Axiom team can see this list.
      </p>

      <form onSubmit={add} className="rounded-lg border border-border p-3 mb-4" data-testid="self-referral-add-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Fields f={f} setF={setF} prefix="" />
        </div>
        <Button type="submit" size="sm" className="mt-3" disabled={adding}>
          {adding ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Plus size={13} className="mr-1.5" />} Add person
        </Button>
      </form>

      {rows === null ? (
        error ? (
          <div className="flex items-center justify-between gap-3 text-sm" role="alert">
            <span className="text-destructive">{error}</span>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading your entries…</div>
        )
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one logged yet. Add the people you brought in before you had your code.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Signed up</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Note</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => editing === r.id ? (
                <EditRow key={r.id} row={r} token={token} onDone={saved => { setEditing(null); if (saved) load(); }} />
              ) : (
                <tr key={r.id} className="border-t border-border/50" data-testid={`self-referral-${r.id}`}>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.email ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(r.approxSignupDate)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_STYLES[r.status] ?? 'bg-muted text-muted-foreground'}`}>
                      {SELF_REFERRAL_STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.note ?? ''}</td>
                  <td className="px-3 py-2">
                    {r.status === 'submitted' && (
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(r.id)} aria-label={`Edit ${r.name}`}><Pencil size={13} /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy === r.id} onClick={() => remove(r)} aria-label={`Delete ${r.name}`}>
                          {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
