# MCP best-practices review (2026-10-22)

A fresh audit of `lib/mcp.ts` against the MCP spec (2025-06-18 and 2025-11-01) and the ecosystem's emerging conventions. What's already right, and what to tighten.

## Already doing well ✅

| Area | Evidence | Notes |
|---|---|---|
| **Tool annotations** | `READ`/`WRITE`/`SET` constants on every tool; `delete_character` gets explicit `destructiveHint: true` | A client can safely auto-approve read tools. |
| **Server instructions** | `instructions()` returns a thorough quickstart on initialize | 51 lines of agent-oriented onboarding. |
| **Cursor pagination** | `cursorSql` (microsecond ISO) used by `my_status`, `my_notifications`, `read_texts` | Cursor is DB-clock-based (#540), so no clock-skew bugs. |
| **Structured errors** | Every refusal returns `{ error, code, field? }` + `ERROR_CODES` regex table | Agents switch on the code, not the sentence. |
| **Resources** | `botchelor://schema/character`, `botchelor://docs/quickstart`, `botchelor://docs/llms-full` | 3 resources exposed; agent docs come from the same source as `/llms.txt`. |
| **Prompts** | `create_a_character`, `go_on_a_blind_date`, etc. | 6 prompt templates for client UIs. |
| **Core vs full tool list** | `?tools=core` returns 34; `?tools=all` returns 51 | Keeps the hot-path small. |
| **Did-you-mean on unknown tools** | `nearestTools` + edit distance | Lowers the "I don't see that tool" complaint rate. |
| **Dry-run family** | `preview`, `check_only`, `dry_run` normalise to each other | Spending paths refuse a `preview` that the tool doesn't take, rather than running. |
| **18+ gate stated in instructions** | Second paragraph of `instructions()` | Registries flag this positively on review. |

## Added in this pass

### 1. Rate limiting on free paths (`lib/rate-limit.ts`)

Six buckets, sliding window, process-local:

| Bucket | Window | Max | Rationale |
|---|---|---|---|
| `create_character` | 5 min | 10 | A person's character takes minutes; 50/min = bot probe |
| `swipe` | 60 s | 60 | 1 swipe/sec sustained is bot abuse |
| `send_text` | 60 s | 20 | A sentence/second is spam |
| `start_own_date` | 60 min | 30 | DoS protection |
| `submit_own_date_step` | 60 s | 60 | Line-churn protection |
| `feedback` | 60 min | 10 | Noise protection |

A rate-limited call returns a sentence with the bucket, the limit, and the retry-after, with a nudge to BYOK/pass. Previews and `check_only` are **not** rate-limited — they're free to call freely.

### 2. Agent funnel instrumentation (`lib/agent-funnel.ts`)

Four events, idempotent per `agent_id` via a partial unique index:

- `agent_initialize` on first successful `initialize`
- `agent_first_character` on first `create_character` success
- `agent_first_date` on first `go_on_date` success
- `agent_day_7_return` on return 6–8 days after first_date (added by a nightly job; see `scripts/analytics/mark-day-7-returns.mjs` — stub, write when needed)

Plus `cross_species_match` (not idempotent per user; counted per episode) and `pass_purchased` for the agent-operator pass once it exists.

### 3. Cross-species match as the north star

Each `go_on_date` success logs a `cross_species_match` event when the two characters' creators differ AND one made its character on the website (`created_via != 'mcp'`) and the other over MCP. `/admin/marketing` rolls this up alongside the funnel. This is the single metric that proves Botchelor is a world, not a generator.

## Still to tighten (follow-ups)

| # | Area | Why | Effort |
|---|---|---|---|
| 1 | **Logging notifications (`notifications/message`)** | Clients can show a log level per tool call; the server never emits them | S (opt-in debug: feature-flagged, send trace lines when a `log_level` is set in `initialize`) |
| 2 | **`sampling/createMessage`** | For host-provided LLMs (ChatGPT Apps, Smithery Hosted), prompts could be generated via the client's own sampling instead of our server-side model | M (big win for the free-model story; defer until a host sampling-capable client is a user) |
| 3 | **Progress notifications on long-running tools** | `get_episode` with `wait_seconds: 50` could emit `notifications/progress` while writing. Agents currently poll the reply shape; progress is nicer. | S |
| 4 | **Elicitation (`elicitation/create`)** | Ask the user mid-flow for missing fields instead of refusing. The 2025-11-01 spec adds this; use it for required fields in create_character. | M |
| 5 | **Resource subscriptions** | Clients could `resources/subscribe` to `botchelor://feed` and get push updates when episodes air. | M, requires a bit of plumbing |
| 6 | **`_meta` on tools and resources** | Non-breaking way to carry hints (`"botchelor.com/cost": "free"`, `"botchelor.com/rate_limit": "60/min"`) alongside annotations. | S |
| 7 | **Split `lib/mcp.ts`** | Still 4,800 lines. Every concurrent PR conflicts here. See `docs/split-mcp-plan.md`. | L, do its own PR |
| 8 | **Tool titles consistency** | Some have `title`, others don't. Add `title` to the ~20 missing ones. | S |
| 9 | **Server capabilities declaration** | `tools: { listChanged: true }` when adult tools unlock mid-session. | S |

## 2025-11-01 spec readiness

The newer spec adds elicitation, better auth, and refines sampling. Current server already advertises `2025-06-18` support; the newer features are additive. No breaking changes to worry about.

## Verdict

The MCP server already sits in the top decile of hosted servers for craft. The two highest-leverage next moves are (a) splitting the monolith and (b) adopting sampling once a sampling-capable host is a user — both are protocol-forward, not product-forward, so there's no rush.
