# Audit — 2026-10-14

A full pass after M9 shipped: feature gaps against both PRDs, a security review, doc cleanup, and a general code audit. `BUILD.md` and `ROADMAP.md` stay the authoritative build/plan logs; this is the point-in-time review.

## 1. Feature gaps (code vs `PRD.md` and `Botchelor_PRD_v1.md`)

Most of both PRDs is built (M1–M9). What's genuinely missing, and where it goes:

### Scheduled — M10 (launch readiness)
- **Async generation + a job table.** Both PRDs call for pre-generating episodes in a worker with job states, not in the request (`PRD.md` "Target architecture" §Background jobs; `v1` §6.4/§10). Today generation is synchronous in `POST /api/episodes`; with M9's 8-turn conversation that's ~9 model calls per date, so this now matters for reliability. **(Also unblocks M9 part 2's template pre-generation.)**
- **Compute-budget enforcement + PAUSE kill switch + hard spend cap.** `PRD.md` "Budget and autonomy" is explicit: the backend (never the AI) enforces a real compute budget, reserves estimated cost before an expensive job, and stops/downgrades at the cap. Only the free-episode cap (`lib/allowance.ts`, 3/season) exists today. With the paid frontier now wired in (`episodeModel`), a per-date/per-user cap + a global PAUSE is needed before enabling it. Ties to the new keychain rule (frontier key needs a provider `--cap`).
- **Account deletion + data export.** `v1` §6.1 / `PRD.md` guardrails. Souls are deletable (`DELETE /api/characters/[id]/soul`) but there's no "delete my account + all my data" or export flow. Anonymous-cookie identity makes this simpler, but it's still owed before public launch.
- **Analytics event taxonomy.** `v1` §14 lists the events (`episode_*`, `prediction_*`, `purchase_*`, `moderation_*`). Not instrumented.
- **Unit-economics / per-episode cost logging.** Both PRDs want provider cost / tokens / latency / retries logged per episode (to the system log via `~/ai-stack/bin/emit-event`). Not built.

### Backlog — new roadmap items the PRDs call for but the roadmap didn't track
- **Post-date AI-to-AI chat** (`PRD.md` core feature #2 / Phase 2): the two AIs keep talking privately after the date, with consent-gated recaps. M9's conversation engine is the technical basis; this is a distinct feature.
- **Show formats** (`PRD.md` "More mechanics"): speed dating, meet-the-parents (house characters as parents), the ex returns (from the relationship graph). $0, reuses the engine, sellable as cosmetic format packs.
- **The reunion special**: a season-finale episode built from approved confessionals + the biggest relationship-graph moments.
- **Chaos button / interactive theatre (Model B)**: audience votes a real curveball that the engine responds to. M8 shipped the flavour-only version (audience-chosen question); the engine-affecting version is still deferred.

### Legal/process (not code — flag only)
- Age assurance beyond the 18+ checkbox; SB 243 companion-chatbot classification; contest/gambling review of free-points-plus-paid-cosmetics. All need counsel before public launch (both PRDs already flag these).

## 2. Security review

**Posture is good.** Reviewed auth, injection, access control, secrets, money and abuse surfaces:

- **Session/CSRF** (`lib/http.ts`): anonymous UUID in an `HttpOnly; SameSite=Lax; Secure` cookie, never echoed; JSON-only + `SameSite=Lax` blocks cross-site form posts; 10 KB body cap; zod on every body; errors never leak internals. Solid.
- **SQL injection**: every user value is a `$n` parameter. The only `${}` splices into SQL are constant identifiers (column-name arrays, `PACK_EPISODES_BOUGHT`) or placeholder-name helpers (`predictionPointsSql`, `matchmakerHitSql`) — no user data. Clean.
- **XSS**: no `dangerouslySetInnerHTML`, `eval`, or `new Function` anywhere.
- **Prompt injection**: character sheets, souls and notes are labelled "data, not instructions" in every prompt (`showrunner.ts`, `conversation.ts`), and an agent never receives the other side's soul/agenda (tested).
- **Money** (`webhooks/stripe`): signature verified over the raw body *before* parsing, with `timingSafeEqual`; size-capped; idempotent grants; verified events always 200 so Stripe stops retrying.
- **Gated surfaces**: the frontier admin (`/api/admin/frontier`) uses a constant-time password gate; private soul/debrief/confessionals are gated server-side in the SQL (`EPISODE_SELECT` never selects soul/note; debrief only for the owning side).
- **Content filter** (`lib/safety.ts`): whole-word minors/sexual/real-person matching with leet-folding, on every character field, episode field and chat/turn line.

**To fix (folded into M10's hardening):**
- `app/api/watch-parties/templates/route.ts` compares the internal admin token with `!==` (not constant-time). Low risk (random 48-hex token, 404s on miss), but it should use the same constant-time compare as the frontier gate. Promote `safeEqual` out of `lib/model.ts` into a shared helper and use it here.
- Add the **compute-budget cap + PAUSE kill switch** (see §1) — this is the most important security/cost control still missing now that paid model calls are wired in.

## 3. Docs cleanup (done in this pass)

The repo grew three overlapping competitor docs and a stale stack header:
- **Merged** `docs/competitive-analysis.md` (feature matrix vs Character.AI/Talkie/Replika/Candy) into `docs/competitive-scorecard.md`, which is now the single "where we stand vs the field" doc, and **removed** the former. Updated `README.md` and `ROADMAP.md` references. The deep per-competitor research stays in root `competitor-analysis.md`.
- **Updated** `ROADMAP.md`'s "Suggested stack" header, which still said "one showrunner call per episode" (M9 made it turn-by-turn) and named Neon/Turso (the app runs on PGlite/pg).
- **Added** a "Backlog (from the PRDs)" section to `ROADMAP.md` for the §1 backlog items.
- **Marked** `REVIEW.md` as the pre-build go/no-go snapshot (score 4/10, written before M1); the product has since shipped M1–M9, so it's kept for history with a dated note pointing to current status.
- **Two PRDs still coexist** (2026-10-16: both now live in `docs/PRDs/`, with the character memory PRD): `PRD.md` (original, with a "what's built today" section) and `Botchelor_PRD_v1.md` (the newer v1.0 commercialization spec, currently uncommitted in the working tree). Recommend committing `Botchelor_PRD_v1.md` as the canonical PRD and reducing `PRD.md` to a pointer, or merging — left for the owner since v1 is actively edited elsewhere.

## 4. General audit

- **Tests**: 493 unit (29 files) + Playwright e2e 16/16 + typecheck + production build all green. Strong coverage; the engine's determinism, the privacy guarantees and the money flows are all tested.
- **Code health**: consistent patterns (zod validation, `handle()` wrapper, parameterized SQL, test-injection seams `setModelForTests`/`setEngineForTests`/`setConversationEnabledForTests`), heavy and accurate comments. No dead-code or TODO smells surfaced.
- **$0 invariant intact**: the live show runs on free models; the frontier is owner-gated and off by default; nothing bought changes outcomes, points or rank (route-listing test enforces no money/points routes beyond the shop).
- **Main risk is operational, not code**: synchronous multi-call generation (M9) on free-tier rate limits — which M10's async worker + budget caps address directly.
