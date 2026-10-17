# DPIA: LLM Routing of Health and Coaching Data (GDPR Art. 35)

Draft for counsel review. 16 October 2026. Controller: [LEGAL ENTITY NAME]. Assessor: founder. DPO: none appointed (decision to be recorded by counsel).
Supersedes nothing; complements `DPIA_FORM_VIDEO_2026-09.md` and `DPIA_ONBOARDING_FORM_HOOK_2026-09.md`.

## 1. Why a DPIA is required
Large-scale processing of special-category data (health: injuries, medical conditions, medications, hormonal factors, PAR-Q answers,
body measurements, meal logs, mood/sleep/stress) using novel technology (LLMs) with transfers to US processors, including minors 13-17.
Triggers Art. 35(3)(b) and EDPB criteria (sensitive data, vulnerable subjects, innovative technology, large scale).

## 2. Processing described
| Flow | Data | Route (code) | Provider / region |
|---|---|---|---|
| Coach agent chat (Anakin) | messages, profile, logs, injuries, check-ins, memory; tools can read conditions, medications, DOB | `backend/src/agent/loop.ts` (Anthropic SDK) | Anthropic, US |
| Program generation | conditions, medications, injuries, hormonal notes, PAR-Q, sex, 8-week logs | `chatComplete(..., { sensitive: true })` -> OpenAI direct (`services/chatClient.ts`) | OpenAI, US |
| Nutrition plan | targets, `medicalFlags`, diet | sensitive -> OpenAI direct | OpenAI, US |
| Notes parser, legacy chat stream | free-text notes, injuries | sensitive -> OpenAI direct | OpenAI, US |
| PT drafts / PT intake / PT programs | client names, trainer facts, client health notes | sensitive -> OpenAI direct (`personalTraining/drafts.ts`) | OpenAI, US |
| PT import column mapping | headers + few sample values, email/phone masked | Anthropic (`importMapping.ts`) | Anthropic, US |
| Non-health prompts (feed summaries, recipes, typed meal text) | no health data by design | OpenRouter, primary model pinned to `fireworks,together,deepinfra,baseten`, `allow_fallbacks: false`, `data_collection: 'deny'` | US hosts |
| Moderation, Whisper, embeddings | message/comment text, avatars, voice audio, chat text | OpenAI | US |
| Video/photo analysis | body video, stills, meal photos | Vertex AI / Gemini + GCS (1-day lifecycle) | Google, US |

Incident lever: `LLM_SENSITIVE_ROUTING=off` sends sensitive prompts back through OpenRouter. It must only be used with this DPIA re-opened.

## 3. Necessity and proportionality
- Purpose: personalised training and nutrition coaching the user requested (Art. 6(1)(b)); health data under explicit consent (Art. 9(2)(a)), recorded as `User.healthConsentAt` with `termsVersion '2026-10'` at signup or `POST /auth/consent`.
- Minimisation: prompts carry only what the feature needs; email and raw `coachProfile` JSON removed from legacy chat; PT import mapping sees masked samples.
- No training: all providers on business API terms that exclude training; OpenRouter restricted to `data_collection: deny` hosts.
- Retention: agent conversations kept while the account exists (user-visible history); deleted on immediate hard account deletion; backups 7 days (30 days off-box once enabled).
- Rights: export and delete in Settings (web and in-app); withdrawal of health consent stops health-dependent features.
- Minors: under-13 accounts deleted at DOB entry; 13-17 have reference stills disabled server-side. Calorie floors apply to everyone; there is no separate conservative nutrition path for 13-17 yet [ACTION].

## 4. Risks and mitigations
| Risk | Likelihood / severity | Mitigation | Residual |
|---|---|---|---|
| Health data reaching non-US or retaining hosts | was HIGH (pre-Oct DeepSeek on Alibaba/Baidu) | sensitive routing to OpenAI; OpenRouter pinned US + `data_collection: deny`; test coverage in chatClient tests | Low |
| Overrides (non-primary models) via throughput routing land on an unexpected host | Medium / Low (non-health only) | `data_collection: deny`; non-health by construction | Low; review if any override gets sensitive data |
| Misclassification: a prompt with health data not flagged `sensitive` | Medium / High | default new call sites to sensitive; code review checklist; grep audit each release | Medium -> [ACTION: lint rule] |
| Unsafe advice (injury, ED, minors, PEDs) | Medium / High | safety prompt in agent, untrusted-text envelope, calorie floors, moderation + crisis branch, "not medical advice" | Medium |
| Prompt injection via user/trainer content | Medium / Medium | untrusted-text envelope; no direct-apply tools (proposals need confirmation) | Low-Medium |
| Processor breach | Low / High | DPAs, US-only, minimal prompts; incident runbook | Low |
| Transfer to US invalidated | Low / Medium | DPF where certified, SCCs otherwise | Low |
| Provider abuse-monitoring retention (OpenAI 30 days) | High / Low | request ZDR; disclose | Low-Medium |

## 5. Outstanding actions
1. Signed DPAs for Anthropic, OpenAI, OpenRouter (fill `docs/DATA_PROCESSORS.md`).
2. Request zero-data-retention for Anthropic and OpenAI.
3. Enforce `sensitive` default for new `chatComplete` call sites.
4. Appoint/decline DPO in writing; appoint [EU REPRESENTATIVE].
5. Re-run this DPIA on any provider or routing change.

## 6. Sign-off
Assessor: ______ Date: ______ Counsel: ______ Prior consultation (Art. 36) required: No, provided residual risks above are accepted.
