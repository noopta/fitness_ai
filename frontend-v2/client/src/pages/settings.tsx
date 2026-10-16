import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ContributionGraph } from '@/components/ContributionGraph';
import {
  User, CreditCard, Shield, Loader2, ExternalLink,
  Check, Crown, Zap, Calendar, ChevronRight, Scale, Download, Trash2, LogOut, FileCheck,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { PRO_PRICE, PRO_PRICE_MONTHLY, AUTO_RENEW_DISCLOSURE } from '@/lib/pricing';

import { startProCheckout } from '@/lib/checkout';
import { authFetch } from '@/lib/api';
import { useUnits, type UnitPreference } from '@/lib/units';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

export default function SettingsPage() {
  const { user, logout, consent, updateConsent, clearSession } = useAuth();
  const [, setLocation] = useLocation();
  const [portalLoading, setPortalLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [marketingSaving, setMarketingSaving] = useState(false);
  const { unit, setUnit } = useUnits();
  const [unitSaving, setUnitSaving] = useState(false);

  async function changeUnit(next: UnitPreference) {
    if (next === unit) return;
    setUnitSaving(true);
    try {
      await setUnit(next);
      toast.success(`Weights now shown in ${next === 'metric' ? 'kilograms' : 'pounds'}.`);
    } catch {
      toast.error('Could not update unit preference.');
    } finally {
      setUnitSaving(false);
    }
  }

  async function openStripePortal() {
    setPortalLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/payments/portal`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      // Same-tab navigation: popup blockers and mobile/in-app browsers
      // routinely suppress _blank opens, leaving the user stuck.
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || 'Could not open billing portal');
    } finally {
      setPortalLoading(false);
    }
  }

  // GET /auth/export-link → a short-lived, export-only URL the browser can
  // open directly (it can't attach our bearer token to a navigation).
  async function downloadMyData() {
    setExporting(true);
    try {
      const res = await authFetch(`${API_BASE}/auth/export-link`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== 'string') throw new Error(data.error || 'Could not prepare your export');
      const url = new URL(data.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unexpected export link');
      window.location.assign(url.toString());
    } catch (err: any) {
      toast.error(err.message || 'Could not prepare your export');
    } finally {
      setExporting(false);
    }
  }

  async function signOutEverywhere() {
    if (!confirm('Sign out of Axiom on every device, including this one?')) return;
    setSigningOutAll(true);
    try {
      const res = await authFetch(`${API_BASE}/auth/logout-all`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not sign out everywhere');
      }
      clearSession();
      toast.success('Signed out on all devices.');
      setLocation('/login');
    } catch (err: any) {
      toast.error(err.message || 'Could not sign out everywhere');
    } finally {
      setSigningOutAll(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      const reason = deleteReason.trim();
      const res = await authFetch(`${API_BASE}/auth/account`, {
        method: 'DELETE',
        // The exit survey is optional — send it only when given.
        ...(reason ? { body: JSON.stringify({ reason }) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete account');
      clearSession();
      setDeleteOpen(false);
      toast.success('Your account has been deleted.');
      setLocation('/');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  }

  async function toggleMarketing(next: boolean) {
    if (!consent) return;
    setMarketingSaving(true);
    try {
      await updateConsent({
        acceptedTerms: !!consent.acceptedTermsAt,
        healthConsent: !!consent.healthConsentAt,
        marketingConsent: next,
      });
      toast.success(next ? 'You\'ll receive product emails.' : 'Marketing emails turned off.');
    } catch (err: any) {
      toast.error(err.message || 'Could not update your preference');
    } finally {
      setMarketingSaving(false);
    }
  }

  const fmtConsent = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not given';

  async function handleUpgrade() {
    if (!user) return;
    await startProCheckout();
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

        {/* Activity Graph */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}>
          <Card className="p-6">
            <ContributionGraph />
          </Card>
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

        {/* Preferences — units */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <Card className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 border border-primary/20">
                <Scale className="h-4 w-4 text-primary" />
              </div>
              <h2 className="text-sm font-semibold">Preferences</h2>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Weight units</p>
                <p className="text-xs text-muted-foreground mt-0.5">Used across workouts, your strength profile, and coaching.</p>
              </div>
              <div className="inline-flex rounded-xl border bg-muted/30 p-0.5 shrink-0">
                {(['imperial', 'metric'] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => changeUnit(opt)}
                    disabled={unitSaving}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                      unit === opt ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt === 'imperial' ? 'lbs' : 'kg'}
                  </button>
                ))}
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
              <h2 className="text-sm font-semibold">Billing &amp; subscription</h2>
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
                      <p className="text-xs text-muted-foreground">{PRO_PRICE} / month · Unlimited analyses, Anakin, nutrition & programs</p>
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
                    <p className="text-sm font-bold">Upgrade to Pro — {PRO_PRICE_MONTHLY}</p>
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
                  <p className="text-[10px] text-muted-foreground text-center">{AUTO_RENEW_DISCLOSURE}</p>
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
                className="w-full flex items-center justify-between rounded-xl border px-4 py-3 hover:bg-muted/40 transition-colors text-left disabled:opacity-60"
                onClick={downloadMyData}
                disabled={exporting}
              >
                <span className="flex items-center gap-2 text-sm">
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 text-muted-foreground" />}
                  Download my data
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                className="w-full flex items-center justify-between rounded-xl border px-4 py-3 hover:bg-red-500/5 hover:border-red-500/20 transition-colors text-left"
                onClick={() => {
                  if (confirm('Sign out of your account?')) logout();
                }}
              >
                <span className="text-sm text-red-600 dark:text-red-400">Sign Out</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                className="w-full flex items-center justify-between rounded-xl border px-4 py-3 hover:bg-red-500/5 hover:border-red-500/20 transition-colors text-left disabled:opacity-60"
                onClick={signOutEverywhere}
                disabled={signingOutAll}
              >
                <span className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  {signingOutAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                  Sign out everywhere
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                className="w-full flex items-center justify-between rounded-xl border border-red-500/30 px-4 py-3 hover:bg-red-500/5 transition-colors text-left"
                onClick={() => setDeleteOpen(true)}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                  <Trash2 className="h-4 w-4" />
                  Delete my account
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </Card>
        </motion.div>

        {/* Privacy & consent */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-muted border">
                <FileCheck className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="text-sm font-semibold">Privacy &amp; consent</h2>
            </div>
            {consent ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-muted/30 border px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Terms &amp; Privacy accepted</p>
                    <p className="text-sm font-medium" data-testid="consent-terms">{fmtConsent(consent.acceptedTermsAt)}</p>
                  </div>
                  <div className="rounded-xl bg-muted/30 border px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Health-data consent</p>
                    <p className="text-sm font-medium" data-testid="consent-health">{fmtConsent(consent.healthConsentAt)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Marketing emails</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {consent.marketingConsentAt ? `Opted in ${fmtConsent(consent.marketingConsentAt)}` : 'Not subscribed'}
                    </p>
                  </div>
                  <Switch
                    checked={!!consent.marketingConsentAt}
                    onCheckedChange={toggleMarketing}
                    disabled={marketingSaving}
                    aria-label="Marketing emails"
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Consent records are not available right now.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Read our <Link href="/privacy" className="underline">Privacy Policy</Link>,{' '}
              <Link href="/health-data" className="underline">Consumer Health Data Privacy Policy</Link> and{' '}
              <Link href="/terms" className="underline">Terms</Link>.
            </p>
          </Card>
        </motion.div>

        <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!deleting) setDeleteOpen(o); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes your profile, workouts, nutrition logs, coach history and
                all other data. It can't be undone. An active web (Stripe) subscription is cancelled
                automatically; App Store or Google Play subscriptions must be cancelled in the store.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <label htmlFor="delete-reason" className="text-xs font-medium text-muted-foreground">
                Why are you leaving? (optional)
              </label>
              <textarea
                id="delete-reason"
                className="w-full min-h-[72px] rounded-md border bg-background px-3 py-2 text-sm"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                maxLength={1000}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <Button variant="destructive" onClick={deleteAccount} disabled={deleting}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Delete permanently
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
