// App Store / Play Store badge — pair-able with primary CTAs in the hero and
// the footer CTA section. Spec: handoff §08. Apple lozenge text reads
// "Download on the / App Store"; Google reads "GET IT ON / Google Play" or
// "COMING SOON ON / Google Play" when `comingSoon` is true.
//
// Both badges adopt a light surface by default to sit against the white
// landing background; pass `dark` for use on dark sections.

interface Props {
  store: "apple" | "google";
  href?: string;
  comingSoon?: boolean;
  dark?: boolean;
  /** Optional callback (e.g. for analytics). Doesn't fire when comingSoon is true. */
  onClick?: () => void;
}

export function AppStoreBadge({ store, href, comingSoon = false, dark = false, onClick }: Props) {
  const stroke = dark ? "rgba(255,255,255,0.25)" : "var(--border, #e4e4e7)";
  const fg = dark ? "#ffffff" : "#09090b";
  const bg = dark ? "rgba(255,255,255,0.06)" : "#ffffff";
  const muted = dark ? "rgba(255,255,255,0.6)" : "#71717a";

  const Inner = (
    <div
      className="inline-flex items-center gap-2.5"
      style={{
        padding: "8px 14px",
        background: bg,
        border: "1px solid " + stroke,
        borderRadius: 12,
        opacity: comingSoon ? 0.62 : 1,
        cursor: comingSoon ? "default" : "pointer",
      }}
    >
      {store === "apple" ? (
        <svg width="20" height="22" viewBox="0 0 24 24" fill={fg} aria-hidden="true">
          <path d="M17.05 12.04c.02-2.27 1.86-3.36 1.94-3.41-1.06-1.55-2.71-1.76-3.29-1.78-1.39-.14-2.73.83-3.44.83-.72 0-1.81-.81-2.98-.79-1.53.02-2.95.89-3.74 2.27-1.6 2.77-.41 6.86 1.14 9.1.76 1.1 1.66 2.33 2.84 2.29 1.14-.05 1.57-.74 2.95-.74s1.77.74 2.98.71c1.23-.02 2.01-1.11 2.76-2.22.87-1.27 1.23-2.51 1.25-2.57-.03-.01-2.39-.92-2.41-3.69zM14.91 5.32c.62-.76 1.05-1.81.93-2.86-.9.04-2 .6-2.65 1.36-.58.66-1.09 1.74-.96 2.76 1.01.08 2.05-.51 2.68-1.26z" />
        </svg>
      ) : (
        <svg width="20" height="22" viewBox="0 0 24 24" fill={fg} aria-hidden="true">
          <path d="M3.609 1.814 13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893 2.355 2.354-10.51 5.91zM6.345 2.029 16.85 7.94l-2.353 2.353zM20.16 10.81c.692.439.692 1.939.001 2.378l-2.566 1.443-2.834-2.831 2.835-2.832z" />
        </svg>
      )}
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontSize: 9, color: muted, letterSpacing: "0.04em" }}>
          {comingSoon ? "COMING SOON ON" : store === "apple" ? "Download on the" : "GET IT ON"}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: fg, letterSpacing: "-0.01em" }}>
          {store === "apple" ? "App Store" : "Google Play"}
        </div>
      </div>
    </div>
  );

  if (comingSoon || !href) {
    return (
      <span
        aria-disabled={comingSoon || undefined}
        aria-label={
          comingSoon
            ? `Coming soon on ${store === "apple" ? "the App Store" : "Google Play"}`
            : `${store === "apple" ? "App Store" : "Google Play"} badge`
        }
      >
        {Inner}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      aria-label={`Download Axiom on the ${store === "apple" ? "App Store" : "Google Play"}`}
      className="inline-block"
    >
      {Inner}
    </a>
  );
}
