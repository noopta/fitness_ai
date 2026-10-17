import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Navbar } from '@/components/Navbar';
import { useAuth, postAuthDestination, DEFAULT_FEATURES, type ConsentChoices } from '@/context/AuthContext';
import { ConsentCheckboxes, EMPTY_CONSENT } from '@/components/ConsentCheckboxes';
import { toast } from 'sonner';
import { WebAnalytics } from '@/lib/analytics';
import { SEO } from '@/components/SEO';
import { InAppBrowserWarning } from '@/components/InAppBrowserWarning';
import { ReferralCodeField } from '@/components/ReferralCodeField';
import { getStoredReferralCode, normaliseReferralCode, storeReferralCode } from '@/lib/referral';

/** ?ref= wins over a stored code (and replaces it); otherwise the stored one. */
function initialReferralCode(): string | null {
  const urlRef = normaliseReferralCode(new URLSearchParams(window.location.search).get('ref'));
  if (urlRef) { storeReferralCode(urlRef); return urlRef; }
  return getStoredReferralCode();
}

export default function Register() {
  const { register, googleLogin, refreshUser, user, features, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [consents, setConsents] = useState<ConsentChoices>(EMPTY_CONSENT);
  const [submitting, setSubmitting] = useState(false);
  const redirected = useRef(false);
  const [referralCode, setReferralCode] = useState<string | null>(initialReferralCode);

  // Already logged in on arrival — redirect out
  useEffect(() => {
    if (!loading && user && !redirected.current) {
      redirected.current = true;
      setLocation(postAuthDestination(user, features ?? DEFAULT_FEATURES));
    }
  }, [user, features, loading]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !password) return;
    if (!consents.acceptedTerms || !consents.healthConsent) {
      toast.error('Please accept the Terms, Privacy Policy and health-data consent to continue.');
      return;
    }
    // The backend has required dateOfBirth since the 13+ age gate (a9ecd3d,
    // 2026-04-23). This form went on calling it optional, so anyone who left
    // it blank got a bare "Invalid request" toast and could not sign up.
    if (!dateOfBirth) {
      toast.error('Please enter your date of birth.');
      return;
    }
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) {
      toast.error('Please enter a valid date of birth.');
      return;
    }
    // Mirrors the mobile check so both clients fail the same way, before the
    // request rather than after.
    const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (ageYears < 13) {
      toast.error('You must be 13 or older to create an account.');
      return;
    }
    setSubmitting(true);
    try {
      // Sent as `referralCode` (stored as User.referredByCode). The code stays
      // in localStorage so it also reaches create-checkout when they upgrade.
      const pending = await register(name, email, password, dateOfBirth, referralCode || undefined, consents);
      WebAnalytics.register('email');
      redirected.current = true; // prevent useEffect double-fire
      if (pending) {
        // Email verification is on — the account exists but needs the 6-digit
        // code before a session is issued.
        const params = new URLSearchParams({ email: pending.email });
        if (pending.codeSent === false) params.set('codeSent', '0');
        setLocation(`/verify-email?${params.toString()}`);
      } else {
        // The register response carries no feature flags — ask /auth/me so a
        // diagnostic-first user cold-starts in the diagnostic flow.
        const refreshed = await Promise.resolve(refreshUser()).catch(() => null);
        setLocation(postAuthDestination(refreshed?.user ?? null, refreshed?.features ?? DEFAULT_FEATURES));
      }
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-secondary">
      <SEO title="Create Account" noIndex canonical="/register" />
      <Navbar variant="full" />
      <div className="flex-1 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Create your account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <Card className="p-6 space-y-4">
          <InAppBrowserWarning />
          <Button
            variant="outline"
            className="w-full"
            onClick={googleLogin}
            type="button"
          >
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign up with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Password (min 8 chars)</Label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Date of Birth</Label>
              <Input
                type="date"
                value={dateOfBirth}
                onChange={e => setDateOfBirth(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Required — we use this to confirm you're 13 or older.
              </p>
            </div>
            <ConsentCheckboxes value={consents} onChange={setConsents} idPrefix="register" />
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !consents.acceptedTerms || !consents.healthConsent}
            >
              {submitting ? 'Creating account...' : 'Create account'}
            </Button>
          </form>
          <ReferralCodeField value={referralCode} onChange={setReferralCode} />
        </Card>
      </motion.div>
      </div>
    </div>
  );
}
