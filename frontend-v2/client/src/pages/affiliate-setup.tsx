import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLocation } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, ExternalLink } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

export default function AffiliateSetupPage() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [affiliateName, setAffiliateName] = useState('');
  const [affiliateId, setAffiliateId] = useState('');
  const [onboardingUrl, setOnboardingUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) { setStatus('error'); setErrorMsg('Missing invite token.'); return; }

    fetch(`${API}/affiliate/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Invalid or expired invite link.');
        setAffiliateName(d.affiliate.name);
        setAffiliateId(d.affiliate.id);
        setOnboardingUrl(d.onboardingUrl);
        localStorage.setItem('affiliateId', d.affiliate.id);
        localStorage.setItem('affiliateEmail', d.affiliate.email);
        setStatus('ready');
      })
      .catch(err => { setStatus('error'); setErrorMsg(err.message); });
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-8 max-w-sm w-full text-center space-y-4">
          <p className="text-sm font-medium text-destructive">{errorMsg}</p>
          <p className="text-xs text-muted-foreground">If you believe this is an error, contact hello@axiomtraining.io</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Card className="p-8 space-y-6">
          <div className="text-center">
            <CheckCircle2 size={36} className="text-green-500 mx-auto mb-3" />
            <h1 className="text-xl font-semibold">Welcome, {affiliateName}!</h1>
            <p className="text-sm text-muted-foreground mt-2">
              You've been invited to join the Axiom affiliate program. Complete your Stripe setup to start receiving monthly payouts.
            </p>
          </div>

          <div className="space-y-3 text-sm text-muted-foreground bg-muted/50 rounded-lg p-4">
            <p><strong className="text-foreground">What happens next:</strong></p>
            <ul className="space-y-1.5 list-disc list-inside">
              <li>You'll be taken to Stripe to set up your payout account (5 min)</li>
              <li>Once complete, you'll get your referral link in your dashboard</li>
              <li>Every subscriber you refer earns you 30% recurring commission</li>
              <li>Payouts hit your Stripe account on the 1st of each month</li>
            </ul>
          </div>

          <Button className="w-full" onClick={() => window.location.href = onboardingUrl}>
            <ExternalLink size={15} className="mr-2" />
            Set Up Stripe Payout Account
          </Button>

          <button className="w-full text-xs text-muted-foreground underline" onClick={() => navigate('/affiliate')}>
            Skip for now — go to my dashboard
          </button>
        </Card>
      </motion.div>
    </div>
  );
}
