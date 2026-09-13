import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Navbar } from '@/components/Navbar';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { SEO } from '@/components/SEO';

// Post-registration email verification: the account exists but no session is
// issued until the 6-digit code from the email is submitted. Reached from
// register (fresh signup) and login (returning unverified user); the email
// travels in the query string so a page refresh doesn't strand the user.
export default function VerifyEmail() {
  const { verifyEmail, resendVerification, user, loading } = useAuth();
  const [, setLocation] = useLocation();

  const params = new URLSearchParams(window.location.search);
  const email = params.get('email') ?? '';
  // register passes codeSent=0 when the mail provider refused the send — lead
  // with "tap Resend" instead of implying a code is on its way.
  const initialSendFailed = params.get('codeSent') === '0';

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const redirected = useRef(false);

  // Already signed in (e.g. verified in another tab) — move along.
  useEffect(() => {
    if (!loading && user && !redirected.current) {
      redirected.current = true;
      setLocation('/coach');
    }
  }, [user, loading]);

  // Countdown for the resend cooldown the server reports.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast.error('Enter the 6-digit code from your email.');
      return;
    }
    setSubmitting(true);
    try {
      await verifyEmail(email, code);
      redirected.current = true;
      setLocation('/coach');
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setResending(true);
    try {
      const r = await resendVerification(email);
      if (r.sent) {
        toast.success('New code sent — check your inbox.');
      } else if (r.reason === 'cooldown' && r.cooldownRemainingSec) {
        setCooldown(r.cooldownRemainingSec);
      } else if (r.reason === 'already_verified') {
        toast.success('Already verified — you can sign in.');
        setLocation('/login');
      } else {
        toast.error("Couldn't send the code. Please try again in a minute.");
      }
    } catch (err: any) {
      toast.error(err.message || 'Resend failed');
    } finally {
      setResending(false);
    }
  }

  if (!email) {
    // Landed here without an email (deep link, stale bookmark) — nothing to
    // verify against; restart from register.
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-secondary">
        <SEO title="Verify Email" noIndex canonical="/verify-email" />
        <Navbar variant="full" />
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="p-6 max-w-md text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              We don't know which account to verify.
            </p>
            <Link href="/register" className="text-primary hover:underline text-sm">
              Back to sign up
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-secondary">
      <SEO title="Verify Email" noIndex canonical="/verify-email" />
      <Navbar variant="full" />
      <div className="flex-1 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold">Check your email</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {initialSendFailed
                ? <>We couldn't send a code to <span className="font-medium">{email}</span> — tap Resend below.</>
                : <>We sent a 6-digit code to <span className="font-medium">{email}</span>.</>}
            </p>
          </div>

          <Card className="p-6 space-y-4">
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="space-y-2">
                <Label>Verification code</Label>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center text-lg tracking-[0.5em]"
                  autoFocus
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || code.length !== 6}>
                {submitting ? 'Verifying...' : 'Verify'}
              </Button>
            </form>

            <div className="text-center text-sm text-muted-foreground">
              Didn't get it?{' '}
              <button
                type="button"
                className="text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                onClick={handleResend}
                disabled={resending || cooldown > 0}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? 'Sending...' : 'Resend code'}
              </button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Wrong email?{' '}
              <Link href="/register" className="text-primary hover:underline">
                Start over
              </Link>
            </p>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
