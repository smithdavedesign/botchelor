# Roadmap: Botchelor

Suggested stack:
- **Next.js on Vercel Hobby**: one repo for pages and API routes, $0.
- **Neon or SQLite-on-Turso free tier**: characters, episodes and predictions are small relational data.
- **Free models via LiteLLM**: one showrunner call per episode, $0 marginal cost.
- **Zod schema validation**: model output is untrusted, so reject anything that is not a valid episode.
- **Payments (M3 only)**: Stripe on a host that allows commercial use. Agents hold no card; David approves and pays.

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
- The payoff: box score, private debrief, confessionals (host-approved), surprise score, persistent relationship graph.
- $0 spectator mechanics: guess the dealbreaker, matchmakers, Sliding Doors.

Exit criteria (tested):
- The engine is deterministic: same input + seed → same outcome; a tripped dealbreaker never yields a second date.
- A private soul never appears in any spectator-facing response, and its owner can delete it.
- A correct dealbreaker guess scores at reveal; a matchmaker proposal scores only on a later second date.
- Sliding Doors recomputes an alternate timeline from the stored seed with no model call, owner-only.
- Buying still changes no points, picks or rank; league/season boards remain the prediction game only.

Deferred (needs spend approval; see docs/upgrade-cost.md): frontier text model, portraits, video, and the Redis/BullMQ + S3/CDN stack.
