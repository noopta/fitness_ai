import { useState } from 'react';
import { useAuth, type ConsentChoices } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { ConsentCheckboxes, EMPTY_CONSENT } from '@/components/ConsentCheckboxes';
import { toast } from 'sonner';

/**
 * Post-login gate: a signed-in user whose account predates (or skipped) the
 * Terms / health-data consent is asked for it before continuing. Only active
 * when /auth/me actually sent `consent` — an older backend never blocks.
 */
export function ConsentGate() {
  const { user, consent, updateConsent } = useAuth();
  const [choices, setChoices] = useState<ConsentChoices>(EMPTY_CONSENT);
  const [saving, setSaving] = useState(false);

  if (!user || !consent) return null;
  if (consent.acceptedTermsAt && consent.healthConsentAt) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!choices.acceptedTerms || !choices.healthConsent) return;
    setSaving(true);
    try {
      await updateConsent(choices);
    } catch (err: any) {
      toast.error(err?.message || 'Could not save your choices. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-gate-title"
      data-testid="consent-gate"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
    >
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-xl space-y-4">
        <div>
          <h2 id="consent-gate-title" className="text-lg font-semibold">Before you continue</h2>
          <p className="text-sm text-muted-foreground mt-1">
            We've updated our terms. Please review and confirm to keep using Axiom.
          </p>
        </div>
        <ConsentCheckboxes value={choices} onChange={setChoices} idPrefix="gate" />
        <Button
          type="submit"
          className="w-full"
          disabled={saving || !choices.acceptedTerms || !choices.healthConsent}
        >
          {saving ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </div>
  );
}

export default ConsentGate;
