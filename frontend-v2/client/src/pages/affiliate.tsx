import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLocation } from 'wouter';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { AffiliateResources } from '@/components/AffiliateResources';
import { AffiliateTerms, AffiliateTrainerReferrals, AffiliateManualPayouts } from '@/components/AffiliateExtras';
import {
  affiliateFetch, consumeAffiliateTokenFromUrl, clearAffiliateToken,
} from '@/lib/affiliateToken';
import {
  LogOut, DollarSign, TrendingUp, Users, ExternalLink, Copy, Loader2, CheckCircle2, Clock, Wallet,
} from 'lucide-react';

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
  /** Payouts recorded by the Axiom team outside Stripe (UGC, bonuses). */
  manualPayoutTotals?: { paidCents: number; pendingCents: number };
  recentCommissions: Commission[];
  payouts: Payout[];
}

function cad(cents: number) {
  return `CA$${(cents / 100).toFixed(2)}`;
}


export default function AffiliatePage() {
  const [location] = useLocation();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  // The invite token is the affiliate's credential — from the URL (?token=,
  // their personal link) or saved by a prior visit. Email is NOT an
  // identifier: it's public knowledge and must never unlock earnings data.
  const [token, setToken] = useState('');
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  // Handle ?onboarding=complete callback from Stripe Connect + auto-load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Reads ?token= then strips it from the address bar (replaceState).
    const t = consumeAffiliateTokenFromUrl();
    setToken(t);

    if (params.get('onboarding') === 'complete' && t) {
      affiliateFetch('/affiliate/onboarding-complete', t, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      }).then(async res => {
        const d = await res.json();
        if (d.onboarded) toast.success('Stripe Connect onboarding complete! Your account is now active.');
        else toast.info('Onboarding received — your account is being reviewed.');
      }).catch(() => {});
    }

    if (t) loadDashboard(t);
  }, []);

  async function loadDashboard(t: string) {
    setLoading(true);
    try {
      const res = await affiliateFetch('/affiliate/me', t);
      if (res.status === 401 || res.status === 404) {
        clearAffiliateToken();
        setToken('');
        toast.error('This affiliate link is no longer valid — contact hello@axiomtraining.io.');
        return;
      }
      const data = await res.json();
      setDashboard(data);
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
      const res = await affiliateFetch('/affiliate/onboard', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
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
      const res = await affiliateFetch('/affiliate/dashboard-url', token);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      window.open(d.url, '_blank');
    } catch (err: any) {
      toast.error(err.message || 'Failed to open Stripe dashboard');
    } finally {
      setDashboardLoading(false);
    }
  }

  function handleSignOut() {
    clearAffiliateToken();
    setToken('');
    setDashboard(null);
    toast.success('Signed out of the affiliate portal.');
  }

  function copyReferralCode() {
    if (!dashboard) return;
    navigator.clipboard.writeText(dashboard.referralCode);
    toast.success(`Code ${dashboard.referralCode} copied`);
  }

  // Access gate — the dashboard only opens from the affiliate's personal
  // tokened link. No email lookup: an email address is not a credential.
  if (!dashboard) {
    return (
      <div className="page">
        <Navbar variant="full" />
        <main className="container-tight py-20 max-w-md mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-8 space-y-6 text-center">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Affiliate Portal</h1>
                <p className="text-sm text-muted-foreground mt-2">
                  {loading
                    ? 'Loading your dashboard…'
                    : 'Open your personal affiliate link to view your dashboard — it\'s the same link you used to set up your account.'}
                </p>
              </div>
              {loading ? <Loader2 size={20} className="animate-spin mx-auto text-muted-foreground" /> : null}
              <p className="text-xs text-muted-foreground">
                Lost your dashboard link, or want to join the program? Contact us at <strong>hello@axiomtraining.io</strong>.
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
          <div className="flex items-center gap-2">
            {dashboard.onboarded && (
              <Button variant="outline" size="sm" onClick={handleStripeDashboard} disabled={dashboardLoading}>
                {dashboardLoading ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <ExternalLink size={14} className="mr-1.5" />}
                Stripe Dashboard
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut size={14} className="mr-1.5" />
              Sign out
            </Button>
          </div>
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
          className={`grid grid-cols-2 gap-4 ${dashboard.manualPayoutTotals ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
          {[
            { label: 'Pending Earnings', value: cad(dashboard.pendingCents), icon: TrendingUp, highlight: true },
            { label: 'Total Paid Out', value: cad(dashboard.paidCents), icon: DollarSign },
            { label: 'Active Referrals', value: dashboard.activeSubscriptions, icon: Users },
            ...(dashboard.manualPayoutTotals
              ? [{ label: 'Paid outside Stripe', value: cad(dashboard.manualPayoutTotals.paidCents), icon: Wallet, highlight: false }]
              : []),
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

        {/* Your code: people enter it at App Store or Stripe checkout */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <Card className="p-5" data-testid="affiliate-code-card">
            <h2 className="text-sm font-semibold mb-3">Your code</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="rounded-lg bg-muted px-4 py-2.5 font-mono text-3xl font-bold tracking-wider select-all" data-testid="affiliate-code">
                {dashboard.referralCode}
              </div>
              <Button size="sm" onClick={copyReferralCode}>
                <Copy size={13} className="mr-1.5" /> Copy code
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              Tell people to enter this code when they subscribe, at Apple (App Store) checkout in the app or Stripe checkout on axiomtraining.io. They get the referral offer and the subscription is credited to you.
            </p>
          </Card>
        </motion.div>

        {/* Resources */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.09 }}>
          <AffiliateResources token={token} />
        </motion.div>

        {/* Your terms */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.095 }}>
          <AffiliateTerms token={token} />
        </motion.div>

        {/* Trainer referrals */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <AffiliateTrainerReferrals token={token} />
        </motion.div>

        {/* UGC & other payouts */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <AffiliateManualPayouts token={token} />
        </motion.div>

        {/* Commission History */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-4">Recent Commissions</h2>
            {dashboard.recentCommissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No commissions yet. Share your code to get started.</p>
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
              <li>Give people your code, <strong>{dashboard.referralCode}</strong>. They enter it when they subscribe: at Apple (App Store) checkout in the app, or at Stripe checkout on axiomtraining.io.</li>
              <li>The code gives them <strong>{Math.round(dashboard.discountRate * 100)}% off Pro for life</strong> plus a 30-day trial, and credits the subscription to you.</li>
              <li>You earn <strong>{Math.round(dashboard.commissionRate * 100)}%</strong> of each payment — every month they stay subscribed.</li>
              <li>On the 1st of each month, your pending earnings are transferred to your Stripe account.</li>
            </ol>
          </Card>
        </motion.div>

      </main>
    </div>
  );
}
