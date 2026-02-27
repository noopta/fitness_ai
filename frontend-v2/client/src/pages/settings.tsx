import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  User, CreditCard, Shield, Loader2, ExternalLink,
  Check, Crown, Zap, Calendar, ChevronRight,
} from 'lucide-react';
import { Link } from 'wouter';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';
const STRIPE_PRO_URL = 'https://buy.stripe.com/9B614gaQ2gjIdxV26NfUQ01';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [portalLoading, setPortalLoading] = useState(false);

  async function openStripePortal() {
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_BASE}/payments/portal`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      window.open(data.url, '_blank');
    } catch (err: any) {
      toast.error(err.message || 'Could not open billing portal');
    } finally {
      setPortalLoading(false);
    }
  }

  function handleUpgrade() {
    if (!user) return;
    window.open(`${STRIPE_PRO_URL}?client_reference_id=${user.id}`, '_blank');
  }

  const joinDate = (user as any)?.createdAt
    ? new Date((user as any).createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

  const tierLabel = user?.tier === 'pro' ? 'Pro' : user?.tier === 'enterprise' ? 'Enterprise' : 'Free';
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  return (
    <div className="page">
      <Navbar variant="full" />
      <main className="container-tight py-12 sm:py-16 space-y-8">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-semibold tracking-tight">Account Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your account, subscription, and preferences.</p>
        </motion.div>

        {/* Profile */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 border border-primary/20">
                <User className="h-4 w-4 text-primary" />
              </div>
              <h2 className="text-sm font-semibold">Profile</h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-muted/30 border px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Name</p>
                <p className="text-sm font-medium">{user?.name || '—'}</p>
              </div>
              <div className="rounded-xl bg-muted/30 border px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Email</p>
                <p className="text-sm font-medium">{(user as any)?.email || '—'}</p>
              </div>
              {joinDate && (
                <div className="rounded-xl bg-muted/30 border px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Member since</p>
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {joinDate}
                  </div>
                </div>
              )}
              <div className="rounded-xl bg-muted/30 border px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Plan</p>
                <div className="flex items-center gap-2">
                  {isPro ? (
                    <Crown className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className={`text-sm font-semibold ${isPro ? 'text-primary' : 'text-foreground'}`}>{tierLabel}</span>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Subscription */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 border border-primary/20">
                <CreditCard className="h-4 w-4 text-primary" />
              </div>
              <h2 className="text-sm font-semibold">Subscription</h2>
            </div>

            {isPro ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Crown className="h-4 w-4 text-primary" />
                        <span className="text-sm font-bold text-primary">Pro Plan — Active</span>
                      </div>
                      <p className="text-xs text-muted-foreground">$12 / month · Unlimited analyses, AI coach, nutrition & programs</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-1 text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-wide shrink-0">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {[
                    'Unlimited diagnostic analyses',
                    'Personalized training programs',
                    'AI nutrition plan & meal ideas',
                    'Life Happened auto-reschedule',
                    'Full analytics dashboard',
                    'Exercise tutorial videos',
                  ].map(f => (
                    <div key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  className="w-full rounded-xl text-sm"
                  onClick={openStripePortal}
                  disabled={portalLoading}
                >
                  {portalLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ExternalLink className="h-4 w-4 mr-2" />
                  )}
                  Manage Billing & Subscription
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  Change plan, view invoices, or cancel — all from the secure Stripe portal.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border bg-muted/30 px-5 py-4">
                  <p className="text-sm font-semibold mb-0.5">Free Plan</p>
                  <p className="text-xs text-muted-foreground">2 analyses per day · No training program or nutrition plan</p>
                </div>

                <div className="rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 space-y-3">
                  <div>
                    <p className="text-sm font-bold">Upgrade to Pro — $12/month</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Less than the cost of a single personal training session.</p>
                  </div>
                  {[
                    'Unlimited diagnostics + full AI Coach dashboard',
                    'Multi-phase personalized training programs',
                    'Nutrition plan with macro targets & meal ideas',
                    'Life Happened — auto-reschedule when life disrupts training',
                  ].map(f => (
                    <div key={f} className="flex items-center gap-2 text-xs text-foreground">
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                      {f}
                    </div>
                  ))}
                  <Button
                    className="w-full rounded-xl bg-gradient-to-r from-primary to-blue-600 font-semibold shadow-sm"
                    onClick={handleUpgrade}
                  >
                    Upgrade to Pro <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </motion.div>

        {/* Security */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-muted border">
                <Shield className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="text-sm font-semibold">Account</h2>
            </div>

            <div className="space-y-2">
              <Link href="/history">
                <button className="w-full flex items-center justify-between rounded-xl border px-4 py-3 hover:bg-muted/40 transition-colors text-left">
                  <span className="text-sm">Analysis History</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </Link>
              <button
                className="w-full flex items-center justify-between rounded-xl border px-4 py-3 hover:bg-red-500/5 hover:border-red-500/20 transition-colors text-left"
                onClick={() => {
                  if (confirm('Sign out of your account?')) logout();
                }}
              >
                <span className="text-sm text-red-600 dark:text-red-400">Sign Out</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
