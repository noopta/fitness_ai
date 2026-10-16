// "How Axiom works" — occupies the slot (between Hero and AI Coach) that used
// to hold the social-proof block. That block shipped placeholder testimonials,
// outcome numbers and an App Store rating that were not real user data, which
// the FTC treats as deceptive endorsements. Until real, consented user stories
// exist, this renders claim-free feature statements in the same dark-card
// layout.
//
// To bring testimonials back: only real, verifiable customers, with consent,
// typical-results context, and any material connection disclosed.

export interface FeatureCardData {
  /** Small uppercase label, e.g. "Diagnose". */
  eyebrow: string;
  /** Short headline. */
  title: string;
  /** One or two plain-language sentences. No outcome promises. */
  body: string;
}

const CARDS: FeatureCardData[] = [
  {
    eyebrow: "Diagnose",
    title: "Find your limiter",
    body: "Enter your working weights and answer a few questions. Axiom compares your lift ratios to pinpoint the most likely weak link in your bench, squat or deadlift.",
  },
  {
    eyebrow: "Program",
    title: "Train the weak point",
    body: "Get a structured program built around your limiter, your equipment and your schedule — with accessories chosen for the problem you actually have.",
  },
  {
    eyebrow: "Adapt",
    title: "Adjust as you log",
    body: "Log sessions and meals as you go. When your numbers move, Anakin proposes changes and explains why — you confirm before anything is applied.",
  },
];

function FeatureCard({ data }: { data: FeatureCardData }) {
  return (
    <article
      className="flex flex-col h-full"
      style={{
        background: "#09090b",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: 24,
        gap: 14,
        boxShadow: "0 14px 44px -28px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: "rgba(255,255,255,0.55)",
          textTransform: "uppercase",
        }}
      >
        {data.eyebrow}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          lineHeight: 1.1,
          color: "#ffffff",
        }}
      >
        {data.title}
      </div>
      <p
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: "rgba(255,255,255,0.78)",
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          margin: 0,
        }}
      >
        {data.body}
      </p>
    </article>
  );
}

export function SocialProofSection() {
  return (
    <section
      className="border-t bg-white"
      style={{ paddingTop: 96, paddingBottom: 96 }}
      aria-labelledby="how-it-works-heading"
    >
      <div className="container-tight">
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
            How it works
          </div>
          <h2
            id="how-it-works-heading"
            className="font-bold"
            style={{
              marginTop: 8,
              fontSize: 32,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              color: "#09090b",
            }}
          >
            Diagnose. Program.<br />Adapt.
          </h2>
          <p
            className="text-muted-foreground"
            style={{ marginTop: 12, fontSize: 15, lineHeight: 1.6, maxWidth: 520 }}
          >
            Built on established strength-training and nutrition science, applied to your own numbers.
          </p>
        </div>

        <div
          className="grid gap-4 sm:grid-cols-3"
          style={{ marginTop: 40, alignItems: "stretch" }}
        >
          {CARDS.map((c) => (
            <FeatureCard key={c.eyebrow} data={c} />
          ))}
        </div>
      </div>
    </section>
  );
}
