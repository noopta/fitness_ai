/**
 * /coaches (and /for-coaches → here): the public "For coaches" page.
 *
 * Trainers who aren't on the personal-training allow-list join the coaching
 * beta / launch list (POST /api/coach-beta/signup). Allow-listed trainers
 * already have the dashboard, so they're sent straight to the roster.
 *
 * Copy rules (FTC): no outcome statistics, no "+X lb", no star ratings, no
 * certification-body or creator endorsements, no medical outcomes, no earnings
 * promises. "Outcomes" here are things the trainer can do with the product.
 * Competitor prices are approximate public list prices and labelled so.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight, BarChart3, CalendarCheck, Check, CheckCircle2, ClipboardCheck, CreditCard, Eye,
  FileSpreadsheet, Lightbulb, Loader2, MessageSquareText, PenLine, Send, ShieldAlert, Smartphone, Sunrise, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { useAuth } from "@/context/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL || "https://api.airthreads.ai:4009/api";
export const PT_ROSTER_PATH = "/personal-training/clients";

// ─── Form model ──────────────────────────────────────────────────────────────

export const SOCIAL_PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "x", label: "X" },
  { value: "other", label: "Other" },
] as const;
export const COACHING_TYPES = [
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
] as const;
export const CLIENT_COUNTS = ["0", "1-10", "11-30", "31-100", "100+"] as const;

export interface CoachSignupFields {
  name: string;
  email: string;
  socialPlatform: string;
  socialHandle: string;
  coachingType: string;
  clientCount: string;
  platformToday: string;
  website: string;
  message: string;
  /** Honeypot: hidden from people. */
  company: string;
  marketingConsent: boolean;
}

export const EMPTY_FIELDS: CoachSignupFields = {
  name: "", email: "", socialPlatform: "", socialHandle: "", coachingType: "", clientCount: "",
  platformToday: "", website: "", message: "", company: "", marketingConsent: false,
};

/** Ref code or UTM tags from the URL, for attribution (≤120 chars). */
export function sourceFromSearch(search: string): string | undefined {
  const q = new URLSearchParams(search);
  const ref = q.get("ref")?.trim();
  const utm = ["utm_source", "utm_medium", "utm_campaign"].map((k) => q.get(k)?.trim()).filter(Boolean).join("/");
  const s = ref ? (utm ? `${ref} ${utm}` : ref) : utm;
  return s ? s.slice(0, 120) : undefined;
}

/** Form → request body. Empty optional fields are left out. Exported for tests. */
export function signupPayload(f: CoachSignupFields, source?: string): Record<string, unknown> {
  const body: Record<string, unknown> = { email: f.email.trim(), marketingConsent: f.marketingConsent, company: f.company };
  const opt: (keyof CoachSignupFields)[] = ["name", "socialPlatform", "socialHandle", "coachingType", "clientCount", "platformToday", "website", "message"];
  for (const k of opt) {
    const v = String(f[k]).trim();
    if (v) body[k] = v;
  }
  if (source) body.source = source;
  return body;
}

// ─── Content ─────────────────────────────────────────────────────────────────

const STEPS = [
  { icon: Eye, title: "Axiom watches", body: "Every client's workouts, check-ins, bodyweight and messages are checked against plain rules: mentioned pain, no session in a set number of days, engagement dropped, a stalled lift, a new PR, missed check-ins." },
  { icon: Lightbulb, title: "It explains", body: "Each item in your briefing has a \"Why am I seeing this?\" that shows the rule and the data that triggered it. No black box." },
  { icon: PenLine, title: "It drafts", body: "The AI only words the message. The facts in it come from the rule that fired, so it can't invent a number or a session." },
  { icon: Send, title: "You send", body: "Nothing reaches a client until you press send. You can edit every draft, there's an undo window, and every send is in an audit log." },
];

const FEATURES: { icon: typeof Eye; title: string; body: string }[] = [
  { icon: Sunrise, title: "Daily briefing", body: "One list of who needs you today: mentioned pain, waiting on a reply, a check-in worth a look, no session in N days, engagement dropped, high stress with low energy, a stalled lift, a new PR, missed check-ins. Each with \"Why am I seeing this?\"." },
  { icon: ClipboardCheck, title: "Check-ins", body: "Weekly or fortnightly, with your own questions. Answers are sorted by rule into Needs attention, Worth a look and Routine, and you can reply to the routine ones in bulk." },
  { icon: FileSpreadsheet, title: "Spreadsheet import", body: "Bring your roster over from .xlsx or .csv. Clients who haven't joined yet come in as \"Not joined\" with their history, and the whole import can be undone." },
  { icon: MessageSquareText, title: "Ask Anakin", body: "Ask questions about your roster in plain English, like \"Who mentioned pain in the last 14 days?\". Anakin reads, answers and can draft a message. It can't send one." },
  { icon: ShieldAlert, title: "Contraindications", body: "When a client has an injury on file, loaded movements for that pattern are refused until you clear them. The same deterministic rule shows up in the briefing, in programs and in the client's app." },
  { icon: BarChart3, title: "Monthly reports", body: "Built by rules from the logged data: sessions, adherence, PRs from estimated 1RM, bodyweight change. Clients are labelled Progressing, Plateau or Regressing, with the numbers behind it." },
  { icon: CalendarCheck, title: "Bookings", body: "Sessions with credits and reminders, so you can see who has sessions left and who's booked." },
  { icon: CreditCard, title: "Billing at 0% platform fee", body: "Charge clients through your own Stripe account. Axiom takes no cut; you pay only Stripe's processing fees." },
];

const MORE = [
  "Roster with statuses: Might need support, New, On plan, Paused, Not joined",
  "Engagement trend per client",
  "Program builder, plus \"Generate with Axiom\" for a first draft",
  "Private notes and progress photos",
  "Inbox, leads page and retention view",
  "Team accounts for more than one coach",
];

/** Capability outcomes: what the trainer can do. Not statistics. */
const OUTCOMES = [
  "Start the day with a list of who needs you and why, instead of opening every client.",
  "Clear routine check-ins in one pass and spend your time on the ones that need a reply.",
  "See who has gone quiet, with the rule that flagged them, without scrolling through every thread.",
  "Send a monthly report without building it by hand.",
  "Program around a client's injury without having to remember it in every session.",
  "Keep every word that reaches a client your own: drafts are suggestions, sending is yours.",
];

const CLIENT_APP = [
  "Anakin, an AI coach they can talk to, which proposes program changes and waits for them to confirm",
  "Nutrition logging from a meal photo, a barcode, a nutrition label or a chain restaurant menu",
  "Form check from a video, and a lift diagnostic for a stuck lift",
  "Their program, sessions and check-ins in one app",
];
const TRAINER_SEES = ["Workouts", "Check-ins", "Bodyweight", "Program", "Injuries"];

interface CompRow { label: string; axiom: string; trainerize: string; truecoach: string; everfit: string }
export const COMPARISON: CompRow[] = [
  { label: "Price to the trainer", axiom: "Free. 0% platform fee; Stripe processing fees only", trainerize: "~$5–$250+/mo, tiered", truecoach: "~$20–$150+/mo, tiered", everfit: "Free for a few clients, then tiered" },
  { label: "Priced by number of clients", axiom: "No", trainerize: "Yes", truecoach: "Yes", everfit: "Yes" },
  { label: "Built around", axiom: "Watching the roster for you", trainerize: "Delivering programs", truecoach: "Delivering programs", everfit: "Delivering programs" },
  { label: "Reading check-ins", axiom: "Sorted by rule: Needs attention, Worth a look, Routine", trainerize: "You read each one", truecoach: "You read each one", everfit: "You read each one" },
  { label: "Noticing who went quiet", axiom: "Flagged in the daily briefing, with the reason", trainerize: "You notice", truecoach: "You notice", everfit: "You notice" },
  { label: "Messages to clients", axiom: "Drafted from rule-backed facts; sent only when you press send", trainerize: "You write and send", truecoach: "You write and send", everfit: "You write and send" },
];

const FAQ: { q: string; a: ReactNode }[] = [
  { q: "Is it free for trainers?", a: "Yes. There's no subscription for trainers and a 0% platform fee on what you charge clients. If you bill through your own Stripe account, Stripe's normal processing fees apply." },
  { q: "Is AI messaging my clients?", a: "No. The AI drafts; you decide. Nothing is sent to a client until you press send, there's an undo window after you do, and every message is in an audit log. Ask Anakin can answer questions about your roster and draft, but it can't send." },
  { q: "When do I get access?", a: "We're inviting coaches in batches so each one gets a proper setup. Join the list and we'll email you when it's your turn. There's no fixed date yet." },
  { q: "Do my clients need Pro?", a: "No. Clients use the normal Axiom app, and the free tier works for training with you. Pro unlocks the AI coach, Anakin, for clients who want it." },
  { q: "Can I bring my current clients over?", a: "Yes. Import a .xlsx or .csv of your roster. Clients who haven't joined yet show as \"Not joined\" with their history, and you can undo the import." },
  { q: "Does Axiom give medical advice?", a: "No. Injury rules only stop loaded movements for a pattern you've marked as injured until you clear them. Assessment and clearance stay with you and the client's healthcare provider." },
];

// ─── Small pieces ────────────────────────────────────────────────────────────

function Eyebrow({ icon: Icon, children }: { icon: typeof Eye; children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground mb-5">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </div>
  );
}

function SectionHeading({ icon, eyebrow, title, sub }: { icon: typeof Eye; eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-10 sm:mb-12">
      <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{title}</h2>
      {sub && <p className="text-muted-foreground mt-3 max-w-2xl text-[15px] leading-relaxed">{sub}</p>}
    </div>
  );
}

const inputCls = "w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-foreground/20";

function Field({ id, label, optional, children }: { id: string; label: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}{optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Signup form ─────────────────────────────────────────────────────────────

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string } | { kind: "done"; email: string; alreadyOnList: boolean };

export function CoachSignupForm({ initialEmail = "", source }: { initialEmail?: string; source?: string }) {
  const [f, setF] = useState<CoachSignupFields>({ ...EMPTY_FIELDS, email: initialEmail });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const set = <K extends keyof CoachSignupFields>(k: K, v: CoachSignupFields[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { if (initialEmail) setF((p) => (p.email ? p : { ...p, email: initialEmail })); }, [initialEmail]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!f.email.trim()) return setStatus({ kind: "error", message: "Please enter your email." });
    if (!f.marketingConsent) return setStatus({ kind: "error", message: "Please tick the box so we can email you about the beta." });
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`${API_BASE}/coach-beta/signup`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupPayload(f, source)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = res.status === 429
          ? "Too many tries from this network. Please try again in an hour."
          : (typeof data?.error === "string" ? data.error : "Something went wrong. Please try again.");
        return setStatus({ kind: "error", message });
      }
      setStatus({ kind: "done", email: f.email.trim(), alreadyOnList: !!data?.alreadyOnList });
    } catch {
      setStatus({ kind: "error", message: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  if (status.kind === "done") {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center" role="status" data-testid="coach-signup-success">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10" aria-hidden />
        <h3 className="text-xl font-semibold mb-2">{status.alreadyOnList ? "You're already on the list" : "You're on the list"}</h3>
        <p className="text-muted-foreground">
          {status.alreadyOnList
            ? "We've updated your details. "
            : <>Check your inbox: we've sent a confirmation to <strong className="text-foreground">{status.email}</strong>. </>}
          We invite coaches in batches, and your invite will come to that address. Questions? Reply to the confirmation email.
        </p>
      </div>
    );
  }

  const sending = status.kind === "sending";
  return (
    <form onSubmit={onSubmit} noValidate className="rounded-2xl border bg-card p-6 sm:p-8 space-y-4" aria-label="Join the coaching beta list">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cb-name" label="Name">
          <input id="cb-name" className={inputCls} autoComplete="name" maxLength={80} value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id="cb-email" label="Email">
          <input id="cb-email" type="email" required className={inputCls} autoComplete="email" maxLength={254} value={f.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field id="cb-platform" label="Main social platform" optional>
          <select id="cb-platform" className={inputCls} value={f.socialPlatform} onChange={(e) => set("socialPlatform", e.target.value)}>
            <option value="">Choose one</option>
            {SOCIAL_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field id="cb-handle" label="Handle" optional>
          <input id="cb-handle" className={inputCls} placeholder="@yourhandle" maxLength={100} value={f.socialHandle} onChange={(e) => set("socialHandle", e.target.value)} />
        </Field>
        <Field id="cb-type" label="How you coach" optional>
          <select id="cb-type" className={inputCls} value={f.coachingType} onChange={(e) => set("coachingType", e.target.value)}>
            <option value="">Choose one</option>
            {COACHING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field id="cb-count" label="Clients right now" optional>
          <select id="cb-count" className={inputCls} value={f.clientCount} onChange={(e) => set("clientCount", e.target.value)}>
            <option value="">Choose one</option>
            {CLIENT_COUNTS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field id="cb-today" label="What you use today" optional>
          <input id="cb-today" className={inputCls} placeholder="e.g. Trainerize, spreadsheets, WhatsApp" maxLength={200} value={f.platformToday} onChange={(e) => set("platformToday", e.target.value)} />
        </Field>
        <Field id="cb-website" label="Website" optional>
          <input id="cb-website" type="url" className={inputCls} placeholder="https://" maxLength={200} value={f.website} onChange={(e) => set("website", e.target.value)} />
        </Field>
      </div>
      <Field id="cb-message" label="Anything you'd like us to know" optional>
        <textarea id="cb-message" rows={3} className={inputCls} maxLength={1000} value={f.message} onChange={(e) => set("message", e.target.value)} />
      </Field>

      {/* Honeypot: people never see or fill this; bots do and the server drops them. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="cb-company">Company</label>
        <input id="cb-company" name="company" type="text" tabIndex={-1} autoComplete="off" value={f.company} onChange={(e) => set("company", e.target.value)} />
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-foreground"
          checked={f.marketingConsent}
          onChange={(e) => set("marketingConsent", e.target.checked)}
          aria-describedby="cb-consent-note"
          data-testid="coach-consent"
        />
        <span>
          Email me about the beta and launch. <span id="cb-consent-note" className="text-muted-foreground">You can unsubscribe from any email. See our <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.</span>
        </span>
      </label>

      {status.kind === "error" && <p role="alert" className="text-sm text-destructive">{status.message}</p>}

      <Button type="submit" size="lg" className="w-full rounded-xl sm:w-auto" disabled={sending}>
        {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Joining…</> : <>Join the beta list <ArrowRight className="ml-2 h-4 w-4" aria-hidden /></>}
      </Button>
    </form>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CoachesPage() {
  const { user, features, loading } = useAuth();
  const [, setLocation] = useLocation();
  const isTrainer = !loading && !!user && features.personalTraining;
  const [source] = useState(() => (typeof window !== "undefined" ? sourceFromSearch(window.location.search) : undefined));

  useEffect(() => {
    if (isTrainer) setLocation(PT_ROSTER_PATH, { replace: true });
  }, [isTrainer, setLocation]);

  if (isTrainer) return null;

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="For coaches"
        canonical="/coaches"
        description="Axiom for personal trainers: a daily briefing of who needs you and why, check-ins sorted by rule, drafts you approve before anything sends, and 0% platform fee. Join the beta list."
      />
      <Navbar />

      {/* Hero */}
      <section className="py-16 sm:py-24">
        <div className="container-tight max-w-3xl">
          <Eyebrow icon={Users}>For personal trainers · Beta</Eyebrow>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-5">
            Coach more clients without losing the detail
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg leading-relaxed mb-8 max-w-2xl">
            Axiom watches your roster by rule, tells you who needs you today and why, and drafts the message.
            Nothing reaches a client until you press send. It's free for trainers, with a 0% platform fee.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button size="lg" className="rounded-xl text-base px-8" asChild>
              <a href="#signup">Join the beta list <ArrowRight className="ml-2 h-4 w-4" aria-hidden /></a>
            </Button>
            <Button size="lg" variant="outline" className="rounded-xl text-base px-8" asChild>
              <a href="#how">How it works</a>
            </Button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-16 sm:py-24 border-t bg-muted/30">
        <div className="container-tight">
          <SectionHeading icon={Lightbulb} eyebrow="How it works" title="Watch, explain, draft. You send." sub="Rules decide who shows up in your briefing. The AI only puts the message into words." />
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border bg-background p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background text-sm font-bold">{i + 1}</span>
                  <s.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                </div>
                <h3 className="font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 sm:py-24 border-t">
        <div className="container-tight">
          <SectionHeading icon={ClipboardCheck} eyebrow="The dashboard" title="Everything a coaching business runs on" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((ft) => (
              <div key={ft.title} className="rounded-2xl border bg-card p-6">
                <ft.icon className="h-5 w-5 mb-3" aria-hidden />
                <h3 className="font-semibold mb-2">{ft.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{ft.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-2xl border bg-muted/30 p-6">
            <h3 className="font-semibold mb-3">Also included</h3>
            <ul className="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
              {MORE.map((m) => <li key={m} className="flex gap-2"><Check className="h-4 w-4 mt-0.5 shrink-0 text-foreground" aria-hidden />{m}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* Outcomes (capabilities) */}
      <section className="py-16 sm:py-24 border-t bg-foreground text-background">
        <div className="container-tight">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-10">What you can do with it</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {OUTCOMES.map((o) => (
              <li key={o} className="rounded-2xl border border-background/15 bg-background/5 p-5 text-[15px] leading-relaxed text-background/85">{o}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* What clients get */}
      <section className="py-16 sm:py-24 border-t">
        <div className="container-tight grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading icon={Smartphone} eyebrow="What your clients get" title="The full Axiom app" sub="Clients use the same Axiom app everyone else does. You don't have to build or brand anything." />
            <ul className="space-y-3">
              {CLIENT_APP.map((c) => <li key={c} className="flex gap-3 text-[15px]"><Check className="h-4 w-4 mt-1 shrink-0" aria-hidden />{c}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl border bg-card p-6 self-start lg:mt-24">
            <h3 className="font-semibold mb-1">What you see from their app</h3>
            <p className="text-sm text-muted-foreground mb-4">Logged by the client, visible on your dashboard.</p>
            <div className="flex flex-wrap gap-2">
              {TRAINER_SEES.map((t) => <span key={t} className="rounded-full border bg-muted/50 px-3 py-1 text-sm">{t}</span>)}
            </div>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="py-16 sm:py-24 border-t bg-muted/30">
        <div className="container-tight">
          <SectionHeading
            icon={BarChart3}
            eyebrow="Why coaches switch"
            title="Delivery tools vs. a second pair of eyes"
            sub="Trainerize, TrueCoach and Everfit are built to deliver programs, priced by how many clients you have. You still read every check-in and notice who went quiet. Axiom does the watching, explains why, drafts, and never sends without you."
          />
          <div className="overflow-x-auto rounded-2xl border bg-background">
            <table className="w-full min-w-[640px] text-sm" data-testid="coach-comparison">
              <caption className="sr-only">Axiom compared with Trainerize, TrueCoach and Everfit</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="p-4 font-medium text-muted-foreground"><span className="sr-only">Feature</span></th>
                  <th scope="col" className="p-4 font-semibold">Axiom</th>
                  <th scope="col" className="p-4 font-medium text-muted-foreground">Trainerize</th>
                  <th scope="col" className="p-4 font-medium text-muted-foreground">TrueCoach</th>
                  <th scope="col" className="p-4 font-medium text-muted-foreground">Everfit</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((r) => (
                  <tr key={r.label} className="border-b last:border-0 align-top">
                    <th scope="row" className="p-4 text-left font-medium">{r.label}</th>
                    <td className="p-4 bg-foreground/[0.03]">{r.axiom}</td>
                    <td className="p-4 text-muted-foreground">{r.trainerize}</td>
                    <td className="p-4 text-muted-foreground">{r.truecoach}</td>
                    <td className="p-4 text-muted-foreground">{r.everfit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Competitor prices are approximate public list prices as of October 2026 and change often; check each company's site for current plans.
            Trainerize, TrueCoach and Everfit are trademarks of their owners. Axiom isn't affiliated with them.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-24 border-t">
        <div className="container-tight max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-8">Questions</h2>
          <div className="divide-y rounded-2xl border">
            {FAQ.map((item) => (
              <details key={item.q} className="group p-5">
                <summary className="cursor-pointer list-none font-medium flex items-center justify-between gap-4">
                  {item.q}
                  <span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <div className="mt-3 text-sm text-muted-foreground leading-relaxed">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Signup */}
      <section id="signup" className="py-16 sm:py-24 border-t bg-muted/30">
        <div className="container-tight max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Join the coaching beta list</h2>
          <p className="text-muted-foreground mb-8">We invite coaches in batches. Tell us a little about how you coach and we'll be in touch.</p>
          <CoachSignupForm initialEmail={user?.email ?? ""} source={source} />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
