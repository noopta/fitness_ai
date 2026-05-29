# Agentic Anakin (`agentic-main` branch)

Built autonomously overnight on the `agentic-main` branch / worktree. **Nothing
here touches `main`, production, or existing services.** Every entry point is
gated behind feature flags that default OFF, so this is inert until a
deliberate cutover.

## What it is

Moves Anakin from a Stage-2 conversational assistant to a Stage-5 (proactive)
agent: a Claude tool-use loop with unified context, durable memory, multi-turn
persistence, cross-domain tools, and a proactive trigger layer.

## Files

| File | Role |
|---|---|
| `types.ts` | `AgentTool`, `UserContext`, `AgentTurnResult` |
| `tools.ts` | Tool registry — wraps existing services/DB as callable tools |
| `context.ts` | Per-turn `UserContext` assembler + `renderContext()` |
| `memory.ts` | Durable cross-session memory (`AgentMemory` model) |
| `conversation.ts` | Rolling per-user transcript (`AgentConversation` model) |
| `loop.ts` | The brain — Claude tool-use loop |
| `proactive.ts` | Stage-5 trigger evaluation (decision-only, never sends) |
| `../routes/agent.ts` | `POST /api/coach/agent`, `GET /api/coach/agent/memory` |

## Tools the agent has

**Read:** `read_profile`, `read_nutrition_today`, `read_body_weight_trend`,
`read_recent_workouts`, `read_wellness`, `read_latest_diagnostic`,
`query_research`
**Write:** `log_meal`, `log_body_weight`, `log_workout`, `log_wellness`,
`remember`
**Proactive-only:** `propose_notification`

Tools delegate to the real implementations (e.g. `log_meal` uses the same
`parseMealMacros` as the Describe sheet; `read_latest_diagnostic` reflects the
deterministic engine). The agent CALLS authoritative code, it doesn't re-derive.

## Key decisions (please sanity-check)

1. **Raw `@anthropic-ai/sdk`, NOT `@anthropic-ai/claude-agent-sdk`.** The
   higher-level agent SDK peer-requires `zod@4`; the whole backend is on
   `zod@3` (every route schema). Migrating zod 3→4 is a breaking,
   backend-wide change I would not do blind overnight. The manual tool-use
   loop is ~120 lines, gives more control, and fits Express better. If you
   specifically want the agent SDK, that's a deliberate zod-4 migration task.
2. **Model:** `claude-sonnet-4-6` (env `AGENT_MODEL` to override). Opus is
   overkill for coaching turns.
3. **Memory = flat note list** (FIFO, cap 40). Simple for v1; can become
   typed (goals vs. constraints vs. prefs) if too lossy.
4. **Conversation persists text only**, not tool plumbing — current data
   comes from the fresh context each turn, so replaying old tool calls would
   be stale noise. Capped to last 24 messages.

## Endpoints

- `POST /coach/agent` — one turn, JSON `{ reply, toolsUsed, iterations }`.
  Same `reply` field as the old `/coach/chat`, so mobile is a one-line swap.
- `POST /coach/agent/stream` — SSE; events `status` / `delta` / `done`.
  Use for web (mirrors `/coach/chat/stream`).
- `POST /coach/agent/task/:taskId` — purpose-built tasks (program_adjustment,
  life_happened, plateau, meal_suggestions, daily_tips, weekly_review,
  injury_intake, research_apply).
- `POST /coach/agent/proactive/:trigger` — decision-only, never sends.
- `GET  /coach/agent/memory` — what the agent remembers about the user.

All gated by `AGENT_ENABLED` + `AGENT_USER_ALLOWLIST`; turn endpoints are
rate-limited per day.

## Cost — READ THIS

This path bills the **Anthropic API per token. It is NOT covered by Claude
Max** (Max can't authenticate a backend service). Rough cost ≈ $0.03–0.15 per
turn on Sonnet. It's $0 until you flip `AGENT_ENABLED`, because the routes
404 while off.

## How to turn it on (NOT done — needs you)

1. `cd backend && npx prisma db push` — materialise `AgentMemory`,
   `AgentConversation`, and the `User.agentTurns*` counters (additive, safe).
2. Set env in `backend/.env`:
   - `ANTHROPIC_API_KEY=...`
   - `AGENT_ENABLED=true`
   - **`AGENT_USER_ALLOWLIST=<your-user-id>`** — dogfood for JUST your
     account in production. Everyone else 404s and stays on the existing
     coach. Remove (or leave empty) to open to all once you trust it.
   - (optional) `AGENT_MODEL=claude-sonnet-4-6`
   - (optional) `AGENT_FREE_DAILY_LIMIT=10`, `AGENT_PRO_DAILY_LIMIT=200`
     — per-day turn caps (cost control; every turn is a real API call).
   - leave `AGENT_PROACTIVE_ENABLED` unset/false until you've watched
     proactive decisions in logs and trust them
3. Restart the service. `POST /api/coach/agent { "message": "..." }` now works.
4. Smoke it as yourself before exposing to anyone.

## What's deliberately NOT done

- **No production cutover.** Existing OpenAI Anakin (`coachThreadId`) is
  untouched; this runs alongside behind the flag.
- **No OpenAI→Claude migration of existing features** (plan gen, diagnostic
  interview, meal parse). That's a tested, per-feature swap for later, not a
  blind overnight rip-out.
- **Proactive delivery is not wired into the cron.** `evaluateProactiveTrigger`
  exists and is tested, but no scheduler calls it yet, and delivery is double-
  gated. Wiring it into the existing notification cron is the next step once
  you've reviewed.
- **No live API calls were made building this** — all 25 agent tests mock the
  Anthropic client, so $0 was spent overnight.

## Tests

`npx vitest run src/__tests__/agent.test.ts` — 25 tests, all mocked (zero
spend): tool executors, context assembly, memory dedup, conversation
round-trip + trim, the full tool-use loop (tool_use→end_turn, error feedback,
iteration ceiling, extra-tools path), and proactive decisions. Full backend
suite: 242/242.
