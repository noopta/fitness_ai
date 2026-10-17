import { Link } from 'wouter';
import type { ConsentChoices } from '@/context/AuthContext';

/**
 * Terms + Privacy and health-data consent (both required) and an optional
 * marketing opt-in. Native checkboxes so `required` works in a <form>.
 */
export function ConsentCheckboxes({
  value,
  onChange,
  idPrefix = 'consent',
}: {
  value: ConsentChoices;
  onChange: (next: ConsentChoices) => void;
  idPrefix?: string;
}) {
  const set = (k: keyof ConsentChoices) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.checked });
  const link = 'text-primary underline';
  return (
    <div className="space-y-2.5 text-xs text-muted-foreground">
      <label htmlFor={`${idPrefix}-terms`} className="flex items-start gap-2 cursor-pointer">
        <input
          id={`${idPrefix}-terms`}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          checked={value.acceptedTerms}
          onChange={set('acceptedTerms')}
          required
        />
        <span>
          I agree to the{' '}
          <Link href="/terms" className={link}>Terms of Service</Link> and{' '}
          <Link href="/privacy" className={link}>Privacy Policy</Link>. <span aria-hidden>*</span>
        </span>
      </label>
      <label htmlFor={`${idPrefix}-health`} className="flex items-start gap-2 cursor-pointer">
        <input
          id={`${idPrefix}-health`}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          checked={value.healthConsent}
          onChange={set('healthConsent')}
          required
        />
        <span>
          I consent to Axiom processing my health and fitness data (e.g. body weight, injuries,
          training and nutrition logs) to provide coaching, as described in the{' '}
          <Link href="/health-data" className={link}>Consumer Health Data Privacy Policy</Link>. <span aria-hidden>*</span>
        </span>
      </label>
      <label htmlFor={`${idPrefix}-marketing`} className="flex items-start gap-2 cursor-pointer">
        <input
          id={`${idPrefix}-marketing`}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          checked={value.marketingConsent}
          onChange={set('marketingConsent')}
        />
        <span>Send me product updates and tips by email (optional — unsubscribe anytime).</span>
      </label>
    </div>
  );
}

export const EMPTY_CONSENT: ConsentChoices = {
  acceptedTerms: false,
  healthConsent: false,
  marketingConsent: false,
};
