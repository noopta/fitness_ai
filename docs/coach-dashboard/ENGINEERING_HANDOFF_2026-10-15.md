# Axiom Coach Dashboard — Engineering Handoff

Date: 2026-10-15
Audience: Engineering team
Companion docs: `coach-dashboard-design-brief.md` (product/design), `gaps-and-pain-points.md` (30+ pain points), `market-research-2026-10-15.md` (competitor landscape)

---

## 1. Objective

Build the trainer-facing web platform that makes Axiom the hub of an online coach's business. Every build item below exists to kill a specific, validated competitor gap. If an item doesn't map to a gap, it doesn't get built.

## 2. Guiding architecture decisions

These are load-bearing. Every phase assumes them.

1. **The dossier is the atomic unit.** One client = one dossier = one source of truth. Every feature reads from and writes to it. No feature owns its own copy of client data.
2. **Contraindications are structured data enforced at the rules-engine layer, not the UI layer.** Injuries/conditions are entities (body part, severity, source, date, clearance). The rules engine rejects any program or exercise that conflicts, no matter where the request comes from (UI, AI generation, API). This is the safety moat and it must be impossible to bypass by accident.
3. **Every AI output ends in a trainer decision.** Approve, edit, or dismiss. Nothing auto-sends to clients and nothing auto-changes a program. Every AI-suggested change writes an audit record: suggested by AI, approved by trainer, timestamp.
4. **Client-type agnostic.** Whether the client uses the Axiom app or a no-install web link is a data-source label, never a UI fork. The trainer's workflow is identical.
5. **Async AI, sync UI.** Briefings generate overnight; summaries stream in. First paint never waits on the LLM. Stale-data states are designed, not error states.
6. **No-install identity = per-client revocable token links.** Mobile-web first. This underpins every client-facing flow, so it ships in Phase 0.

## 3. Gap → build mapping

| # | Validated gap | What Axiom builds in-house | Phase |
|---|---|---|---|
| 1 | Fragmentation: business runs across 5+ tools, none is the hub | Unified dossier + chronological timeline; every touchpoint (check-in, program, message, video, photo) flows into it | 0–1 |
| 2 | Check-in overload: hours reading 20+ check-ins weekly | AI check-in engine: NLP extraction into structured signals + morning briefing with one-line summaries and draft replies | 1 |
| 3 | Fee resentment: 5% platform cuts, add-on mazes | Native billing on our Stripe rails, 0% platform fee, dunning included | 2 |
| 4 | Data lock-in as the incumbents' moat | Full structured export/import; "migrate in 10 minutes" as an acquisition feature, not a grudging CSV | 1 |
| 5 | Non-app clients unsupported | No-install web flows for check-in, program view, video/photo upload, messaging, reports (token links) | 0 |
| 6 | No client intelligence: AI is a generic workout generator | Morning briefing, Ask Axiom (NL roster query), engagement/churn signals, plateau detection | 1–3 |
| 7 | Nutrition theater: logs nobody coaches | Macro targets + weekly compliance rollup (MVP); meal-photo estimation + pattern flagging (V2) | 1 / 3 |
| 8 | No roster overview: "too many tabs, easy to miss something" | Briefing-first home; roster with engagement sparklines and filters | 1 |
| 9 | Programming is a 30–60 min/client time sink | Guardrailed AI program generation: LLM draft → rules-engine validation → trainer approval on the same builder canvas | 2 |
| 10 | Intake nobody fills out well; injuries live in free text | Conversational intake that probes vague answers; injuries as structured entities from day one | 1 |
| 11 | Churn discovered, not predicted | Engagement scoring + at-risk surfacing with suggested interventions (care language, never surveillance language) | 3 |
| 12 | Clients can't see progress as a story | AI monthly progress reports, trainer-approved before send | 3 |
| 13 | Lead rot in Instagram DMs | Lightweight lead capture → consult scheduling → follow-up (v2; marketplace matching in phase 3 turns this into the growth engine) | 3 |

## 4. Build phases

### Phase 0 — Foundation (ships first, unblocks everything)

- **Trainer auth + workspace.** Email auth, trainer profile (specialties, branding basics).
- **Client roster (B3 core).** CRUD clients, tags/groups, search/filter. The roster is the nav backbone.
- **Dossier data model.** Schema for: identity/contact, goals (structured: target, deadline, metric), contraindications (structured entities), program assignment, measurements, photos, notes, billing state. This schema is the contract every later phase builds on. Get it right.
- **No-install token links (A11 infra).** Per-client revocable secure links; link-scoped web views. Every client-facing surface in later phases hangs off this.
- **Ingestion paths.** Consumer-app data → dossier (exists via app event stream; wire it). Web-link submissions → dossier (new).

*Exit criteria: a trainer can sign up, add 5 clients, and each client can open their link and submit something that lands in the dossier.*

### Phase 1 — The daily loop (the demo and the habit)

- **Morning briefing (A1).** Overnight job: aggregate check-ins, logs, messages → signal extraction → red/yellow/green cards with inline actions (approve/message/open dossier/dismiss). Completable UI ("4 of 6 handled"). Reasoning expandable on every card.
- **Dossier UI (A2).** Header (photo, goal, phase, status dot) + AI living summary (regenerated on data change) + contraindication chips pinned in header + tabs (Overview, Timeline, Program, Check-ins, Measurements, Notes, Billing).
- **Unified timeline (A5).** Chronological feed of everything; filterable by type. Pure UX win, no AI required.
- **Ask Axiom (A3).** NL query bar over the roster with inline evidence per result; clarifies ambiguous queries instead of guessing.
- **Check-in engine (A6).** Trainer-configured cadence + question sets; client responds via app or web link (text/voice); AI extracts structured signals (soreness by body part, sleep, stress, motivation, pain flags); check-in inbox with draft replies in the trainer's voice; missed-check-in escalation.
- **Conversational intake.** Probing follow-ups on vague answers; completeness scoring; injuries auto-create contraindication entities.
- **Migration import.** CSV/program import from TrueCoach/Trainerize/Everfit exports. This is the switching-cost killer; treat it as a first-class feature.

*Exit criteria: a trainer with 20 clients can do their full morning triage in the product, in under 10 minutes.*

### Phase 2 — Programming + business

- **Program builder (B1).** Week/day/session structure, supersets/circuits/AMRAP, %1RM and RPE loading, drag-and-drop, copy across clients/weeks, templates. This canvas is also the render target for AI-generated programs. One canvas, not two.
- **Exercise library (B2).** Searchable/filterable, video demos, custom uploads, contraindication tags wired to the rules engine.
- **Guardrailed AI generation (A4).** Trainer describes the block in plain language (+ pre-filled structured selectors) → LLM drafts → rules engine validates against contraindications, equipment, progression bounds → rendered on the builder canvas with guardrail badges and per-decision annotations → explicit trainer approval, logged. Refusal states are a feature: show them confidently.
- **Billing (B7).** Packages/subscriptions/session credits, invoices, dunning (auto-retry + client nudge), revenue dashboard. 0% platform fee. Built on existing Stripe rails.
- **Scheduling (B8).** Availability slots, client self-booking, package decrement, reminders.
- **Branding basics (B10).** Trainer logo/colors on client-facing surfaces.

*Exit criteria: a trainer can program, bill, and schedule entirely inside Axiom and cancel their incumbent.*

### Phase 3 — Growth loops (V2, needs repository data)

- **Engagement & churn (A7).** Per-client engagement score + trend sparkline; at-risk surfacing with reasons and suggested interventions.
- **AI progress reports (A8).** Monthly client-facing narratives, trainer-approved before send.
- **Unified messaging inbox (A9).** All client threads in one place with per-thread context strips; AI draft replies, explicit send.
- **AI nutrition (B6).** Meal-photo macro estimation, weekly compliance pattern flagging.
- **Marketplace matching.** Trainer profiles + user profiles (see matching spec below); hard filters → AI soft-fit scoring → two-way recommendations; 15% first-month take on matched clients. Only viable once the repository has density; do not build before Phase 1 data is flowing.
- **Business analytics (B9).** MRR, churn, LTV, per-client profitability, offer performance.
- **Multi-coach workspaces.** Role permissions, client assignment, owner analytics. (IA must not block this; see design brief.)

## 5. Matching engine spec (Phase 3)

- **Trainer profile fields:** specialties (multi-select + free text), training style tags, languages, price band, availability windows, who they coach (gender/age/niche), cultural/religious fit markers (opt-in, e.g. Ramadan-aware programming, women-only coaching), timezone, format (online/hybrid).
- **User profile fields:** goals (structured), experience level, injuries, equipment access, budget band, schedule, language, explicit preferences (including background/cultural preferences the user states).
- **Pipeline:** hard filters (budget, language, contraindication compatibility, availability overlap) → AI soft-fit score (goal-specialty alignment, style compatibility, stated preferences) → ranked recommendations both directions.
- **Trainer-facing:** "Recommended clients" feed = high-intent users (consistent logging 30+ days with no trainer, completed intake quiz, explicit "find me a coach" signal).
- **Learning loop:** match accept/decline, booking, 90-day retention feed back into ranking weights.
- **Cold start:** explicit intake beats inference until density exists.

## 6. Buy vs build

- **Build:** everything in §4. It is the product and the moat.
- **Use existing:** Stripe rails (billing — already owned), OpenRouter (multi-provider LLM routing — already planned), Twilio/SES (transactional SMS/email delivery), push notification infra from the consumer app.
- **Do not build:** a custom video pipeline for the exercise library (use existing storage + streaming), a full CRM (Phase 3 needs are lightweight; integrate later if needed).

## 7. Explicit non-goals for now

Lead CRM beyond lightweight capture, content-repurposing for trainer marketing, win-back automation, full white-label apps, multi-language client surfaces (but keep i18n out of hard-coded layouts so it can land later).

## 8. Open technical questions

1. Separate domain/service for the trainer platform vs a mode in the existing web app?
2. Magic links vs lightweight client accounts for no-install identity (security/compliance call)?
3. How configurable is briefing logic per trainer (thresholds) vs opinionated defaults?
4. Billing: confirm 0% platform fee is the final call (competitive wedge; see market research).
5. What is the trainer onboarding "first 5 clients" flow shaped like, technically?
