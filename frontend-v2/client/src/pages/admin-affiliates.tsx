import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Users, DollarSign, TrendingUp, Plus, ExternalLink, Trash2,
  Copy, ChevronDown, ChevronUp, Loader2, RefreshCw, Link as LinkIcon,
} from 'lucide-react';
import { useLocation } from 'wouter';

const API = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Affiliate {
  id: string;
  name: string;
  email: string;
  promoCodeId: string | null;
  stripeAccountId: string | null;
  onboarded: boolean;
  createdAt: string;
  activeSubscriptions: number;
  totalPayoutCents: number;
  pendingPayouts: number;
  payoutCount: number;
}

interface Summary {
  totalAffiliates: number;
  totalPayoutCents: number;
  activeSubscriptions: number;
  affiliateCutCents: number;
}

interface Payout {
  id: string;
  stripeTransferId: string | null;
  amountCents: number;
  createdAt: string;
  sourceEventId: string;
}

function cad(cents: number) {
  return `CA$${(cents / 100).toFixed(2)}`;
}

function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${API}${path}`, { credentials: 'include', ...opts });
}

export default function AdminAffiliatesPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<Record<string, Payout[]>>({});
  const [payoutsLoading, setPayoutsLoading] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPromo, setCreatePromo] = useState('');
  const [creating, setCreating] = useState(false);

  // Action loading states
  const [onboarding, setOnboarding] = useState<string | null>(null);
  const [dashboarding, setDashboarding] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    // Redirect non-admins
    if (user && user.tier !== 'enterprise' && !(user as any).isAdmin) {
      // We'll let the API 403 handle it, just load
    }
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [sumRes, affRes] = await Promise.all([
        apiFetch('/affiliates/stats/summary'),
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

  async function handleCreate() {
    if (!createName.trim() || !createEmail.trim()) {
      toast.error('Name and email are required');
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch('/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          email: createEmail.trim(),
          promoCodeId: createPromo.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to create');
      }
      toast.success('Affiliate created');
      setShowCreate(false);
      setCreateName(''); setCreateEmail(''); setCreatePromo('');
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
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

  async function handleDashboard(id: string) {
    setDashboarding(id);
    try {
      const res = await apiFetch(`/affiliates/${id}/dashboard`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      window.open(d.url, '_blank');
    } catch (err: any) {
      toast.error(err.message || 'Failed to open dashboard');
    } finally {
      setDashboarding(null);
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
        const data = await res.json();
        setPayouts(p => ({ ...p, [id]: data }));
      } catch {
        toast.error('Failed to load payouts');
      } finally {
        setPayoutsLoading(null);
      }
    }
  }

  function copyPromoLink(promoCodeId: string) {
    const url = `https://buy.stripe.com/28E9AU15CaIJgYQ5zD0Ba00?prefilled_promo_code=${promoCodeId}`;
    navigator.clipboard.writeText(url);
    toast.success('Checkout link copied to clipboard');
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
            <p className="text-sm text-muted-foreground mt-1">Manage affiliates, track payouts, and generate onboarding links.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw size={14} className="mr-1.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreate(s => !s)}>
              <Plus size={14} className="mr-1.5" /> Add Affiliate
            </Button>
          </div>
        </motion.div>

        {/* Summary Cards */}
        {summary && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Affiliates', value: summary.totalAffiliates, icon: Users },
              { label: 'Active Subscriptions', value: summary.activeSubscriptions, icon: TrendingUp },
              { label: 'Total Paid Out', value: cad(summary.totalPayoutCents), icon: DollarSign },
              { label: 'Cut Per Sub/mo', value: cad(summary.affiliateCutCents), icon: DollarSign },
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

        {/* Create Form */}
        {showCreate && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold">New Affiliate</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Full Name *</label>
                  <input
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                    placeholder="Alice Smith"
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Email *</label>
                  <input
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                    placeholder="alice@example.com"
                    value={createEmail}
                    onChange={e => setCreateEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Stripe Promo Code ID (optional)</label>
                  <input
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono"
                    placeholder="promo_xxx"
                    value={createPromo}
                    onChange={e => setCreatePromo(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Create the Promotion Code in your Stripe Dashboard first, then paste the <code className="font-mono">promo_xxx</code> ID here.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreate} disabled={creating}>
                  {creating ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
                  Create
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Affiliates Table */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          {affiliates.length === 0 ? (
            <Card className="p-10 text-center text-muted-foreground text-sm">
              No affiliates yet. Click "Add Affiliate" to get started.
            </Card>
          ) : (
            <div className="space-y-3">
              {affiliates.map(a => (
                <Card key={a.id} className="overflow-hidden">
                  {/* Row */}
                  <div className="p-4 flex items-center gap-4 flex-wrap">
                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{a.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          a.onboarded
                            ? 'bg-green-500/15 text-green-600'
                            : a.stripeAccountId
                            ? 'bg-yellow-500/15 text-yellow-600'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {a.onboarded ? 'Onboarded' : a.stripeAccountId ? 'Pending onboarding' : 'Not started'}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{a.email}</div>
                    </div>

                    {/* Stats */}
                    <div className="hidden sm:flex items-center gap-6 text-center">
                      <div>
                        <div className="text-sm font-bold">{a.activeSubscriptions}</div>
                        <div className="text-xs text-muted-foreground">Subs</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold">{cad(a.totalPayoutCents)}</div>
                        <div className="text-xs text-muted-foreground">Paid out</div>
                      </div>
                      {a.pendingPayouts > 0 && (
                        <div>
                          <div className="text-sm font-bold text-yellow-600">{a.pendingPayouts}</div>
                          <div className="text-xs text-muted-foreground">Pending</div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.promoCodeId && (
                        <Button size="sm" variant="outline" onClick={() => copyPromoLink(a.promoCodeId!)} title="Copy checkout link with promo code">
                          <LinkIcon size={13} className="mr-1.5" /> Copy link
                        </Button>
                      )}
                      {!a.onboarded && (
                        <Button size="sm" variant="outline" onClick={() => handleOnboard(a.id)} disabled={onboarding === a.id}>
                          {onboarding === a.id ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <ExternalLink size={13} className="mr-1.5" />}
                          {a.stripeAccountId ? 'Re-send link' : 'Onboard'}
                        </Button>
                      )}
                      {a.onboarded && (
                        <Button size="sm" variant="outline" onClick={() => handleDashboard(a.id)} disabled={dashboarding === a.id}>
                          {dashboarding === a.id ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <ExternalLink size={13} className="mr-1.5" />}
                          Dashboard
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => toggleExpand(a.id)}>
                        {expandedId === a.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDelete(a.id, a.name)} disabled={deleting === a.id}>
                        {deleting === a.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded: payout history */}
                  {expandedId === a.id && (
                    <div className="border-t px-4 py-3 bg-muted/40">
                      <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Payout History</div>

                      {/* Promo code info */}
                      {a.promoCodeId && (
                        <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                          <Copy size={11} />
                          Promo code ID: <code className="font-mono">{a.promoCodeId}</code>
                          <button className="underline" onClick={() => { navigator.clipboard.writeText(a.promoCodeId!); toast.success('Copied'); }}>copy</button>
                        </div>
                      )}

                      {payoutsLoading === a.id ? (
                        <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
                      ) : !payouts[a.id] || payouts[a.id].length === 0 ? (
                        <p className="text-xs text-muted-foreground">No payouts yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {payouts[a.id].map(p => (
                            <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                              <div className="flex items-center gap-3">
                                <span className={`w-2 h-2 rounded-full ${p.stripeTransferId ? 'bg-green-500' : 'bg-yellow-400'}`} />
                                <span className="text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>
                                {p.stripeTransferId
                                  ? <code className="font-mono text-muted-foreground">{p.stripeTransferId}</code>
                                  : <span className="text-yellow-600 font-medium">Pending (not onboarded at time)</span>
                                }
                              </div>
                              <span className="font-semibold">{cad(p.amountCents)}</span>
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

        {/* Setup Guide */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-3">Setup Checklist</h2>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Enable Stripe Connect in your Dashboard → Connect → Get Started (Platform model, Express accounts)</li>
              <li>Create a base coupon (e.g. 20% off), then create one <strong>Promotion Code</strong> per affiliate on top of it</li>
              <li>Copy the <code className="font-mono text-xs">promo_xxx</code> ID from Stripe and paste it when creating an affiliate here</li>
              <li>Click <strong>Onboard</strong> to generate a Stripe Express onboarding link — send it to the affiliate</li>
              <li>Once onboarded, add <code className="font-mono text-xs">invoice.payment_succeeded</code> to your Stripe webhook events if not already added</li>
              <li>Share the affiliate's checkout link (use "Copy link" button) — payouts fire automatically on each purchase and renewal</li>
            </ol>
          </Card>
        </motion.div>

      </main>
    </div>
  );
}
