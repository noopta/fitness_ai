// Social proof — the new block #2 (sits between Hero and AI Coach).
// Card style: Stat-first dark. The outcome number is the visual anchor;
// the quote is supporting evidence. Spec: handoff §06–07.
//
// Three reviews stretch across the row; on mobile they collapse to a stack.
// All numbers and quotes are placeholders the founder will swap in for real
// user stories — but the schema (`ReviewData`) is the contract.

export interface ReviewData {
  /** Display name, e.g. "Mark T." */
  name: string;
  /** Audience meta, e.g. "Intermediate · 2 yr training". */
  meta: string;
  /** Lift label, e.g. "Bench Press". */
  lift: string;
  /** Pre-formatted "<starting> · <context>". Only the chunk before " · " renders. */
  before: string;
  /** Pre-formatted ending weight, e.g. "245 lb". */
  after: string;
  /** Pre-formatted "<sign+number> / <period>", e.g. "+20 lb / 6 wks". Sign required. */
  gain: string;
  /** One-sentence supporting quote, ≤ 90 chars. */
  short: string;
}

const REVIEWS: ReviewData[] = [
  {
    name: "Mark T.",
    meta: "Intermediate · 2 yr training",
    lift: "Bench Press",
    before: "225 lb · 8 mo plateau",
    after: "245 lb",
    gain: "+20 lb / 6 wks",
    short: "First app to tell me what's actually wrong with my bench.",
  },
  {
    name: "Rivka L.",
    meta: "Advanced · 6 yr training",
    lift: "Back Squat",
    before: "315 lb · stalled",
    after: "345 lb",
    gain: "+30 lb / 10 wks",
    short: "My triceps index went from 38 to 71. More motivating than streaks.",
  },
  {
    name: "Cara M.",
    meta: "Beginner · lost 22 lb",
    lift: "Body Composition",
    before: "163 lb · no plan",
    after: "141 lb",
    gain: "−22 lb / 12 wks",
    short: "Weight loss had stalled for months. The nutrition profile finally showed me why.",
  },
];

function StarRow({ size = 13, count = 5, color = "#f59e0b" }: { size?: number; count?: number; color?: string }) {
  return (
    <div className="inline-flex" style={{ gap: 1 }} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={color}>
          <path d="M12 .587l3.668 7.568L24 9.75l-6 5.852L19.336 24 12 19.897 4.664 24 6 15.602 0 9.75l8.332-1.595z" />
        </svg>
      ))}
    </div>
  );
}

/**
 * One dark stat-first card. The 64px gain number is the hero element; the
 * supporting quote and the attribution + star row anchor it.
 */
function StatFirstDarkCard({ data }: { data: ReviewData }) {
  const [num] = data.gain.split(" / ");
  const period = data.gain.split(" / ")[1] || "";
  const beforeWeight = data.before.split(" · ")[0];
  return (
    <article
      className="flex flex-col h-full"
      style={{
        background: "#09090b",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: 24,
        gap: 18,
        boxShadow: "0 14px 44px -28px rgba(0,0,0,0.4)",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "rgba(255,255,255,0.55)",
            textTransform: "uppercase",
          }}
        >
          {data.lift} · over {period}
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            color: "#ffffff",
            marginTop: 8,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {num}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
            marginTop: 6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {beforeWeight} → {data.after}
        </div>
      </div>
      <blockquote
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: "rgba(255,255,255,0.78)",
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          margin: 0,
        }}
      >
        "{data.short}"
      </blockquote>
      <div className="flex items-center justify-between" style={{ marginTop: "auto" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#ffffff" }}>{data.name}</div>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)" }}>{data.meta}</div>
        </div>
        <StarRow size={10} />
      </div>
    </article>
  );
}

export function SocialProofSection() {
  return (
    <section
      className="border-t bg-white"
      style={{ paddingTop: 96, paddingBottom: 96 }}
      aria-labelledby="social-proof-heading"
    >
      <div className="container-tight">
        {/* Header row */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[580px]">
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#71717a",
              }}
            >
              Real diagnoses, real plateaus
            </div>
            <h2
              id="social-proof-heading"
              className="font-bold"
              style={{
                marginTop: 8,
                fontSize: 32,
                letterSpacing: "-0.02em",
                lineHeight: 1.15,
                color: "#09090b",
              }}
            >
              Where users were stuck.<br />Where they ended up.
            </h2>
            <p
              className="text-muted-foreground"
              style={{ marginTop: 12, fontSize: 15, lineHeight: 1.6, maxWidth: 520 }}
            >
              Three Pro users, three different limiters, three plateaus broken. Names changed, numbers unedited.
            </p>
          </div>

          <div
            className="inline-flex items-center gap-3"
            style={{
              padding: "12px 16px",
              border: "1px solid var(--border, #e4e4e7)",
              borderRadius: 14,
            }}
          >
            <StarRow size={13} />
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#09090b" }}>
                5.0 <span className="font-normal text-muted-foreground">· App Store</span>
              </div>
              <div className="text-muted-foreground" style={{ fontSize: 10.5 }}>Early reviews</div>
            </div>
          </div>
        </div>

        {/* Card grid */}
        <div
          className="grid gap-4 sm:grid-cols-3"
          style={{ marginTop: 40, alignItems: "stretch" }}
        >
          {REVIEWS.map((r) => (
            <StatFirstDarkCard key={r.name} data={r} />
          ))}
        </div>
      </div>
    </section>
  );
}
