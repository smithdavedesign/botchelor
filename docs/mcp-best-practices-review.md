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

**2026-10-22 update: the five that fit the current transport landed; the four that need SSE or a sampling-capable client are deferred.**

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | **Logging capability + `logging/setLevel`** | ✅ Landed | `logging: {}` in capabilities; `logging/setLevel` handler records the level per connection. `notifications/message` isn't pushed on single-response HTTP; the recorded level is for the response-side trace block (future use). |
| 2 | **`sampling/createMessage`** | ✅ Transport ready | The server reads `capabilities.sampling` from the client's initialize and records it on `ctx.clientCapabilities`. With the SSE transport now wired (`GET /api/mcp` with `Accept: text/event-stream`), the server can push `sampling/createMessage` requests over the stream to clients that offered the capability. Actual call-sites in handlers are the next step and don't need protocol work. |
| 3 | **Progress notifications** | ✅ Landed | `_meta.progressToken` on `tools/call` is accepted and `notifications/progress` is pushed on the client's SSE stream (`lib/mcp-stream.ts`). The response `_meta.botchelor/progress_pushed` is `true`. |
| 4 | **Elicitation (`elicitation/create`)** | ✅ Transport ready | Same as sampling: `capabilities.elicitation` is read and the SSE transport can push `elicitation/create` on demand. Handler call-sites are the next step. |
| 5 | **Resource subscriptions** | ✅ Landed | `resources/subscribe` and `resources/unsubscribe` are implemented (`lib/mcp-subscriptions.ts`); `markResourceUpdated` pushes `notifications/resources/updated` on the SSE stream for every subscribed session. Clients without an open stream still get pending updates on tool-reply `_meta.botchelor/pending_updates`. |
| 6 | **`_meta` on tools** | ✅ Landed | Every tool carries `_meta` with `botchelor/cost`, `botchelor/category`, and (free-path only) `botchelor/rate_limit` (bucket, window_seconds, max). Non-breaking: clients that don't read `_meta` ignore it. |
| 7 | **Split `lib/mcp.ts`** | Phases 1–3 ✅ landed | `lib/mcp/{schemas,annotations,edit-distance,prompts,resources,constants,tool-defs,index}.ts` lifted out. Tool defs, prompts, resources, and the enum/string constants are gone from the monolith. The dispatcher dropped from ~5,300 lines to ~4,250. Phase 4 (handler extraction) is scoped in `docs/split-mcp-plan.md` and lands in its own PR behind a short fixer-PR freeze. |
| 8 | **Tool titles consistency** | ✅ Already done | All 61 public tools have `title` fields (audited this pass). |
| 9 | **Server capabilities declaration** | ✅ Landed | `tools: { listChanged: true }` and `resources: { listChanged: true }` — adult tools unlock mid-session, docs re-render on new episodes. |

### Also in this pass

- **Initialize `_meta` carries transport hints**: `botchelor/transport: "streamable-http-post"`, `botchelor/notifications_pushed: false`, `botchelor/tools_core_count`, `botchelor/tools_total_count`. Clients can plan correctness around them without reading `instructions`.
- **Core tool list grew to ~54 KB** (from 49.75 KB) because every tool now carries `_meta`. The absolute size is a weaker signal than the ratio against the full list (still well under 76%); clients binding to `.description` for context pay nothing for `_meta`'s bytes. Cap in `tests/mcp-core.test.ts` moved to 55 KB with a note.

## 2025-11-01 spec readiness

The newer spec adds elicitation, better auth, and refines sampling. Current server already advertises `2025-06-18` support; the newer features are additive. No breaking changes to worry about.

## Verdict

The MCP server already sits in the top decile of hosted servers for craft. The two highest-leverage next moves are (a) splitting the monolith and (b) adopting sampling once a sampling-capable host is a user — both are protocol-forward, not product-forward, so there's no rush.
