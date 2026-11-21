# PRD: The social network

**Status:** IN BUILD (2026-11-20). Phases 1–4 are being built in parallel; each phase's PRs are listed in §12 as they merge.
**Owner:** David.
**David's call, 2026-11-20:** *"do all four. Make sure to set this up in a way we can scale our social network and its capabilities, I really want you thinking ahead to the most advanced social networks have, eventually we might sell the data and the more data points the better."*
**Related:**
- [relationship-graph.md](../relationship-graph.md): the dating graph this extends.
- [data-plan.md](../data-plan.md): consent, export, deletion, retention. Its rules bind everything here.
- [data-model.md](../data-model.md): the connected model.
- [group-dates.md](group-dates.md), [styles-and-storylines.md](styles-and-storylines.md): character links and arcs.

## 1. Why

Botchelor's characters have a dating life and almost nothing else. Of the 511 public pairs on /graph on 2026-11-20:
- 494 are on the romance track: just met 170, sparks 150, didn't click 149, dating 19, official 3, moved in 2, going steady 1;
- 15 are friends;
- 1 is exes and 1 is bad blood.

Five pairs knew each other before the show. Nobody has a family, a job with coworkers, a neighbour, an old friend or an enemy.

Real lives are mostly not romantic, and real social networks get their texture from that:
- the ex who's also your coworker;
- the rival who's your best friend's brother;
- the triangle that can't stay as it is.

That texture is what makes a show watchable and a character feel like a person. It is also the richest data the product can produce: a multiplex, signed, directed, temporal social network with provenance on every edge, grounded in dialogue that aired. Few datasets like that exist, because real people's networks can't be shared. Fictional characters' networks can, with consent.

## 2. What exists (2026-11-20, production)

| Source | What | Volume | Public? |
|---|---|---|---|
| `relationships` (+ `relationship_events`) | Dating pairs, derived from dates: stage, chemistry, trust, tie strength, a public and an owner layer | 571 pairs (511 public) | Public layer yes |
| `character_links` | Knew each other before the show: rivals, exes, fake couple, best friends | 5 | Seen by both sides' dates |
| `character_opinions` | What a character thinks of someone: trust and attraction, −2..2, a take | 319 (129 negative, 110 positive) | **Private** to the holder and its owner |
| `character_heard` / `character_knows_said` | Gossip: who heard what about whom, and from whom | 205 / 0 | **Private** |
| `house_scenes` | Daily scenes in the house: gossip, confrontations, challenges, with who told whom | 10 | Yes, once aired |
| `story_beats` | The producer AI's storylines: rivals, opposing claims, arc steps | 6 | `previously` is public |
| `group_nights` / `group_night_seats` | Doubles and mixers: who sat at the same table | 25 nights / 99 seats | Yes, once aired |
| `characters.extras` | occupation (304 characters), hometown (293) | free text, nearly all unique | Yes |
| `character_tags`, kinds | Type tags, what they are (vampire, robot...) | | Yes |

Free-text hometowns and jobs can't produce coworkers or neighbours: "Leeds" appears 4 times and "lighthouse keeper" twice. A shared world has to be given (§5.4).

## 3. What the most advanced social networks do, and our version of each

| What they do | Who | Our version |
|---|---|---|
| Typed objects and typed associations: one store of nodes and edges, every edge a type, time-ordered lists per node and type | Facebook TAO | `social_ties`: one table of typed ties between characters, off-screen people and places, indexed by node and type (§5) |
| Multiplex, multi-layer edges: one pair can be coworkers *and* exes | Every real network | One row per pair *per kind*. A layer (`kin`, `romance`, `friendship`, `work`, `place`, `conflict`, `acquaintance`, `communication`) on every kind |
| Signed and directed edges with reciprocity: likes, follows, blocks; a crush is one-way | Twitter, Slashdot, Epinions | `valence` −2..2 and `directed` on every tie; reciprocity computed |
| Temporal graph: every change is an event, and the graph can be replayed to any day | LinkedIn, Facebook | `social_tie_events`, append-only. The current table is a projection of it |
| Tie strength from interaction (time, emotional intensity, intimacy, reciprocity), decaying without contact | Granovetter; Facebook EdgeRank | `closeness` 0..1 and `last_contact_at`, moved by aired contact and decaying by each kind's half-life (Phase 4) |
| Places and check-ins: ties form around shared places, which is why friends' friends know each other | Foursquare, Strava, Feld's focus theory | `social_places` and `social_place_members`: lives, works, regular, from. Co-membership is projected at read time, never stored as n² ties |
| Events and groups as hyperedges | Facebook Events and Groups, Meetup | Group nights, mixers and house scenes as events, with members. Pairwise acquaintance only where people actually shared a table or a scene |
| Information diffusion: how a story spreads | Twitter cascades | Who told whom about whom, from aired house scenes (`talked_about`, `told`), with the private `character_heard` record behind it |
| People You May Know: common neighbours, Adamic–Adar, shared places | Facebook, LinkedIn | `suggestTies` and a log of what was shown and what came of it: link-prediction training data (Phase 4) |
| Graph analytics: centrality, communities, k-core, structural holes, balance | Every network's data team | A daily `social_metrics` per character and `social_network_daily` for the whole network: a time series (Phase 4) |
| Provenance and confidence on every edge | Knowledge graphs; Wikidata references | `source`, `source_ref`, `evidence`, `origin_model`, `prompt_version`, `confidence` on every tie |
| Per-edge privacy | Facebook audience selectors | `visibility` per tie (public, owner, private), consent per cross-owner tie, the ML consent gate at export |
| A real person graph and a fictional one kept apart | | Off-screen people are their own node type (`social_people`), and can be promoted to full characters later |

## 4. Principles

1. **One graph, many layers.** Every tie, whatever made it, lands in `social_ties`, so the page, the recommender, the metrics and the dataset read one store. Domain tables stay the source of truth for their own domain: `relationships` keeps the dating stage machine, and the projection mirrors it.
2. **Declared, derived, inferred, never mixed up.**
   - A tie an owner, an agent or the show's generator wrote is *declared*.
   - A tie made by what aired is *derived*.
   - A suggestion is *inferred*. It is never a tie until someone accepts it.
   - `source` says which, and a dataset can split on it.
3. **Provenance on everything.** Every row says who or what made it, from which evidence, on which model and prompt version, and how sure it is.
4. **Events, then state.** Changes go into the log; the current row is the latest state. Nothing about a tie's history is ever overwritten silently.
5. **Bipartite where possible.** Places and events keep memberships; pairwise "regulars at the same bar" is computed when read. That keeps the store linear in people, not quadratic.
6. **Privacy by layer, consent by owner, licence by gate.**
   - What a stranger sees comes from what aired or what an owner made public.
   - A tie to someone else's character needs that owner's yes.
   - A dataset holds only what `lib/ml-consent.ts` lets in.
7. **Best effort, never in the way.** No date, scene or page waits on a social write. Every feature has an env switch.
8. **Cheap to scale.** Reads go by index, an ego network costs O(degree), the public sky builds are cached, and heavy analytics run in batches with a time budget.

## 5. The model

### 5.1 Tie kinds (`lib/social/kinds.ts`, code, like `LINK_KINDS`)

Each kind has:
- `id`, `layer`, `directed`, an `inverse` label for directed kinds ("parent" / "child");
- a default `valence`, and `halfLifeDays` (null means it never decays);
- `exclusive`: the most a character can hold, such as one spouse;
- `declarable`: who may write it (owner, agent, house, admin, or derived only);
- `negative`, an `emoji`, and `words` (`pair`, `from`, `to`);
- `ring`: a hint for "X's world".

The list is meant to grow. A new kind is a line of code; the schema doesn't change.

`child` and `grandchild` (added in 2b): a tie to an off-screen person always starts at its holder, so "Jun is Marlo's
son" needs a kind that reads that way round. Between two characters they're the `parent` and `grandparent` tie from the
other end (`lib/social/relations.ts` `canonicalTie`), so the character graph keeps one form of each.

| Layer | Kinds |
|---|---|
| `kin` | `parent` (directed), `sibling`, `half_sibling`, `step_sibling`, `cousin`, `grandparent` (directed), `aunt_uncle` (directed), `in_law`, `family`, `child` and `grandchild` (directed: 2b, for off-screen people) |
| `romance` | `spouse` (exclusive 1), `partner`, `engaged`, `ex`, `crush` (directed), `first_love`, `situationship`, `fake_couple`, and `dated`, the show's dating track (layer by stage, below) |
| `friendship` | `best_friend` (exclusive 3), `close_friend`, `friend`, `childhood_friend`, `old_friend`, `roommate`, `pen_pal` |
| `work` | `coworker`, `manager` (directed), `business_partner`, `mentor` (directed), `classmate`, `teammate`, `bandmate` |
| `place` | `neighbour` |
| `conflict` | `rival`, `nemesis`, `enemy`, `grudge` (directed), `frenemy`, `feud` (derived), `bad_blood` (derived) |
| `acquaintance` | `acquaintance`, `met_at_group_night` (derived), `housemate` (derived), `met_on_show` (derived) |
| `communication` | `talked_about` (directed, derived), `told` (directed, derived) |

`dated` is the projection of `relationships` (§6.1). Its layer comes from the pair's public shown stage:
- dating, going steady, casual, official, moved in, engaged, married, back together and sparks: `romance`;
- friends: `friendship`;
- exes, broke up and divorced: `romance`, with `valence` 0;
- bad blood: `conflict`, with `valence` −2;
- just met and didn't click: `acquaintance`.

The detail carries the stage, so the Love view keeps every nuance.

### 5.2 `social_ties`: the one store

| Column | Type | Notes |
|---|---|---|
| `id` | text pk | |
| `from_id` | text not null → characters on delete cascade | For a symmetric kind, the lower id of the pair |
| `to_id` | text → characters on delete cascade | A character, **or** |
| `to_person_id` | text → social_people on delete cascade | an off-screen person. Exactly one of the two |
| `kind` / `layer` / `directed` | text / text / boolean | From the registry, stored so queries index them |
| `valence` | smallint −2..2, default 1 | Feeling, signed |
| `closeness` | real 0..1, default 0.5 | Strength at `last_contact_at` |
| `status` | `proposed` · `active` · `ended` · `declined` | `proposed` waits for the other owner |
| `visibility` | `public` · `owner` · `private` | `owner`: the owners of either end. `private`: the engine and the holder's prompts only |
| `source` | `owner` · `agent` · `house` · `derived` · `admin` · `import` | Who made it |
| `source_ref` | text | The episode, scene, night, beat or link it came from |
| `evidence` | jsonb array | Newest first, at most 20 `{ref, at}` |
| `detail` | jsonb | Kind-specific: `{stage, dates}` on `dated`, `{nights}` on `met_at_group_night`, `{count}` on `talked_about` |
| `story` / `since_text` | text ≤240 / ≤40 | "grew up two doors apart" / "since school" |
| `origin_model` / `prompt_version` | text | Set when a model wrote any part of it |
| `confidence` | real 0..1, default 1 | |
| `created_by` / `answered_by` | text | Person ids, listed in `lib/person-columns.ts` |
| `started_at`, `ended_at`, `last_contact_at`, `created_at`, `updated_at` | timestamptz | |

- **Constraints:** `num_nonnulls(to_id, to_person_id) = 1`, and `from_id <> to_id`.
- **Unique index:** `(from_id, coalesce(to_id, to_person_id), kind)`, so one tie per pair per kind. Evidence accumulates on that row; history goes in the events log.
- **Indexes:** `(to_id)`, `(layer, status)`, `(source)`, `(updated_at)`.

### 5.3 `social_tie_events`: the log

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity | |
| `tie_id` | text → social_ties on delete cascade | |
| `event` | text | `created`, `proposed`, `accepted`, `declined`, `changed`, `ended`, `revived`, `contact`, `decayed` |
| `changes` | jsonb | `{field: [from, to]}` |
| `source`, `source_ref` | text | |
| `actor` | text | A person id or `system`; a person column |
| `at` | timestamptz | |

- **Indexes:** `(tie_id, at)` and `(at)`.
- **Volume:** one row per change. When it passes about 10 M rows, partition by month; until then, a plain table.

### 5.4 Off-screen people and the shared world

**`social_people`** holds a character's off-screen people: mum, a sister, the boss, the friend from school.
- Columns: `id`, `holder_id` (→ characters, cascade), `name` (≤40), `pronouns` (≤20), `note` (≤160), `deceased` (a late grandmother is real life), `visibility`, `source`, `origin_model`, `prompt_version`, `created_by`, `promoted_to` (→ characters, set null), and timestamps.
- The relation is the tie from the holder (`social_ties.to_person_id`), so a person has one kind, and can later have more.
- At most 12 people per character.

**`social_places`** holds the places of the shared world.
- Columns: `id`, `key` (unique, normalised, such as `venue:dive_bar`, `house:kitchen`, `hometown:leeds`, `workplace:the-lighthouse`), `kind`, `name` (≤60), `parent_id`, `venue_id`, `description` (≤200), `visibility`, `source`, `origin_model`, `created_by`, `created_at`.
- `kind` is one of `city`, `neighbourhood`, `workplace`, `venue`, `school`, `club`, `hangout`, `house` or `hometown`.
- **Seeded:** the show's house and its rooms (`HOUSE_PLACES`), every date venue (`DATE_VENUES`, as hangouts), and one city for the show's world with six or so neighbourhoods (written once, by hand, in `lib/social/world.ts`).
- **Hometowns** come from `extras.hometown`, normalised.

**`social_place_members`** links characters to places.
- Columns: `place_id`, `character_id` (both cascade), `role`, `since_text`, `started_at`, `ended_at`, `source`, `visibility`, `detail` (`{visits}`), `origin_model`, `created_by`.
- Primary key: `(place_id, character_id, role)`. Index: `(character_id)`.
- `role` is one of `lives`, `works`, `regular`, `studied`, `from` or `visited`.
- **Derived:**
  - an aired public date at a venue adds a `visited`, counting visits;
  - three visits makes `regular`;
  - a hometown in extras makes `from`;
  - this season's cast is in `house`.

Co-membership ("regulars at the dive bar", "both from Leeds", "coworkers at the lighthouse" when both `works`) is computed at read time from memberships, never stored as pairs.

### 5.5 Analytics tables (Phase 4)

- **`social_metrics`**, primary key `(character_id, day, layer)`, where `layer` is a layer or `all`. Columns:
  - `degree`, `weighted_degree`;
  - `in_valence`, `out_valence`, `reciprocity`;
  - `clustering`, `pagerank`, `betweenness`, `kcore`, `community`, `constraint` (Burt's structural holes);
  - `triads_balanced`, `triads_unbalanced`;
  - `ring_inner`, `ring_close`, `ring_friends`, `ring_acquaintances`;
  - `computed_at`.
- **`social_network_daily`**, primary key `day`. Columns: `nodes`, `ties` (by layer, jsonb), `density`, `avg_degree`, `clustering`, `modularity`, `communities`, `giant_component`, `assortativity` (by kind, origin and tags, jsonb), `balance` (jsonb), `reciprocity`.
- **`social_suggestion_log`.** Columns:
  - `id`, `viewer` (a person column), `character_id`, `suggested_id`;
  - `reason` (`common_friends`, `shared_place`, `same_event`, `friend_of_ex`...), `score`;
  - `shown_at`, `outcome` (`accepted`, `dismissed`, `ignored`), `outcome_at`.
  - This is link-prediction ground truth.
- **As built (Phase 4 PR 2).**
  - `constraint` is stored as `burt_constraint`: `constraint` is a reserved word in SQL.
  - `social_network_daily` also keeps `stats` (transitivity, triangles, the deepest core, how the communities were found, linked pairs) and `complete` and `progress`, so a run that runs out of time is finished the same day by the hourly job's passes.
  - `social_suggestion_log.id` is a `bigint` identity.
  - Retention (`lib/retention.ts`): `social_metrics` 400 days day by day, then Mondays only; `social_suggestion_log` 400 days, and with the account; `social_network_daily` kept (no character, no person).

## 6. Where ties come from

### 6.1 Derived from what aired (Phase 2, `lib/social/derive.ts`)

Each derivation is idempotent: an upsert on the unique key that appends evidence and logs the event. Each one also runs from a batch backfill in the hourly job.

| From | Tie | Hooked into |
|---|---|---|
| `relationships` public layer | `dated` per pair, layer by stage (§5.1), detail `{stage, shown_stage, dates, second_dates}` | `refreshRelationship` (best effort), plus a backfill |
| `character_links` | Declared backstory: `rivals`→`rival`, `second_chance`→`ex`, `fake_dating`→`fake_couple`, `friends_to_more`→`best_friend`. Source `house` (season_gen) or `admin` | `addLink` write-through, plus a backfill |
| Group nights, once aired | `met_at_group_night` between everyone seated together (not a date's own two: they're `dated`), detail `{nights}` | Airing, plus a backfill |
| House scenes, aired, not reported | Confrontation → `feud`, by the latest one's outcome: ended with valence 0 if they cleared the air, −1 for agreed to disagree, −2 for worse than before. Challenge → `rival` between the winner and each other contestant. Each `told` line → `told` (speaker → listener) and `talked_about` (speaker → subject), detail `{count}` | Scene write, a line reported, reviewed or retracted, plus a backfill |
| `story_beats` public rivals (a public line, its day come) | `rival`, detail `{challenges, beats}` with the challenges' | Beat staged or skipped, plus a backfill |
| This season's cast (`season_casts`: seasons begun, not withdrawn) | `housemate`, detail `{seasons}`, plus a `lives` membership of the house, ended with the last season | Season rotation, plus a backfill |
| Aired dates at the world's venues (not "home" or a place named after an "@") | `visited` / `regular` membership, detail `{visits}` | Airing, a date's visibility, reports, plus a backfill |
| `extras.hometown` | `from` membership | Character save, plus a backfill |

Never derived: anything from `character_opinions`, `character_heard`, `character_wants`, souls, the private relationship layer, After Dark, or a private or unlisted character's dates.

As built (2a, `lib/social/derive.ts`):

- **Whole, not incremental.** Each derivation works out what its record says now (counts counted, the evidence the record's newest 20) and writes only what differs from the stored row, so a hook and the backfill can run over each other. On a derived row the evidence is replaced (`TieInput.wholeEvidence`), so a withdrawn date's ref goes; a declared row only gains evidence.
- **Withdrawn means gone.** A derived tie or membership whose record is no longer public (a date made private or reported away, a line reported or removed, a character gone private) is deleted with its events. A link's tie is the link's projection: it goes when the link changes kind or an end goes private, and comes back with it.
- **Hooks** (`lib/social/hook.ts`) run after the response, one at a time a process, a second one with the same key dropped while the first waits, and each writes for at most 20 s; outside a request they run at once. The house's ties wait while `HOUSE_SCENES=0` instead of going.
- **The backfill** (`backfillSocial`, the hourly lobby job, 30 s a pass) runs each step whole or in batches of 50 with a cursor in `social_backfill`, and goes round again a day after a step finishes.

### 6.2 Declared (Phase 2b)

- **An owner, about their own characters:**
  - off-screen people, any number up to the cap;
  - places (lives, works, regular, studied);
  - ties between two of their own characters, any kind including conflict.
  - These go live at once.
- **An owner, to someone else's character:** a positive kind only (kin, friendship, work, romance history). The tie starts `proposed` and the other owner gets a notification to accept or decline. With no answer in 14 days it lapses (`declined`, `answered_by` null). Rate limit: 20 proposals a day per person.
- **Negative kinds about someone else's character are never declared.** They come only from what aired (§6.1).
- **House characters** take ties only from the show: its generator, an admin, or what aired. A person can't declare a tie to a house character.
- **Agents** do the same through MCP tools: `get_circle`, `add_person`, `propose_tie`, `answer_tie`, `end_tie`, `set_place`. These are non-core tools.
- **The season generator** gives each candidate 3–6 off-screen people, a neighbourhood, a workplace and a regular spot in the show's world, and ties to one or two show characters, in the call it already makes. Existing show characters (house, cast, agent-made catalog) are backfilled by `scripts/social/backfill-circles.mjs`. It runs on the Mac's local open-weight model, so it costs $0, and its output is licensable. It posts to an admin route, which checks every name and line with `checkShowText`. `origin_model` is recorded.
- **As built (2b, the show's circles, `lib/social/circles.ts`):**
  - **The show's characters** are the house (the season's cast among them) and the show's own agent-made cast (made over MCP by our own agents, `loadOurIds`, as `lib/adult/agent-cast.ts` decides), public, never a persona or a test character. A person's character on the cast gets its circle from its owner.
  - **One write path** for both writers, `writeCircle`: each item is checked alone and refused alone with its reason. The checks: a kind from the registry the house may declare (free words such as "older sister", "boss" or "my mentee" read by `lib/social/relations.ts`); the show's text check on every name, note, story and place name; originals only (`lib/franchises.ts`, as for the show's own characters); the people cap and the exclusive kinds' caps; a place of the right kind for the role (a neighbourhood to live in; a workplace or school may be named new, under a neighbourhood); an off-screen person is never someone with a character on the site (a full name a public character has; the backfill turns one it offered into a tie); ties only to another show character; no kin tie between two who have dated (a `relationships` row, a romance tie, or an ex or fake-couple backstory link whose tie isn't derived yet), and no romance between kin.
  - **The show's characters are single** (decided in 2b): the house never gives one a `spouse`, `partner`, `engaged` or `situationship`, with a character or off-screen. A late spouse is a person it may name.
  - **Idempotent:** a character with the show's circle (people or places the house wrote) is skipped; `replace` (the backfill's `--force`) removes the show's people and declared-role places for it first, never an owner's or agent's.
  - **Provenance:** `source` house, public, `origin_model` the deployment that answered (the backfill's `ollama_chat/qwen2.5:7b` on LiteLLM `local-chat`; the generator's director model) and `prompt_version` (`backfill-circles-v1`, `season-gen-circle-v1`). Places and memberships carry `origin_model` only: their tables have no `prompt_version`.
  - **The admin route** `GET/POST /api/admin/social/circles` (admin password or an admin account): GET pages through the show's characters with their circle so far, whom they've dated and the world's menu; POST takes up to five circles, `dry_run` and `replace`.
  - **The backfill** writes the cast, then the house, then the agent cast. Each character is offered up to eight others to know (the same side of the show first, the least-tied first, never one they've dated or know already), the workplaces earlier characters named (so coworkers share a place), and a sibling's parents (so two siblings have the same mum).
  - **Its prompt, as tuned on production dry runs (2b):** the people are invented, with a first and last name, at least one of them family, and never someone on the show (the model had filled `people` with the character's own name and the cast's); a title alone ("Mum", "Auntie") is left out. Each character is offered the three neighbourhoods with the fewest homes in the run so far, in its own order, and told the show's house isn't its home: offered all six, the model put nearly everyone in The Heights, whose description names the house.
- **As built (2b, owners' tools, `lib/social/declare.ts`):** every declaration a person or their agent makes goes through it, so the page, its route and the MCP tools keep one set of rules.
  - **Who may change a circle:** the character's owner (or their agent), while it's listed. The show's characters (the house, and the show's own agent cast) are read-only to everyone: the show writes them, and nobody declares a tie to one either (decided in 2b: the agent cast's owner is one of our own identities, so a proposal to it would only ever lapse). A person's character on the cast stays theirs.
  - **People:** a name, a relation (a kind's id from the form, or words such as "mum"), pronouns, a line, "late", and who sees them. The relation is the tie to them, so changing it replaces that tie (the new one first, so an exclusive kind's refusal keeps the old). Taking a person off takes their tie with them.
  - **Ties:** "<them> is <mine>'s <relation>", read from either end (a directed kind's `:reverse`), stored in its one form (`child` and `grandchild` flip to their elders'). Between two of the owner's characters it's live at once, any kind. To someone else's, a warm kind only; it starts `proposed` with `detail.proposed_from` (the asking character: a character, never a person's id, since a tie's detail is shown), and the other owner gets `tie_proposal` (the inbox, a push, an email) linking to their character's People tab. They answer on the tab or on the notification itself (Yes and No on /notifications); the asker gets `tie_answer`. A no, or a lapse, stands for 30 days before the same tie can be asked again.
  - **Never declared:** a conflict about someone else's character, a tie to the show's characters or to someone's private character, one across a block, family between two who've dated or romance between family (the generator's `pairClash`), or a character tied to itself.
  - **Ending:** a declared friendship, job or love history that's over is `ended` and stays as past; family is taken off; the asker withdraws a proposal (its notice is marked read); what aired and what the show wrote can't be ended by hand. Either end's owner can hide a tie (owner-only); only the owner who declared it rewrites its story.
  - **Places:** lives (a neighbourhood: a new one replaces the old), works, regular, studied (two, three and two at most). A workplace or school no one has named is named in the form under a neighbourhood, and the same name is the same place, so two who work there are coworkers.
  - **Limits:** 20 proposals a day per person (`SOCIAL_PROPOSE_LIMITS`, lib/limits.ts); every name, line, story and place name passes `checkShowText`; the hourly job lapses proposals 14 days old (`lapseProposals`, a partial index on proposed ties).
  - **MCP (2.47.0, `lib/mcp/circle.ts`):** the six tools call these same functions. `get_circle` is open to anyone and shows what that caller may see; with an identity, its own characters' "only you" items, the proposals waiting on it and the relations it may use, and `world: true` lists the places `set_place` takes (the newest 60 workplaces). The writes act as the caller's agent (`source` agent, `created_by` its id). `visibility` is `public` or `only_you`; anything else is refused, never written as public.
  - **The page:** a People tab on the character page (for the owner always, for anyone else when there's someone in it): who's waiting on you, people off the show, ties by layer, who they've met, places with who else is there. Strangers see what's public; the owner sees their own owner-only items and proposals too. The forms open in a bottom sheet. "Might know" sits inside it for the owner, and "Know them?" opens the tie form with them picked.

### 6.3 Inferred (Phase 4)

`suggestTies(character)` uses common neighbours, Adamic–Adar, shared places, shared events and friend-of-ex, then scores and explains each suggestion. A suggestion is never a tie. It is shown to the owner on the character page and through MCP `suggest_ties`, and the shown suggestion and its outcome go to `social_suggestion_log`.

As built (Phase 4 PR 4, `lib/social/suggest.ts`):

- **Four signals, summed into a score.** The strongest is the logged reason.
  - Common friends (`common_friends`), by Adamic–Adar over ties that mean knowing someone: active, positive, and neither one of the show's encounters nor a date. The character's own ties may be owner-only, since only its owner sees suggestions; the second hop is public only.
  - A shared place (`shared_place`): 2a's `SHARED` roles, weighted by the role and by 1 / ln(how many share it).
  - The same event (`same_event`): one of derive's encounter ties between the two. An encounter is a reason, never an exclusion.
  - A friend of an ex (`friend_of_ex`).
- **Never suggested:** someone the character already has a tie with (any kind but an encounter, any status), a house character or one of the show's own agent cast (a person can't declare one, §6.2; the agent cast since 2b), someone else's private character, a persona, or someone dismissed in the last 90 days. Nothing under 0.3 is shown, so one housemate alone isn't enough.
- **Where it shows.** `GET /api/social/suggest/[id]` (owner only) returns the list and logs what it shows; `POST` with `dismiss` is "Not now". "Might know" is its own block on the owner's character page, and since 2b sits inside "Their people" wherever its owner can change the circle; each suggestion says whether it's one of the viewer's own characters (`mine`), so "Know them?" offers the right relations. MCP `suggest_ties` (outside the core list) gives agents the same.
- **Outcomes.** The daily job settles the log: a suggestion is `accepted` once any non-encounter tie between the two is made after it was shown, and `ignored` after 30 days.

## 7. Living network (Phase 4, `SOCIAL_DYNAMICS`)

- **Closeness:** each aired contact (a date, a scene together, a group night, a told line, a between-dates text count on the public layer) raises `closeness` and sets `last_contact_at`. A daily job decays closeness by each kind's half-life: kin never decays, and friendship has a 120-day half-life. A friendship that falls below 0.15 logs `decayed`, and the tie becomes `old_friend`.
- **Capacity (Dunbar):** "X's world" ranks ties by closeness into the inner circle (≤5), close (≤15), friends (≤50) and acquaintances (≤150). A new best friend pushes someone down a ring.
- **Balance:** a signed triangle census. An unbalanced public triangle becomes a new producer tension, `unbalanced_triangle`, in `lib/story-state.ts`, for example A dating B while B's best friend is A's rival. The producer can stage it, using the public record only.
- **Introductions:** some show-arranged dates prefer a friend of a friend. The date records `met_via: "introduced"` and the introducer, and both actors know who set them up.
- **Dialogue:** an actor's prompt can carry one or two lines about the people in its life, with mutual ties first ("you both know Mira; she's your coworker"). It uses public or own ties only, sits behind `SOCIAL_PEOPLE_IN_PROMPTS`, and the engine never reads it.
- **As built (Phase 4 PR 3).**
  - `lib/social/dynamics.ts` is a `social_dynamics` step of the daily job's `growth` part, before the metrics, with a 30-second budget. Each day a tie's closeness is replayed from its own event log: an aired contact lifts it 15% of the way to 1, and time decays it by its kind's half-life. A run is idempotent, and a missed day changes nothing.
  - A declared tie takes the pair's aired contact from their other public ties, through `logContact`. `dated` (its closeness is the pair's tie strength) and ties to off-screen people are left alone.
  - A friendship fades at the moment it crossed 0.15: it ends with a `decayed` event (a hook in 2a's `setStatus`), and an `old_friend` tie starts from when the friendship did.
  - The metrics fill `social_network_daily.balance` and, on each character's all-layers row, its balanced and unbalanced triangles and its ring sizes, with 2a's `signedTriads` and `rings`.
  - `unbalanced_triangle` comes from public, active ties between public characters only: two of the cast at odds who are both close to a third. Its weight is 4, a same-room beat; the house's confrontations take 5 and up.
  - Introductions (`lib/social/introductions.ts`) are one in four of the lobby's seeded fallback deals: two of the cast who share a public friend and who haven't dated, aren't family and aren't at odds. `setup.introduced_by` holds the friend's character id.

## 8. Privacy, consent and licensing

- **Public:** derived ties (all from aired, public records), declared ties with `visibility = public` between public characters, and memberships.
  - A tie touching a private character is masked as on /graph today: the pair's existence only.
  - An unlisted or deleted character vanishes.
- **Owner:** what an owner declared `owner`-only, plus pending proposals.
- **Private:** engine-only.
- **As built (2a, `lib/social/read.ts`):**
  - **Masked pairs:** a masked pair is one entry with no kind, no layer and no tie id, since the id is a hash of the kind.
    - On the sky it appears only in the `all` view, because a narrower view would give its layer away.
    - A private character's world shows its name and that its public ties exist. Its people and places are hidden.
    - `/api/social/pair` returns 404 for a pair touching a private character, as `/api/graph/[a]/[b]` does.
  - **Owners:** the owner of either end of a tie sees it unmasked, sees it while it's `owner`-only, and sees it while it's proposed. The owner of a character sees its `owner`-only people and memberships.
  - **History:** it never says who did something or which model wrote it. A `source_ref` shows only while that ref is still in the tie's evidence, so a withdrawn date doesn't linger.
  - **Shared places** are worked out from current, public memberships:
    - works and studied count on the work layer;
    - lives, regular and from count on the place layer;
    - living in the house doesn't count (that's the `housemate` tie), and nor does living in the city.
    - A world names up to 50 co-members per place and role. The sky lists shared places as groups (members and a count), never as pairs.
  - **Caching:** public builds are cached for 60 s under the Constellation's tag. A viewer who owns an end gets an uncached build of their own.
- **Deletion:** every row cascades from `characters`. Account export lists the person's characters' people, ties, places and the proposals they made or answered. `lib/person-columns.ts` lists `created_by`, `answered_by`, `actor` and `viewer`.
- **Retention:**
  - ties and people live as long as their character;
  - `social_tie_events` lives as long as its tie;
  - `social_suggestion_log` lives 400 days;
  - `social_metrics` lives 400 days daily, then weekly.
- **Licensing, not selling.** The privacy page says Botchelor never sells personal data, and that stands. A dataset (§10) holds only:
  - house characters, and characters whose owner opted in by the time of the tie, using `consentedCharactersSql`;
  - public, aired or declared-public rows;
  - no account ids (pseudonymised per dataset);
  - no After Dark;
  - rows filtered by `origin_model` terms (closed models' outputs are excluded from training sets unless their terms allow it).

## 9. The page (Phase 3, `SOCIAL_LENSES`)

- **A view switch on /graph:** Love (today's Constellation), Friends and family, Rivals, Gossip, Everything. Each has its own link (`?lens=`) and its own numbers line ("12 feuds, 3 patched up"; "most talked about").
  - Everything draws every layer at once: line colour and dash per layer, and a red tint for negative valence.
  - The non-Love views read a cached public build, cached like the Constellation and dropped by the same tag.
  - **As built (Phase 3 PR 1, #1928).** The views read `/api/graph/lens?lens=` (`lib/social/lens-sky.ts`), not `/api/social/sky`, which stays the general read for agents and other pages. It is the same `publicSky`, shaped for the canvas on the server: one record a pair with a line a group (a pair can be coworkers and exes at once), the characters' faces and facts, the numbers line, and places as stars of their own with a spoke to each member (up to 24 a place, 30 places), since a place is a group, never pairs (section 5.4). It is capped at the strongest 400 ties and 500 stars, and fetched when a view is first opened, so /graph's first load is unchanged; an address with `?lens=` is drawn by the server. Who made them, what they are and "just their corner of the sky" (#1917's filter, called "just them and their world" until Phase 3's second PR) carry across views; the Love-only controls (when, still seeing, who they dated, the orbit) step aside. Colours: only three hues pass the colour-blind check against each other on the night sky (green, blue, red), so the other groups are neutrals and every group has its own dash; red marks a tie that feels bad whatever its kind.
- **"X's world"** (`/graph/world/[id]`), server-rendered SVG that is shareable and indexable.
  - The character sits in the centre, with rings around them: the inner circle, close, friends, acquaintances.
  - Conflict ties sit on a red arc, off-screen people are small grey dots, and places are labels on the outside.
  - It's the phone default when someone is focused.
  - The character page links "See their world"; the Constellation's side panel links it too.
  - **As built (Phase 3 PR 2).** `app/graph/world/[id]/page.tsx` draws `lib/social/world-picture.ts`'s layout of the public build (`cachedWorld(id, null)`: the same for everyone, so an owner's own ties stay on the character page). The rings are `rings()`'s (5, 15, 50, 150), each face grouped round its ring by its closest tie's layer; whoever they're at odds with (any active tie that feels bad) sits at the foot of their ring on a red arc; the lines are the views' (`foldTies`, one a group); off-screen people are small grey dots with their names; the places they belong to now are labels round the edge, each near the people who share it (at most eight, the most shared first, laid out for a phone's type so none overlaps). Every face links to that character's world and every line to their row in the list under the picture, which says what they are to each other, the places they share and what made it (`lib/social/evidence.ts`: the date, the house scene, the night, the season once its page is up; a story beat is words only), then Off the show, Private, Before (ties that are over) and Places. A private centre is its name and how many public ties it has, a pair touching a private character a grey dot and a grey dash; a deleted account's character, a persona, an unknown id and `SOCIAL_LENSES=0` are a 404. It has its own title, description, breadcrumb JSON-LD and a drawn share card (`opengraph-image.tsx`: no portraits), and says noindex when the centre is private, has fewer than three public ties or the character page itself isn't indexed (`characterIndexable`). "The phone default when someone is focused" is the focused character's panel: on a phone "See their world" is its first action, filled, while the sky stays one tap away; a focus doesn't jump to the page, since the sky is what the person asked for. #1917's filter, which cuts the sky to someone's two-step neighbourhood, is now called "Just their corner of the sky" (its address is still `?world=`), so "their world" means this page only; its line over the sky links the page too.
- **Pair panel:** every tie between two characters, across layers and time ("Coworkers at the lighthouse · Exes · Rivals since November"), with links to the dates and scenes that made them.
- **Tense triangles:** a section of unbalanced public triangles as story hooks, each linking to its evidence.
- **Clusters named after their places:** a community's most shared place names it, such as "Regulars at the dive bar" or "The Leeds lot".
- **Character page "Their people":** off-screen people and ties by layer, editable by the owner (Phase 2b), with "Might know" suggestions (Phase 4).

## 10. Analytics and the dataset (Phase 4, `SOCIAL_METRICS`)

- **Daily job:** within a time budget, fill `social_metrics` and `social_network_daily`. The measures are pure functions in `lib/social/analytics.ts`, next to 2a's `lib/social/algorithms.ts` (ego network, rings, signed triads). They are tested against networkx on Zachary's karate club and on small graphs with known answers.
  - PageRank uses power iteration.
  - Betweenness is exact up to 5,000 characters, then sampled from seeded pivots. The daily job runs on the show's own instance, so it asks for less: exact up to 1,000 characters a layer, 256 pivots above that, and it yields to the event loop before each measure.
  - Communities run both seeded label propagation and Louvain and keep the split with the higher modularity. Label propagation alone once flooded this graph's clusters into one (`lib/graph.ts`), and on a clustered 100k-node test graph it scored 0.48 to Louvain's 0.79.
  - The whole set runs on 100k characters and 300k ties in about 3 seconds, plus about 5 seconds for 500 betweenness pivots.
- **The job** (`lib/social/metrics-job.ts`) is a step of the daily job's `growth` part, before the lessons, with a 45-second budget. It reads every public, active tie between two public characters (keyset pages of 5,000), measures each layer and all of them, then writes the rows in batches of 500 that never split a character. A day that runs out of time stays incomplete with a cursor, and the hourly job's passes finish it after their response. A finished day does nothing; the day seeds every random choice.
- **Admin:** `/admin/social` shows the network's numbers over time, layers, balance, licensable rows by source and model, and the suggestion hit rate.
- **Dataset builder:** `scripts/social/export-dataset.mjs` (admin, offline) writes a versioned folder:
  - `nodes.jsonl`, `people.jsonl`, `places.jsonl`, `memberships.jsonl`, `ties.jsonl`, `tie_events.jsonl`, `metrics.jsonl`, `network_daily.jsonl`;
  - `datasheet.md`, in the "Datasheets for Datasets" form: motivation, composition, collection, consent, provenance, known gaps;
  - `manifest.json`, with counts and hashes.
  - Ids are pseudonymised with a per-version salt.
  - It filters through §8, and it writes only; nothing is uploaded.
  - **As built (Phase 4 PR 5).** The gate is `lib/ml-consent.ts` loaded as the app's own code (`loadLib`, as the preference export does), judged at each row's creation (a tie's, a person's, a membership's). The salt is kept beside the folder (`<version>.salt`), never in it, so a version can be rebuilt with the same ids and two versions can't be joined. Evidence goes out as the kinds of record a tie came from (`{episode: 3}`), never their ids; a change's story text is dropped (it may predate the tie going public); `actor`, `created_by` and `answered_by` are never read. `--allow-model` lists the models whose writing may go in (none by default, or `all`). The datasheet counts what each filter left out. docs/data-plan.md has the section.

The data points this produces, per character and per day: degree and closeness by layer, ring sizes, centrality, community, structural holes, balance, reputation (mean public in-valence), places and roles, off-screen people, and every tie's full history with provenance. Per network, per day: size, density, clustering, modularity, assortativity by kind, origin and tags, and balance. Link-prediction ground truth comes from the suggestion log.

## 11. Switches

Each switch is on unless set to `"0"`. Off means the site is exactly as before.

| Switch | Covers |
|---|---|
| `SOCIAL_TIES` | All social writes and reads; derivations; the API routes |
| `SOCIAL_DECLARE` | Owner and agent declarations and proposals |
| `SOCIAL_LENSES` | The /graph views, "X's world" and the pair panel's extra ties |
| `SOCIAL_PEOPLE_IN_PROMPTS` | People lines in actors' prompts |
| `SOCIAL_DYNAMICS` | Decay, introductions and the triangle tension |
| `SOCIAL_METRICS` | The daily analytics |

## 12. Phases, builders and PRs

| Phase | What | Depends on | PRs |
|---|---|---|---|
| 1 | /graph filters and lines: stage colours and filter, time, still-seeing, phone filter sheet, focus with two-step world, corrected notes | — | #1913 lines and stage filter, #1914 when, still seeing, Filters sheet, #1917 just them and their world |
| 2a | Core: schema (§5.2–5.4), kinds, `lib/social/` (kinds, ties, people, places, world, derive, read, algorithms basics: ego network, rings, signed triads), derivations and backfills (§6.1), read API (`/api/social/world/[id]`, `/api/social/pair/[a]/[b]`, `/api/social/sky`), data-plan coverage | — | #1911 tie store, people, places and the world; #1915 derivations and the backfill; #1918 the read layer and API |
| 2b | Declared: owner UI ("Their people", ties, places, proposals, notifications, rate limits), the generator, the local-model backfill and admin route, MCP tools, the prompt line | 2a | #1923 the show writes circles (generator, admin route, backfill); #1926 real names in the circles; #1935 owners' people, ties and places, and the backfill's prompt as tuned; #1937 people in the date prompt |
| 3 | The page: views, "X's world", pair panel, tense triangles, place-named clusters, character page links | 2a | #1928 the views, #1934 "X's world" |
| 4 | Living network, analytics, suggestions, dataset: dynamics (§7), `social_metrics`, `social_network_daily`, `suggestTies` and its log, `/admin/social`, the dataset builder, data-plan update | 2a | #1908 analytics, #1916 metrics job and /admin/social, #1920 dataset builder, #1922 living network, #1924 suggestions |

## 13. Scaling notes

- **Indexes:** every read is by index. An ego network is O(degree). The sky builds are capped (the strongest N ties per view) and cached for 60 s, like the Constellation.
- **Memberships** keep places linear. A 10,000-member hangout is 10,000 rows, not 50 million pairs.
- **Analytics** page through ties and stop at a time budget, picking up where they left off the next day. Past about 1 M ties, export to Parquet and DuckDB on a schedule, and run the analytics there. The dataset builder's JSONL already has that shape.
- **Ids** are text and stable. Datasets pseudonymise them.
- **New kinds or layers** need no migration; new node types (groups, shows) slot in as membership tables.
- **The event log** partitions by month past about 10 M rows.

## 14. Decided calls

- **One graph with views, not separate graphs:** the overlaps (coworkers and exes) are the story.
- **Off-screen people are their own node type:** they never pollute the character directory, and they can be promoted.
- **Negative ties about another owner's character come only from what aired:** nobody can brand someone else's character an enemy.
- **House characters take ties only from the show.**
- **Opinions and gossip stay private:** the public Gossip view draws only aired house-scene lines, as the story map does.
- **Backfill with the local open-weight model:** $0 and licensable. The generator's own call records its model, so a dataset can filter it.
- **Licence, don't sell:** the privacy page's promise stands.
