# Data Processor Register (GDPR Art. 28/30, CCPA service providers, MHMDA processors)

Draft for counsel review. Last updated 16 October 2026. Controller: [LEGAL ENTITY NAME], [POSTAL ADDRESS]. Contact: [PRIVACY CONTACT EMAIL — suggest privacy@axiomtraining.io].
EU representative: [EU REPRESENTATIVE]. Keep this table in sync with `frontend-v2/client/src/pages/privacy.tsx` section 4.

| Processor | Role / feature | Data categories | Health data? | Region | Transfer mechanism | Retention at processor | Code | DPA status |
|---|---|---|---|---|---|---|---|---|
| Anthropic (Claude) | Coach agent (Anakin), PT agent, PT import column mapping | chat, profile, training/nutrition logs, injuries, check-ins, long-term memory; masked spreadsheet samples | Yes | US | SCCs / DPF | API: no training; ZDR not yet enabled | `backend/src/agent/loop.ts`, `services/personalTraining/importMapping.ts`, `anakinAgent.ts` | [SIGNED? date] |
| OpenAI | All other health-data prompts (program gen, nutrition plans, notes parser, legacy chat, PT drafts) via `chatClient` sensitive routing; moderation; Whisper; embeddings | prompts with health data, audio, images (moderation), text | Yes | US | DPF / SCCs | API: no training; 30-day abuse monitoring unless ZDR | `services/chatClient.ts`, `moderationService.ts`, `llmService.ts`, `ragService.ts` | [SIGNED? date] |
| OpenRouter -> Fireworks, Together AI, DeepInfra, Baseten | Non-health prompts only (feed summaries, recipes, typed meal text) | non-health text | No (by design) | US (primary model pinned; overrides use throughput routing restricted to `data_collection: deny`) | SCCs | `data_collection: deny` (no retention/training) | `services/chatClient.ts` (`DEFAULT_OPENROUTER_PROVIDERS`) | [OpenRouter DPA?] |
| Google Cloud: Vertex AI / Gemini | Form-check + lift-diagnostic video, meal/label/order photos, food lookup with Search grounding, podcast embeddings | body video, stills, photos, food text | Yes | US | SCCs (Cloud DPA) | no training on customer data | `services/geminiService.ts`, `liftDiagnostic/video.ts`, `food/webFoodLookup.ts`, `formVideoScreeningService.ts` | Cloud DPA (click-through) |
| Google Cloud Storage | Transient video store | body video; quarantined objects | Yes | US | as above | 1-day lifecycle rule | `services/geminiService.ts` | as above |
| Stripe (+ Connect Express / Standard) | Web subscriptions, affiliate payouts (CAD), trainer client billing | name, email, userId, payment metadata, affiliate KYC/tax | No | US | DPF / SCCs | Stripe policy (tax records 7y) | `services/stripeService.ts`, `routes/payments.ts`, `affiliateService.ts`, `personalTraining/billing.ts` | Stripe DPA (in SSA) |
| Apple App Store / Google Play | In-app subscriptions (mobile), Sign in with Apple / Google | transaction IDs, purchase tokens, name, email | No | US | — (independent controllers for billing) | their policy | `routes/appleIap.ts`, `googleIap.ts`, `routes/auth.ts` | platform terms |
| SendGrid (Twilio) | All email | email, name, email content (PT check-ins) | Low | US | DPF / SCCs | activity ~30 days | `services/mailService.ts` | [SIGNED?] |
| Twilio SMS | Operational alerts to founder (signup/login incl. name + email, 5xx, quarantine summons) | name, email, error text | No | US | DPF / SCCs | Twilio log | `services/errorAlertService.ts`, `smsService.ts` | [SIGNED?] |
| PostHog | Product analytics; web only after consent, masked replay; no mobile replay | userId, events, device | Partial (event names) | US cloud | SCCs | plan retention; person deleted on account deletion | `backend/src/services/posthogClient.ts`, web/mobile `lib/analytics.ts` | [SIGNED?] |
| Sentry | Error monitoring (backend, mobile) | stack traces, request metadata, device | Indirect | US (us.sentry.io) | SCCs | plan retention | `backend/src/instrument.ts`, `mobileAlt/index.js` | [SIGNED?] |
| Expo | Push delivery, OTA updates | push token, notification text | Low | US | SCCs | transient | `services/notificationService.ts` | Expo terms |
| AWS (EC2/EBS) | Hosting, DB, nightly backups | everything | Yes | US | DPF / SCCs | backups 7 days; off-box encrypted 30 days once enabled | systemd `fitness-ai.service` | AWS DPA (in service terms) |
| Cloudflare | DNS, CDN, DDoS | IP, request metadata | No | Global edge / US | DPF / SCCs | logs short-lived | — | Cloudflare DPA |
| Open Food Facts / USDA FDC | Food lookups | barcode / food name only, no user data | No | FR / US | n/a (no personal data) | n/a | `services/food/openFoodFacts.ts`, `usdaLookup.ts` | n/a; ODbL attribution required |
| YouTube (embeds) | Exercise demo videos | viewer data under Google policy when played | No | US | n/a | n/a | `youtubeService.ts` | n/a |
| Telegram Bot | Founder growth metrics | aggregate metrics, no user data | No | — | n/a | — | `growth/telegramPublisher.ts` | n/a |

Not used: Firebase/FCM analytics, HealthKit/Health Connect, wearables, ad networks, data brokers.

Actions: collect signed DPAs (fill bracketed cells), enable Anthropic/OpenAI ZDR where available, review this table at every new integration.
