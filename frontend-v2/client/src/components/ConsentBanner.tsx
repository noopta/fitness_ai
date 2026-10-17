import { useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { getAnalyticsConsent, setAnalyticsConsent } from '@/lib/analytics';

/**
 * Cookie / analytics consent banner. Analytics (PostHog, incl. session replay)
 * stays off until the visitor picks "Accept analytics". The choice is kept in
 * localStorage; essential storage (sign-in) is always used.
 */
export function ConsentBanner() {
  const [decided, setDecided] = useState(() => getAnalyticsConsent() !== null);
  if (decided) return null;

  const choose = (value: 'granted' | 'denied') => {
    setAnalyticsConsent(value);
    setDecided(true);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie and analytics preferences"
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-[100] p-3 sm:p-4"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border bg-background/95 backdrop-blur shadow-lg p-4 sm:flex sm:items-center sm:gap-4">
        <p className="text-sm text-muted-foreground flex-1">
          We use essential storage to keep you signed in. With your permission we also use
          analytics (PostHog) to understand how the product is used — inputs and on-screen text
          are masked. See our{' '}
          <Link href="/privacy" className="underline text-foreground">Privacy Policy</Link>.
        </p>
        <div className="mt-3 sm:mt-0 flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => choose('denied')}>
            Essential only
          </Button>
          <Button size="sm" onClick={() => choose('granted')}>
            Accept analytics
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ConsentBanner;
