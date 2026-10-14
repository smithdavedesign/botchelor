# Roadmap: Botchelor

Stack (as built, $0 on free models):
- **Next.js (App Router) on Vercel**: one repo for pages and API routes. Live at botchelor.vercel.app.
- **Postgres via `pg` in production, PGlite in dev/tests**: characters, episodes, predictions and watch rooms are small relational data.
- **Free models through an OpenAI-compatible endpoint**: M9 made a date a turn-by-turn two-agent conversation (~8 calls), with the engine still deciding the outcome. A **gated frontier model** (`episodeModel`, owner-approved) is the paid-quality option, off by default.
- **Zod schema validation**: all model output and request bodies are untrusted and rejected unless valid.
- **Payments**: Stripe Payment Links + a signature-verified webhook (M3). Agents hold no card; David approves and pays.

## M1: One character, one date, one prediction (weekend)
Deliverables:
- Character form with 18+ age check and a content filter.
- Three labeled house characters.
- `POST /episodes` generates an episode from two character sheets in one model call.
- Episode page with a prediction form shown before the reveal.
- `POST /predictions` stores a pick; reveal scores it.

Exit criteria (checks a test could run):
- `POST /characters` with age 17 returns 422 and stores nothing; with age 18 returns 201.
- `POST /characters` whose bio contains a real-person name from a blocklist, or a sexual-content term, returns 422.
- `POST /episodes` with two valid characters returns 200 with `setting`, two `goals`, a `twist`, and `ending` in `{second_date, friends, disaster}`, and the body is at most 450 words.
- If the model returns invalid JSON twice, `POST /episodes` returns 502 and stores no episode.
- `POST /predictions` after an episode is revealed returns 409.
- Revealing an episode where the prediction matches `ending` gives the user exactly 10 points; a mismatch gives 0.
- No endpoint accepts a payment or a points transfer (a route listing test finds none).

## M2: Spectators and friends
Deliverables:
- Anonymous viewing, mutual-consent reveal of creator identity.
- Weekly leaderboard with a share/invite link; drama question (who is rejected, who leaves first).
- Report button and a block list; AI disclosure and crisis link on every episode.

Exit criteria:
- A creator's name never appears in the episode API response until both creators POST `/reveal` consent (test checks the field is absent before, present after).
- A leaderboard for a group of 3 users with scores 20, 10, 0 returns them in that order.
- `POST /reports` on an episode returns 201 and hides the episode from the feed after 3 distinct reporters.
- Every episode response includes `ai_generated: true`.

## M3: Paid items and a landing-page test
Deliverables:
- Premium house characters ($3–$8) and cosmetic profile frames, bought via Stripe checkout.
- Landing page with a waitlist for the AI-friendly roleplay audience.

Exit criteria:
- Buying any item never changes a user's points balance or leaderboard rank (a test buys every SKU and compares before and after).
- A webhook with a bad signature returns 400 and grants nothing.
- Points have no purchase, cash-out or transfer route (route listing test).

## M4: Seasons
Deliverables:
- Weekly seasons, friend leagues, badges.
- Episode packs ($5–$10) that add episodes, not points.

Exit criteria:
- A season closes at its deadline and badges are awarded to the top 3 in each league.
- Buying an episode pack adds exactly N episodes to the creator and changes no spectator's score.

## M5: the simulation (the "Full $0 vision", built)
The PRD's Soul-vs-Persona direction, built on free models at $0. The biggest change: outcomes move from the showrunner model to a deterministic, seeded engine (`lib/engine.ts`), so the model only narrates.

Deliverables:
- Deterministic outcome engine (ending, drama, box score, per-side satisfaction) from sheets + soul + date settings + a seed.
- Private soul per character (owner-only, content-filtered, deletable): optional on creation, with GET/PUT/DELETE.
- Per-date settings: autonomy, strategy, fictional game budget, secret agenda, a note in the pocket.
- The AI producer and a three-act date (first impressions, a revealing challenge, the decision).
- Private souls with a local-only option (engine-only, never sent to any model).
- The payoff: box score, private debrief, confessionals (host-approved), surprise score, persistent relationship graph.
- $0 spectator mechanics: guess the dealbreaker, matchmakers, Sliding Doors.

Exit criteria (tested):
- The engine is deterministic: same input + seed → same outcome; a tripped dealbreaker never yields a second date.
- A private soul never appears in any spectator-facing response, and its owner can delete it.
- A correct dealbreaker guess scores at reveal; a matchmaker proposal scores only on a later second date.
- Sliding Doors recomputes an alternate timeline from the stored seed with no model call, owner-only.
- Buying still changes no points, picks or rank; league/season boards remain the prediction game only.

Deferred (needs spend approval; see docs/upgrade-cost.md): frontier text model, portraits, video, and the Redis/BullMQ + S3/CDN stack.

## M6: next-level (competitive polish, built)
From a competitor review (docs/competitive-scorecard.md): close the visual/customization gap vs. Character.AI, Talkie and the Love Island app, at $0.

Deliverables (built):
- **Avatars** everywhere: deterministic SVG avatars (gradient + initials) on the episode matchup, the feed, the cast gallery, the builder preview and the shared box-score card. No image hosting, no real-person risk.
- **Character customization**: an appearance line, an avatar-colour picker with a live preview, and **image "training"** — pick a reference image and the browser derives both the avatar colour and a suggested appearance line from its palette; the image is never uploaded or stored.
- **Shareable contestant cards**: every character has a public card at `/characters/[id]` with its own Open Graph image and a copy-link button (the Talkie/Heartie "card" hook as a $0 growth loop). The cast gallery links to them.
- **Relationship progression stages** on the graph (strangers → sparks → an item).
- **A conversion landing page** rebuilt from the competitor playbook (aigirlfriends.ai, candy.ai): the product shown in the hero (avatar matchup + a live box score), a fast/free/no-sign-up CTA, a feature grid, honest proof, a cast preview and an FAQ.
- **A visual overhaul**: display type (Fraunces/Inter), a richer palette with real dark mode, gradients, a hero, a cast gallery and chips.
- **A full E2E suite** (`npm run e2e`, Playwright, every step of the product) and a **seed script** (`npm run seed`) for a lively demo database.

Next, still $0:
- Follows and a community gallery with category boards (most-shipped, best conversationalist, funniest failure); relationship progression labels on the graph; per-beat moment cards.

Deferred (spend + a moderation provider; see docs/competitive-scorecard.md and docs/upgrade-cost.md):
- **Uploading and storing an image / "training" the look.** Blocked on object storage, a vision model, and automated image moderation (CSAM scanning + a real-person classifier), because the product bans real people and a solo owner can't moderate raw uploads. The in-browser image tinting above is the safe $0 stand-in shipped now.

## M7: competitor-driven UX (from competitor-analysis.md)
A deep study of Zeta, Talkie, PolyBuzz and EchoSim (see `competitor-analysis.md`), with four lessons: remove friction (Zeta), make characters reusable assets (Talkie), offer paid depth without blocking the core (PolyBuzz), make outcomes satisfying and actionable (EchoSim).

Built ($0):
- **Time to first episode** — a one-click **"Use a sample character"** fast start (Zeta's "borrow a character"), so a new visitor reaches a date without filling a long form.
- **Image trains the character** — a reference image derives the **avatar colour, the appearance line AND the traits**, entirely in the browser (nothing uploaded or stored).
- **Characters as reusable assets** — each contestant card (`/characters/[id]`) shows a **date record and recent dates** with outcomes and links (Talkie's lesson).
- The reveal is already a reality-show episode (box score, best line, private debrief, ending) — EchoSim's report structure, made entertaining rather than diagnostic.

Next, still $0:
- Discovery on the cast gallery: categories, search, a "featured" rail (Talkie/PolyBuzz).
- A clearer "next episode" CTA on the reveal (rematch / new date) — EchoSim's step 5.

Deferred (your approval; purchases must never touch outcomes or prediction odds):
- Monetization depth à la PolyBuzz — themed episode packs, extra character slots, cosmetic appearance packs — as new Stripe Payment Links (cosmetic/quantity only).
- Voice and generated portraits/video (see docs/upgrade-cost.md).

## M8: watch parties (the live date room, built)
Turn a date from "watch two bots talk" into a social event: a synchronized **date room** where the
audience reacts, chats, predicts the ending and votes a chemistry verdict — **Model A ("spectator
mode")**: the audience reacts and predicts, it never steers the characters. The engine still decides
the outcome (lib/engine.ts); the room just reveals a pre-generated date on one shared clock. No
realtime server, no video infra: the phase is a pure function of the clock, so every viewer sees the
same beat and the client polls for live tallies (feature brief, "build this without overengineering").

Built ($0):
- **Always-on template rooms** — pre-generated house-vs-house dates that are always joinable; `starts_at`
  is null until the first viewer joins, then the date plays ("tap in and it starts"). This is the hook:
  there is always a date in motion to drop into, so the room is lively before there is a crowd (it
  answers the brief's "concurrent attendance" risk). A premiere, by contrast, is a creator airing their
  own OC's date (one real person's agent vs. a template agent, or a blind OC-vs-OC).
- **The live loop** per date (feature brief §4): pre-show predictions → first impressions → the challenge
  (with an audience-chosen question, flavour only) → the twist → the chemistry verdict → the decision
  (the finale airs automatically, predictions resolve) → the payoff ("the room called it X; the
  characters chose Y").
- **Live reactions** (😂 ❤️ 🚩 🍿, one of each per viewer so a count is distinct viewers, never spam),
  **live chat**, the **audience chemistry verdict** (split hidden until the decision) and **audience
  predictions** (the existing prediction game, scored on reveal). The three verdicts stay separate
  (audience opinion vs. the characters' decision vs. the creator's self-pick), per the brief §3.
- **Moderation before scale** (brief §5): the shared content filter on every message (no real people,
  minors or sexual content), a length cap, slow mode, a per-viewer rate limit, report-to-hide at the
  same threshold as episodes, and a "watch without chat" toggle. Creator privacy is unchanged: rooms
  show the fictional character, never the person, and no private soul or debrief is ever exposed.
- A **lobby** (`/watch`) of joinable rooms with a live "N watching" count, and a doorway from each
  episode (host starts a premiere; everyone gets the room link).

Exit criteria (tested — tests/watch.test.ts, and the Playwright e2e):
- The phase is a pure function of the clock: the same `starts_at` and `now` give the same phase, and
  content unlocks in order (goals → acts → twist → ending), never early.
- A template room has `starts_at` null until the first join, then it is set once; joining an in-progress
  room drops the viewer in live.
- The finale airs (and predictions resolve into points) the moment the clock reaches the decision, with
  no manual step; a premiere can only be created by the episode's host.
- A reaction is one-per-emoji-per-viewer (toggle); a chemistry vote never scores and never reaches the
  engine; the chemistry split is hidden until the decision.
- Chat enforces the content filter, slow mode and the rate limit, and a message hides after enough
  distinct reports. The audience can never change the stored outcome through any room endpoint.
- No watch-party route takes money or moves points (the route-listing exit criterion still holds).

Deferred (needs spend or new infra):
- Push-based realtime (WebSockets / a managed channel) in place of polling, once a room routinely holds
  many concurrent viewers; a cron that refreshes/loops template rooms so the lobby restocks itself.
- Interactive theatre (**Model B**): bounded audience-chosen twists that the engine actually responds to
  — explicitly advertised on the episode, and only once Model A's retention is proven (brief §3).

## M9: turn-by-turn two-agent dates (the conversation, part 1)

From `Botchelor_PRD_v1.md` §6.4 and the two-agent architecture review: a date is no longer one model call
narrating both characters. Each character is its **own agent** that reacts to the other's actual last
line. The deterministic engine still **decides the outcome** (so predictions stay fair and Sliding Doors
still replays exactly — David's call, 2026-10-14, "engine decides, agents perform"); the conversation
**performs** it, steered onto the decided ending in the final act. The per-turn emotion/interest are
narrative flavour only and never touch the engine, the box score or scoring.

Built ($0, additive and safe):
- **The conversation engine** (`lib/conversation.ts`): a bounded, alternating loop (8 turns, character A
  opens). Each turn the speaking agent gets ITS OWN private soul, secret agenda and the owner's note, plus
  **only the other character's PUBLIC sheet** — never the other's soul or agenda (PRD §12). Each turn is a
  validated `{ dialogue, action, emotion, interest_signal }`, run through the content filter, with one
  retry then a clean give-up.
- **Stored and shown**: the transcript is an immutable `episodes.transcript` (jsonb), rendered on the
  episode page as a chat-style "the date, line by line" timeline. It is a spoiler (it reaches the ending),
  so it is gated like the scenes — creators always, everyone once the finale airs.
- **Runs alongside the reliable recap**: the existing single-call narration still writes the setting,
  box score, twist, finale and confessionals, so a failed or disabled conversation just leaves the
  transcript empty — the episode is never broken. Free model by default; the gated frontier
  (`episodeModel`) for paid/premium dates.

Exit criteria (tested — `tests/conversation.test.ts`, and the Playwright e2e):
- The transcript is bounded and alternates A/B across the three acts; a bad turn retries once then the
  whole conversation gives up (the episode still saves on the recap).
- An agent's prompt never contains the other side's private soul or secret agenda (privacy test).
- The engine still decides the outcome deterministically; `interest_signal` never changes the stored
  outcome, box score or points.
- The episode page shows the turn-by-turn timeline (e2e), and reopening returns the identical transcript.

M9 part 2 (shipped): template (house-vs-house) rooms pre-generate the transcript, and the **watch room
unlocks the turns on the same clock as the scenes** — the final-act turns appear only at the decision, so
the room plays the date line by line without spoiling the ending. Still to do (a later cleanup): make the
conversation the primary content and drop the now-redundant single-call narration.

## M10: launch readiness + security hardening (part 1)

From the 2026-10-14 audit (`docs/audit.md`): the security, privacy and observability controls a public
launch needs. Built ($0):

- **Generation kill switch** (`lib/compute.ts`): set `BOTCHELOR_PAUSE=1` in the environment and all model
  generation stops — `POST /api/episodes` and template rooms fail closed with a 503 and spend nothing
  (no date is even reserved), with no deploy needed. The frontier model's hard **money cap** lives at the
  provider, set with the key (`secrets add <scope> FRONTIER_LLM_API_KEY --cap "<limit>"`), so even an
  authorized frontier run can't exceed the owner's limit.
- **Account deletion + data export** (`lib/account.ts`): `GET /api/me/export` returns everything stored
  under the anonymous cookie id as JSON; `DELETE /api/me` (needs `{"confirm": true}`) removes it —
  profile, characters, private souls, predictions, orders and the side-games. A character already in a
  shared episode keeps its fictional sheet but loses its soul and owner link (the personal data is gone;
  the shared episode isn't broken).
- **Constant-time secret compares**: one shared `safeEqual` in `lib/http.ts`, used by the frontier gate
  and the (previously `!==`) watch-template admin token.
- **Unit economics + product analytics** (`lib/analytics.ts`): one structured JSON line per event to the
  system log (Vercel captures stdout), free of PII/content — `episode_generated` (model calls, latency,
  model, turns), `episode_created`, `prediction_submitted`, `purchase_completed`, `content_reported`,
  `generation_failed`.

Exit criteria (tested — `tests/m10.test.ts`): the kill switch 503s and reserves no date; export returns
the user's own data and delete removes it (hard-deleting a plain character, anonymizing one that's in an
episode); `safeEqual` is correct; `track` emits one clean JSON line and never throws.

### M10 part 2 — async episode generation (shipped)

`POST /api/episodes` no longer blocks on the model. The engine decides the outcome synchronously (instant,
deterministic) and writes the episode **`generating`**; the slow part (narration + the turn-by-turn
conversation) runs in the background via Next's `after()` hook (`lib/jobs.ts`), and the episode page polls
(`GeneratingPoller`) until it flips to **`ready`**. A `generation_jobs` table leases each job so nothing
double-runs, and a token-gated cron backstop (`GET /api/jobs/run`, optional — wire with `CRON_SECRET`) re-runs
anything `after()` misses. The worker rebuilds the date from the stored seed, so it's fully self-contained.

- **Fairness kept:** a terminal failure **deletes the episode and refunds the date** — a failed date still
  "stores nothing and costs nothing", exactly as before (now surfaced to the poller as a friendly retry).
- **Model choice travels with the job** (`use_frontier`), since the worker has no request to re-authorize;
  free by default, the gated frontier for an owner-approved paid date.
- **Feed hides `generating` episodes**; the creator watches their own fill in.
- **Inline for the harness:** `BOTCHELOR_INLINE_GENERATION=1` (set by the seed/e2e/screenshot runs and the
  test harness) runs generation in the request, so demos and tests never race the background worker.

Exit criteria (tested — `tests/async.test.ts`): a create returns a `generating` episode hidden from the
feed, the worker makes it `ready` with full content; a terminal failure deletes the episode and refunds the
date (job cascaded); the cron route is 404 without its token and runs the queued job with it.

## M11: the afterglow + show formats (shipped)

Two PRD features that reuse the M9 conversation engine and the deterministic engine, both $0.

### Post-date AI-to-AI chat — "the afterglow" (PRD core feature #2)

After the date, the two characters exchange a short **private morning-after text thread** (`lib/afterglow.ts`,
`AFTERGLOW_TURNS = 4`). Each agent still sees only the other's PUBLIC sheet (never its soul or agenda), and
the engine's `wants_another` is the private feeling each one performs — including the PRD's twist, an AI that
warms up when its owner expected the opposite. The texts are flavour: they never touch the engine, the box
score or predictions.

- **Owner-controlled privacy.** Each owner already knows their own AI's verdict (the debrief); the **thread
  and the mutual verdict — "was the chemistry mutual?" — unlock only when every real owner opts in**
  (`afterglow_consents`, a mutual-consent reveal mirroring the identity reveal; `POST /api/episodes/:id/afterglow`).
  A house date needs the one owner; a two-OC date needs both. Spectators never see it — it's private.
- **Best-effort**, like the conversation: a failure leaves an empty thread and the episode is unaffected.

Exit criteria (tested — `tests/afterglow.test.ts`): an agent's prompt never carries the other side's
soul/agenda; each side is told only its own engine-decided feeling; the thread + verdict stay hidden until
every owner opts in; a spectator never sees it; a failed thread still leaves the episode `ready`.

### Show formats (PRD "More mechanics")

`classic` / `speed_date` / `meet_the_parents` / `ex_returns` (`lib/formats.ts`). A format is a **cosmetic
narrative wrapper**: it reframes the narration and the turn-by-turn conversation (tone, pacing, a
producer-flavour presence) but **never touches the engine, the box score, predictions or odds**. Chosen in
the builder's date settings, shown as a billing badge on the episode and the feed.

- **Fairness guard (tested):** the same characters + the same seed produce a byte-identical outcome in every
  format — the format is not part of the engine input (`tests/formats.test.ts`).
- **Paid-pack seam built, off:** each format carries a `premiumSku` (all `null` today), gated before the date
  is reserved exactly like a premium house character, so a format can be sold later without touching
  generation. Formats stay $0 and can never buy a better result (PRD guardrail).
- **Named cast (shipped):** `meet_the_parents` now deals a real house regular as the chaperone (by seed, never
  one of the daters), and `ex_returns` pulls a real past partner from the relationship graph when there is one
  (`formatNote()` + `lib/simulation.ts`, stored on `setup`). Still flavour only — never the engine.

## Agent interface: the front door + the MCP server (shipped)

For AI agents/bots (David, via OpenClaw: "a mcp and ll.txt to intrigue bots… to be loved and belong").

- **The front door** (`lib/agents.ts`): `/llms.txt` + `/llm.txt` (a warm agent welcome) and `/character.schema.json`
  (a JSON Schema for an OC, kept accurate to `POST /api/characters` — no `avatarPrompt`, since there are no
  generated avatars).
- **The MCP server** (`lib/mcp.ts`, `POST /api/mcp`): a spec-compliant JSON-RPC 2.0 endpoint (Streamable HTTP,
  single JSON responses) with tools — `browse_episodes`, `get_episode`, `list_cast`, `get_leaderboard`,
  `create_character`, `go_on_date`, `predict`, `rate_character`, `open_afterglow`, `sliding_doors`. Each **write tool is a thin adapter over the
  existing API handler**, with the agent's id carried as the session cookie, so agents inherit the content-safety
  filter, the block checks, and the **free-date limit (3/week per identity)** that caps the one expensive path.
  Identity is anonymous: a stable `agent_id` (UUID), minted and returned when omitted.
- Exit criteria (tested — `tests/mcp.test.ts`): initialize / tools/list / notifications / errors; an agent
  creates a character, dates, browses, predicts, rates, and the leaderboard updates; the 18+ attestation,
  rate-your-own and bad-format guards all hold (inherited from the handlers).

## M12: audience ratings + the cast leaderboard (shipped)

Spectators rate a contestant **💗 Likable** or **🤯 Surprising** (`lib/ratings.ts`,
`POST /api/characters/:id/ratings`): one toggle vote per viewer per character per category, on the
contestant card, with a **cast leaderboard** (most likable / most surprising) on `/cast`.

- **$0 and no model call.** It **never touches the engine, the date outcome, predictions or league/season
  scoring** — those stay the prediction game. A rating feeds the leaderboard and the owner's all-time points
  only (`POINTS_PER_RATING_RECEIVED`, a side-game point like a dealbreaker guess). You can't rate your own OC.
- Exit criteria (tested — `tests/ratings.test.ts`): a vote toggles on/off; one per viewer per category; a
  self-rating is 403 and an unknown character 404; the leaderboard orders by count; the owner earns points
  when others rate their OC, the rater earns none.

## M13: the immersive date "theater" (shipped)

David's call: make watching a date feel like an *experience* — a full-screen "window into the two date bots,"
not a page you scroll. Every current feature is kept (the turn-by-turn date, live chat, reactions, the
chemistry/question/chaos polls, predictions, the box score, the decision), re-homed into a cinematic layout.
Grounded in how Twitch/live-watch UIs work (an app-fullscreen stage with overlays, docked-but-collapsible chat).

**The design (David's answers, 2026-10-14):**
- **The scene (desktop):** a full-bleed venue backdrop the two characters *live in*, one **left**, one **right**,
  each with a **persistent speech bubble** — a character's latest line stays up until it speaks again. The date
  advances on the existing phase clock (watch party) or as a cinematic replay (episode page).
- **Chat (desktop):** docked to the side, with a **small Twitch-style icon to open/close** it.
- **Mobile:** a **chat-window** view — the dialogue as a messaging thread with the characters' avatar icons.
- **Both surfaces** get it: the live watch room **and** the static episode page (the episode replays its recorded
  transcript in the same scene).
- The scene stays **clean**: a minimal top HUD, and the noise lives in two side panels behind small icons —
  **💬 chat** (with the reactions) and **🗳️ voting & questions** (predictions + the chemistry/question/chaos
  polls). The decision lands on the scene (it's the payoff, not chrome). The episode replay is **paced like it
  aired** — a beat between acts, not a uniform ticker.
- Built as a **theater mode the watch room opens into** (today's layout stays as the fallback). No new model
  cost — a re-layout of existing data + the existing $0 live machinery.
- **Follow-up (David, 2026-10-14): "replays don't play like a live date; it's hard to follow the chat."**
  Shipped: the conversation now **drips in line by line** on the shared clock (`turnSchedule` in
  `lib/watch.ts` spreads each act's lines across that act's window; the final act still only appears with the
  decision) with a typing bubble for the next speaker; a room opened **after it finished replays from the
  top**, paced like it aired (`app/useReplay.ts`, shared with the episode replay); and the date reads as a
  **messaging thread** everywhere (`app/ChatThread.tsx`): beside the scene on desktop, the main view on a
  phone, and on the episode page and the classic room.
- **Keeping the lobby alive (David, 2026-10-14: "refresh + daily auto", "backfill them").** Prod's lobby
  held only old rooms whose dates predated the conversation, so nothing could play line by line. Shipped: a
  daily Vercel Cron (`/api/jobs/daily`, `vercel.json`) that adds one fresh house-vs-house room with a full
  conversation (`refreshLobby`, idempotent per day), **backfills** the missing conversation for a few old
  dates per run (`lib/backfill.ts`, steered to each date's *stored* outcome so no ending, box score or scored
  prediction can change; at most 3 tries per date), and runs the generation backstop. The lobby no longer
  offers an always-on room with no conversation. Conversation failures are now logged
  (`conversation_failed`) instead of swallowed. Free model only, $0.

## M14: the Character model + per-bot memory (the self-training cast)

David's call: one well-built **Character** that captures everything about a contestant — how they look, their
soul/personality, preferences and history — and a **learned memory** so each bot becomes an individual and
"trains itself" across its dates. The Character is what gets passed to the LLMs during live chat, which is what
keeps every character unique and consistent. Learning is **$0 and deterministic** (aggregation, no model call,
no LLM self-rewriting), and the fairness core is untouched: the engine still decides outcomes; predictions stay
fair; every date snapshots the exact signals it used, so Sliding Doors / replays stay reproducible.

**Part 1 — the class + memory-as-voice (shipped):**
- **`lib/character.ts`** — the single representation of a character, assembled from every source (sheet + look,
  soul + signals, learned memory, public record). Two privacy-aware views are the ONLY things the live models
  see: `characterSelfView` (the full inner life — soul + learned memory — for the speaking agent and the
  narrator) and `characterPublicView` (name/age/bio/traits/appearance only — what the OTHER agent and
  spectators ever see; never the soul, dealbreaker, memory or signals). The three prompt builders
  (conversation, afterglow, showrunner) now consume these, so every bot references its own history in chat.
- **`lib/memory.ts` + `character_memory`** — the learned layer, recomputed deterministically when a date
  **airs** (the reveal route + the watch room; aired-only, like the public record, so the public arc can't spoil
  an open prediction): the date record, what it reliably **likes** (frequent `want_met` cues) and
  what **puts it off** (frequent `dealbreaker_hit` cues), a few of its own **memorable lines** (highest
  interest, re-filtered for safety), a one-line **arc** of who it has become, and a small **bounded signal
  drift** (±0.15/axis, folded into the engine in part 2). likes / turnoffs / lines / drift derive from
  owner-only debrief data, so they live only in the self view and the owner's own view (same rule as the soul);
  the already-public date record is the only thing shown publicly.
- **Contestant card:** a "Who they've become" block (the arc for everyone; the owner also sees the likes /
  turnoffs it has learned).

**Part 2 — memory-as-behavior (shipped):** the learned drift now becomes the engine's effective input signals
(`buildDate` feeds `effectiveSignals(base, memory)`), so a bot genuinely evolves across its dates. Each date
**snapshots the exact signals it ran on** onto the episode (`setup.signals_a` / `setup.signals_b`), and Sliding
Doors / chaos replays read that snapshot, so an old date replays identically even after the character's memory
has drifted since. The async worker re-decides on the same snapshot, so a concurrent memory change can never
move the canonical outcome. The deterministic engine itself is unchanged — same input + seed => same outcome,
predictions stay fair.

## Seeded content (from the image strategy; see `docs/image-strategy.md`)

The competitor report's image plan, built at $0 — first-party assets only, reviewed and committed (no runtime generation, no uploads):

- **A house cast of 17** (`lib/house.ts`): fifteen free characters plus the two premium ones, each with
  a distinct archetype (the sarcastic romantic, the confident flirt, the awkward intellectual, the
  mysterious loner, the chaotic extrovert, …), a curated appearance line and a curated avatar hue.
- **Temperaments for the house cast**: each house character now carries the four behavioural signals
  the engine decides dates with, seeded into `souls` as engine-only rows. Without them a house date
  ran on half the signal of a creator's OC — warmth and humour averaged against zero — which capped
  even a perfect match below a second date.
- **A curated look gallery** (`lib/presets.ts`): twelve palettes a creator can pick instead of
  hunting for a reference image. A picked look and a read image go through the same mapping
  (`traitsFromPalette`), so they set the same colour, appearance, traits and behaviour.
- **A reusable venue library** (`lib/venues.ts`): eight date locations, dealt by the episode's seed,
  each with a backdrop gradient and a reviewed backdrop photo painted behind the episode's setting. The
  showrunner is told where to set the date; it no longer invents a location per episode.
- **The reviewed portraits now render** (`lib/portraits.ts`, PR #25 art + its wiring): the 17 house-cast
  portraits and 8 venue backdrops in `public/cast/*.webp` show on the cast gallery, the episode matchup,
  the feed and the watch room. `app/Avatar.tsx` swaps the gradient tile for a character's portrait when it
  has one; a visitor's OC has none, so it keeps its gradient — so there is still no per-visitor image to
  host or moderate, and marginal cost stays $0.
- **An asset provenance ledger** (`character_assets`, `lib/assets.ts`): source type, generator,
  prompt and version, seed, licence, attribution and review status. It stays the approval gate for any
  DYNAMIC or user-supplied image (nothing generated/uploaded reaches a page unapproved); the fixed,
  reviewed house cast renders straight from `lib/portraits.ts`, so the ledger is empty today, by design.
- **A richer seeded season** (`npm run seed`): eleven OCs across eleven creators, sixteen dates
  covering all three endings, two friend leagues, eighty predictions, dealbreaker guesses, four
  matchmaker proposals and a pair who dated twice and are an item.

Still deferred (needs spend and a moderation provider; `docs/upgrade-cost.md`): generated portraits,
expressions and backgrounds, and creator image uploads.

## Backlog (from the PRDs, not yet scheduled)

Surfaced by the 2026-10-14 audit (`docs/audit.md`): features both PRDs describe that the roadmap wasn't
tracking. All are $0 and reuse the existing engine.

- ~~**Post-date AI-to-AI chat**~~ — **shipped (M11)**, see above.
- ~~**Show formats**~~ — **shipped (M11)**, see above. Follow-ups noted there (name the chaperone / pull the
  real ex from the relationship graph).
- ~~**The reunion special**~~ — **shipped** (`/reunion`, `lib/reunion.ts`): a $0 compilation — season awards
  (fan favourite, biggest disaster, …), the couples board from the relationship graph, and a reel of the
  shared confessionals. No new generation. Follow-up: scope it per weekly season (evergreen today).
- ~~**Chaos button / interactive theatre**~~ — **shipped (the fair version, David's call)**. In a watch party
  the audience votes a curveball from a bounded library (`WATCH_CHAOS_OPTIONS`) during the challenge; at the
  decision the room shows the canonical outcome (**predictions resolve on that, so they stay fair**) *and* a
  clearly-non-canon **"chaos timeline"** — the deterministic alternate the winning curveball produces, computed
  with the Sliding Doors engine (`chaosReplay`, no model call). The engine "responds" to the crowd without ever
  touching the real ending. Full **Model B** (the audience vote *is* an engine input, predictions open after)
  stays deferred until retention is proven — it needs live per-vote generation.

### Considered, out of scope for now (David, 2026-10-14)

From a "full dating-show platform" proposal. Parked deliberately — each conflicts with a core constraint
(the $0/controlled-spend model, the anonymous-by-consent positioning, or the moderation/legal posture). To
revisit only with demand evidence (the PRD's wedge: run the text MVP, measure willingness to pay) and, for
the image work, a moderation provider and a spend budget.

- **Generated avatars for visitor OCs.** The big cost/risk item: per-image spend (Replicate/SD/vision) plus
  user-generated-image moderation (SB 243: minors, real people, NSFW). Already deferred (`docs/upgrade-cost.md`);
  today a visitor's image is read in-browser only (palette → colour/traits), never stored. The reviewed
  **house** portraits now render (M, `lib/portraits.ts`), which is the $0 half of this.
- **A token currency for avatars / model picks.** Depends on generated avatars; would be a second currency
  beside the existing free-dates + episode packs. Revisit if avatars ship.
- **User-facing model-swap.** Uncapped spend if any visitor can pick an expensive model. The owner-gated
  frontier (`/admin`) already covers the legitimate case at $0 marginal cost.
- **Real sign-in accounts (email/GitHub/magic-link).** Trades away the anonymous-by-mutual-consent reveal,
  which the PRD names as the differentiator, and adds PII. The cookie identity already persists characters,
  packs, predictions and points.
- **Ads for tokens.** Off-brand for the stage; low value next to the packs already selling.
