import { Link } from 'wouter';
import type { CoachReference } from '@/lib/api';
import { safeHttpUrl } from '@/lib/safeUrl';

/**
 * "Sources" under a coach reply: the cited references plus the attribution
 * disclaimer the backend sends with them (e.g. "not affiliated with or
 * endorsed by …"). The disclaimer is shown whenever references are.
 */
export function CoachSources({
  references,
  disclaimer,
  compact = false,
}: {
  references?: CoachReference[];
  disclaimer?: string;
  compact?: boolean;
}) {
  if (!references?.length && !disclaimer) return null;
  const text = compact ? 'text-[10px]' : 'text-[11px]';
  return (
    <div className={`mt-2 border-t pt-2 ${text} text-muted-foreground space-y-1`} data-testid="coach-sources">
      {references?.length ? (
        <>
          <p className="font-semibold uppercase tracking-wider">Sources</p>
          <ul className="space-y-0.5">
            {references.map((r, i) => {
              const label = [r.speaker, r.episode].filter(Boolean).join(' — ') || 'Source';
              const href = safeHttpUrl(r.url);
              return (
                <li key={i}>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{label}</a>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {disclaimer ? <p data-testid="coach-sources-disclaimer">{disclaimer}</p> : null}
    </div>
  );
}

/** Inline upgrade CTA for a coach turn the backend refused with 403 pro_required. */
export function CoachUpgradeCta({ onNavigate, compact = false }: { onNavigate?: () => void; compact?: boolean }) {
  return (
    <div
      className={`rounded-2xl border border-primary/30 bg-primary/5 ${compact ? 'p-3 text-xs' : 'p-4 text-sm'} text-center space-y-2`}
      data-testid="coach-upgrade-cta"
    >
      <p className="font-semibold">Chat with Anakin is a Pro feature</p>
      <p className="text-muted-foreground">Upgrade to Pro for unlimited coaching, programs and nutrition.</p>
      <Link
        href="/pricing"
        onClick={onNavigate}
        className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 font-medium text-primary-foreground"
      >
        See Pro plans
      </Link>
    </div>
  );
}
