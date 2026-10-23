# The data plan: what Botchelor keeps, who can use it, and for how long

The "world for agents to date" data plan (David, 2026-10-22) records the choices people and agents make, so that one day
the show's models can learn from them. It shipped in #666 (consent and the gated export), #667 and #668 (capture), #675
and #676 (structured fields, embeddings, reflection labels, how they met) and #678 (the Constellation). A post-merge
review on [#678](https://github.com/smithdavedesign/botchelor/pull/678) found gaps in consent, deletion and retention;
this page describes the plan as it stands after the fix, so that David and later sessions can check the promises on the
privacy page (`app/legal/sections.tsx`) against the code. The tools that will use it came next, built ahead of the data
and run by nobody yet: a readiness tracker on /admin/analytics, the #577 training-set builder with its local LoRA path,
and the #578 offline evaluators ([below](#when-the-learning-can-start-libtraining-readinessts)). None of them trains,
changes the live show or spends anything.

**The rule in one line:** the show records what it needs to run; only aired public dates, from people who opted in, ever
go into a dataset; After Dark never does; and nothing the plan keeps about a person or their characters outlives
deleting them.

## What's collected, and why

Every write is best effort (a failed write never breaks the action it records) and none of it changes an outcome.

| Where | What | Why | Since |
|---|---|---|---|
| `ml_consents` | `user_id`, `granted`, `version` (the wording agreed to), `decided_at`. One row per account. | The opt-in to training (below). | #666 |
| `analytics_events` `cross_species_match` | One row per web × MCP pair, keyed `pair:<lo>:<hi>`. `props` holds `episode_id` and `via` (`booking`, `own_date`), no owner ids. | When a pair first booked across the human × agent line, and how. A log only: the north star is counted from the dates (below). | #666 |
| `relationship_events` | `character_a`, `character_b`, `layer` (`public` or `all`), `from_stage`, `to_stage`, `episode_id`, `at`. One row per layer whose stage changed (`lib/relationships.ts`). | A pair's timeline (first met, dating, exes, rekindled) instead of an overwritten value. `all` can reflect private dates, so only owners and the engine read it. | #667 |
| `swipe_impressions` | `viewer`, `card`, `serve_id`, `rank`, `score` (the deck's, never shown), `liked_you`, `served_via` (`web`, `mcp`), `at`. | What a deck showed: with the swipes, the shown-and-skipped record a preference model needs. Prefetches aren't logged. | #667 |
| `matches.answer_source_lo/hi` | `agent`, `house_bot`, `synthetic` (the seeded coin for a person's character), `house`, `person`. | Only an agent's answer is a real decision; a model of who wants whom must know which is which. | #667 |
| `episodes.engine_trace` | `margin`, `score`, `thresholds`, `reasons`, `counts`, `signals` (the averaged warmth, openness, guardedness and humour), `terms` (each variable's sum, term by term), `contributions`, `sat`, `engine_version`, `strategy`, `ending`. Never a cue word. | Why the engine decided a date's ending, without re-running it. | #667 |
| `episodes.turn_meta` | Per transcript line, in the same order: `{ at, by }`, `by` being `show`, `byok` or `agent`. | When each line was written and by whom. A parallel array, so the transcript's shape is unchanged. | #667 |
| `choice_history` | `kind` (`prediction`, `nudge`, `nudge_cleared`, `review`, `ml_consent`), `user_id`, `episode_id`, `character_id`, `other_id`, `value`, `at`. | Every change of mind, not just the latest. A prediction is recorded only when its pick changes; sending the same pick again adds nothing. | #668 |
| `turn_drafts` | `episode_id`, `turn_index`, `side`, `source` (`critic`, `agent_refused`, `agent_check`), `reason`, `rejected`, `created_at`. At most 60 a date, 600 characters a line. | The rejected half of chosen/rejected pairs for preference tuning (ROADMAP, #577). A line a safety filter caught keeps its reason only (`rejected` is null). A `never_says` catch keeps a generic reason, never the sheet's phrase. | #668 |
| `episode_variations` | `varies_episode_id`, `variation`, `engine_version`, `base_ending` (the engine's replay as booked), `stored_ending`, `alt_ending`, `alt_box_score`, `alt_sides` (booleans only), `alt_trace`, `faithful`, `requests`, `created_at`. | An owner's Sliding Doors runs, kept as counterfactuals. The chaos replay a watch party polls is never stored. | #668 |
| `character_embeddings.model`, `text_hash` | Which model made a character's concept embedding, and a hash of the exact text. | So an unchanged character never re-embeds and a model change re-embeds everyone. | #676 |
| `episodes.reflection_labels` | `{ a, b }`, each with `rating` (1–5), `would_date_again`, `worked` and `didnt` (up to 3 tags each). | Structured "how did it go" from `reflect_on_date`. Owner-only: never in the public episode, a prompt or the engine. | #676 |
| `episodes.setup.met_via` | `blind`, `match`, `proposal`, `chosen`, `second_date`, `own_date`, `show`. | How a date came about. Server-side only; the Constellation publishes only a coarse version. | #676 |

Also related: `line_feedback` (2026-10-21, just before the plan) holds the 👍 and 👎 on lines that the export reads, and #675
added four optional, public fields to a character's `extras` (`kind`, `archetype`, `here_for`, `drawn_to`).

## The consent gate

`lib/ml-consent.ts` is the one definition. `consentedOwnerSql(ownerExpr, atExpr)` is true when:

- the owner has an `ml_consents` row with `granted = true` **and `version = ML_CONSENT_VERSION`**. A yes to an older wording
  counts as no until it's given again, and `/account` says so (`getMlConsent` returns `outdated: true`). Bump the version
  whenever the privacy page's "Training and research" section changes meaning;
- or the owner is an agent linked to such an account (`agent_links`) **since before `atExpr`** (the date's `created_at`,
  or the vote's). A link covers what the agent does from the moment of the link on. When an agent is moved to another
  account, `confirmLink` starts a new `linked_at`, so the new account's consent never reaches back over dates the agent
  played for someone else. Linking to the same account again keeps the original time. The cost of this rule: dates from
  before an agent's first link aren't covered either, since a first link and a move look the same.

House characters belong to the show and need no consent. Anonymous sessions can't consent (401).

**What it covers:** what goes into a training or evaluation dataset. A dataset builder must check every character on a
date and every person whose vote it reads.

**What it doesn't cover:** what the show records to run itself (everything in the table above is recorded whatever the
consent says), the admin dashboards and Real use, analytics, and the engine reading a character's history. Consent never
lets in After Dark, private or unlisted dates, or a private soul. The dataset readers are the preference export, the
#577 training-set builder (which reads `turn_drafts` too) and the #578 offline evaluators (swipes, impressions, matches,
first and second dates), all through the same gate (below). Nothing exports choice history, and anything that ever does
must go through it too.

`lib/ml-consent.ts` also holds the two gates every reader shares, so none of them keeps a copy:
`airedPublicSql(e)` (public, revealed, ready, fewer than 3 reports, not After Dark) and
`consentedCharactersSql(a, b, at)` (both characters the show's own or opted in by `at`).

## The export (`scripts/eval/export-preferences.mjs`)

```sh
DATABASE_URL="$(neon connection-string --profile davejobs-agent --project-id cool-boat-29098893)" \
  node scripts/eval/export-preferences.mjs [--out .data/preferences/preferences-<date>.jsonl] \
    [--since 2026-10-01] [--context 4] [--db url | --pglite dir]
```

- `--out`: where the JSONL goes (default `.data/preferences/preferences-<today>.jsonl`).
- `--since`: only votes updated since this time.
- `--context`: how many lines before each rated line to include (0–20, default 4).
- `--db` / `--pglite`: the database (default `$OBSERVER_DATABASE_URL`, then `$DATABASE_URL`). Every connection is
  read-only (`default_transaction_read_only=on`) and only SELECTs run.
- `--include-after-dark` is refused, and so is anything else it doesn't know.

One record per rated line of a date: `kind: "episode"`, `ref_id`, `line_index`, `votes { up, down, voters, score }`,
`last_vote`, `speaker`, `other`, `text`, `action`, `emotion`, `act`, `moved_to`, `context`, `source` (setting, venue,
ending, who performed it, the model, when). No user ids.

The gates, all on, none of them a flag:

1. **The date aired publicly:** public, revealed, ready, fewer than 3 reports, not an After Dark date.
2. **Both characters** are the show's own or their owners pass the consent gate at the date's time.
3. **Only opted-in voters' votes count:** each vote passes the consent gate at the time it was cast. A line no opted-in
   person rated is left out.
4. **After Dark votes are never read.**

The log line counts `skipped` (the date is gone) apart from `excluded` (still there, but a gate left it out). The script
loads `lib/ml-consent.ts` through Vite's module runner (`loadConsent`, as `after-dark-observer.mjs` loads the observer),
so the gate is the app's own SQL, never a copy; `tests/ml-consent.test.ts` checks the two agree. The `publicOnly` and
`consentOnly` options exist only for the tests of the record's shape. `loadLib(path)` loads any other lib module the same
way; the scripts below use it.

## When the learning can start (`lib/training-readiness.ts`)

The roadmap's two learning items ([#577](https://github.com/smithdavedesign/botchelor/issues/577) and
[#578](https://github.com/smithdavedesign/botchelor/issues/578)) each say "Not before", and real use on 2026-10-22 was
about zero. So the tools are built ahead and a tracker says when the data has caught up: **/admin/analytics → Quality →
"Ready to learn from our own data?"** (`GET /api/admin/training-readiness`, owner-only, counts only, no money). Each gate
shows as "x of y" with a sentence that says what's still needed.

| Item | Gate | How it's counted |
|---|---|---|
| #577 fine-tuning | 2,000 labelled lines | A line of a date the dataset gates admit (aired publicly, every character opted in by the date's time or the show's own, neither a private character) with at least one label: a 👍/👎 from someone opted in when they voted, or a critic revision whose draft text was kept. Counted once however many labels. The observer's flags are After Dark's, so they never count. |
| | 30 characters | The distinct characters speaking those lines (house cast included; the page says how many are players'). |
| | mostly from other players | More than half of those lines have a label that isn't ours (`loadOurIds`): a vote by someone who isn't us, or a critic revision on a date someone who isn't us booked. |
| #578 outcomes | 500 real dates in 30 days | Real use's "Dates booked" (`lib/real-metrics.ts`), our own traffic left out. |
| | 200 swipers in 30 days | Distinct owners whose characters swiped, from the same facts Real use reads, ours out. |

Beside the #578 gates the page says how much of that the offline evaluators may actually read (opted-in, aired public
dates and opted-in swipers): the gate counts all real use, the evaluators only the consented part. The training-set
builder and both evaluators print the same numbers and say "not enough data" (or, for the builder, refuse) below them.

## Fine-tuning (#577) when ready

Nothing here has run: it's the path, written down, for when the tracker says ready. It's local and $0 (the Mac's own
GPU, open weights); **any managed fine-tuning spend is David's call** (#577: a few dollars to about $20 a run), and
**After Dark is excluded by the privacy promise**: the page and the account toggle say it's never used for training, the
builder can't be asked for it, and changing that would need the privacy page's promise changed first.

### 1. Build the set (`scripts/eval/build-training-set.mjs`)

```sh
DATABASE_URL="$(neon connection-string --profile davejobs-agent --project-id cool-boat-29098893)" \
  node scripts/eval/build-training-set.mjs --out .data/training/v1 [--seed 577] [--eval-share 0.2]
```

Read-only, free, and through the export's own gates (it calls `collectPreferences` for the votes and reads the dates with
the `lib/ml-consent.ts` SQL, through `lib/training-set.ts`). Under #577's gate it prints the readiness and exits 1 without
writing anything; `--allow-small` builds anyway, for testing. It writes:

- `sft/train.jsonl`, `sft/valid.jsonl`: `{"messages": [system, user, assistant]}`, what `mlx_lm.lora --data` reads.
  - **system:** the show's actor prompt word for word (`lib/conversation.ts actorSystemPrompt`, the moving one when the
    date could move), then the speaker's sheet as `characterSelfView` builds it, minus everything private: no soul, no
    learned memory, no dealbreaker, no never-says, no private facts or After Dark looks (`publicExtras`), none of the
    date's private context (agenda, the owner's note, the dials). Then the other side as a blind date sees them
    (`characterBlindView`), where they are (after any move), what the speaker hopes for, and the act's public facts.
    Left out because they're private or rebuilt from the engine: the beat sheet's intention, the pair's memory, texts,
    nudges, the tell and the goodbye move. A faithful minimal version of `buildTurnMessages`, documented in
    `lib/training-set.ts`, since the real one needs the engine's outcome and the private context.
  - **user:** the conversation so far, as the show writes `conversation_so_far`, and the act's name.
  - **assistant:** the kept line as the reply JSON the show parses: `{"dialogue","action","emotion"}`.
  - **Kept:** a line that's net 👍 (opted-in votes), or never flagged (no 👎) and never revised (no critic draft).
- `dpo/train.jsonl`, `dpo/valid.jsonl`: `{"prompt": [system, user], "chosen", "rejected"}`, replies as `{"dialogue"}`
  JSON (a draft keeps only its words). Pairs: a critic revision over the draft it replaced (unless the revision went
  net 👎), and a net-👍 line over a net-👎 one where both answer the very same prompt.
- `manifest.json`: counts, what was dropped and why, the split's sizes, the readiness. No ids.
- **Hold-out by character**, seeded (`--seed`): each character is in train or valid, never both, and a date whose two
  characters landed apart is dropped, so no character's lines are on both sides, as speaker or as context.
- **Never:** After Dark, private or unlisted dates, private characters, a soul, a dealbreaker's words (a date is cut from
  the first line where a character uses its own dealbreaker's words), a draft a safety filter caught, a draft's reason.

### 2. Train a LoRA on the Mac (mlx-lm, not run)

A 16 GB M1 fits QLoRA on a 3–8B instruct model at batch size 1. Start with a 3B (fast, and Llama-family, so Ollama can
import it); an 8B is the stretch. Flags as `mlx_lm.lora` defines them (mlx-lm on GitHub, `mlx_lm/lora.py`):

```sh
python3 -m pip install mlx-lm          # once; Apple silicon only
# SFT: loss on the assistant line only (--mask-prompt). A prompt is ~2.5k tokens, so lift the 2,048 default.
mlx_lm.lora --model mlx-community/Llama-3.2-3B-Instruct-4bit --train --data .data/training/v1/sft \
  --fine-tune-type lora --mask-prompt --batch-size 1 --grad-accumulation-steps 8 --num-layers 8 \
  --iters 1000 --learning-rate 1e-5 --max-seq-length 4096 --grad-checkpoint \
  --steps-per-eval 100 --val-batches -1 --save-every 100 --seed 577 --adapter-path .data/lora/actor-v1
# The held-out characters' loss (it reads test.jsonl, so point it at the valid split):
cp .data/training/v1/sft/valid.jsonl .data/training/v1/sft/test.jsonl
mlx_lm.lora --model mlx-community/Llama-3.2-3B-Instruct-4bit --adapter-path .data/lora/actor-v1 \
  --data .data/training/v1/sft --test --test-batches -1 --max-seq-length 4096
```

The 8B: `--model mlx-community/Meta-Llama-3.1-8B-Instruct-4bit --num-layers 4`; if it runs out of memory, shorten
`--max-seq-length` or stay on the 3B. A quantized `--model` is what makes it QLoRA (`mlx_lm.convert --hf-path <repo> -q
--q-bits 4 --mlx-path <dir>` makes one from any Hugging Face model). DPO comes second (#577's plan): `mlx_lm.lora` trains
SFT only, so the `dpo/` files are for a preference trainer (TRL's `DPOTrainer` reads `{prompt, chosen, rejected}`), on
the Mac or wherever David decides.

### 3. Serve it, OpenAI-compatibly

Either one, at 127.0.0.1 so the golden run counts it as $0:

```sh
# mlx-lm's own server (http://127.0.0.1:8080/v1). Ask for "default_model": that's --model with --adapter-path applied.
mlx_lm.server --model mlx-community/Llama-3.2-3B-Instruct-4bit --adapter-path .data/lora/actor-v1 --port 8080
# Or Ollama (http://127.0.0.1:11434/v1, already on the ai-stack): fuse, export GGUF (Llama-family, fp16), import.
mlx_lm.fuse --model mlx-community/Llama-3.2-3B-Instruct-4bit --adapter-path .data/lora/actor-v1 \
  --save-path .data/lora/actor-v1-fused --dequantize --export-gguf --gguf-path actor-v1.gguf
printf 'FROM ./actor-v1-fused/actor-v1.gguf\n' > .data/lora/Modelfile   # FROM is relative to the Modelfile
ollama create botchelor-actor-v1 -f .data/lora/Modelfile --quantize q4_K_M
```

`mlx_lm.server` ignores `response_format`, so the JSON reply comes from the training itself; `ollama show
botchelor-actor-v1 --template` should show the Llama 3 chat template.

### 4. The golden gate (`scripts/eval/golden.mjs`)

The dates suite takes a candidate in B's place: the eval case is built on this machine (`lib/eval.ts runEvalCase`, in
memory, nothing stored) with the candidate as the actor, against A on a deployment. There's no default endpoint or
model; a key, if the endpoint needs one, is read from the environment variable `--candidate-key-env` names.

```sh
export CRON_SECRET="$(security find-generic-password -s vault/botchelor/CRON_SECRET -w)"
node scripts/eval/golden.mjs --suite dates --label prod-vs-actor-v1 --base-a https://botchelor.com \
  --candidate-base-url http://127.0.0.1:11434/v1 --candidate-model botchelor-actor-v1 \
  --candidate-director-model llama3.2:3b --repeat 3 --gate --post
```

`--candidate-director-model` gives the plan and the recap to another model at the same endpoint (the fine-tune learned
only the actor's lines); without it the candidate directs too. With `mlx_lm.server`, pass `--candidate-model
default_model`. A's dates are the deployment's own (about 1.3¢ each on the paid default, or its eval key's free quota;
the script prints the estimate first and stops at `--max-usd`).

### 5. The ship rule (#577)

A tuned model ships only when **all three** hold:
- it wins **at least 55%** of the golden side-by-sides (the gate's own floor is 45%: pass `--thresholds win=0.55`);
- **no metric regresses** past its tolerance (`--gate` checks every gated one);
- it costs **no more per step** than today's model.

Then it goes in as the show's model behind the existing switches, never as a silent swap.

## Learning from outcomes (#578) when ready

Report only. Nothing below changes the deck, the prompts or the engine, and the engine stays deterministic: a learned
model only ever informs previews and who meets whom, never an ending. Both evaluators read `lib/outcome-data.ts`, which
gates every row the same way (a swipe, an impression or a match counts only between opted-in or house, public characters,
none of them ours; a date only when it aired publicly, its characters opted in and nobody ours; a second date only when it
aired publicly too; a first date whose follow-up didn't is left out rather than read as "no"). Both take `--db` or
`--pglite` (read-only), print "not enough data" first below #578's gate, and write `--json` if asked.

- **(a) The deck, by collaborative filtering** (`scripts/eval/deck-cf-offline.mjs`): item-item CF over likes (1), likes
  that became matches (+1) and pairs that reached a second date (+2, both ways), cosine between cards. A time-based
  hold-out (the last `--test-share` of likes): each viewer with history is shown the cards it saw or swiped after the
  cutoff, ranked by CF, by popularity, and by the deck's own score at the time (`swipe_impressions.score`, replayed;
  `lib/dating.ts rankFor` can't be re-run for the past, since it reads today's relationships and trait statistics, which
  already include what happened after the cutoff). Hit rate @5 and @10, catalog coverage, and how many viewers CF could
  score at all.
- **(c) Chemistry** (`scripts/eval/chemistry-model.mjs`): logistic regression in plain JS on public sheet fields (traits
  counted over both sides, shared traits, the temperament traits and voice describe, the format, what kind of being each
  is) → a second date. `--outcome booked` (the default: the couple booked one and it aired, after a week to do so) or
  `ending` (the engine's own second-date ending). A time-based hold-out, AUC and log loss against the base rate and
  against `chemistry_on_record` replayed from the training dates (`lib/compatibility.ts`).
- **(b) The prompt and model, chosen by outcome: a design, not code.**
  - **Arms:** 2–3 variants of the actor prompt or model, each first through the golden gate (no arm that loses there
    is ever served).
  - **Assignment:** per booked date, by Thompson sampling: each arm keeps a Beta posterior per reward, the date goes to
    the arm whose draw is highest, and a fixed share (say 20%) always goes to today's prompt as the held-out control.
    Both sides of a date get the same arm; the arm is recorded on the date (`generated_with`), never shown.
  - **Reward:** second-date rate (the primary: did the couple book another, within a week), rewatches (a date's views by
    others than its owners), and the net of opted-in line votes, each a 0/1 per date, combined with fixed weights
    written down before it starts.
  - **Safety:** an arm whose posterior falls clearly below the control's is dropped; nothing changes the engine's
    ending; After Dark is never an arm. Ships when the winner beats the held-out control on second-date rate or
    next-day return (#578's rule).

## How long it's kept (`lib/retention.ts`)

The daily job (`app/api/jobs/daily/route.ts`) runs `pruneKeptData` first, before the long texts step, so a run that runs
out of time never skips it. It logs `data_pruned` with the rows removed per table.

| Data | Kept |
|---|---|
| `choice_history` | 400 days, except `ml_consent` decisions: those stay as long as the account (the record of what someone agreed to, and when). |
| `swipe_impressions` | 400 days (was `lib/swipes.ts pruneImpressions`, now here). |
| `turn_drafts` | 400 days. |
| `relationship_events` | 400 days. |
| `episode_variations` | 400 days from the first run. |
| `episodes.engine_trace`, `turn_meta`, `reflection_labels`, `setup.met_via` | As long as the date (they explain it). Soul-derived numbers go earlier, on a forget. |
| `line_feedback` | Until the voter deletes their account. |
| `ml_consents` | Until the account is deleted. |
| `analytics_events` | No prune yet (the funnel's firsts and the pair log are small). |

400 days (about 13 months) keeps a year-over-year view, as the deck impressions and the MCP call log already did. Each
prune reads an index on its time column (`lib/db.ts`).

## The account export and what goes on delete

**In the account export** (`lib/account.ts exportAccount`): the consent (`ml_consent`), `swipe_impressions`,
`relationship_events`, `choice_history`, `turn_drafts`, `reflection_labels`, `line_feedback`, and `episode_variations`
(the runs on dates they booked or their characters were on, without `alt_trace`, whose numbers average both characters).
`matches` carries the answer sources.

**When a character is forgotten** (deleting it once it has dates, or deleting the account; `forgetEverything`):

- its impressions (as viewer and as card), its pairs' `relationship_events`, choices about it, and its matches and swipes;
- its side's `turn_drafts`; the other side's stay with the shared date;
- every `episode_variations` row on its dates (a replay built on its soul's numbers, so it goes whole);
- its reflection text and labels, and its concept embedding;
- **the soul-derived numbers on its dates:** `engine_trace.signals` and the terms built from them (`chemistry.humor`,
  `chemistry.warmth`, `attraction.openness`, `trust.warmth`, `trust.guarded`, `awkwardness.guarded`,
  `awkwardness.humor`; `TRACE_SOUL_PATHS`), and its side's `setup.signals_a`/`signals_b` snapshot on finished dates. The
  margin, score and other terms stay, since they explain the aired ending. A later Sliding Doors run on such a date reads
  neutral numbers for that side, so it may record `faithful: false`.

Votes on its dates stay: they belong to the voters, like predictions, and go with the voter's account. They can't reach
a dataset anyway, since the forgotten character's owner (the deleted owner) never consents.

**When an account is deleted** (`deleteAccount`): all of the above for every character it kept, then its consent,
choice history, votes, the Sliding Doors runs on dates it booked, its agents' `agent_links` rows (so the consent they
carried goes too), and everything else keyed to it.

## The north star

`lib/agent-funnel.ts crossSpeciesPairs`, shown on `/admin` and logged daily as `relationship_metrics.cross_species_pairs`:
the number of pairs of characters, one made on the website and one over MCP, that have at least one date that

- finished (`status = 'ready'`),
- isn't private (public and unlisted count),
- has two different owners, neither the show,
- involves none of our own identities (`lib/our-traffic.ts loadOurIds`: admins and their agents, our checks and scripts,
  the house-run bots, people from before the public launch, the deleted owner),
- and isn't a person's web character dating the character of an agent linked to that same person.

It's counted from the dates at query time, not from the `cross_species_match` log. #666 ran two one-way statements on
prod on 2026-10-22: it stripped the owner ids from the old episode-keyed log rows, which can't be restored (so those rows
can't be told apart as ours or real), and it backfilled a `pair:` row for every past web × MCP pair, private and test
pairs included. Both statements are gone from `ensureSchema`, and the count doesn't read the log, so it's right without
them. Expect it to drop when this ships: the #666 count included private, unfinished, test and self-linked pairs.

## What's never collected

- **After Dark:** none of the plan's capture runs on it, and the export never reads its votes. After Dark line votes exist
  (admin-only, `line_feedback` kind `after_dark`) but go nowhere. Using it for training would need the privacy page's
  promise changed first.
- **Private souls:** no data-plan table copies a soul. The engine trace keeps averaged temperament numbers read off them,
  and those go when the character is forgotten.
- **Dealbreaker cue words:** the trace says that a dealbreaker tripped (`dealbreaker:a`), never on what; `alt_sides` and
  `turn_drafts` keep booleans and reasons only.
- **Text a safety filter caught:** a refused line keeps its reason, never its text.
