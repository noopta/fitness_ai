# Proactive coach

Implements the design handoff **"Proactive Coach Flows v3"** (`axiom_agent_ui/…/design_handoff_axiom_agent_app/proactive_v3.pdf`, 30 Oct 2026): *the coach comes back with the work already done — and shows whether it worked.*

## Flags

| Env | Effect |
|---|---|
| `PROACTIVE_V2_ENABLED=1` | On for everyone (Pro only in practice — free users get G4). |
| `PROACTIVE_V2_USERS=a@b.com,uid` | Allowlist for the silent test. |
| `PROACTIVE_V2_DRY_RUN=1` | The reasoner runs; nothing is posted or pushed. Candidates land in `ProactiveEvent` with `channel='dryrun'` and in the log. |
| `CHAT_PHOTOS_ENABLED=0` | Turns photos in chat off (on by default when the agent is on). |

Requires `AGENT_ENABLED=true` and the v2 UI. New tables: `AgentThread`, `ProactiveEvent`, `ChatPhoto`, `SessionFlag` (`prisma db push` + `generate` together).

## Flow → module

| Design | Module | Notes |
|---|---|---|
| A1–A3 check-in, push, stop asking | `evidence.ts` → `reasoner.ts` → `gate.ts` → `deliver.ts` | Receipts are DB values; the model only cites ids. Push copy says why now, never what was noticed. Three exits always. |
| B1–B2 prepared work | `prepared.ts`, tool `propose_week_change` | Diff → program deterministically; Apply opens an experiment thread. |
| B3 outcome report | `outcome.ts` | Five states; copy says "fits", never "worked". |
| B4–B9 coach runs it | `prepared.ts`, `prefs.programOwner`, `context.ts` | Share sheet (B6), next-evening follow-up (B7), inbox recorded (B8 UI later), setting (B9). |
| B5 expiry | `prepared.ts::expirePreparedCards` | First affected session, else 48 h. One re-offer. |
| C Working on | `threads.ts`, `routes/proactive.ts` | Quote must be in the transcript. "That's wrong" logs a negative example. |
| D1–D3 screens | `screens.ts`, `insight.ts` | One endpoint `GET /coach/agent/screens`. D3 tests an approved pair list only. |
| E photos (v4) | `photos.ts`, `geminiService.describeChatPhoto` | Blob store first; the model reads a fenced description. The E1 tile (Meal/Label/Program) is an `intent` the kind resolver honours. |
| H form check in chat (v4) | `formCheck.ts`, `routes/formAnalysis.ts` completion, `POST /coach/agent/form-check/sent` | The clip uses the existing upload → poll pipeline; the result turn carries receipts and the FRM-03 card (still, faults, Proposed cue). `form.add_cue` writes the cue onto the lift in the program, undoable. |
| F1–F2 controls | `prefs.ts`, photo routes | Private photos go with their descriptions. |
| G2 sparse data | `gate.ts` | 6 sessions / 3 meal days; follow-ups exempt. |
| G3 weight cut | `safety.ts` | **Thresholds need clinician review** (`CUT_RATE_PCT` etc.). |
| G4 free users | `gate.ts` | Nothing in chat; safety as a screen line. |

`sweep.ts::runProactiveHour` runs hourly from `index.ts`: per-user local 7 am evaluation, expiry, safety, photo retention. `POST /coach/agent/proactive/dry-run` runs it for yourself.

## Tests

`src/__tests__/proactive*.test.ts` — one file per flow, plus `proactiveSweep.test.ts` end to end on `helpers/memPrisma.ts`. Client helpers: `packages/agent-ui-core/__tests__/proactive.test.ts`.

## Launch order (from the review)

1. Silent test: allowlist the active Pro users with `PROACTIVE_V2_DRY_RUN=1`, read the dry-run rows, rate "would I send this?".
2. Turn delivery on for founder accounts, then Pro.
3. Clinician review of G3 before any free user sees it.
