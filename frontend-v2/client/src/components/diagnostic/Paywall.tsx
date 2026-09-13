import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CreditCard, X } from 'lucide-react';
import { COPY } from '@axiom/diagnostic-core';
import { authFetch } from '@/lib/api';
import { WebAnalytics } from '@/lib/analytics';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';
const PRICE = '$12.99';

function applePayAvailable(): boolean {
  try {
    const w = window as unknown as { ApplePaySession?: { canMakePayments?: () => boolean } };
    return !!w.ApplePaySession?.canMakePayments?.();
  } catch {
    return false;
  }
}

interface Props {
  open: boolean;
  source: 'diagnostic_limit' | 'diagnostic_report' | 'diagnostic_home';
  onClose: () => void;
}

/**
 * Radix Dialog, bottom variant: radius 24 top, scrim rgba(0,0,0,.5), 320ms
 * slide on cubic-bezier(.16,1,.3,1). Tap the scrim to dismiss. Apple Pay
 * primary, card secondary; both run through Stripe Checkout, which returns to
 * this page with ?checkout=success so the purchase lands in place.
 */
export function DiagnosticPaywall({ open, source, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apple = applePayAvailable();

  useEffect(() => {
    if (open) {
      WebAnalytics.paywallViewed(source);
      setError(null);
    }
  }, [open, source]);

  const checkout = async (method: 'apple_pay' | 'card') => {
    WebAnalytics.upgradeTapped(`${source}:${method}`);
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/payments/create-checkout`, {
        method: 'POST',
        body: JSON.stringify({ returnPath: window.location.pathname }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || 'Could not start checkout');
      window.location.href = body.url;
    } catch (err: any) {
      // Inline, never a toast — the flow has no alerts anywhere.
      setError(err?.message ?? 'Could not start checkout');
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dx-fade-in fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="dx-sheet-in fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[520px] flex-col gap-3.5 rounded-t-[24px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-2.5 outline-none"
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-zinc-200" />
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-[22px] font-bold tracking-[-0.03em] text-zinc-950">{COPY.paywallTitle}</Dialog.Title>
            <Dialog.Close aria-label={COPY.close} className="text-zinc-500 hover:text-zinc-950">
              <X size={20} />
            </Dialog.Close>
          </div>
          <p className="text-sm leading-5 text-zinc-700">{COPY.paywallPromise}</p>
          <p className="text-[13px] font-semibold text-zinc-500">{COPY.freeMonthFine} · then {PRICE}/mo</p>
          {apple ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void checkout('apple_pay')}
              className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-zinc-950 text-base font-semibold text-white disabled:opacity-35"
            >
              {COPY.payWithApple}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void checkout('card')}
            className={
              apple
                ? 'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-zinc-200 text-base font-semibold text-zinc-700 disabled:opacity-35'
                : 'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-zinc-950 text-base font-semibold text-white disabled:opacity-35'
            }
          >
            <CreditCard size={18} />
            {COPY.payByCard}
          </button>
          {error ? <p className="text-center text-[13px] text-zinc-500">{error}</p> : null}
          <div className="flex items-center justify-center gap-2 pt-1 text-[13px] font-medium text-zinc-500">
            <a href="/settings" className="hover:text-zinc-950">{COPY.restore}</a>
            <span className="text-zinc-400">·</span>
            <a href="/terms" className="hover:text-zinc-950">{COPY.terms}</a>
            <span className="text-zinc-400">·</span>
            <a href="/privacy" className="hover:text-zinc-950">{COPY.privacy}</a>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
