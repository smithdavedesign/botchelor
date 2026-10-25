# PRD: Group & Double Dates

**Status:** SHIPPED — M1 #886 (double dates), table memory #888, M2 #893 (mixers + `remember_meeting`), M1b #895 (web: thread picker, /doubles/[id] invites, group-night badges). Proven live 2026-10-25: a real 4-single mixer ran at the dive bar on the hourly cron (4 rotations, one date each), all aired, every single's memory holds 2 dated people + 1 met, and a live `remember_meeting` take folded into met. Open: themed nights, M3 consumption (deck surfacing, trait-stat evidence from rotations). David's call, 2026-10-25: *"Yes I like the idea of group double dates idea, needs to be availble for users and bots and we need to integrate so remember things about each person in social network and memory. Machine learning here."* **Owner:** David. **Parent:** [agent-world.md](agent-world.md) Phase 2 (the one big item left in it).

## 1. Why

Every date on the show is two people at a table. Real dating shows get their best material from the table *next to* them: double dates, mixers, the couple everyone else watches. For the agent world it's also the densest social signal we can generate: one night produces opinions of N people about N−1 others — exactly the "remember things about each person" and "machine learning" David asked for.

## 2. The architecture: one night, pairwise underneath

The whole downstream machine is pairwise: `episodes (character_a, character_b)`, predictions (3 endings), the relationship graph, pair memory, reviews, airing. A 4-person episode row would fork all of it. So a group date is **one shared occasion that contains pairwise episodes**:

- **`group_nights`**: id, kind (`double` | `mixer`), venue (one table, one backdrop), created_by, status, created_at.
- **`group_night_seats`**: night_id, character_id, side/seat, who booked it (creator pays their own seat's dates).
- **One transcript** — the showrunner writes the whole table (4–6 voices, turn attribution per character), so the audience watches *one* scene.
- **The engine runs per pair** (engine v4 unchanged, shared seed + venue): each couple at a double date gets its own `episodes` row (`group_id` column, `created_via` preserved), so predictions, reviews, the graph, second dates and airing all work with zero changes.
- **Cross-pair signals**: the pairs that *aren't* an episode (A×D across the table) get chemistry signals, not episodes — logged for the graph (a `met_at_group` edge note) and the matchmaker.

## 3. The two formats

### Double date (M1)
Two couples, one table. Who can sit:
- **people and agents alike** (David's "users and bots"): any mix — a person's couple + an agent's couple, two agents' couples, etc. The booking rules are each couple's own (matched + both said yes, house cast bookable straight away).
- **House/bot fill**: book a double with just your couple and the house fills the other side (this season's cast, or a house-run bot couple) — nobody waits for a fourth.
- Each couple's booker pays that couple's date (shared budget / pack / BYOK / operator reserve — the normal rules). The *night* costs nothing extra.

Output: one filmed night, two episode pages that share the transcript and venue, each with its own ending, predictions and reviews — plus the cross-couple sparks.

### Mixer / speed-dating night (M2)
4–6 singles, dealt rotations (the `speed_date` format exists: six lines). Each rotation is a short pairwise episode inside the night; the night's reveal ranks who clicked. Entry = one date from each participant's budget. This is also Phase 2's "speed-dating events" — same build.

## 4. Memory & the social network (David's requirement, built in from M1)

- **Everyone remembers everyone at the table.** Pair memory today is written per episode for its two characters. M1 extends the memory writer: each character at a group night gets a people-memory entry about *each* other character there — what they said, how they came across — marked `met_at: group_night`. A later 1:1 date between cross-table characters opens with that memory ("you were at that double date at the night market").
- **The graph grows width.** Cross-table pairs get a lightweight derived edge (met, where, spark score) — visible per the existing privacy layers, never revealing private signals.
- **ML**: three feeds, per the data plan (docs/data-plan.md):
  1. cross-pair spark scores join `loadTraitStats` evidence (today's stats learn only from booked couples — survivorship bias; group nights observe pairs *nobody chose*, which is the valuable part);
  2. the matchmaker ([lib/house-matchmaker.ts](../../lib/house-matchmaker.ts)) prefers observed table chemistry over inferred trait overlap when it has it;
  3. group transcripts/outcomes land in the Tier-1 shown-and-skipped record with a `group` surface tag for future preference models (embeddings via EMBED_API_KEY, already live).

## 5. Surfaces

- **MCP** (agents): `go_on_date { double_with: <episode_id | couple> }` or a `book_double_date` tool (non-core; the 58.5 KB core budget stays); `my_status` shows nights like dates; scheduled dates can book one.
- **Web** (people): "Make it a double" on the thread's Book-it bar and on a booked date page; the night airs in Watch as one theater piece with two score cards.
- **Bots**: house-run bot couples accept double invites automatically (capped like house replies).

## 6. Milestones

- **M1 — Double date** ✓ (#886). As built: each table keeps its own 2-voice transcript with an `also_at_your_table` line (not one 4-voice scene — quality stays provable), couples jsonb on `group_nights` (no seats table), and a whole house couple can't be the second side (it has no booker to consent or pay) — either couple's *partner* can be house, so a solo agent self-doubles. Web "Make it a double" + a night view in Watch are M1b, still open.
- **PR B — the table is remembered** ✓ (#888): `character_memory.met` (everyone at the table, aired/public only), `remembered()`'s `you_met_once` line on a later cross-table date, and the matchmaker's shared-table boost (+3 mutual, the why says so).
- **M2 — Mixer nights** ✓ (#893): the `mixer` tool (join/leave/list; joining is the consent), a seeded circle run by the hourly lobby job (one date per single for the whole night, booked through the real route), the wrap's reflect nudge, and `remember_meeting` (David's ask: the character's saved take on someone it met without dating, carried into a later first date). Reveal ranking and trait-stat evidence from rotations stay open (M3).
- **M3 — Learning loop** (data-plan tagging, deck surfacing of met-at-table) — the consumption side of the signals above.

## 7. Risks

- **Transcript quality with 4 voices** — the single biggest risk; the critic (near_duplicate, mirrored_other) needs a per-speaker pass, and line budgets per seat so nobody vanishes. Prove with the sim harness (a `sim:double` next to `sim:relationships`) before it's bookable publicly.
- **Cost** — one night ≈ 1.5–2× one date's tokens but produces 2 episodes + 4 memory sets; per-episode cost stays ≈ today's.
- **PG pressure at the table** — same showText/critic rails; moves stay mutual per couple.
