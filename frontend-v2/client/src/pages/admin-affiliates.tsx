import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Users, DollarSign, TrendingUp, Plus, ExternalLink, Trash2,
  Copy, ChevronDown, ChevronUp, Loader2, RefreshCw, Link as LinkIcon,
  Play,
} from 'lucide-react';
import { useLocation } from 'wouter';

const API = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Affiliate {
  id: string;
  name: string;
  email: string;
  referralCode: string;
  stripeAccountId: string | null;
  onboarded: boolean;
  active: boolean;
  commissionRate: number;
  discountRate: number;
  createdAt: string;
  pendingCents: number;
  paidCents: number;
  totalCommissions: number;
  payoutCount: number;
}

interface Summary {
  activeAffiliates: number;
  pendingCents: number;
  paidCents: number;
}

interface Payout {
  id: string;
  stripeTransferId: string | null;
  totalCents: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

function cad(cents: number) {
  return `CA$${(cents / 100).toFixed(2)}`;
}

function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${API}${path}`, { credentials: 'include', ...opts });
}

export default function AdminAffiliatesPage() {
  const [, navigate] = useLocation();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<Record<string, Payout[]>>({});
  const [payoutsLoading, setPayoutsLoading] = useState<string | null>(null);
  const [runningPayouts, setRunningPayouts] = useState(false);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviting, setInviting] = useState(false);
  const [setupLink, setSetupLink] = useState<string | null>(null);

  // Action loading states
  const [onboarding, setOnboarding] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [sumRes, affRes] = await Promise.all([
        apiFetch('/affiliates/summary'),
        apiFetch('/affiliates'),
      ]);
      if (sumRes.status === 403 || affRes.status === 403) {
        toast.error('Admin access required');
        navigate('/coach');
        return;
      }
      setSummary(await sumRes.json());
      setAffiliates(await affRes.json());
    } catch {
      toast.error('Failed to load affiliate data');
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite() {
    if (!inviteName.trim() || !inviteEmail.trim() || !inviteCode.trim()) {
      toast.error('Name, email, and referral code are required');
      return;
    }
    setInviting(true);
    setSetupLink(null);
    try {
      const res = await apiFetch('/affiliates/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim(), referralCode: inviteCode.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to create');
      toast.success('Affiliate created — setup link generated');
      setSetupLink(d.setupLink);
      setInviteName(''); setInviteEmail(''); setInviteCode('');
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setInviting(false);
    }
  }

  async function handleOnboard(id: string) {
    setOnboarding(id);
    try {
      const res = await apiFetch(`/affiliates/${id}/onboard`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      window.open(d.url, '_blank');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate onboarding link');
    } finally {
      setOnboarding(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove affiliate "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const res = await apiFetch(`/affiliates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Affiliate removed');
      setAffiliates(a => a.filter(x => x.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleting(null);
    }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!payouts[id]) {
      setPayoutsLoading(id);
      try {
        const res = await apiFetch(`/affiliates/${id}/payouts`);
        setPayouts(p => ({ ...p, [id]: await res.json() }));
      } catch {
        toast.error('Failed to load payouts');
      } finally {
        setPayoutsLoading(null);
      }
    }
  }

  async function handleRunPayouts() {
    if (!confirm('Run monthly payouts now? This will transfer pending commissions to all onboarded affiliates via Stripe.')) return;
    setRunningPayouts(true);
    try {
      const res = await apiFetch('/affiliates/payouts/run', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(`Paid ${d.affiliatesPaid} affiliate(s) — ${cad(d.totalCents)} total`);
      if (d.errors?.length) toast.error(`${d.errors.length} error(s): ${d.errors[0]}`);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Payout run failed');
    } finally {
      setRunningPayouts(false);
    }
  }

  function copyReferralLink(referralCode: string) {
    const url = `https://axiomtraining.io?ref=${referralCode}`;
    navigator.clipboard.writeText(url);
    toast.success('Referral link copied');
  }

  if (loading) {
    return (
      <div className="page">
        <Navbar variant="full" />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Navbar variant="full" />
      <main className="container-tight py-10 space-y-8">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Affiliate Program</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage affiliates, track commissions, and run monthly payouts.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw size={14} className="mr-1.5" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleRunPayouts} disabled={runningPayouts}>
              {runningPayouts ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Play size={14} className="mr-1.5" />}
              Run Payouts
            </Button>
            <Button size="sm" onClick={() => { setShowInvite(s => !s); setSetupLink(null); }}>
              <Plus size={14} className="mr-1.5" /> Invite Affiliate
            </Button>
          </div>
        </motion.div>

        {/* Summary Cards */}
        {summary && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="grid grid-cols-3 gap-4">
            {[
              { label: 'Active Affiliates', value: summary.activeAffiliates, icon: Users },
              { label: 'Pending Commissions', value: cad(summary.pendingCents), icon: TrendingUp },
              { label: 'Total Paid Out', value: cad(summary.paidCents), icon: DollarSign },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label} className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Icon size={14} />
                  <span className="text-xs">{label}</span>
                </div>
                <div className="text-xl font-bold">{value}</div>
              </Card>
            ))}
          </motion.div>
        )}

        {/* Invite Form */}
        {showInvite && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold">Invite Affiliate</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Full Name *</label>
                  <input className="w-full border rounded-md px-3 py-2 text-sm bg-background" placeholder="Alice Smith"
                    value={inviteName} onChange={e => setInviteName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Email *</label>
                  <input className="w-full border rounded-md px-3 py-2 text-sm bg-background" placeholder="alice@example.com"
                    value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Referral Code * (e.g. ALICE20)</label>
                  <input className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono uppercase"
                    placeholder="ALICE20" value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The referral code is what users enter at checkout (e.g. <code className="font-mono">?ref=ALICE20</code>). It must be unique.
              </p>
              {setupLink && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <LinkIcon size={14} className="text-green-600 shrink-0" />
                  <span className="text-xs text-green-700 font-medium truncate flex-1">{setupLink}</span>
                  <button className="text-xs underline text-green-600 shrink-0" onClick={() => { navigator.clipboard.writeText(setupLink); toast.success('Copied'); }}>Copy</button>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleInvite} disabled={inviting}>
                  {inviting ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
                  {inviting ? 'Creating…' : 'Create & Get Setup Link'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowInvite(false); setSetupLink(null); }}>Cancel</Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Affiliates List */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          {affiliates.length === 0 ? (
            <Card className="p-10 text-center text-muted-foreground text-sm">
              No affiliates yet. Click "Invite Affiliate" to get started.
            </Card>
          ) : (
            <div className="space-y-3">
              {affiliates.map(a => (
                <Card key={a.id} className="overflow-hidden">
                  <div className="p-4 flex items-center gap-4 flex-wrap">
                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{a.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          a.onboarded && a.active ? 'bg-green-500/15 text-green-600'
                            : a.stripeAccountId ? 'bg-yellow-500/15 text-yellow-600'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {a.onboarded && a.active ? 'Active' : a.stripeAccountId ? 'Onboarding…' : 'Invited'}
                        </span>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{a.referralCode}</code>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{a.email} · {Math.round(a.commissionRate * 100)}% commission · {Math.round(a.discountRate * 100)}% user discount</div>
                    </div>

                    {/* Stats */}
                    <div className="hidden sm:flex items-center gap-6 text-center">
                      <div>
                        <div className="text-sm font-bold">{a.totalCommissions}</div>
                        <div className="text-xs text-muted-foreground">Commissions</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-yellow-600">{cad(a.pendingCents)}</div>
                        <div className="text-xs text-muted-foreground">Pending</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold">{cad(a.paidCents)}</div>
                        <div className="text-xs text-muted-foreground">Paid out</div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => copyReferralLink(a.referralCode)} title="Copy referral link">
                        <LinkIcon size={13} className="mr-1.5" /> Copy link
                      </Button>
                      {!a.onboarded && (
                        <Button size="sm" variant="outline" onClick={() => handleOnboard(a.id)} disabled={onboarding === a.id}>
                          {onboarding === a.id ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <ExternalLink size={13} className="mr-1.5" />}
                          {a.stripeAccountId ? 'Re-onboard' : 'Onboard'}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => toggleExpand(a.id)}>
                        {expandedId === a.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(a.id, a.name)} disabled={deleting === a.id}>
                        {deleting === a.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded: payout history */}
                  {expandedId === a.id && (
                    <div className="border-t px-4 py-3 bg-muted/40">
                      <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Payout History</div>
                      <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                        <Copy size={11} />
                        Referral link: <code className="font-mono">?ref={a.referralCode}</code>
                        <button className="underline" onClick={() => copyReferralLink(a.referralCode)}>copy</button>
                      </div>

                      {payoutsLoading === a.id ? (
                        <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
                      ) : !payouts[a.id] || payouts[a.id].length === 0 ? (
                        <p className="text-xs text-muted-foreground">No payouts yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {payouts[a.id].map(p => (
                            <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                              <div className="flex items-center gap-3">
                                <span className={`w-2 h-2 rounded-full ${p.status === 'completed' ? 'bg-green-500' : p.status === 'failed' ? 'bg-red-500' : 'bg-yellow-400'}`} />
                                <span className="text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>
                                {p.stripeTransferId
                                  ? <code className="font-mono text-muted-foreground">{p.stripeTransferId}</code>
                                  : <span className="text-yellow-600 font-medium capitalize">{p.status}</span>
                                }
                              </div>
                              <span className="font-semibold">{cad(p.totalCents)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </motion.div>

      </main>
    </div>
  );
}
