import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLocation } from 'wouter';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  DollarSign, TrendingUp, Users, ExternalLink, Copy, Loader2, CheckCircle2, Clock,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Commission {
  id: string;
  commissionCents: number;
  originalAmountCents: number;
  status: string;
  createdAt: string;
}

interface Payout {
  id: string;
  totalCents: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  stripeTransferId: string | null;
  createdAt: string;
}

interface Dashboard {
  id: string;
  name: string;
  email: string;
  referralCode: string;
  referralLink: string;
  active: boolean;
  onboarded: boolean;
  pendingCents: number;
  paidCents: number;
  activeSubscriptions: number;
  commissionRate: number;
  discountRate: number;
  recentCommissions: Commission[];
  payouts: Payout[];
}

function cad(cents: number) {
  return `CA$${(cents / 100).toFixed(2)}`;
}

function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${API}${path}`, { credentials: 'include', ...opts });
}

export default function AffiliatePage() {
  const [location] = useLocation();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  // Handle ?onboarding=complete callback from Stripe Connect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const affiliateId = localStorage.getItem('affiliateId');

    if (params.get('onboarding') === 'complete' && affiliateId) {
      apiFetch('/affiliate/onboarding-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateId }),
      }).then(async res => {
        const d = await res.json();
        if (d.onboarded) toast.success('Stripe Connect onboarding complete! Your account is now active.');
        else toast.info('Onboarding received — your account is being reviewed.');
      }).catch(() => {});
    }

    // Auto-load if email saved in localStorage
    const savedEmail = localStorage.getItem('affiliateEmail');
    if (savedEmail) {
      setEmail(savedEmail);
      loadDashboard(savedEmail);
    }
  }, []);

  async function loadDashboard(e: string) {
    setLoading(true);
    try {
      const res = await apiFetch(`/affiliate/me?email=${encodeURIComponent(e)}`);
      if (res.status === 404) {
        toast.error('No affiliate account found for this email.');
        return;
      }
      const data = await res.json();
      setDashboard(data);
      localStorage.setItem('affiliateEmail', e);
      if (data.id) localStorage.setItem('affiliateId', data.id);
    } catch {
      toast.error('Failed to load affiliate data');
    } finally {
      setLoading(false);
    }
  }

  async function handleOnboarding() {
    if (!dashboard) return;
    setOnboardingLoading(true);
    try {
      const res = await apiFetch('/affiliate/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateId: dashboard.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      window.location.href = d.url;
    } catch (err: any) {
      toast.error(err.message || 'Failed to start onboarding');
    } finally {
      setOnboardingLoading(false);
    }
  }

  async function handleStripeDashboard() {
    if (!dashboard) return;
    setDashboardLoading(true);
    try {
      const res = await apiFetch(`/affiliate/dashboard-url?affiliateId=${dashboard.id}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      window.open(d.url, '_blank');
    } catch (err: any) {
      toast.error(err.message || 'Failed to open Stripe dashboard');
    } finally {
      setDashboardLoading(false);
    }
  }

  function copyReferralLink() {
    if (!dashboard) return;
    navigator.clipboard.writeText(dashboard.referralLink);
    toast.success('Referral link copied to clipboard');
  }

  // Email gate
  if (!dashboard) {
    return (
      <div className="page">
        <Navbar variant="full" />
        <main className="container-tight py-20 max-w-md mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-8 space-y-6 text-center">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Affiliate Portal</h1>
                <p className="text-sm text-muted-foreground mt-2">Enter your affiliate email address to view your dashboard.</p>
              </div>
              <div className="space-y-3">
                <input
                  className="w-full border rounded-md px-4 py-2.5 text-sm bg-background"
                  placeholder="your@email.com"
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { setEmail(emailInput); loadDashboard(emailInput); } }}
                />
                <Button className="w-full" disabled={loading || !emailInput.trim()} onClick={() => { setEmail(emailInput); loadDashboard(emailInput); }}>
                  {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                  View My Dashboard
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Don't have an affiliate account? Contact us at <strong>hello@axiomtraining.io</strong> to apply.
              </p>
            </Card>
          </motion.div>
        </main>
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
            <h1 className="text-2xl font-semibold tracking-tight">Welcome, {dashboard.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {dashboard.active ? 'Your affiliate account is active.' : 'Your account is pending activation.'}
              {' '}You earn <strong>{Math.round(dashboard.commissionRate * 100)}%</strong> commission on every subscription your referrals pay.
            </p>
          </div>
          {dashboard.onboarded && (
            <Button variant="outline" size="sm" onClick={handleStripeDashboard} disabled={dashboardLoading}>
              {dashboardLoading ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <ExternalLink size={14} className="mr-1.5" />}
              Stripe Dashboard
            </Button>
          )}
        </motion.div>

        {/* Stripe Connect Banner */}
        {!dashboard.onboarded && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
            <Card className="p-5 border-yellow-500/30 bg-yellow-500/5">
              <div className="flex items-start gap-3">
                <Clock size={18} className="text-yellow-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Set up your Stripe account to receive payouts</p>
                  <p className="text-xs text-muted-foreground mt-1">We pay out via Stripe Connect on the 1st of each month. Complete the 5-minute setup to get your first payout.</p>
                  <Button size="sm" className="mt-3" onClick={handleOnboarding} disabled={onboardingLoading}>
                    {onboardingLoading ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <ExternalLink size={13} className="mr-1.5" />}
                    Complete Stripe Setup
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: 'Pending Earnings', value: cad(dashboard.pendingCents), icon: TrendingUp, highlight: true },
            { label: 'Total Paid Out', value: cad(dashboard.paidCents), icon: DollarSign },
            { label: 'Active Referrals', value: dashboard.activeSubscriptions, icon: Users },
          ].map(({ label, value, icon: Icon, highlight }) => (
            <Card key={label} className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Icon size={14} />
                <span className="text-xs">{label}</span>
              </div>
              <div className={`text-xl font-bold ${highlight ? 'text-green-600' : ''}`}>{value}</div>
            </Card>
          ))}
        </motion.div>

        {/* Referral Link */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-3">Your Referral Link</h2>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-muted rounded-md px-3 py-2 text-sm font-mono truncate">
                {dashboard.referralLink}
              </div>
              <Button size="sm" variant="outline" onClick={copyReferralLink}>
                <Copy size={13} className="mr-1.5" /> Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Share this link with your audience. Users who sign up get <strong>{Math.round(dashboard.discountRate * 100)}% off</strong> their first payment.
            </p>
          </Card>
        </motion.div>

        {/* Commission History */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-4">Recent Commissions</h2>
            {dashboard.recentCommissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No commissions yet. Share your referral link to get started.</p>
            ) : (
              <div className="space-y-0 divide-y divide-border">
                {dashboard.recentCommissions.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      {c.status === 'paid'
                        ? <CheckCircle2 size={14} className="text-green-600" />
                        : <Clock size={14} className="text-yellow-500" />
                      }
                      <span className="text-muted-foreground text-xs">{new Date(c.createdAt).toLocaleDateString()}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        c.status === 'paid' ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600'
                      }`}>{c.status}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{cad(c.commissionCents)}</div>
                      <div className="text-xs text-muted-foreground">on {cad(c.originalAmountCents)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        {/* Payout History */}
        {dashboard.payouts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
            <Card className="p-5">
              <h2 className="text-sm font-semibold mb-4">Payout History</h2>
              <div className="space-y-0 divide-y divide-border">
                {dashboard.payouts.map(p => (
                  <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${p.status === 'completed' ? 'bg-green-500' : p.status === 'failed' ? 'bg-red-500' : 'bg-yellow-400'}`} />
                      <span className="text-muted-foreground text-xs">
                        {new Date(p.periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      </span>
                      <span className={`text-xs font-medium capitalize ${p.status === 'completed' ? 'text-green-600' : 'text-muted-foreground'}`}>{p.status}</span>
                    </div>
                    <div className="font-semibold">{cad(p.totalCents)}</div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}

        {/* How it works */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-3">How it works</h2>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Share your referral link. Anyone who clicks it and subscribes is tracked to you.</li>
              <li>You earn <strong>{Math.round(dashboard.commissionRate * 100)}%</strong> of each monthly payment — every month they stay subscribed.</li>
              <li>On the 1st of each month, your pending earnings are transferred to your Stripe account.</li>
              <li>Your referrals get <strong>{Math.round(dashboard.discountRate * 100)}% off</strong> their subscription — forever.</li>
            </ol>
          </Card>
        </motion.div>

      </main>
    </div>
  );
}
