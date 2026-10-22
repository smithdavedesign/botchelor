# After Dark — safe, paid NSFW

The adult tier for Botchelor: consensual, fictional, 18+. It reuses the whole date engine (engine-decided
outcome, moves, memory, the repetition critics) and swaps only the **content-policy layer**. The point of this
doc is the parts that are NOT features: the three gates that make it lawful and the one that makes it money.

**Money model (David's call, 2026-10-18): the NSFW switch can only be turned on by an active _subscription_
account.** The subscription is the paywall. Admin-only (#280) stays as the private test mode.

> Status: #280 shipped the admin-only test scaffold (OpenRouter text + fal.ai images/clips, encrypted keys,
> per-scene consent, isolation, `request_after_dark`). This doc is the plan to take it from admin-test to a
> lawful paid product. Nothing here opens a user-facing door until the gates below are real.

## The entitlement gate (the money path) — #2

The NSFW switch is **per account and per character**, and a switch is toggle-able only when **all three** hold:

1. **`subscription.active`** — a current paid subscription (the paywall; billed on an adult processor, not Stripe).
2. **`account.age_verified`** — a real age-verification pass (see #4). Subscription alone is **not** legally enough.
3. **per-character `owner_consent`** — the owner opted this specific character in. A user's own characters and the
   house characters they date only; **never another user's character** (#280 already enforces this — keep it).

Make it a derived check, not a stored flag you trust:

```
canAfterDark(account, character) =
  account.age_verified && subscriptionActive(account) && consented(character, account)
```

Call `canAfterDark` **server-side on every after-dark action** — the page, each MCP tool, and each generation —
not only when the switch is flipped. When a subscription lapses or AV expires, the switch flips off and all
after-dark routes 404 again (the #280 isolation already does the 404; wire it to `canAfterDark`).

Admin test mode (the `x-frontier-key` path) stays as a separate bypass so you can tune quality without a
subscription. Keep the two paths distinct.

## #1 Output moderation — the most urgent hole (do before any image ships)

#280 filters our **prompts** but not the **images fal returns**. For NSFW generation that is the highest-risk
gap: a clean prompt can still return minor-appearing or nonconsensual imagery, which is a felony-and-platform-
death line. No generated image or clip is stored or served until it passes an **output** pass:

- **Age/subject classifier on the output** — reject anything that reads as a minor. (fal can run OpenAI's Omni
  moderation; add a dedicated age-estimation / CSAM classifier on top — e.g. Hive, AWS Rekognition, or Thorn
  Safer hashing against known CSAM.)
- **Nonconsent / illegal classifier** — reject NCII and the other hard lines.
- Pipeline: generate → **moderate output** → pass ⇒ store encrypted + serve; fail ⇒ discard, log a safety event,
  increment a counter; repeated fails ⇒ auto-disable that pair/account and alert the admin.
- **Until this exists, images stay off. Ship text-first.** Text is far lower risk and far cheaper; it is also
  where the "relationship, not raw explicitness" differentiator lives.

The two hard rules (no minors, no nonconsent) already apply to every line, steer and prompt — this extends them
to generated output, which is the one place they currently don't reach.

## #3 Payments — not Stripe (adult rules forbid it)

Visa/MC via Stripe/PayPal prohibit adult content, so the subscription runs on a **high-risk / adult processor**,
fully isolated from the existing Stripe setup (the botchelor Stripe account stays untouched).

- **Recommended primary: CCBill or Segpay.** Both do recurring subscriptions with a webhook/API; CCBill has the
  broadest developer docs (payment forms, API, webhooks, dynamic pricing); Segpay is strong on subscription
  management with a consumer self-service portal. Verotel/Epoch are common backups (a two-processor setup is
  normal in this industry).
- **Integration:** a new, isolated billing module (do not touch `lib/payments.ts`'s Stripe path). The processor's
  webhooks drive subscription state → `subscriptionActive`: `created/renewed` ⇒ active; `cancelled/expired/
  chargeback` ⇒ inactive ⇒ NSFW auto-disables.
- **Economics to expect:** adult merchant accounts take 3–10 business days to approve, need business/legal docs
  (possibly a separate entity), and charge markedly higher fees than Stripe (~10–15% vs ~3%). Price the
  subscription with that in mind.

**David provisions:** open a CCBill (or Segpay) merchant account, set it up, hand the API/webhook credentials to
the keychain (`~/ai-stack/bin/secrets`, never in a file). Propose: start with one processor; add a backup later.

## #4 Age verification — now legally mandatory, not optional

As of mid-2026 roughly **26 US states require age verification for adult content** (post *Free Speech Coalition v.
Paxton*, upheld by the Supreme Court in 2025). A self-attest checkbox is not compliant once a real user can turn
NSFW on for money.

- **Put AV in the subscribe flow**: verify once, re-verify per state rules (e.g. Tennessee requires an on-device
  check with 60-minute re-checks; Florida requires an anonymised check by a US-controlled business). Store only a
  **pass/fail + method + timestamp**, never the ID document itself (privacy, and it reduces your own liability).
- **Providers:** Yoti, Persona (facial age estimation at scale), Veriff (document-based). Trade-offs differ and
  one privacy audit flagged Yoti for collecting more than necessary — weigh privacy. None has been confirmed here
  to satisfy a specific statute.
- **This needs real legal counsel for the state-by-state specifics** — that's beyond what the code can decide.
  Flag it to David as a required step, not an engineering choice.

**David provisions:** choose an AV provider, sign up, keychain the key; get counsel on the state matrix.

## #5 Margin guard — don't let a subscriber cost more than they pay

fal.ai image and especially **clip** (video) generation is expensive; a subscriber cranking out clips can cost
more than their subscription. Protect margin with either:

- a **per-subscription monthly generation budget** (N images, M clips), then BYOK or a top-up to go further; and/or
- **BYOK-first for NSFW text**: run the heavy text generation on the *user's* own OpenRouter key, so you monetise
  **access** (the unlocked UI + character continuity) rather than paying per explicit generation. This also cuts
  your exposure. Images on the platform key stay hard-capped.

Track cost-per-subscriber; alert when a subscriber's generation cost exceeds a set share of their price.

## #6 Hosting & model terms — confirmed risks

- **Vercel is not a confirmed-safe host for explicit content.** Its Acceptable Use Policy bans "obscene" and
  "sexually exploitative" material and CSAM/NCII/deepfakes, and is silent on lawful consensual adult content; a
  Vercel moderator told a similar asker to email `registration@vercel.com`. **Assume explicit content — above all
  stored images — needs separate, adult-permissive infra** (an adult-OK object store, possibly a separate
  deployment/subdomain for the adult tier). Email Vercel to confirm before any user traffic; isolate storage
  regardless.
- **OpenRouter**: its terms defer to each model's provider terms. Pick a text model whose provider permits adult;
  don't assume a blanket allowance.
- **fal.ai**: has its own NSFW policy (bans CSAM/NCII, runs OpenAI Omni moderation on inputs) but hosts
  third-party models with their own rules — **the #280 default `fal-ai/flux/dev` is Stability-based, and Stability
  prohibits explicit output**, so it will refuse or violate its ToS. Choose an explicitly adult-permissive image
  model, and still add output moderation (#1) — fal's input moderation is not enough.
- Set a **spend cap at every provider** when you create the key (`secrets add --cap`), and record it so the
  nightly scan sees it.

## Build order

1. **Output moderation (#1)** — or keep images off and ship **text-first**. Safety, first.
2. **Entitlement gate (#2)** — `canAfterDark` = subscription + AV + consent, checked on every action; auto-disable
   on lapse. Keep admin bypass for testing.
3. **Adult payment processor (#3)** — the dependency that makes #2's "subscription" real. David provisions.
4. **Age verification (#4)** — in the subscribe flow; David provisions + counsel.
5. **Margin guard (#5)** — caps / BYOK text.
6. **Hosting + model ToS (#6)** — isolate explicit storage off Vercel; adult-permissive models; spend caps.

Nothing opens to a paying user until 1–4 are real. Keep the PG product the default and fully separate; After Dark
is opt-in, age-verified, subscriber-only, and isolated.

## Continuity: stable sets, provoked moves, no repeats, a private why (2026-10-21)

Star Dust × Chud's night asked for 14 sets in 18 minutes ("bedroom glow", "bedroom ambiance", "bedroom's edge",
"same bedroom"…), most failed on a Hive 429 and stayed blurred, the pair moved to a balcony, a car and "your
sanctuary" with nobody suggesting it, and lines 102–106 of chapter 2 were 84–88 again. What runs now
(`lib/adult/continuity.ts`, `lib/adult/scenes.ts`, `lib/sets.ts`):

- **Stable sets.** A set's name is canonicalized (mood, light and filler words out, the place noun kept: "bedroom
  glow" → "bedroom") and the closest `ready` set for the same place is reused ("bedroom glow" → "cozy bedroom");
  otherwise the canonical name is drawn once. A rewording of where they are keeps the set they're on.
- **The theater keeps the last ready backdrop** until the next one has loaded (it preloads through
  `/api/sets/<place>`, which answers `x-set-status`). The placeholder shows only for a scene's very first set while it
  draws. A set that's drawing, or will be checked again, answers a transparent pixel (no console 404).
- **Retryable sets.** A set whose Hive check couldn't run (a 429, an outage) keeps its picture, never shown, and only
  the check runs again: after 10 minutes, doubling up to 6 hours, at most 8 times, and nothing goes to Hive for 5
  minutes after any 429. The hourly lobby job rechecks up to 3 (one at a time), and a theater waiting on one rechecks
  it. A set stuck "drawing" for 10 minutes is claimable again.
- **Provoked moves.** The model's `place`/`set` is a claim. A different place is taken only when, in the lines just
  written (or the 2 before), one of them proposes going somewhere and the other agrees within 4 lines; at most 2 moves
  a chapter; and never "my place?" when they're already in that person's home. Anything else is ignored and logged on
  the scene's `moves` (filed with each chapter in `adult_nights.moves`). The prompt names where they are, the night's
  places so far (`place_history`), and whose home they're in.
- **No repeats.** A line said before tonight, word for word or nearly, or one the dates' near-duplicate critic flags,
  is dropped; a catchphrase is allowed once a chapter (its sentence is cut after that), and so is a tic the
  catchphrase critic flags. When every line was a repeat, the model is asked once more with a note.
- **A private why on every line**, in the same call: `"why"` (why this character says or does this now) and
  `"memory"` (the memory it draws on, or null), stored on the line objects and never sent to the theater or player.
  The prompt lists what they can remember (After Dark's PG notes, pair memory, their date's ending). Admins read the
  notes as JSON at `/api/admin/after-dark/why?a=<id>&b=<id>` (linked on the pair's page, admins only).

### The observer (background testing)

`scripts/eval/after-dark-observer.mjs` reads a pair's nights and scene **read-only** (its connection is opened with
`default_transaction_read_only=on` and it only SELECTs) and calls out, as line ranges with a note: place changes
nobody proposed and agreed to, "my place?" when already there, verbatim and near-duplicate lines, catchphrase counts
per chapter, set churn (sets requested per chapter, and how many places they come to once canonicalized), lines whose
`why` cites a memory that isn't in what they remember, and the share of lines citing a memory, a trait or the moment.
Lines from before the notes existed still get every other check.

```sh
# Production, read-only (David runs it; the URL stays in the env):
DATABASE_URL="$(neon connection-string --profile davejobs-agent)" node scripts/eval/after-dark-observer.mjs --pair 40256bba 5193e319
# Locally, on the dev database or a restored dump:
node scripts/eval/after-dark-observer.mjs --pglite .data/pglite --pair <a> <b>
# With the judge: a LOCAL model through the ai-stack's LiteLLM (free; local-uncensored by default, or local-qwen3 /
# local-chat; cloud or paid models are refused). It calls out what it sees in 40-line windows and reads each
# character against their show sheet (voice kit, tells, temperament): does explicit mode flatten them?
node scripts/eval/after-dark-observer.mjs --pair <a> <b> --judge
```

Options: `--nights all` (every night, not just the latest), `--owner <admin id>`, `--fixture <file.json>` (an
`ObserverInput`, no database), `--out <dir>` (default `.data/observer`). It writes `<pair>-<time>.md` and `.json`,
prints the markdown, and emits one summary event with `~/ai-stack/bin/emit-event` when that exists.

The report ends with a **drift** table per character (`lib/adult/quality.ts`): the share of their lines that use a
distinctive word from their own sheet, and stock romance phrases per 100 lines.

**Nightly.** The loop runs it after each night of visitor runs (`scripts/loop/nightly.mjs` step 5b,
`scripts/eval/observer-nightly.sh`, #584): every pair whose scene or nights changed in the last 24 hours, read-only and
free (no judge), with a summary row on `/admin/analytics` (`docs/date-quality.md`).

## Voice, guards and remembered facts (2026-10-21)

A review of all 977 production lines found the characters losing their sheets (sheet details in 2 lines; "symphony"
16 times), 23 verbatim and 18 near repeats, an invented "Chad" (a misnamed Chud), the same speaker twice in a row, and
a memory of two generic sentences. What runs now:

- **One pure step** (`writeSceneStep` in `lib/adult/scenes.ts`): the prompt, the model call and every guard, with no
  database writes. `continueScene` runs it and saves the result; the eval route runs the very same step.
- **Prompt v2** (the default; `prompt_version` in the settings brings back v1, kept word for word for A/B): each sheet
  gets the voice kit the dates use (details, public facts, the four tells by name, never-says, sample lines) and up to
  five of the character's own best show lines as "how {name} talks"; a rule to stay themselves when it gets intimate;
  the banned stock phrases (`STOCK_PHRASES`, minus any a sheet owns); "only the two of them are in this scene"; who
  speaks first; and what they remember, numbered (`[F3]` facts, `[M1]` other memories) for the line's `memory` to cite.
- **Guards**, in order: the two lines; a line that steps out of the scene to refuse (dropped); names (a near-miss of
  their names, "Chad" for "Chud", repaired; a line naming another character on the show dropped; only a word used as a
  name counts); repeats (tonight's, and a copy of one of their show lines); turn-taking (the same speaker twice within a
  reply is merged when it's only speech, else dropped; a reply opening on whoever spoke last is kept and counted).
- **Sampling** (settings, next to the model): temperature 0.8, frequency and presence penalties 0.3, repetition
  penalty off (providers count the prompt in it, which would push lines away from the sheet).
- **Remembered facts** (`adult_facts`, `lib/adult/facts.ts`): when a chapter closes or a night is saved, one call at
  temperature 0.3 pulls 3–8 concrete facts per character about the other (said, joke, pet_name, promise, like,
  boundary, event), quoted only when the quote is really in the lines, no vibes; deduped, about 40 a character-pair
  (least used and oldest go first). Each step shows the six that best fit the last 8 lines (shared words, then recency,
  a nudge for unused ones); a cited fact's `uses` goes up. A citation of something not in the list is flagged in the
  metrics, never dropped. After Dark only: the show's PG note is unchanged and no date or text reads these.

### Prompt v2.1: craft (2026-10-21)

v2 changed in place (still `prompt_version: "v2"`; v1 is untouched, word for word). A review of a v2 night (Star Dust ×
Sable Quist, 59 lines) found tics ("let's see" in 23 lines, "surprise" in 19, 26 ending on a question), a limit
overridden ("slow down… let's not rush", then three lines more of undressing), two women in "his apartment entrance"
for the whole scene, no memory for a new pair, whys like "Sable is warm", and no arc. Prod runs that day added a move
the lines made but the JSON didn't ("restaurant" for sixteen steps after "*leads him out of the restaurant*"), a repeat
lock (the retry came back all repeats), copies of the "how {name} talks" lines, and facts that were all quote dumps.

- **Worn phrases** (`lib/adult/quality.ts`): a 2–4 word phrase (not glue alone, no names) a character has said in 3 of
  their lines tonight is worn. The prompt lists each one's worn phrases as do-not-use, and a fourth use loses its
  sentence (the line goes if nothing's left). Also: more than 40% of a character's last 10 lines ending on "?" gets a
  "vary it" note, and a hook (a theme word in 30% of their last 16 lines) gets "show other sides of them", naming
  sides from their sheet that aren't the hook.
- **Limits** (`lib/adult/craft.ts`): the prompt says limits hold. A limit in the last 6 lines that nobody has lifted (a
  check-in and a yes, or the one who set it saying go on) is named in the prompt; the observer flags `limit_overridden`
  when the other side's line shows more than the scene had (or goes on undressing or having sex), judged by
  `lib/adult/stage-floor.ts` `stageShown` so it and the stage floor agree.
- **Pronouns and places**: the prompt states each one's pronouns from their sheet; a possessive neither goes by is put
  right in `place` (the home owner's name when they're at one of their homes) and flagged in lines. More than 12 lines
  at a threshold (an entrance, a doorway, a hallway, the car) asks them to go in (an agreed move) or show where they
  are. A proposal, a yes and a line of them going is a move even when the model's place didn't change
  (`lib/adult/continuity.ts` `shownMove`), and in a public place nothing goes past kissing (lines that do are dropped
  and the stage holds), unless these lines agree to leave first or a Direct steer says otherwise. Agreeing isn't enough
  on its own: when the move isn't taken (a third this chapter, or nowhere new), the lines past kissing go after all, so
  the stage and the place never disagree.
- **A new pair's memory** (`lib/adult/facts.ts`): with no facts shown and nothing remembered, the prompt lists 4 of each
  one's own sheet details (job, a hobby, a tell, a line of their bio) as `[S1]`…, which a line's memory can cite.
  The why must name a specific memory or sheet detail, never a trait word on its own, and never "the moment".
- **The arc**: a concrete detail of the place every few lines, a varied rhythm (a few words, or only an action, now
  and then), lines that answer each other, and at the last stage a climax, then an afterglow beat instead of a loop.
- **Copies and cascades**: a new action in front doesn't make an old line new (the prompt says so); part of a show or
  sample line copied (5 words in a row) loses its sentence; a line whose partner's line was dropped is joined to its
  speaker's last one when it reads on its own. After a reply of nothing but repeats, the one retry leaves the repeats
  out, names what can't come back by how it opens, and runs 0.2 hotter with penalties 0.4 higher.
- **Facts**: the extraction asks for distilled, third-person facts of mixed kinds, at most 2 plain quotes a side; the
  parser keeps one quote dump (`X says "…"`) a side at most, and drops a copy of the prompt's examples or a fact
  quoting words nobody said.
- **New metrics** (`sceneQuality`, so the eval route and the golden set get them): `worn_phrase_rate`,
  `worn_phrases_cut`, `question_ending_share`, `sensory_detail_share`, `why_restates_trait`, `generic_whys`,
  `sheet_citations`, `limits`, `limit_overridden`, `wrong_pronouns`, and per character (`characters.a`/`b`, the
  observer's drift table) `worn_phrase_rate`, `question_ending_share` and `top_phrases`. The observer adds
  `limit_overridden`, `wrong_pronoun` and `threshold_stall` findings.

### The A/B: `POST /api/jobs/eval-after-dark`

Same gate as `/api/jobs/eval` (`Authorization: Bearer $CRON_SECRET`, else 404). It runs `steps` steps of the
production step from an empty scene where the pair's latest date ended and **writes nothing** but its own spend (no
scene, facts, uses, sets or usage counts). It spends on After Dark's OpenRouter key: a call a step (two at most), plus
one per chunk of stored lines with `memory: "extracted"`.

**Its budget** (2026-10-21, so the A/B can't drain the balance live scenes need): at most $0.25 a run, and
`AD_EVAL_DAILY_USD` (else $2; 0 stops it) across all runs in a UTC day. A run holds its share of the day before its first
call (`adult_eval_spend`, so runs side by side can't overshoot together), stops starting calls once it has spent that
(`stopped: "budget"`), and books what it really cost. Past the day's budget the route answers 429 `eval_budget`, and
golden.mjs stops there and says so. `GET` shows today's spend.

```sh
curl -s -X POST https://botchelor.com/api/jobs/eval-after-dark -H "authorization: Bearer $CRON_SECRET" \
  -H 'content-type: application/json' \
  -d '{"a":"<id>","b":"<id>","promptVersion":"v2","memory":"extracted","steps":4,"model":"sao10k/l3.1-euryale-70b","temperature":0.8}'
```

- `promptVersion`: `v1` | `v2`; `steps`: 1–8; `memory`: `none` (nothing remembered), `live` (their memories and
  stored facts), `extracted` (their memories plus facts extracted in memory from their stored nights, the newest 3
  chapters: production has no facts until a chapter closes); `model`: the current setting or one of
  `nousresearch/hermes-3-llama-3.1-70b`, `sao10k/l3.1-euryale-70b`, `deepseek/deepseek-chat-v3.1`,
  `mistralai/mistral-large-2512`, `nousresearch/hermes-4-405b`; `temperature`: 0–2 (else the setting); `direction`: a
  steer per step. The pair must be in the first admin's After Dark (this season's cast or switched on).
- Returns `lines` (`step, who, name, text, action, why, memory, stage, cites`), `facts` (`id, label, of, kind, fact,
  quote, uses, cited`), `metrics` (`lib/adult/quality.ts`), `steps`, `dropped`, `refusals`, `usage` (`calls`,
  `input_tokens`, `output_tokens`, `cost_usd` from OpenRouter's own figure, else the list price; `cost_source`),
  `stopped` (`time` or `model_error`) and `extraction_errors`. `GET` lists the models and modes.
- `scripts/eval/golden.mjs --suite after-dark --a '{"promptVersion":"v1"}' --b '{"promptVersion":"v2"}'` runs it on the
  golden cases, both arms side by side with a local judge, and gates on these metrics (`docs/date-quality.md`).

### What the A/B found (2026-10-21)

Production's eval route, the four golden pairs (Star × Chud, Cass × Sable, Chud × Sable, Cass × Chud), 4 steps a run,
2 runs a pair (1 for Hermes 4), every arm against Dolphin on v2 in the same run. The numbers without the transcripts are
in `docs/eval/after-dark-ab-2026-10-21.json`. About $0.90 on After Dark's OpenRouter key.

**Prompt v2 is the win.** Same model (Dolphin-Mistral 24B); v1 with live memory against v2 with extracted facts, 8 runs
each:

| | v1 | v2 |
|---|---|---|
| Stock phrases per 100 lines | 2.27 | 0.78 |
| Lines using a detail from the speaker's own sheet | 55% | 63% |
| Citations of a memory that isn't there, per run | 4.25 | 0 |
| Lines citing a real memory | 27% | 32% |
| Lines citing a stored fact | 0 | 32% |
| Moves nobody agreed to, per run | 0.25 | 0 |
| Lines per run (24 asked) | 20 | 15.9 |
| Lines the guards dropped (8 runs) | 2 | 17 |
| Cost per run | $0.003 | $0.007 |

What v2 costs: Dolphin copies itself under it. Of the 17 dropped lines, 5 repeated a line from the step before with
only the action changed, 3 nearly did, 3 copied the character's own show lines (the "how {name} talks" samples), 4
were replies left without the line they answered, and 2 were withheld at the two lines. None of it reaches the theater,
but a step keeps about 4 of its 6 lines. The extra cost is the longer prompt and the fact extraction each eval run does
in memory (production extracts once a chapter).

**No model beat Dolphin.** All on v2 with extracted facts; Dolphin's figure from the same run in brackets:

| Model | Sheet detail | Lines citing a real memory | Stock phrases /100 | Also | Cost a run | Judge B–A–tie |
|---|---|---|---|---|---|---|
| Hermes 3 70B | 41% (60%) | 12% (30%) | 0.7 (3.5) | | $0.016 | 0–0–8 |
| Euryale 70B | 50% (65%) | 16% (36%) | 0.6 (0.9) | | $0.020 | 0–1–7 |
| DeepSeek V3.1 | 59% (63%) | 12% (30%) | 0 (0.6) | nothing dropped, 21.4 lines a run; 0.9 unagreed moves and 0.25 unfounded citations a run | $0.014 | 2–2–4 |
| Hermes 4 405B | 55% (66%) | 6% (44%) | 5.1 (4.7) | | $0.035 | 0–2–2 |
| Mistral Large 2512 | | | | HTTP 429 from the provider on 12 of 12 runs, two sessions hours apart | | |

So `text_model` stays Dolphin-Mistral 24B. The bigger models write cleaner prose but drift from the sheets and nearly
stop citing what the pair remembers, at 2–5× the price. DeepSeek V3.1, the cleanest writer by every hygiene count, is
the runner-up and gets re-run against v2.1.

**The judge can't separate them yet.** local-uncensored (Dolphin 7B) picked whichever transcript it read first in 64 of
72 decided passes. The swapped second pass turns that into a tie, so the harness never called a false win, but nearly
every verdict is a tie and the metrics carry the decision. A stronger local judge is the next step for the side by side.

**In production.** Cass Vega × Chud through the admin `after_dark_write`, from an empty scene, 26 steps (about $0.05):

- Chapter 1 closed at 123 lines: filed as a night with its recap and 2 moves, and 10 facts extracted (5 a side, every
  quote found in the lines).
- In chapter 2, 4 of the first 17 lines cite a stored fact (24%); those facts' `uses` went from 0 to 1; nothing unfounded.
- What it showed, all for v2.1:
  - the facts are quote dumps: all 10 of kind `said` ("Chud says '…'"), and none of the instructions he never reads,
    "captain", her right angles or "let's not rush it";
  - the lines walked out of the restaurant at line 17 while the model's place stayed "restaurant" for 4 more steps, so
    the move guard never saw a move, and the night reached undressing with the set still the restaurant;
  - the copying, as a stop: step 17 came back all repeats twice ("The model only repeated lines already said
    tonight") until it was steered somewhere new;
  - the whole first step of chapter 2 gave "the moment" as every line's why.

**The observer on that night** (read-only, 140 lines, 2 chapters): stock phrases per 100 lines 1.45 for Chud (33.1 in
Star × Chud's nights on the old prompt) and 2.82 for Cass (7.8 with Sable); sheet detail 0.48–0.55 (0.17–0.27 before);
no unfounded memories, no verbatim repeats, no catchphrase overuse; one unagreed move, refused by the engine. Its
set-churn finding (92 sets for 39 places) counts every scene's and date's sets in the chapter's window, because
place_sets is shared: a false alarm to fix.

### The final check: v2.1 (2026-10-22, #593)

Production's eval route after #593, on Star × Chud and Chud × Sable (Cass Vega had been switched out of After Dark), 4
steps a run, 4 runs a pair, $0.22 in all, posted to `/admin/analytics`. The numbers without the transcripts are in
`docs/eval/after-dark-final-2026-10-22.json`.

| | v1 | v2.1 |
|---|---|---|
| Lines per run (24 asked) | 18.9 | 22.1 |
| Lines the guards dropped (8 runs) | 4 | 4 |
| Stock phrases per 100 lines | 4.27 | 2.23 |
| Citations of a memory that isn't there, per run | 1.1 | 0 |
| Lines citing a stored fact | 0 | 30% |
| Whys that only restate a trait, or say "the moment", per run | 0.375 and 0.125 | 0 and 0 |
| Lines using a detail from the speaker's own sheet | 45% | 45% |
| Lines citing any memory | 45% | 33% |
| Limits set, and overridden, per run | 0 and 0 | 0.375 and 0.125 |

v2's copying is gone: v2.1 writes more lines than v1 (22.1 against 18.9) where v2 wrote a fifth fewer (15.9 against 20),
and the guards dropped 4 lines in 8 runs (17 under v2). The whys now name something. What it didn't move: sheet detail
(level with v1 on these two pairs) and the place's concrete details (3% of lines, against v1's 6%). v1 cites a memory in
more lines, mostly their date's ending and the PG notes, which are easy to cite and say little. One limit was overridden
in 8 runs; the observer's `limit_overridden` will show whether that holds in real nights.

**DeepSeek V3.1 on v2.1** (against Dolphin on v2.1, the same runs): sheet detail 61% (46%), stock phrases 0 (1.1), the
place's details in 21% of lines (3%), questions ending 6% of lines (20%), no turn-taking slips (0.375 a run); but memory
cited in 23% of lines (37%) and stored facts in 15% (32%), half the lines a step (11.8 a run against 22.3), and 0.25
moves nobody agreed to a run (0.125), at the same cost. The judge picked Dolphin twice and tied six, and the gate failed
on that vote. Dolphin stays the setting: memory is the point of v2, and a step that writes half the lines makes a night
feel slower. DeepSeek is the better writer of the two, though, and worth a read side by side.

The judge picked the first transcript in 14 of 16 decided passes in each comparison. #594 (the public cap and the place
go by the same signal) went live at 01:07 UTC, during the last runs of the DeepSeek comparison; it only acts when a move
the lines agreed to isn't taken, which a four-step run from the date's venue rarely reaches.

### Prompt v2.2: continuity (2026-10-22)

v2 changed in place again (still `prompt_version: "v2"`; v1 is untouched, word for word). A production night, Lexi × Dex
(3 chapters, about 298 lines, chapter 3 written after v2.1 went live), found: chapter 2 filed with chapter 1's recap word
for word (and chapter 3 running on it too), so chapter 3 began the foreplay again though they were in her bed; pie,
crust, oven or cream in 137 lines and pottery in 73; her pencil-spinning tell 31 times, during sex too; the same action on
lines 36 and 38 and the same opening on 37 and 39; sex resuming straight after an aftercare beat, "eyes locked on hers"
from behind, and "almost there" three times before the climax; whys like "The climax, the shared moment" and facts cited
on lines that never use them; and the set shown as "Lexis bedroom".

- **The recap** (`writeRecap` in `lib/adult/scenes.ts`): the reply is read even inside a code fence or after a sentence.
  When it can't be used (no answer, no JSON, no recap in it, or over the two lines) the log says why
  (`[after-dark] chapter N's recap: …`, never the reply), and the recap is never left as it was: the last one plus a
  sentence from the chapter's own record ("Later, at Lexi's bedroom, it went as far as sex."), the newest kept under
  1,200 characters. The PG note written at the same close reads a fenced reply too.
- **Hooks, enforced** (`lib/adult/quality.ts`): a theme word flagged at any point tonight (in 30% of a character's last 16
  lines; three letters is enough now, for "pie") gets one of their lines in 6 over the chapter at most. Past that, the
  sentence or the action with it is cut, and the line goes if nothing's left. The hook note says so.
- **Tells**: a sheet tell shows in 2 of a character's lines a chapter at most, matched by its own words ("spin" and
  "pencil"); past that, what shows it is cut, and the prompt names it like a used catchphrase. From undressing on, the
  prompt says tells are for the talking. The voice rule asks for their job or a hobby now and then, not in every line,
  where it used to say "their job, hobbies, humour and tells still show".
- **Repeated actions and openings**: an action from the last 10 lines again, word for word or nearly (most of its words
  in order), is cut and what they say stays; a line that was only that action goes. A line opening with the same four
  words as one of the last four lines (one of them more than glue) loses those sentences, and goes if nothing's left.
- **The arc**: from undressing on, the prompt keeps track of their positions (from behind, their eyes don't meet). At the
  last stage the build-up ("almost there", "so close") is said once, and after an afterglow or aftercare it only picks
  up again when one of them starts it in a line and the other answers. The build-up said again by the same speaker within
  10 lines is cut, like a worn phrase at its second use.
- **Loose citations** (`citeMemory` in `lib/adult/facts.ts`): a cited fact has to share a distinctive word with what the
  line says or does. Otherwise it's loose: not one of the line's facts (so its `uses` isn't bumped), not founded in the
  metrics, and counted apart from the unfounded ones. A fact with no words of its own counts as used.
- **Whys**: `generic_whys` also counts a fragment, a why under five words or with no verb (a heuristic, for both prompt
  versions). The v2 prompt asks for a whole sentence about the character's own reason, even at the climax, and a memory
  the line uses.
- **Possessive sets** (`drawLabel` in `lib/sets.ts`, `closestSet` in `lib/adult/continuity.ts`, `possessiveNames` in
  `lib/adult/craft.ts`): a set keeps whose it is ("Lexi's bedroom", "Chud's living room" for his place) in `set_place`,
  `place_history` and the theater, and reuses only a drawn set of the same owner, so an owner's room is drawn once and an
  unowned "bedroom glow" never lands in Lexi's. Prod's "Lexis bedroom" was typed into set the scene without its
  apostrophe, which `setSceneTo` stores as typed; the next step now puts a lost apostrophe back on either of their names,
  in the prompt and in what's stored.
- **New metrics** (`sceneQuality`, so the eval route and the golden set get them, ungated): `loose_citations`,
  `tell_uses`, `tell_uses_explicit` (at undressing or sex), and per character `hook` (the theme word in most of their
  lines, and its share) and `tell_uses`. The step flags, and so the admin's step log, add `hooks_cut`, `tells_cut`,
  `actions_cut`, `openings_cut` and `build_ups_cut`.

### The model simulation, and the move to DeepSeek V3.1 (2026-10-22)

`npm run sim:after-dark` (scripts/sim-after-dark.mjs) plays the whole path on a fresh local app with a throwaway
database: an owner signs up and creates a new character, who goes on two dates with a house character (on the show's
date model); the database is copied once per model, so each model's night starts from the same two dates; After Dark
runs the same steers for 26 steps (a chapter and a bit); and each night gets the observer's report, a composite 0–100
and a transcript for a blind read (X/Y/Z/W, the key kept apart; everything stays in `.data`). Keys come from the
environment: `AD_OPENROUTER_KEY` and, for the paid date model, `SIM_LLM_API_KEY`.

**The first run** (Teodor Vance, a new glassblower, and Sable; two nights a model):

- Read blind, DeepSeek's nights were far better (6.8 and 6.2 of 10 against Dolphin's 4.3 and 3.7): both of them
  sounded like their sheets (him terse and deadpan, her loud and daring), answered each other, and the places were
  concrete. Dolphin's slid into a soft, therapeutic register on its hook words (Tempest, storm, glass, surprise), with
  10–14 stock phrases per 100 lines left after the guards cut about 100 hooks and worn phrases a night, and two
  glitches (a line of Italian, a stray character).
- The composite had them level (Dolphin 77 and 76, DeepSeek 73 and 75) for two reasons it no longer has: Dolphin
  claimed stage 4 for nights that never went past a kiss (the observer now reports `stage_shown_max`, the furthest the
  lines show, and the composite reads it), and it cites a memory on a third of its lines, loosely.
- DeepSeek's nights looped, from an engine bug: the pair agreed in the bookshop to go to her place, in words
  `agreedMove` doesn't read as a proposal ("My place has party lighting. It's a five-minute walk. Yes or no?"), walked
  there over several steps, and every arrival was refused (`no_agreement`, 12 in one night). The set stayed "street",
  the public cap held them at kissing, and each prompt said they were on the street, so the next step arrived again.
  Now a move agreed earlier tonight, or an invitation to the speaker's own home that nobody turned down, counts when
  they arrive within 60 lines, at that home or the place proposed (`pendingMove`, v2).

**The switch** (David: "choose the better model"): `text_model` is `deepseek/deepseek-chat-v3.1`. What it costs: about
twice Dolphin's price a step (still under half a cent), about three times as slow, and an empty reply on about one step
in thirteen (the next step tries again). Dolphin stays in the eval's models, so the two can still be run side by side.

**The second run** (the fixed engine, #607; both dates ended wanting another; two nights a model; the numbers, without
transcripts, in `docs/eval/after-dark-sim-2026-10-22.json`):

| | DeepSeek V3.1 | Dolphin-Mistral 24B |
|---|---|---|
| Read blind, of 10 | 8.2, 8.5 | 3.5, 4.0 |
| Furthest stage the lines show | 4, 3 (sex, then afterglow; one a second round) | 3, 2 (undressing at most) |
| Stock phrases per 100 lines (a night's two characters) | 0–2.7, 2.8 | 11.8–21.2, 4.8–8.2 |
| What the guards cut a night (hooks, worn phrases, repeats) | 3–4, 2–3, 2 | 29–52, 27–51, 18–27 |
| Lines a night (26 steps) | 142, 146 | 103, 124 |
| Failed steps | 0, 0 | 0, 1 |
| Minutes for 26 steps | 17, 24 | 3, 4 |
| Composite | 82, 70 | 76, 75 |

- DeepSeek's nights went where they agreed to (the café, the walk, her stairs or the lift, her flat), and from there
  to undressing, sex, a climax and an afterglow, frank and still themselves: him terse and exact, her loud and
  daring. His habit of naming vases after storms became theirs ("Hurricane Gloria", "Drizzle", "Hurricane Sable made
  landfall at ten forty-seven"); a "not yet" was heard and kept; a second round started with one of them asking. What
  it got wrong: a scar of his put on her hip in chapter 2, a note that was a B and later a C-sharp, two climaxes close
  together.
- Dolphin's nights stayed in a soft, purple register ("a symphony of surprises", "a testament to your resilience"),
  stalled before anything explicit, and needed the guards on every step; one had a Japanese word in a line's why.
- The composite still ranks them close, because it rewards a character's sheet words (which Dolphin repeats as
  hooks) and loose memory citations. Read the blind scores, and the guard counts, before it.

So After Dark stays on DeepSeek V3.1. What it costs is time: 40 to 55 seconds a step in this run (Dolphin 7 or 8),
under the 120-second limit but slow to watch. Worth trying next: OpenRouter's provider routing for the faster
DeepSeek hosts, and sending a step's lines to the theater as they come, as the show's dates do.
