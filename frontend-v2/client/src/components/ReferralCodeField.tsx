import { useEffect, useRef, useState } from 'react';
import {
  normaliseReferralCode, offerLine, storeReferralCode, validateReferralCode, type ReferralValidation,
} from '@/lib/referral';

interface Props {
  /** The active code (from getStoredReferralCode() in the parent's state). */
  value: string | null;
  onChange: (code: string | null) => void;
  /** 'light' for the white diagnostic sheet; 'default' follows the app theme. */
  variant?: 'default' | 'light';
  className?: string;
  /** Re-check a pre-filled code (e.g. from a ?ref= link) when shown. Default true. */
  revalidateOnMount?: boolean;
  /** Text for the collapsed link. */
  prompt?: string;
}

type Status = 'idle' | 'checking' | 'applied' | 'unchecked' | 'invalid' | 'error';

/**
 * "Have a referral code?" → input + Apply. A valid code is stored in
 * localStorage `axiom_referral` (so it reaches checkout and, for signed-out
 * visitors, registration) and reported to the parent, which passes it to
 * checkout explicitly. Shows the active code with a "remove" link.
 */
export function ReferralCodeField({ value, onChange, variant = 'default', className = '', revalidateOnMount = true, prompt = 'Have a referral code?' }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<Status>(value ? 'unchecked' : 'idle');
  const [offer, setOffer] = useState<ReferralValidation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const checkedMount = useRef(false);

  const muted = variant === 'light' ? 'text-zinc-500' : 'text-muted-foreground';
  const strong = variant === 'light' ? 'text-zinc-950' : 'text-foreground';
  const ok = variant === 'light' ? 'text-emerald-700' : 'text-emerald-600 dark:text-emerald-400';
  const inputCls = variant === 'light'
    ? 'min-w-0 flex-1 rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-sm uppercase text-zinc-950 outline-none focus:border-zinc-400'
    : 'min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm uppercase outline-none focus:ring-2 focus:ring-ring';
  const btnCls = variant === 'light'
    ? 'rounded-full bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40'
    : 'rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40';

  useEffect(() => {
    if (checkedMount.current || !revalidateOnMount || !value) return;
    checkedMount.current = true;
    let cancelled = false;
    validateReferralCode(value)
      .then((v) => {
        if (cancelled) return;
        if (v.valid) { setOffer(v); setStatus('applied'); return; }
        storeReferralCode(null);
        onChange(null);
        setDraft(value);
        setOpen(true);
        setStatus('invalid');
        setMessage(`Code ${value} not recognised`);
      })
      .catch(() => { if (!cancelled) setStatus('unchecked'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, revalidateOnMount]);

  async function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const code = normaliseReferralCode(draft);
    if (!code) { setStatus('invalid'); setMessage('Code not recognised'); return; }
    setStatus('checking');
    setMessage(null);
    try {
      const v = await validateReferralCode(code);
      if (!v.valid) { setStatus('invalid'); setMessage('Code not recognised'); return; }
      const applied = v.code ?? code;
      checkedMount.current = true;
      storeReferralCode(applied);
      setOffer(v);
      setStatus('applied');
      setOpen(false);
      setDraft('');
      onChange(applied);
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Could not check that code right now');
    }
  }

  function remove() {
    storeReferralCode(null);
    setOffer(null);
    setStatus('idle');
    setMessage(null);
    onChange(null);
  }

  if (value && status !== 'invalid') {
    return (
      <div className={`text-center text-[13px] leading-snug ${className}`} data-testid="referral-applied">
        <span className={muted}>Referral code </span>
        <span className={`font-semibold tracking-wide ${strong}`}>{value}</span>
        <span className={muted}> · </span>
        <span className={status === 'applied' ? `font-medium ${ok}` : muted}>
          {status === 'applied' ? offerLine(offer) : 'applied at checkout'}
        </span>
        <span className={muted}> · </span>
        <button type="button" onClick={remove} className={`underline underline-offset-2 ${muted}`} data-testid="referral-remove">
          remove
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className={`text-center ${className}`}>
        <button
          type="button"
          onClick={() => { setOpen(true); setMessage(null); }}
          className={`text-[13px] font-medium underline underline-offset-2 ${muted}`}
          data-testid="referral-toggle"
        >
          {prompt}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={apply} className={`space-y-1.5 ${className}`} data-testid="referral-form">
      <div className="flex items-center gap-2">
        <input
          aria-label="Referral code"
          placeholder="Enter code"
          value={draft}
          onChange={(e) => { setDraft(e.target.value.toUpperCase()); if (status === 'invalid' || status === 'error') { setStatus('idle'); setMessage(null); } }}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          className={inputCls}
          data-testid="referral-input"
        />
        <button type="submit" disabled={!draft.trim() || status === 'checking'} className={btnCls} data-testid="referral-apply">
          {status === 'checking' ? 'Checking…' : 'Apply'}
        </button>
      </div>
      {message ? <p className={`text-center text-[12px] ${muted}`} role="status" data-testid="referral-error">{message}</p> : null}
    </form>
  );
}
