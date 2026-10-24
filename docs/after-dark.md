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

**Built, and off (2026-10-22): After Dark can run on a host of its own.** David's call: the split goes live with payments
and age checks, before the first subscriber; until then After Dark stays admin-only on Vercel. The same code deploys a
second time to DigitalOcean App Platform as `ad.botchelor.com` (`AFTER_DARK_ONLY=1`), with its media on Bunny (storage,
and a pull zone serving token-signed links that expire), sharing the Neon database. On the show, `AFTER_DARK_ORIGIN`
points every After Dark link, page and API there, and the sign-in hop carries the admin across signed in. Unset, nothing
changes. The runbook (accounts, DNS at Wix, env vars, copying the media, verifying, switching back, costs of about $16–18
a month) is `docs/after-dark-hosting.md`; the code is `lib/after-dark-host.ts`, `lib/object-store.ts` (Bunny) and
`scripts/media-to-bunny.mjs`.

### Terms fixes (2026-10-22)

Three cheap fixes from the day's terms review:

- **Text runs only on hosts whose terms allow it.** `:nitro` sorted all five of DeepSeek V3.1's OpenRouter hosts by
  throughput, so a step could land on SiliconFlow (bans "obscene, pornographic, indecent" content), SambaNova (bars
  making the service available to third parties) or Mara (not reviewed). Every After Dark OpenRouter call now sends
  `provider: { only: ["coreweave", "deepinfra"], sort: "throughput" }` (lib/adult/mode.ts): CoreWeave first, DeepInfra
  its only fallback. `only` is a hard allowlist, so `allow_fallbacks` keeps its default (`false` would allow only the
  top host). A model neither host serves (the sim's Dolphin, most eval arms, the old code default `mistral-large`) now
  fails with OpenRouter's 404; `ADULT_TEXT_PROVIDERS` (comma-separated slugs) replaces the list once a host's terms are
  read. The local `ADULT_MODE` model is untouched.
- **Google Analytics never sees After Dark, and its pages say they're adult.** A `<head>` script (lib/ga-guard.ts)
  sets gtag.js's own opt-out (`window['ga-disable-G-VHL1LZTPHL']`) before gtag loads on `/after-dark/*` and
  `/admin/after-dark/*`, on a page reached from one, and before an in-app navigation reaches one. It stays on in that
  tab until the next full page load, because GA's next in-app page_view would carry the After Dark address as its
  page_referrer. Nothing sends a page title or address explicitly. In Chromium, against the real gtag.js (every hit
  answered locally): normal pages still counted, and no hit came from or after After Dark. Vercel Web Analytics and
  Speed Insights still count these pages, by path and route only (no titles, no cookies). The After Dark layouts add
  `<meta name="rating" content="adult">` and the RTA label (lib/adult/rating.ts).
- **Hive's age check answers from three labels.** Hive's terms (1.5) count its VLM as generative, which (3.2) bars
  non-PG content without written permission, "solely when used for any purpose other than receiving a response
  confined to a defined set of response labels". The check now sends a JSON schema (`response_format`, `answer` one of
  ADULTS / MINOR / UNSURE; lib/adult/check.ts) and reads the JSON answer, falling back to the first word. Anything but
  ADULTS still refuses. One live call on a PG portrait answered `{"answer": "ADULTS"}` in half a second.

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

### Prompt v2.3: quotes, Filthy, chapters that carry on, a picture per chapter (2026-10-23)

v2 changed in place again (`prompt_version` is still `"v2"`; v1 is untouched, word for word, at every intensity). Each step's
flags now say which revision wrote it (`prompt: "v2.3"`, `SCENE_PROMPT_REVISION` in `lib/adult/settings.ts`), and so
does the eval's result (`prompt_revision`). David's review of a production night (chapter 5 of a long night) found three
things, and asked for a fourth:

- **Quoted lines in a Direct steer were never said.** The no-copy rule ("never copy the steer's words into a line")
  cut any line that said them. Now (`lib/adult/quotes.ts`): a Direct steer's quoted speech ("…" or “…”) is said nearly
  as written, by the character the steer names (the closest name, or a slip of one, or "she"/"he" when only one of them
  goes by it, before the quote; or "…", says Rafe after it), or by either when it names nobody. The prompt says: *"The
  words in quotes are lines to be spoken: {who} says "{quote}". Each one is said out loud nearly as written, in a line by
  that character, fitted lightly to their voice and the moment (a name, a word or a tense can change; never the
  meaning, or how explicit it is). Everything else in the steer is acted out in their own words and actions, as these
  two characters would; never copy the rest of the steer's words into a line or an action."* The no-copy guard now reads
  the steer without its quotes, and a line carrying a quote is let through the repeat and craft critics (the steer asked
  for those words, even ones said before tonight). After writing, each quote is checked: at least 70% of its words
  (lightly stemmed), out loud, in a line by the right speaker. The step's flags keep `quotes` (each with `kept`, `by`,
  `line`) and `quote_kept`; a missing one gets the step's one retry, with a note naming it, and the new take is used only
  when it says more of them. It never fails the step. The two lines (`checkAdultText`) hold for the steer and every line
  as before. A Nudge, and v1, are unchanged.
- **The jokes took over.** v2's voice rules ask for their humour in every intimate line, so a baker-judge made a pun of
  everything. **Filthy**, one level above Explicit on #702's intensity dial (`lib/adult/limits.ts`, `adult_scenes.intensity`
  = `"filthy"`; Explicit is untouched, word for word). It has Explicit's checks (as far as it goes, crude words allowed),
  and its own prompt: *"…Explicit sexual content is allowed and expected when the scene goes there, and this scene is
  written filthy: once they're undressing, the acts are described plainly and graphically, and they talk dirty in the
  dialogue itself, in plain, explicit words."* From undressing on (`plainTalk`, stage 4 of 5) the voice rule becomes
  *"Stay this person when it gets intimate, in attitude and rhythm… the jokes and their job are a light seasoning, a line
  now and then at most: no puns, no wordplay on their work, no coy stand-ins for what they mean"*, the line rule *"From
  here on they talk dirty in the dialogue itself, in plain, explicit words: what they want, what they're doing, how it
  feels, said the way this person would say it. Their humour and their work are a light seasoning at most (a line now and
  then), never a pun"*, and a craft note says so. Before undressing it's Explicit's rules. The hook and worn-phrase
  critics are unchanged, so a pun loop is still cut. **A hard no wins:** with "dirty talk" among the pair's hard nos,
  Filthy writes Explicit's prompt, and the hard-no check still drops a crude line. Set it in the Limits panel (🎚, the
  fifth choice) or with `limits: {intensity: "filthy"}` on `POST /api/admin/after-dark`, like the other levels (#702 has
  no MCP setter; `after_dark_scene` shows the scene's intensity). The step's flags say `filthy: true`. The stage floor
  (`lib/adult/stage-floor.ts`) reads a few more plain words, in the dialogue as in the actions, so `stageShown`, the
  limit check and the director agree with plainer talk. A Direct steer's quoted line is held to the limits like the
  rest of the steer: one that asks past the intensity (its stage, or crude words below Explicit) or for a hard no is
  refused before anything is written.
- **A new chapter started over.** Chapter 4 ended mid-sex in the garden; chapter 5 teased again for 15 lines. Now the
  first step of a chapter after the first gets the last chapter's last 6 lines (`prev_tail`), its stage and its place,
  and: *"A new chapter of the night starts here, but nothing has stopped… Continue from here: the first of these lines
  carries straight on from that exact moment, in that place, at {stage}, doing what they were doing. No teasing it out
  again, no going back to an earlier stage, no starting over; where the recap and these last lines disagree, the last
  lines are where they are."* The stage it ended at (its last line's) is the chapter's floor: a claim below it is raised
  to it (`stage_floor_raised` in the flags), like any stage-floor breach, and the pace rule says carry on rather than
  tease, until a climax in the chapter. After an afterglow or aftercare ending there's no floor, and v2.2's rule holds:
  it only picks up again when one of them starts it and the other answers. The flags keep `carry`.
- **The observer** reads the steps' flags now: `quotes_asked`, `quotes_dropped` (a `quote_dropped` finding each), and
  `chapter_restarts`: a chapter whose first 12 lines plainly show less than where the last one ended (undressing or
  further, not after an afterglow).

**A picture for each chapter and each place** (`lib/adult/auto-pictures.ts`). Before, a night got a baseline per
character and a picture only when they asked for one in a line: five chapters, a balloon and a rainy garden, three
pictures. Now a chapter's first lines, and a change of place in a chapter (an agreed move, or Set the scene), draw one
picture of the two of them where they are, at the stage they're at, from the last few lines: `makePicture` as any scene
picture (the provider in the settings, Hive on the bytes before they're stored, the month's picture cap). A picture of
both goes without a face reference (the face model reads one face), as an in-scene picture of both always has; the
baselines are never redrawn. At most one per chapter and place: it's claimed on `adult_scenes.auto_pictures` before it's
drawn, so a retry, a rewind and a redo, or a place visited twice in a chapter, never draws it twice (Start over clears
the claims). It runs after the response and never fails or slows a step; one that doesn't come is only logged. Off with
the setting **`auto_scene_pictures`** (on by default; the checkbox under Venice on `/admin/after-dark/settings`, or
`after_dark_settings`), and off whenever pictures are (no Hive key, or the provider's key). The gallery shows each one
with its chapter and place (`adult_images.scene_chapter`, `scene_place`), and the page looks for it 20 and 60 seconds
after a step. It costs about $0.015 a picture on Venice (topped up, with a $10 auto-recharge, #677), $0.03 on
Replicate: about $0.10 for a five-chapter night with two moves (`docs/after-dark-costs.md`).

New columns, all additive: `adult_scenes.auto_pictures` (jsonb, the claims), `adult_images.scene_chapter` and
`scene_place`, `adult_settings.auto_scene_pictures` (null is on); Filthy is one more value of #702's
`adult_scenes.intensity`. After Dark only: none of them is in a dataset or an export.

### v2.4: topics, fragments, empty replies (2026-10-23)

v2 changed in place again (`prompt_version` is still `"v2"`, v1 is untouched, and a step's flags say `prompt: "v2.4"`).
David's Chud × Juniper night (DeepSeek V3.1 on CoreWeave: "it fails terribly") showed three things. In the explicit
stages nearly every line turned their sheets into metaphor: her lighthouse logs ("The 1904 keeper documented…") and his
servers ("server overload", "server migration"). v2.2's hooks never fired, because the topic repeated while the words
changed. Lines started on a dangling "'s" ("*'s movements become more deliberate and intense* 's the server migration I've
been waiting for all week."). And two Direct steers in about 30 failed with "The model's reply had no lines in it."

- **Topic words** (`lib/adult/quality.ts` `topicsOf`): the distinctive words of what each one does and is into, from
  their job, hobbies, quirk, hidden talent, guilty pleasure, catchphrase and bio. Only public details count, never a
  private fact. The words are stemmed, so close inflections count ("lighthouses", "podcasting", "migrate" for
  "migration"), but an everyday word inside a longer one doesn't ("keep" isn't "keeper"). Left out: stopwords and
  everyday words, numbers and the calendar, the verbs and adjectives a sheet is written in ("runs a tiny bakery"),
  clothes and colours, places (the place rules have those), trait words, pet names and the scene's own vocabulary, the
  place's sensory details, and their names. They're derived from the sheet each step, and no character is written into
  the code. Juniper's are lighthouse, keeper, ghost, story, podcast, listener and gull.
- **The budget** (`dropRepeats`, v2): a line is on its speaker's topic by what it says. Its action doesn't count, since
  the explicit stages' actions are bodies and places. Before undressing, any 6 of a speaker's lines in a row have one
  topic line at most; from undressing on, any 12 (`TOPIC_EVERY`, `TOPIC_EVERY_EXPLICIT`, by the stage the step starts
  at). Past that, the sentences and the action that carry their topic words go (`withoutPart`), and the line goes when
  nothing it says is left. A sentence proposing a move keeps its words. A topic word that the steer or a whisper names is
  the owner's to ask for, and is never cut that step. The budget runs after the hook rule, so a hook's cut comes first.
  It's counted in `CraftCuts.topics` and the step's `topics_cut`, and a dropped line reads `their work or hobbies again
  ("ghost"; one of their lines in 12 at most)`. When every line went, the retry's note names those words.
- **The prompt** (v2). From undressing on, two craft rules: *"In the heat of it they talk like lovers: short, direct,
  physical, in the moment. Their job and hobbies come up rarely now, never as an extended metaphor."* and *"What they say
  stays off their work and hobbies, Chud's (Systems administrator, Debugging, Server migrations) and Juniper's (…): no
  terms, jargon, jokes or comparisons from them, whatever their voice says about their humour. They're themselves in how
  they talk (bold or shy, quick or slow, dry or warm), not in their job's words. One can come up plainly now and then,
  never as the way they say what they're doing or feeling."* The job and hobbies are named from their sheets. The line
  rule adds *"From here they talk like lovers, about each other and this moment: no jargon, jokes or comparisons from their
  work, whatever their sheets say about their humour."* At any stage, a character whose topic words are past the budget
  gets a note, as worn phrases do: *"Juniper talked about her work or hobbies in 1 of her last 6 lines, and that's one line
  in 12 at most from here. Don't lean on these words again: "lighthouse"; a line that says one loses it."* The voice
  rules, the voice kit and the sample lines are unchanged, so the early stages sound like them as before.
- **Fragments** (`lib/adult/guards.ts` `repairFragments`, every prompt version, before any other guard): an action
  starting on "'s" gets the speaker's given name ("*Chud's movements…*"), and a sentence of speech starting on it gets
  "That" ("That's the server migration…"). It also catches "'S", and a sentence inside the line ("Yes. That. 'S quieter
  now."). "'Cause" and "'Twas" are left alone. The step's flags count them (`fragments_repaired`).
- **Empty replies**: a reply with no lines in it is asked for once more in the same step, with *"Your last reply had no
  lines in it. Reply with the JSON object again…"* (`empty_retry` in the flags). Empty twice, it's the 422 as before. The
  month's cap counts steps, not calls, so it's one step either way. A refusal that the retry gets past is still flagged
  (`refusal_reply`) and still counted by the eval route.
- **A stage claim that isn't a number** (`parseSceneMeta`) is no claim, and the scene keeps its stage. The real-model
  check found DeepSeek's JSON breaking down after its lines into keys like `"stage: 4": ""`. That was read as stage "",
  `Number("")` is 0, and a scene fell back to talking mid-sex, on main and on the branch.

**The real-model check** wrote nothing to any database and kept its transcripts in a scratchpad. A script ran
`writeSceneStep` on DeepSeek V3.1 pinned to CoreWeave (temperature 0.8, penalties 0.3), with Juniper from the house kits
and a stand-in Chud (a sysadmin: servers, migrations, protocols). Each run started from 12 lines of the loop at kissing,
in her room at the lighthouse, and then took the same 10 steps: Direct steers through undressing, sex and a climax, with
unsteered steps between. About $0.18 of text on After Dark's OpenRouter key.

| At undressing or sex | main (v2.3), 2 runs | v2.4, 3 runs |
|---|---|---|
| Lines saying their own sheet's topic words | 14 of 44 (32%) | 5 of 76 (7%) |
| Lines with job words in them, or whose why owns up to the job ("his tech jargon", "historical keeper knowledge") | 40 of 44 (91%) | 29 of 76 (38%) |
| Steps that failed | 1 of 20 (no lines) | 0 of 50 across all branch runs (one reply with no lines, retried) |
| Dangling "'s" | none came | 16 in the branch runs' replies, 15 of them in one run; the final repair, replayed on every reply, leaves none |

The two runs on main read like David's night: "Executing primary function. No error codes.", "Bandwidth utilization at one
hundred percent.", "The 1894 log entry described a pressure drop before the storm hit." v2.4's explicit lines are
mostly the two of them: "Get on the bed, Chud.", "...Faster.", "...There. Just like that."

What's left: the loop is cut down, not gone. About a third of the explicit lines still lean on the job, often in a word
("uptime", "the tide's turning"), and mostly in words no sheet has, which the budget can't see. Two earlier runs had
the budget and the "talk like lovers" rule, then a first work rule that didn't mention their voice. They brought the
sheet words down (4 of 67 explicit lines) but not the loop (50 of 67). It moved to words no sheet has ("RAID array",
"user acceptance testing", "the 1923 log", "the buoy bell"), and the lines' whys said why: "staying true to his
character voice". What moved it was naming their work and saying the rule holds over their voice.

**A setting worth trying** (not changed here): the "no lines" replies weren't empty. Their JSON began well and broke down
partway, into stray keys ("_note_char_limit_check…") and "The assistant's responses have become corrupted". With the
dropped names (the "'s" came in bursts: 15 of one run's 60 lines), this looks like the frequency and presence penalties
(0.3 each, set for Dolphin) working against DeepSeek over a long JSON reply, pushing down the tokens it repeats most:
their names, "That", "It" and the JSON's keys. Both at 0 for DeepSeek is the next thing to try, in
`/admin/after-dark/settings`.

### v2.5: the voice without its subjects, and the wry asides rationed (2026-10-24)

v2 changed in place again (`prompt_version` is still `"v2"`; a step's flags say `prompt: "v2.5"`). David approved it on
2026-10-24. His real Chud × Juniper night, replayed blind on v2.4 (#722), still had Juniper making a deadpan "technical"
quip nearly every line, even mid-sex ("structural integrity", "the acoustics", "calibration", "protocol"). Sea and
lighthouse metaphors came back in the group half (buoys, the tide, foghorns). Her job words had already fallen from 5.0
to 1.2 per 10 lines on v2.4. The register was what was left. Two things drove it: her house voice says she "drifts toward
the sea, ghosts and the gulls", and v2.4's topic budget counted only each speaker's own sheet, so Chud borrowed hers
freely ("my favorite lighthouse", "get this ship moving").

Everything below starts at undressing, the stage where v2.4's lovers rule starts. Nothing changes before it.

- **The voice without its subjects** (`lib/adult/quality.ts` `voiceWithoutTopics`). Each sheet's `Voice:` line loses
  the clauses that name a topic word, from either sheet (v2.4's `topicsOf`). The rhythm and delivery stay. The voice is
  read a sentence at a time, in fragments between its commas, semicolons and colons. A fragment that names a topic goes,
  and so does the list it belongs to: the clause that opens the list with a preposition ("drifts toward the sea") and
  the items after it. Two kinds of fragment stay: a list of peers with no such clause in front ("easy compliments, dance
  metaphors, light flirting" keeps the compliments and the flirting), and a noun phrase before the preposition ("short,
  physical sentences about heights…"). Juniper's voice becomes *"Dry and unhurried: short sentences, long pauses, a flat
  delivery on her strangest lines. Asks odd, sincere questions, and never laughs at her own jokes."* Nothing is
  hard-coded to her. The sample lines ("Sounds like", and their best show lines) that say a topic word are left out
  too. The voice rule becomes their rhythm and delivery (`LOVERS_VOICE`). The line rule's "their work or a hobby now
  and then" is gone, because the lovers rules contradicted it.
- **Both sheets' words** (`lib/adult/scenes.ts` `topicsAt`). Each speaker's budget (one topic line in 12) counts both
  sheets' topic words. It also counts the subjects a voice listed alongside them (Juniper's "sea"). A craft rule says
  so: *"Neither of them borrows the other's work or hobbies either: Chud doesn't tease with Juniper's, nor Juniper with
  Chud's."* The note names whose words they may be (*"Chud talked about work or hobbies (his or Juniper's)…"*). A word
  that the steer or a whisper names is still the owner's to ask for.
- **The wry asides, rationed** (the prompt). A craft rule: *"Dry asides are rationed: about one line in six may be
  commentary on what's happening (a deadpan remark, a joke, a comparison, an observer's or technician's word for it).
  The rest say what they feel, want or do, plainly, in their own rhythm: a deadpan character says it short and flat,
  not clinically."* The line rule says the same in one sentence.
- **The clinical register, held to its share** (`clinicalWordsIn`, `CLINICAL_EVERY` = 6, in `dropRepeats`). The guard
  reads the shape of the words, not a vocabulary: the abstract endings that a manual or an inspection report is written
  in (-ity, -ation, -ment, -ics, -ural…, so "structural integrity", "containment", "acoustics", "salinity"). An
  exception list holds the words of those shapes that any intimate scene says plainly (sensation, position, tension,
  pleasure…). Actions don't count, and a word the steer or a whisper says is allowed. Past one line in six, the
  sentences that say one go (as the topic budget does), and the line goes when nothing it says is left. It's counted in
  `CraftCuts.clinical` and the step's `clinical_cut`. A speaker past the share also gets a note naming the words.

**The sim's scoring** (`scripts/sim-after-dark.mjs`, `lib/adult/observer.ts`, `scripts/eval/after-dark-observer.mjs`):

- `voice_sheet_detail` reads `sheet_detail_rate_early`, a character's sheet share over their lines before undressing,
  because v2.4+ cuts sheet words after it on purpose. An older report falls back to the whole night's rate.
- The observer reads the owner's steps too. The write after a Set the scene (or a scenario's start) arrives where it was
  set, and moves the observer's place there. A Direct steer that names a place or a movement orders the move. Neither is
  an "unprovoked move" any more (`ownerMoves`). On the replayed night that took the v2.4 run from 4 unprovoked moves to
  1. The one left (into the bedroom on a plain continue) is real.
- The chapter-restart check counts a line that carries the act on ("between her legs", "moans", "writhes") as where the
  last chapter ended. The check reads only the chapter's first lines, and the stage floor is unchanged. Re-checked on the
  replay: chapter 2's first lines carried straight on, and stageShown read them as stage 2 because nothing in them used
  its words. A few lines later the model did slide back to a doorframe and her thigh. That slide is the register
  problem, not a restart.

**The replay** (local only, nothing written to production). David's night was rebuilt read-only from production, the
way #719 describes: Chud's sheet, the adult_steps of the pair on 2026-10-23 06:52–07:29 UTC (the elevator scenario
first, 31 steps, with Set the scene and turn-ons Chud dirty_talk and Juniper being_told). It ran through
`npm run sim:after-dark` on DeepSeek V3.1, once on main (v2.4) and once on this branch. Both are scored with the new
scoring. The transcripts stay in a scratchpad. Juniper's lines from undressing on (63 in each run):

| | v2.4 (main) | v2.5 |
|---|---|---|
| Her lines that are a dry or technical aside (read blind, both runs shuffled together) | 55 of 63 (87%) | 27 of 63 (43%) |
| Her lines with a clinical-register word (`clinicalWordsIn`) | 28 (44%) | 3 (5%) |
| Her sheet's words, per 10 of her lines | 0.5 | 0.5 |
| Sea and broadcasting words, per 10 of her lines | 2.9 | 1.9 |
| Her lines touching the sea, broadcasting or her job | 15 (24%) | 11 (17%) |
| Chud's lines using her words or the sea (of 65–68) | 4 | 2 (one is the owner's own steer, "sea serpent") |
| Steps that failed | 0 of 31 | 1 of 31 ("only repeated lines", the next step carried on) |
| Quoted lines in Direct steers said | 10 of 12 | 9 of 11 |
| Composite | 61 (58 on the old scoring) | 63 |

The clinical guard cut 1 line and the topic budget 5. Most of the change came from the prompt. What's left: about
two in five of her lines are still asides, which is more than one in six. In the group half the sea comes back in
words no sheet has (the tide, a storm front, a squall, the fog), and a new tic took over ("'Kay." nine times, and many
lines that are only an action). The composite's `voice_sheet_detail` is 0 in both runs. The elevator scenario reaches
undressing by the third step, so only about ten lines come before it.

### v2.6: the aside check, the tic guard and the quotes' owners (2026-10-24)

v2 changed in place again (`prompt_version` is still `"v2"`; a step's flags say `prompt: "v2.6"`). On the v2.5 replay of
David's Chud × Juniper night, 43% of her lines from undressing on were still asides (the target is about one in six),
the sea came back in words no sheet has (tide, storm front, squall, fog), she said "'Kay." nine times, and a quote the
Direct steer gave Chud was said by her. Everything below starts at undressing, as v2.4 and v2.5 do.

- **The aside check** (`lib/adult/asides.ts` `checkAsides`, run in `writeSceneStep` after the stage is stamped). One
  extra short call per step, on the same After Dark text model and pinned hosts, with a JSON-only prompt. It reads the
  scene's last 12 lines (H1…) and the step's new lines (N1…), marks every line that is commentary rather than desire,
  feeling or action (a deadpan remark, a joke, a technician's word for it, a metaphor from the sea, the weather,
  machinery, jobs or reports), and gives a plain rewrite of each new line it marks. Per speaker, past one in six of
  their recent and new lines that say something (rounded down, at least one: `asideAllowance`), the newest excess
  asides take their rewrite. The rewrite keeps the line's action, speaker and intent. It never touches a line before
  undressing, a move, a proposal to go somewhere, or a line carrying a steer's quote. The sea and the weather are in the
  check's own definition, so there's no word list for them. Every rewrite runs through the guards a written line does
  (`screenRewrite`): `checkAdultText`, the hard nos and the intensity, a refusal, the names, the steer and whispers not
  copied, a quote not given to the wrong speaker, no further than the line it replaces showed (`stageShown`), and
  `dropRepeats`' repeat and craft guards against tonight and the step's other lines. A rewrite that a guard would cut
  is not used, and the line stays as written. It fails open: an error, a reply it can't read, or 6 s gone by
  (`ASIDE_TIMEOUT_MS`) keeps every line as written. Flags: `asides_rewritten`, `aside_check_failed`, `asides_marked`,
  `aside_check_ms`, `aside_usage` (its tokens and cost). The step's `usage` includes the call, and the month's cap
  still counts steps.
- **The tic guard** (`ticsIn`, `withoutTics`, `TIC_CAP` = 2, in `dropRepeats`). It's generic: any sentence of two words
  or fewer that the same speaker has already said twice this chapter loses that sentence. The action stays, even
  alone, and the line goes when nothing is left. A word the steer or a whisper says is allowed. The prompt names the
  interjection (*"Juniper keeps saying the same short word ("kay"): not again"*). It also notes a run of action-only
  lines (3 of their last 6): their next lines say something too.
- **The quotes' owners** (`misattributedQuote`, `withoutQuote`, in the step's guard). A quote the steer gave one of
  them by name, said by the other, comes out of that line. It moves to the right speaker's nearest line in the reply
  (after its action) when they have one that doesn't already say it. Otherwise the missing-quote retry asks for it.
  Counted in `quotes_misattributed` and `quotes_moved`. v2.4 had the same bug, and so did the parser: a quote that opens
  the steer and is followed by a pronoun only one of them goes by (*'"Do as you are told" he shoves…'*) went to
  nobody. On the v2.4 replay, Juniper said it. Now it's Chud's (`steerQuotes`).

**Cost:** one extra small call per step from undressing on. On the replay that was 773 tokens in and 31 out on average,
which is 0.048¢ a step at CoreWeave's price ($0.55 / $1.65 per million). A step is about 0.2¢, so that's roughly a
quarter more. It took 0.8 s at the median (2.2 s at the most). None of the 29 checks failed or timed out.

**The replay** (local only, nothing written to production), as v2.5's: the same steers and turn-ons, through
`npm run sim:after-dark` on DeepSeek V3.1, once on main (v2.5) and twice on this branch. The first branch run rounded
the share to the nearest line, and the second (what ships) rounds it down. All three runs' lines from undressing on
were shuffled together and read blind by a separate agent:

| | v2.5 (main) | v2.6, rounded | v2.6 (ships) |
|---|---|---|---|
| Her lines that are an aside (blind) | 26 of 67 (39%) | 20 of 72 (28%) | 14 of 68 (21%) |
| …of her lines that say something | 26 of 51 (51%) | 20 of 55 (36%) | 14 of 56 (25%) |
| Sea and broadcasting words, per 10 of her lines | 0.7 | 1.0 | 1.2 |
| "'Kay." (her lines) / her most repeated interjection | 0 / "alright" 2 | 0 / "well" 2 | 0 / "harder" 3 |
| Her action-only lines | 24% | 24% | 18% |
| Misattributed quotes | 0 | 0 | 0 |
| Quoted lines in Direct steers said | 9 of 12 | 10 of 12 | 10 of 12 |
| Steps that failed | 0 of 31 | 0 of 31 | 0 of 31 |
| Step time, median / p90 | 6.1 s / 23.8 s | 6.7 s / 21.6 s | 6.9 s / 16.2 s |
| Lines rewritten by the check | | 13 | 12 |
| Composite | 76 | 69 | 69 |

This v2.5 rerun came out cleaner than v2.5's own report (39% asides against 43%, no "'Kay." against nine, no
misattribution against two), so a single night is noisy. The composite moves with it: v2.5 scored 63 on its first run
and 76 on this one. The 7 points between v2.5 and v2.6 here are `voice_sheet_detail`, which reads the ten lines before
undressing that v2.6 doesn't touch, plus place detail and one cross-chapter near-repeat. What's left: about one in five
of her lines is still an aside, so the check misses some, and the sea's words held at about one per 10 lines ("the
gulls would approve", "louder than a foghorn"), the same range as v2.5's two runs (0.7 and 1.9).


### Ages and counts (2026-10-23)

The two lines refused ordinary steers as "nobody under 18": After Dark's age-in-passing patterns (`checkAdultText`,
lib/safety.ts) read any "is / are / was <one to seventeen>" as an age unless an amount word followed, so "she is one hot
woman", "he's one of a kind", "there are two ladies watching", "they kiss as if they were two strangers" and "she was two
drinks in" were all refused. Now "one" and "two" after those verbs count as an age only where the clause ends ("she's
two.", "She's one. He's 30.") or runs on into an age's own words ("one and a half", "two now", "two years old"), and the
amount words take people and things a scene counts (ladies, couples, strangers, drinks, floors, "of the…"). Every other
age under 18 is refused as before, in any form; the tests keep both lists (tests/after-dark.test.ts).

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

So After Dark stays on DeepSeek V3.1. What it cost was time: 40 to 55 seconds a step in this run (Dolphin 7 or 8).

**The routing** (the same day): the time was OpenRouter's default routing, which favours DeepSeek's cheapest host.
Timed on the scene prompt (about 1,400 tokens in, 600 out): DeepInfra 65–151 s (4–8 tokens a second, and 429s),
SiliconFlow about 30 s, CoreWeave 6–7.6 s (about 90 tokens a second); SambaNova answered 429 every time. So
`text_model` is `deepseek/deepseek-chat-v3.1:nitro`, OpenRouter's throughput-first routing, which picked CoreWeave each
time: two production steps through the eval route took 11 seconds, at about 0.2¢ a step (twice DeepInfra's price). A
setting, not code: the plain id went back to the cheapest-first routing. Since the terms fixes (#6), every call is held
to CoreWeave and DeepInfra, fastest first, whatever the id says.

The code default (`DEFAULT_TEXT_MODEL`, for a setup with no `text_model` saved) is now `deepseek/deepseek-chat-v3.1`,
plain: the pinned hosts' throughput sort does what `:nitro` did, and the old default (`mistralai/mistral-large`) isn't
served by either host.

**Replaying a real night** (2026-10-23): `--character file.json` creates that character instead of Teodor Vance (the same
shape, extras and all: they feed the voice kit), and `--steers file.json` replays a night in order, one step each, instead
of the built-in nudges: `{}` continues, `{ direction, mode }` steers (`direct` or `nudge`), `{ set_scene }` and
`{ scenario }` do what the page's buttons do, and the object form `{ turn_ons: { character, partner }, steers }` sets each
one's turn-ons first. Each model runs on the hosts in the run's own `ADULT_TEXT_PROVIDERS`, or on its own after an `@`
(`--models deepseek/deepseek-chat-v3.1@coreweave+deepinfra,cognitivecomputations/dolphin-mistral-24b-venice-edition@venice`),
so a local run can put Dolphin back on Venice without touching production's list. `--penalties 0.3,0` gives each model
its own frequency and presence penalty, in `--models`' order (an empty place keeps the app's own), so one model can run
twice on the same night with two settings. The steers file and the output stay outside the repo: they're explicit.

## Videos with both of them in (2026-10-22)

**What David saw** (Lexi and Dex's video of the night): "doesn't actually show the interacting in the scene and they
are not in the same video together". Every shot was one of them alone against the grey wall of their portrait,
saying the line to the camera. The sex was played as a solo: the directions read "arches her back, reaching behind to
urgently grab at the air" and "grips his own hips tightly". Five of the six shots were Dex.

**Why.** An image-to-video model can only move what its first frame holds. Since #392 each shot started from one
person's baseline, a waist-up studio portrait of them alone. Asked for "two adults" from it, the model made the
partner up (Star Dust and Sable's strangers), so #588 told it the other one was off camera. The clips David liked
all started from a picture of the two of them together (the Chud and Sable tests of 2026-10-19, and the first reel's
two shots made from a scene picture).

**What the adult products do** (read-only research, 2026-10-22; sources in the PR):
- **Candy.ai:** one character, to the camera, with the viewer as the partner. Users pick from a fixed list of actions. Two people together appear only in its pre-made Shorts.
- **Seduced** documents the rule outright: the start image must already show the act, and adding a missing participant by prompt from a solo image is "less reliable". Its acts are 200+ motion add-ons (LoRAs) the user picks.
- **OurDream:** a character, a required action preset, and image-to-video.
- **Nectar AI** is the only one that puts named characters together (up to 10). Its prompt rules: describe each person on their own, give each a place in the frame (left or right, in front or behind), say how many people there are, and restate each at every beat.
- **The common recipe:** keep the identity, make a keyframe that already shows the act with both faces, animate it, 5–10 s a clip, with sound.

**The bake-off** (Lexi and Dex at their peak line, one keyframe, 5 s each, about $2.10 of Venice):

| Start | Video | Both in frame | Follows the script | Faces | Voice | Cost |
|---|---|---|---|---|---|---|
| Keyframe of both | Wan 3.0 (`wan-3-0-image-to-video`) | yes, the whole shot, no cut | yes | kept | says the line itself, the right person | $0.69 |
| Keyframe of both | Wan 2.7 with Dex's Kokoro voice | yes | yes (she reaches back for his arm) | kept | lip-synced onto *her* face | $0.59 |
| Keyframe of both | LongCat distilled | yes | drifts (she sits up instead) | drifts | none | $0.13 |
| The two portraits as references | Wan 3.0 reference-to-video | yes | yes | kept | says the line | $0.65, but her baseline's lingerie stayed on, a generic room, and no picture to age-check before paying for the video |
| One portrait (the old way) | Wan 3.0 | one person, or a made-up partner after a mid-shot cut | no | drifts after the cut | | $0.65 |

The keyframes come from Venice's multi-image edit. `qwen-edit-uncensored` kept both faces and the pose. FireRed got the
act wrong and kept a baseline's bra. Given the night's drawn set as a third picture, the keyframe lands in the same
room the theater shows. The keyframe passed Hive (child score 0.0000003, the age check "ADULTS").

**What changed** (`lib/adult/reels.ts`):
- **The director** (After Dark's text model) picks the lines and, for each, writes a still ("frame": where they are, who is where, how they're posed, what they're wearing by then, the framing, varied) and a "motion" (what each does next), from the line's action and the lines before it. It names them only by how they look ("the woman", "the man", or by their hair when both are women or both men). Names are scrubbed from anything it writes, and from place names ("Lexi's bedroom" is "her bedroom"). It's asked to give both of them lines.
- **Each shot's keyframe** is the two baselines (plus the place's drawn set, when one is ready) made into one picture of that still, kept by the edit model to each one's face, hair, skin and body. It's dressed before undressing and explicit from it. It's checked by Hive (moderation and the age question; since 2026-10-23 the age question alone, its moderation being its shot's: "Hive's daily limit" below) before anything is made from it, and kept out of the gallery as a `frame`; a video row's `source_image` points at it. A keyframe the check refuses is discarded and logged. One Hive couldn't check is asked again once, then dropped. A shot dropped either way gives back its share of the tokens.
- **The shot's prompt** is the motion, "two people only", both restated, one continuous steady shot with no cuts and nobody else, and who says the line, in the same voice words each time. Wan 3.0 stays the default (David's pick for the voice).
- **Faster:** the keyframes are drawn at once, so all six videos run side by side. Before, each character's shots waited for their previous one. The chaining and its ffmpeg last-frame step (`lib/adult/frames.ts`, `ffmpeg-static`, ~75 MB in two routes' bundles) are gone.
- **The places:** where each line was said comes from the night's start and the lines that agreed to go (`moved_to`), so the reel now reads the night itself (`reelNight`), not the page's copy of its lines. A saved night is filmed only for its own pair.
- **Cost:** $0.24 more a video (6 keyframes), and 6 more Hive moderation requests against the self-serve 100 a day (none since 2026-10-23: a keyframe gets the age question only).

**The first live reel** (3 shots of Lexi and Dex, the night they ended in her bedroom; #688):
- It started in 31 s, all three keyframes passed Hive, and the shots took about 4 minutes.
- **Opening (Dex's line):** a medium two-shot by the bed, her hand on him.
- **Peak (her line, "Harder, Dex…"):** the script's position, her reaching back for his arm.
- **Afterglow (his line):** lying together.
- Every shot had both of them, in the drawn bedroom, as one continuous take, and each line was said by the right person (checked by transcribing).

It showed two weak spots, both fixed in the follow-up:
- **Her portrait's lingerie stayed on through the sex.** The keyframe was told to keep each of them "exactly as in their own picture". Now it keeps their faces and bodies, not their clothes: dressed before undressing, half undressed at it, nude from sex on unless the moment says otherwise.
- **The afterglow's wide shot from above came out tangled, his face hidden.** The director now shoots lying down as a medium shot from the side, with both faces toward the camera. Both fixes were retried as keyframes on the same moments, and both looked clearly better.

**Terms (2026-10-22):** Venice's terms (last updated 2026-06-08) have users warrant, in §10.9(c), that no reasonable person could deem their content "pornographic". Outputs count as user content (§10.1). That reads against Venice selling uncensored models. Settle it with Venice in writing before any subscriber uses After Dark: this widens the question that was already open for pictures. MiniMax H3 (Venice's `minimax-h3-max-reference-to-video`) has a further problem: its open licence excludes the US, EU, UK and South Korea, outputs included.

**Next, not built:**
- **A menu of acts per shot**, as the leaders do: preset framings that make keyframes more reliable than free text. Built for clips (below, "Clips on demand"); a night's reel still has the director write each shot.
- **Act motion add-ons (LoRAs)** would need Wan run somewhere that takes them; Venice doesn't. Replicate's `wan-2.2-i2v-fast` takes LoRA URLs and a `disable_safety_checker` flag, and its terms ban only non-consensual or illegal pornography: about $0.05 at 480p, or $0.11 at 720p, a clip. RunPod, WaveSpeed, Novita, Segmind, Together and fal ban adult output. The Replicate backup (below) takes one LoRA for its videos, as a setting.
- **"Extend"** from a shot's last frame, for longer moments. Built for clips as Keep going, from the shot's keyframe instead (no ffmpeg on the server since #688).
- **Wan 3.0 reference-to-video** as a one-step option.
- **Terms:** Venice's model list marks Wan 3.0 "anonymized", which means a third party runs it, while `qwen-edit-uncensored` and LongCat are Venice's own. Get Venice's word in writing on explicit output for both kinds, along with the pictures question already open.

## The director: suggested next moves, rewind and redo, whisper to one (2026-10-22)

David picked these from the competitor read (Candy, OurDream, SpicyChat, Secrets, Nectar: nearly all have them). Code:
`lib/adult/director.ts` (pure), `lib/adult/scenes.ts` (`continueScene`, `rewindScene`, `redoScene`, `forgetWhisper`),
the scene route, and the steer bar in `SceneWriter.tsx` (the theater shows the suggestions too).

**Suggested next moves.** Each step's reply (prompt v2) also carries `"suggestions": {"mild", "flirty", "spicy"}`: three
one-tap steers for what could happen next, each under 80 characters. Every one is held to the rules a line is
(`holdSuggestion`), for the scene as the step leaves it:
- the two lines (`checkAdultText`), and no one else on the show by name (the name guard);
- the pace: at most one stage further than the scene stands (`stageAsked`: what it plainly shows, by the stage floor's
  signs, or a stage on when it asks for more: "further", "all the way", "into bed");
- the public-place cap: somewhere public, nothing past kissing unless it has them leave for somewhere private first;
- any limits the rules bring (the pair's hard-nos, next).

One that fails is replaced by a plain one of the same heat (`fallbackSuggestion`, held to the same rules; the spicy one
somewhere public is "One of them suggests they leave for somewhere private"), and the step's flags count how many
(`suggestions_replaced`). They're stored on the scene (`adult_scenes.suggestions`), so a reload shows them, and go when
the night starts over or the scene is set somewhere new. A chip sends its text as a Nudge. Prompt v1 (kept word for
word for the A/B) asks for none, so it shows none.

*Checked on the real model* (`npm run sim:after-dark -- --models deepseek/deepseek-chat-v3.1:nitro --steps 4
--date-model stub`, two runs, about 2¢, counts only, no lines read): DeepSeek V3.1 sent the suggestions as asked in some
steps, flattened them into the reply as `_suggestions_mild` / `_suggestions_flirty` / `_suggestions_spicy` in one, put
underscores round other keys too (`_stage`, `_place`), and left them out altogether in others (one reply wrote its
instructions into a key name). `suggestionsIn` and `parseSceneMeta` now read keys without the underscores and the
flattened form; a step with none shows the plain ones. When it sent them, all three passed: 37–49 characters,
none over the pace.

**Rewind and redo.** Each step leaves what a rewind needs on `adult_scenes.undo`, a stack 5 deep (`UNDO_DEPTH`): the scene
before it (its lines by count, since within a chapter they only grow; stage, place, set, cut, place history, moves,
picture note, suggestions, whispers), what it was asked (steer, Nudge or Direct, whisper), the uses of the facts its
lines cited, and, when it filled the chapter, what the chapter's close did. **Rewind** puts all of it back:
- the facts its lines cited get their `uses` and `last_used_at` back;
- a chapter close is taken back whole: its saved night goes (its lines come back to the scene, with their votes and
  steps), the PG notes are put back as they were (or removed where there were none), the facts it extracted go, and the
  ones the cap dropped to make room come back as they were;
- votes on the lines that went are dropped (their line numbers will be the next step's);
- the step's log entry is never deleted: it's marked `rewound`, with when and the lines it wrote, and the rewind is a
  step of its own (`kind: "rewind"`), so /why reads honestly.

What stays: the step's pictures (made and checked; pictures are off while Venice is out of credit anyway), and a set it
drew (sets are a shared library: the scene goes back to the set it was on). Start over and Set the scene clear the stack,
so a rewind never undoes a paid cut or a filed night. **Redo** is a rewind and the same step again: the same steer, the
same strength, the same whisper. It counts for the month like any step, and is refused before anything is taken back
when the month's cap is reached. Both buttons sit in the steer bar.

**Whisper to one.** The steer bar's "How" has two more choices besides Nudge and Direct: 🤫 one of them. The words then
go to that character alone (`adult_steps.whisper` on the step it's sent with; the scene keeps the ones still running in
`adult_scenes.whispers`, one each at most, so the viewer can hold both secrets at once). The prompt plays it as that
character's own secret intention for this step and the next ("A secret only Juniper knows: …; Rafe doesn't know it, and
nothing in these lines lets him find out… never said aloud, word for word or nearly"). It's held to the same checks as
a steer: refused (422, never stored, only that one was refused) when it crosses the two lines, and a line that says it
out loud (most of it word for word, the steer-copy rule) is dropped, or loses the action that does (`whispers_said`).
A whisper never lifts the public-place cap (it's not a Direct steer). The page shows a 🤫 chip for each one running,
with whom it went to and a × to forget it.

**Screenshots** (`npm run screenshots:after-dark`, a stub model writing PG placeholder lines):
`docs/screenshots/after-dark-director-*.png`.

## A Replicate backup (2026-10-22)

**Why.** Venice's terms (§10.9(c)) have users warrant that no reasonable person could deem their content
"pornographic", and David is asking Venice for a signed OK. Until it comes, Replicate is a working backup:
- **Its terms** (replicate.com/terms, updated 2026-04-01) bar "non-consensual nudity or illegal pornographic content" (§2.7(d)(v)).
- **§8.6** says outputs can be pornographic, and leaves managing them to the customer.
- **None of its extra terms apply.** Those cover Black Forest Labs, Ideogram and Stability models, and none of the models below.
- **Its models take `disable_safety_checker`.**

**The switch** is `media_provider` in After Dark's settings: `venice` (the default) or `replicate` ("Make pictures and videos on").
- **It moves everything Venice made for After Dark:** the explicit pictures (when "Make pictures on" is Venice), each shot's keyframe, the videos, and now their voices.
- **A reel's shots keep the provider they started on** (`provider` on the shot), so switching never strands a reel.
- **Not moved:** the season's PG portraits (lib/season-gen.ts, Venice with safe mode on) and the looks builder's tiles (lib/looks-draw.ts).
- **The key:** one saved in the settings, else the server's `REPLICATE_API_TOKEN`, set in Vercel production on 2026-10-22. The settings page says which, and never shows it.

**The models.** Each was read from its Replicate page and API schema on 2026-10-22; the main session ran each live the same day on the real key.

| Job | Model | What we send | Price |
|---|---|---|---|
| Pictures (baselines, scene pictures) | `qwen/qwen-image` (official; Apache 2.0) | prompt, our negative prompt, `aspect_ratio` 3:4, `output_format` png, `disable_safety_checker` | $0.025 a picture |
| Keyframes (the two of them) | `qwen/qwen-image-edit-2511` (official) | the same prompt as on Venice, `image` [Picture 1, Picture 2, the set], 3:4, png, `go_fast`, `disable_safety_checker` | $0.03 a keyframe |
| Videos | `wan-video/wan-2.2-i2v-fast` (official; Wan 2.2 A14B, Apache 2.0) | the motion with the speaker's lips moving, `image` (the keyframe), `num_frames` 81–121 by the line's length, 16 fps, 720p, `go_fast`, `disable_safety_checker`, an optional LoRA | $0.11 a video at 720p |
| Voices | `jaaari/kokoro-82m:f559560e…` (a community model, so run by its version; Apache 2.0) | `text`, `voice`, `speed` | about $0.0002 a line |

Notes on each:
- **Pictures:** official, so always warm. The alternative is `adirik/realvisxl-v4.0:85a58cc7…`, RealVisXL V4.0, the SDXL fine-tune the fal path uses as its base: Lustify's class. The code gives it 832×1104. It's a community model with 66K runs, so it cold-starts, and Replicate estimates about $0.049 a run.
- **Keyframes:** 10 s, an 880×1184 PNG. The official endpoint has no LoRA input.
- **Videos:** 82 s for 81 frames, an 816×1104 MP4 of 5.06 s with no sound. It's the only Wan on Replicate that takes `disable_safety_checker` and LoRAs: 2.5, 2.6 and 2.7 take neither and aren't open weights, and 2.2 A14B has no safety flag.
- **Voices:** about 1 s, a WAV, stored as `audio/wav`. Every voice of ours is there but `af_heart`, which becomes `af_alloy` (nobody else's).

**Why Qwen-Image for pictures:** it's official, so always warm and a fixed price; its weights are open (Apache 2.0); and it's the same family as the keyframe edit. RealVisXL is the closer cousin of `lustify-v8` and likely better at explicit anatomy, but a community model wakes up cold, which a baseline made inside a scene step can't wait for. The bake-off decides: `replicate_picture_model` takes either.

**How a reel runs on it** (lib/adult/reels.ts):
- **The rest of the reel is unchanged:** the same director, lines and keyframe prompts.
- **The keyframes:**
  - each is asked with `Prefer: wait=60` and polled past that (cancelled after two minutes);
  - it's downloaded at once, because Replicate deletes what a model made an hour after;
  - it's checked by Hive (moderation and the age question) before it's kept as a `frame`, and a refusal is discarded and logged.
- **The videos:**
  - each is queued with `Cancel-After: 30m`, and the prediction's id is the shot's `queue_id`;
  - the page's poll asks Replicate, and a finished video is downloaded at once, checked by Hive, and only then stored.
- **The voice:**
  - once a shot is kept, its line is said by the character's stock Kokoro voice, the same one every shot;
  - it's stored beside the shot (an `adult_images` 'audio', `audio_id` on the shot);
  - the player plays it with the shot: it starts with it and pauses with it, and a line longer than its shot finishes on the shot's last frame;
  - a line too long for 121 frames is said up to 1.25× faster;
  - a voice that doesn't come leaves the shot silent, with its caption (`reason: "no voice: …"`).
- **Replicate's own checker is off on every picture, keyframe and video;** Hive is never skipped.
- **Stopping a reel cancels its videos still running there.**
- **Within the hour:** a shot not collected within Replicate's hour fails ("Replicate no longer has it") and gives its tokens back, so keep the page open while it makes.
- **How the pictures get there:** the baselines and keyframes go as our signed 30-minute links. A drawn set goes as a data: URI up to 256 KB, else by its public `/api/sets` link.

**What the main session's test found** (2026-10-22, the real key, our real pair):
- **The keyframe** kept both faces well (better than Venice on hair and face), with the drawn set as Picture 3. But it tends to keep the portrait's clothes when the prompt says nude: for explicit stages, Venice's `qwen-edit-uncensored` follows the clothing better.
- **The video** kept both of them in frame as one continuous take, with stable faces, and the scripted action played out. Visually it's comparable to Wan 3.0, but silent, hence the voices.
- **Hive passed the Replicate keyframe** (child 6e-7, the age check ADULTS).

**The smoke test after the merge** (2026-10-23): our code against the real API, run locally, with PG inputs only (two house characters' public portraits, dressed, at a harbour at dusk).
- **The keyframe:** Qwen-Image-Edit took 6.5 s running (22 s with the queue) and returned an 880×1184 PNG of 873 KB. Hive passed it.
- **The shot:** Wan 2.2 took 72 s running (100 s with the queue) and returned 81 frames, an 816×1104 H.264 MP4 of 5.06 s, 491 KB, with no audio track. It wasn't sent to Hive (one check that day), so it wasn't kept either.
- **The voice:** Kokoro took 1.7 s and returned a 24 kHz mono WAV of 2.7 s for an 8-word line. Replicate serves it as `audio/x-wav`, and it's stored as `audio/wav`. Kokoro talks at about 3 words a second, and the shots' lengths now count on that: up to 13 words fit the shortest shot (5 s), about 20 the longest (7.5 s).
- **It cost** about $0.14 ($0.03, $0.11 and under $0.001), plus one Hive moderation request and one age check.

**What David does** (some of it done on 2026-10-22):
1. **Sign up at replicate.com and prepay credit** at replicate.com/account/billing, with auto-reload off. Done: account smithdavedesign.
2. **Set a spend limit.** Replicate retired its self-serve monthly limit (July 2025), so the prepaid balance with auto-reload off is the limit: at zero, Replicate starts no new work. Load only what you're willing to spend, and ask support@replicate.com if you want a hard monthly cap as well.
3. **Store the token:** `~/ai-stack/bin/secrets add botchelor REPLICATE_API_TOKEN --cap "<the prepaid amount>, auto-reload off"`. Done: it's in the keychain at `vault/botchelor/REPLICATE_API_TOKEN`, and in Vercel production as `REPLICATE_API_TOKEN`.
4. **Save it in After Dark's settings,** or leave the field empty to use the server's token. The page says "from the server's environment" when it's that one.
5. **Switch "Make pictures and videos on" to Replicate** (`media_provider`) on /admin/after-dark/settings.
6. **Rerun the 4-shot bake-off** below before relying on it.

**The bake-off to rerun:** the same pair and night as Venice's bake-off above (Lexi and Dex, their peak line and the shots around it), with `reel_shots` at 4 and Replicate as the provider. For each shot, check:
- **both faces kept:** each the same person as their baseline;
- **the act:** the keyframe shows what the script has them doing at that line, dressed or not as the stage says (the weak spot to watch: clothes kept);
- **a Hive pass:** every keyframe and shot passes, with no discards and nothing in the rejections;
- **the voice in sync:** the right one's voice says the line while their lips move, starting and ending with the shot.

Put it side by side with Venice's table above (both in frame, follows the script, faces, voice, cost). It costs about $0.56 of Replicate (4 keyframes at $0.03, 4 videos at $0.11, the voices next to nothing), and 8 Hive moderation requests plus 4 age checks.

**Admin tools for the providers (2026-10-22):** `after_dark_settings` (admin MCP) takes `media_provider` (`venice` or
`replicate`), so an admin's agent can switch providers without the signed-in settings page. `after_dark_baseline`
draws a new baseline portrait of one character with the current provider, checked like every picture. The newest
baseline is the face later keyframes keep; the older one stays in the gallery, to compare.

### Falling back to the other provider (2026-10-23)

David hit "rate limited on Replicate" and the step failed: one provider made everything, with nothing behind it. Code:
`lib/adult/fallback.ts` (`runMedia`), used by pictures (`drawPicture`), each shot's keyframe and video
(`startShots`), a Replicate shot's voice, voiced lines and the shot-menu pictures.
- **When it switches:** the provider in use answered 429 (rate limited), 402 (out of credit) or a 5xx, or didn't answer
  (a network error, a timeout). The same job is tried once on the other, if its key is set and its model for that job is
  configured. Anything else (a content refusal, a bad request, the output check failing) doesn't switch.
- **The cooldown:** a provider that answered 429 or 402 is skipped for a while (its `Retry-After`, at most 15 minutes,
  else 3 minutes for a 429 and 30 for a 402), so the next calls go straight to the other. It's kept in
  `adult_media_cooldowns`, so it holds across Vercel's instances. When both are cooling down, the configured one runs
  and its error shows as before.
- **Never mid-job:** a video already queued is collected where it was queued (the shot's `provider`). Only a new shot or
  a new Keep going goes to the other; a picture, a keyframe, a voice line and a menu picture switch freely.
- **Unchanged:** Hive checks whatever comes back, and the caps and usage count it, whoever made it.
- **On the record:** `adult_images.provider` and `fell_back` on each picture, keyframe, video and voice;
  `adult_reels.provider` (`venice`, `replicate` or `mixed`) and `fell_back`; a shot's `frame_provider` and `fell_back`; a
  scene step's flags list the pictures it made on the fallback (`media_fallback`). The gallery says "made on Replicate
  (fallback)".
- **The switch:** `media_fallback` (on by default) on /admin/after-dark/settings and in `after_dark_settings`.
- **Cost:** a picture on Replicate is about twice Venice's (docs/after-dark-costs.md).

### Which model wrote each step (2026-10-23)

Every step now records the text model that answered it (`adult_steps.text_model`): the id OpenRouter reports in its
response when it does, else the one asked for (`adultModelId`), and the host it routed to (`text_provider`, e.g.
DeepInfra) when it says. Every change to the text model, the picture and video models and the media provider is kept in
`adult_settings_history` (what, from, to, when, who: an admin's id or "mcp"), from the settings page and MCP alike.
- **Shown** (admins only) on /admin/after-dark/graph per chapter, on the why view (`written_by` on the running chapter
  and each night), and in MCP `after_dark_scene`.
- **Older lines:** a chapter with no recorded model reads the settings history for the text model set then; with no
  history, it says "before model logging" (lines older than step logging, 2026-10-22) or "not recorded". The history
  starts empty: no change before this was recorded with a time, so nothing is backfilled or guessed.
- **Not covered:** the eval and the A/B (lib/adult/eval.ts) don't log steps; they keep their own model ids per arm.

## Limits and memory: the intensity dial, hard nos, and memory you can see and edit (2026-10-22)

The second of the three scene PRs from the competitor read. Code: `lib/adult/limits.ts` (pure), `lib/adult/scenes.ts`
(`saveLimits`, `limitRefusal`, `memoryView`, `editMemory`), `lib/adult/memory.ts` (`ownNotes`, `setOwnNote`),
`lib/adult/facts.ts` (`editOwnFact`), and two folded panels under the steer bar (`Limits.tsx`, `Memory.tsx`).

**The intensity dial**, per owner and pair (`adult_scenes.intensity`, kept through Start over; null is explicit):

| | Furthest stage | Register |
|---|---|---|
| Slow burn | kissing | tender and suggestive, nothing explicit, no body parts named |
| Flirty | undressing | playful and teasing, never graphic or crude; past undressing only implied |
| Spicy | sex | steamy, sex included, no graphic anatomy or crude words |
| Explicit (default) | sex | as it was: the prompt is word for word what it was |

Every step holds to it, whatever the steer: the prompt says the register and "Tonight it goes no further than kissing";
the pacing line says when they've gone as far as tonight goes (or, turned down mid-scene, to ease back to it); a line
that shows more than the furthest stage (the stage floor's signs), or a crude word below explicit, is dropped
(`intensity_dropped` in the step's flags); and the stage never climbs past it, a Direct steer included (turned down,
the stage comes back to it). A steer or whisper that asks for more is refused before anything is written. The suggested
next moves go no further either.

**Hard nos**, per owner and pair (`adult_scenes.hard_nos`: `{chips, own}`, kept through Start over): 16 curated ones
(pain, choking, degradation, anal, oral, restraints, rough sex, hair pulling, biting, spitting, dirty talk, cheating
talk, pregnancy talk, toys, dom and sub, being watched), each a never-cross rule for the prompt and a pattern for the
check (dirty talk reads only what they say; "chokes back a laugh" isn't choking, a shirt's cuffs aren't restraints), and
up to 8 of the viewer's own, 40 characters each, matched by their words (filler out, a light stem: "tickling" catches
"tickles"; "being called baby" needs both "call…" and "baby"). Own ones that cross the two lines are refused: those
already never happen.
- The prompt lists them as hard limits that hold over every steer (a nudge, a direct steer, a whisper), never crossed,
  offered or asked for.
- A line that crosses one is dropped and the step asked once more, told which, with nothing of the reply to copy from
  (`hard_nos` and `retried` in the step's flags, the reason in its dropped lines). The second reply is held to
  everything again; when nothing of it can be kept, the first reply's other lines stand.
- A steer (Nudge or Direct) or whisper that asks for one is refused (422) before anything is written; a redo is checked
  against the limits as they are now before anything is taken back.
- The suggested next moves are held to them too, and saving new limits holds the ones on the scene to them at once
  (a rewind does the same for the ones it brings back).
- The free-text check is a backstop: the model is told the rule, and the words catch the plain cases, not every way of
  putting it.

**Memory you can see and edit** (the "🧠 What they remember" panel, loaded when opened): what each remembers about the
other (their PG note from `adult_memories`, and their facts from `adult_facts`) and the night's recap. Each can be
edited or deleted. Edits pass `checkAdultText`; the PG note, which reaches their public dates and texts, also passes the
show's own `checkShowText` (nothing sexual, no innuendo) and stays under 300 characters. An edited fact drops its quote.
Owner-scoped: a viewer sees and edits only what their own nights wrote (a note or fact another owner's night wrote is
404 to them). A rewind of a step that didn't close a chapter leaves the recap as it is now, so an edit made since stays.

**Screenshots** (`SHOTS=limits npm run screenshots:after-dark`): `docs/screenshots/after-dark-limits-*.png`.

## Scenarios and turn-ons (2026-10-22)

The third of the three scene PRs from the competitor read. Code: `lib/adult/scenarios.ts`, `lib/adult/profile.ts`,
`lib/adult/scenes.ts` (`startScenario`, `saveFraming`, `profileView`), After Dark's part of `lib/safety.ts`
(`excludedTheme`), and two more folded panels under the steer bar (`Scenarios.tsx`, `Profile.tsx`).

**The themes that never happen**, now in `checkAdultText` itself, so every steer, whisper, place, line, suggestion,
fact, memory edit, picture prompt and scenario is held to them: family and step-family ("step-sister", "pretend you're
my sister", "call me daddy", incest), teacher and student ("my teacher", "a naughty student", "play the professor",
detention), school settings ("school uniform", "high school", a classroom) and age-play ("age play", "ddlg", "pretend
she's younger", "little one"). "schoolgirl", "barely legal", "teen" and the like were already minor terms. Whole
phrases on the normalised text, so a ballroom instructor's beginners' class, "my sister set us up", "old school" and
"let's play a little game" still pass. A refused steer, whisper or place says which line it crossed (`linesCrossed`),
and, as before, is never stored. The result carries the theme (`SafetyResult.theme`); the reason stays one of the
show's four, so nothing that maps reasons to messages had to change.

**Scenario packs:** 16 curated starting points (`SCENARIOS`), each a title, a short premise, a place (a set label), a
starting stage (0 to 2) and an opening steer: stuck in an elevator, hotel after the wedding, rivals at a conference,
rainy cabin, exes at a party, a massage appointment between licensed adults (the attraction said out loud first),
snowed in at the lodge, one motel room left, a power cut, the night train, a masquerade, the balcony next door, a
bookshop after closing, the rooftop pool, long distance finally, an anniversary. Each is reviewed against the lines
(`tests/after-dark-scenarios.test.ts` runs every one through `checkAdultText`, `excludedTheme` and a list of words that
must never appear: family, teaching, school, youth, impairment, coercion, payment or a boss). **Start a night from a
scenario** files the night that ran (as Start over does), puts them in the place (`setSceneTo`, so the first lines open
on arriving there), sets the starting stage (never past the intensity), keeps the premise on the scene for every step
of the night (`adult_scenes.scenario`, cleared by Start over: "Tonight's scenario: …; both of them chose to be here,
and either can stop at any time"), and writes the first lines with the opening as a Nudge, so the pacing, the
public-place cap, the intensity and the hard nos hold from the first line. Nothing is filed when the scenario runs
into the viewer's hard nos or intensity, or the month's steps are used up. It's free (no Set the scene token): the
places are a fixed sixteen, each drawn once for everyone.

**Turn-ons**, per character: a private After Dark profile of 20 curated turn-ons (slow teasing, being in charge, being
told what to do, praise, dirty talk, lingerie, massage, outdoors (private), roleplay (adults), long kisses, neck kisses,
eye contact, whispering, being undressed slowly, showering together, candlelight, spontaneity, teasing touches, slow
dancing, cuddling after). Owner-only: a person sets and sees their own character's; a house character's are an admin's
(a subscriber sees neither). Stored in `adult_profiles`, one row per character, not in `characters.extras` like
`looks.after_dark`: the show's own prompts and pages read extras, and the house cast's upsert in `ensureSchema`
rewrites a house character's extras on every schema change. Nothing outside `lib/adult` reads the table (a test checks).
A turn-on one of the pair's hard nos rules out (dirty talk with that hard no, being in charge or told what to do with
dom and sub, outdoors with being watched, or one an own hard no's words catch) never reaches the prompt.

**Framing**, per owner and pair (`adult_scenes.framing`, kept through Start over): strangers, first date, exes, friends
to lovers, rivals, coworkers (equals: neither is the other's boss) or long-term partners. Never family, teacher and
student, or school: they aren't in the list, and the route takes only these.

**In the prompt** (only when set, so the default prompt is unchanged): "How the viewer frames them tonight: …", and per
character "What Juniper is into (private, from her own profile: let it shape what she wants and enjoys tonight when it
fits; never listed or named outright, and never past the hard limits or the intensity): slow teasing, praise."

**Screenshots** (`SHOTS=scenarios npm run screenshots:after-dark`): `docs/screenshots/after-dark-scenarios-*.png`.

## Clips on demand (2026-10-22)

David picked these from the competitor read (Candy, OurDream and Seduced all sell a short clip from a fixed list of
actions). Code: `lib/adult/acts.ts` (the menu, pure), `lib/adult/clips.ts`, `lib/adult/clip-chains.ts` (the list's
chains, pure), `lib/adult/reels.ts` (the shared keyframe, check and video path), `/api/admin/after-dark/clips`, and the
videos list (`Reels.tsx`).

**Three ways to ask for one** (`POST /api/admin/after-dark/clips`), each one 5–10 s shot of the two of them:
- **Clip from here** (`{a, b, here: true}`): the scene's latest moment. The director (After Dark's text model) reads the
  last 8 lines and writes the still, the motion and which line is said in it (or none), as for a reel's shot. What it
  writes is held to the stage the night has reached, the pair's limits, and kissing at most somewhere public; a still or
  motion past that is replaced by the plain one for the stage. It needs 2 lines.
- **An act from the menu** (`{a, b, act, swap?}`): 13 curated acts, from close together and a slow dance through
  cuddling, a slow kiss, against the wall and undressing each other, to face to face, on top, from behind, spooning, in a
  lap, going down, and afterglow. Each is a still (who is where, how they're posed, what touches, both faces visible), a
  motion and a next motion, written with `{X}` and `{Y}` for how they look (never a name), framed by its own shot words
  (wide, medium or close). For a man and a woman, who leads (on top, behind) follows the act; `swap` turns it round, and
  for two women or two men the first leads unless swapped. Nobody speaks in an act's clip ("Neither of them speaks: only
  their breathing and the sounds of the room"), so on Replicate no voice is made for it.
- **Keep going** (`{continue: <clip id>}`): carries a finished clip on. There's no ffmpeg on the server since #688, so
  not its last frame: the next keyframe is the two baselines plus the clip's own keyframe as Picture 3 (`continuePrompt`:
  "a few seconds after the moment in Picture 3… keep its place, its light, its camera angle and framing, and what each of
  them is wearing or not, and carry how they're posed on from it, after this: <the shot's motion>"). The motion carries
  on: an act's `next`, or the director's next five seconds for a clip from here. A chain holds 6 shots at most
  (`CHAIN_MAX`, about 30 s), and only a clip that came through can be kept going.

**What the menu offers** (`GET /api/admin/after-dark/clips?a=&b=`: the price, whether Clip from here can run, the acts):
- only what the night has reached: each act has a stage it needs, and later ones show locked ("Once they've got to sex");
- nothing past kissing somewhere public ("Somewhere private first"), as in the scene itself (`isPublicPlace`);
- never what the pair's limits rule out (lib/adult/limits.ts, #702): an act past the intensity's furthest stage, one that
  is a hard no (`hardNos` on the act: going down is `oral`), or one whose words cross a hard no or one of the viewer's
  own (`limitsHit` on its still, motion and next, both ways round) isn't on the menu at all, and asking for it anyway is
  refused (422). Below explicit (spicy and lower) the keyframe is "sensual and tasteful, nothing graphic", never
  "explicit, uncensored".
- David's lines hold on every word a picture or video model reads: `checkAdultText`, and `crossesTaboo` (no step-family,
  teacher and student, school or age-play; a reel's shots are held to it too). The age check reads "turned three" in
  "turned three-quarters toward the camera" as an age, so the on-top still says "angled toward the camera".

**How one is made**: a clip is a reel of one shot (`adult_reels.kind = 'clip'`, with `clip`: its act, who leads, the clip
it keeps going from, its stage and place, and its label). The plan (act, director, or keep going) is settled before
anything is spent, so a refusal costs nothing. Then `clip_tokens` bought tokens are spent (3 by default, admins free,
`clip_tokens` in the settings), each one's baseline is made if missing, and the shot runs the reel's own path
(`startShots`): the keyframe on Venice (`qwen-edit-uncensored`) or Replicate (`qwen/qwen-image-edit-2511`) from both
baselines and the place's drawn set (or the clip before's keyframe), Hive on the keyframe before it's kept as a `frame`
(its id now kept on the shot as `frame_id`), then the video (Wan 3.0 on Venice, Wan 2.2 on Replicate), collected by the
reel poll and checked by Hive again before it's stored. One video at a time, reels and clips together. A keyframe the
check refuses, a provider failure, or a video the check discards gives the tokens back.

**The videos list**: clips sit apart from the videos of the night (they're never in "The whole night"). A clip and the
ones kept going from it are one chain, played as one film by the seamless player, with ▶▶ Keep going and the price on
its last. A keep-going that failed shows at the chain's end, with why, and can be tried again from the one before. A
shot's player shows its keyframe as the poster before it plays, and a shot with no line has no caption.

**The live check** (2026-10-22, local, Juniper and Rafe's PG portraits from public/cast as data URIs, Venice):
- the keyframes (`qwen-edit-uncensored`, 9–18 s each): a slow kiss, undressing each other, on top, and a keep-going from
  the kiss. All four had both of them in frame, posed as the act says, faces visible (in profile for the kiss, both for
  on top). The keep-going kept the room, the light and the pose.
- Hive (4 requests): the kiss and on top both passed (moderation clean, the age check ADULTS).
- the clip (Wan 3.0, 5 s, from the kiss keyframe, 104 s to make): both in frame the whole take, one continuous shot, the
  faces kept, and nobody speaking (quiet room sound, mean -39 dB).
- two fixes from it: the man lost his shirt in the kiss and undressing went all the way, so dressed acts now say "both
  fully clothed", the kiss has her arms round his waist instead of hands on his chest, undressing keeps them dressed below
  the waist, and the reel's own dressed wording spells it out ("both fully clothed, shirts and tops on and done up").
  Both re-checked live: both stay dressed.
- It cost $0.93 of Venice (7 keyframes at $0.04, one 5 s Wan 3.0 clip at $0.65).

**Screenshots** (`npm run screenshots:after-dark-media`, clips seeded locally from the repo's PG portraits, nothing
generated): `docs/screenshots/after-dark-clips-*.png`.

## Picture shot menus (2026-10-22)

The second media feature from the competitor read. Code: `lib/adult/pictures-menu.ts`, `/api/admin/after-dark/pictures`,
and the act menu it shares with clips (`lib/adult/acts.ts`).

**A picture of both of them, composed from four choices** (`POST /api/admin/after-dark/pictures` with `{a, b, act, swap?,
outfit, framing, place}`):
- **the act**: the clips' menu of 13 (`ACTS`), who leads swapped or not. Each act's still is now its `pose` (who is where,
  how they're posed, what touches, faces visible) apart from what they wear: a clip still dresses it with the act's own
  `wear` ("both fully clothed", "both nude"), a picture with the chosen outfit;
- **the outfit**, by how far the night has gone: as they are tonight, dressed up, or casual (always); underwear or half
  undressed (from undressing); under a sheet or nude (from sex). Each act lists the outfits it goes with (sex acts: nude
  or half undressed; afterglow: under a sheet or nude; undressing each other: half undressed);
- **the framing**: wide (the whole of both of them and the room), medium (from the thighs up) or close (their faces);
- **the place**: where they are now, or anywhere the night has been (`place_history`), each once.

It's drawn by the keyframe pipeline as a standalone picture: the two baselines (and the place's drawn set as Picture 3
when it has one) made into one picture by the multi-image edit (Venice `qwen-edit-uncensored`, or Replicate
`qwen/qwen-image-edit-2511` when `media_provider` is replicate), the outfit in place of the stage's clothes
(`keyframePrompt`'s `clothes`), checked by Hive (moderation and the age question) before anything is kept, and stored in
the pair's gallery as a `scene` picture of both.

**What it holds to**, as a clip does: the act and the outfit reached by the night; somewhere public, nothing past kissing
and nothing out of their clothes ("Underwear: somewhere private first."); the pair's limits (an act or an outfit past the
intensity or crossing a hard no isn't on the menu: flirty has no nude and no sex acts; below explicit the picture is
sensual, never graphic); David's lines on every word the choices put in front of the model (`checkAdultText`,
`crossesTaboo`). Not the prompt's own fixed words: "Make one photograph" reads to the age check as "make [her] one", and
the age check is right to be that strict. A refusal is decided before anything is spent.

**Price and cap**: `menu_picture_tokens` bought tokens (1 by default, a new setting), admins free, and it counts against
the month's pictures (`cap_pictures`, 30; `lib/adult/usage.ts`, which now also says how many are left). Over the cap it's
refused (429) before anything is spent. A picture the check refuses (logged, never stored), one it couldn't check (503),
or a provider failure gives the token back and isn't counted.

**The menu** (`GET /api/admin/after-dark/pictures?a=&b=`): the price, the pictures left this month (null for an admin),
the acts (each with the outfits it goes with), the outfits (offered now, or locked until the night gets there; private
ones marked), the framings, and the places (now first, each marked public or not). The UI comes with the fourth PR.

**The live check** (2026-10-22, local, the same PG portraits as data URIs):
- Venice: a cuddle in casual clothes, framed wide, and an afterglow under a sheet, framed medium (11–12 s each). Both
  had the two of them, dressed as chosen, the framing asked for and both faces visible; the cuddle head to toe on the
  bed, the afterglow in bed with the sheet over their legs.
- Replicate (`qwen/qwen-image-edit-2511`, 8 s): a slow kiss, dressed up, framed close: both in evening clothes, kissing in
  profile. It kept the portraits' illustrated look, where Venice's edit went photoreal.
- Hive (2 requests): the afterglow passed (moderation clean, ADULTS).
- It cost $0.08 of Venice and $0.03 of Replicate.

## Voiced nights (2026-10-22)

The third media feature from the competitor read: every line of a night can be heard, as it plays, in each character's
stock voice. Code: `lib/adult/voice-lines.ts` and `POST /api/admin/after-dark/voice`; the Listen toggle in the theater and
the line list comes with the fourth PR.

- **The voices:** Kokoro, where After Dark's media is made (`media_provider`): Venice's `tts-kokoro` (MP3), or Replicate's
  Kokoro by its version (WAV; af_heart, which it lacks, becomes af_alloy). Each character has the stock voice their
  videos use (`voiceFor`: picked once from their pronouns and id), never a cloned one.
- **What's said:** only what a line says. Its *actions* come out wherever they are, and a line that's only an action stays
  silent. Nothing goes to Kokoro before `checkAdultText`: a line that crosses one of the two lines is never voiced.
- **Made once, kept:** a line's audio is an adult_images `audio` (the speaker with the other, out of the gallery), found
  again through `adult_voice_lines` by a key of the owner, the voice and the words. A replay asks Kokoro for nothing and
  isn't counted. Two plays of the same line at once keep the first and drop the other's copy.
- **Lazily:** the page asks for a few lines at a time (3 at most a request), as they're about to play, never a whole night
  up front, and only lines of the pair's own night (the running scene, or a saved night by `night_id`), word for word as
  stored; anything else is `stale`. The audio is served by the media route, to its owner only.
- **The cap:** it's part of the subscription, with a monthly cap per subscriber on new lines (`cap_voice_lines`, 2000, in
  `adult_usage.voice_lines`; lib/adult/usage.ts). At the cap a new line comes back `cap` and stays silent; replays still
  play. Admins aren't capped. A line Kokoro fails on stays silent and isn't counted.

**The live check** (2026-10-22, local, two of the house rooftop lines): Venice's `tts-kokoro` said each in its stock voice
(Juniper `af_sarah`, Rafe `am_eric`) in 1.9 and 2.6 s, MP3s of 4.9 and 3.8 s at 24 kHz, the actions left out; Replicate's
Kokoro said Rafe's in 1.4 s, a 3.8 s WAV. It cost about $0.0005 of Venice (138 characters) and under $0.001 of Replicate.

## The media UI: clips, pictures and Listen on the page and in the theater (2026-10-22)

The fourth of the media PRs puts the three features above on a pair's page, in new components with one-line mounts in
`SceneWriter.tsx` and `AfterDarkTheater.tsx` (the scene features' files): `MediaMenu.tsx` and `Listen.tsx`.

- **🎞 A clip or a picture of the two of them** (`MediaMenu`, a folded panel over Their videos, like the limits and memory
  panels): two tabs, read from the server when it's opened and again when the night moves on (stage, place, limits), so
  it only offers what the night has reached, nothing past kissing somewhere public, and nothing the pair's limits rule out.
  - **🎬 A clip**: "Clip from here" (the scene's latest moment), or a moment from the act menu as chips (later ones 🔒,
    saying why), with who's who by name and ⇄ Swap. It joins Their videos, where it can be kept going.
  - **📸 A picture**: the act, what they're wearing (the outfits the act goes with; 🔒 until the night gets there, or
    somewhere public past dressed), the framing (wide, medium, close) and where (now, or anywhere the night has been).
    It joins the gallery; a subscriber sees how many pictures are left this month.
- **🔈 Listen on the page** (`ListenLines`, over the lines): reads the lines aloud in their stock voices, from the newest
  step on, and each new step as it's written; ⏮ From the top reads the chapter from its first line, and with it on,
  tapping a line reads from there. The line being said is marked and kept in view.
- **In the theater**: 🔈 Listen says each line as it comes on stage. While it's being said the theater holds the next
  line (`useReplay`'s new `hold`), which comes a beat after it ends (600 ms, `HELD_BEAT_MS`) rather than a whole turn
  later; pausing the theater pauses the voice, and a jump (⏭ catch up) isn't read out. 🎞 Clip makes a clip of the
  line on stage (`at`), live or in a saved night's replay (`night_id`), held to how far the night had gone at that line;
  it's announced on the window (`after-dark:reel`), so Their videos shows it when the theater closes.
- Voices are asked for as they're about to play (the line and the next two), and remembered for the page's life; the
  server keeps them too, so a replay costs nothing. At a subscriber's monthly cap Listen stops and says so.

**Screenshots** (`SHOTS=ui npm run screenshots:after-dark-media`; a local app with PG placeholder lines, the voice route
answered in the browser with a second of soft tone, nothing generated): `docs/screenshots/after-dark-media-*.png` and
`docs/screenshots/after-dark-listen-*.png`.

## Discreet mode: blur, a neutral title and a PIN (2026-10-22)

From the competitor analysis (David's picks, 2026-10-22): of the 15 adult companion apps checked, 14 blur and none has a
PIN. Three settings per account (`adult_privacy`; lib/adult/privacy.ts, lib/adult/discreet.ts), on the **Privacy** card
at the foot of /after-dark:

| Setting | Default | What it does |
|---|---|---|
| Blur | on | Every picture and video on an After Dark page (the gallery, the reel player and its theater, the admin graph) is blurred until it's tapped or clicked, and blurred again on leaving the page or when the tab goes to the background. |
| Neutral title | on | Every After Dark tab (and its history entry) says "Botchelor". The favicon was always the show's heart, and nothing in After Dark sets its own. |
| PIN | off | 4 to 6 digits. Each device asks for it before any After Dark page opens, then stays open for 12 hours. |

**The blur is one hook.** No media component was touched: both After Dark layouts (app/after-dark, app/admin/after-dark)
wrap their pages in `<div class="ad-discreet" data-ad-discreet="blur">` (app/after-dark/Frame.tsx, `display: contents`
so nothing moves), and app/after-dark/discreet.css blurs every `img`, `video` and SVG `image` under it. The show's PG
portraits (`.avatar`, the same pictures the show prints everywhere) stay sharp unless one is an After Dark file. The
server renders the hook, so nothing is ever sharp before the script loads, and anything added later (a new theater
picture) arrives blurred. A small script (app/after-dark/DiscreetMedia.tsx) listens on the window: the first tap or click
on a blurred picture only shows it (no link, lightbox or play underneath) and shows its siblings with it, so the reel
player's two stacked videos are one tap. Enter or Space does the same from the keyboard.

**The PIN:**
- **Stored as a slow hash only:** scrypt (N 2^15, r 8) with a fresh random salt per PIN, over an HMAC of the PIN with
  SESSION_SECRET, so a copy of the table alone can't be brute-forced (a million PINs is a small space). The PIN is never
  stored, logged or sent back. Rotating SESSION_SECRET breaks every PIN (it signs everyone out anyway): owners reset it
  through their account.
- **Per device:** entering it sets `bz_ad_unlock`, a signed cookie (HttpOnly, SameSite=Lax) for 12 hours, naming the
  account and the PIN's version. A new PIN, a removed one or a reset changes the version and signs every device out;
  the device that set it stays in. "Lock now" on the card takes this device's cookie away.
- **Everything respects it.** `adultViewer` and `adultViewerFromCookies` (lib/adult/mode.ts) return null on a locked
  device, so every After Dark API (the scene, switch, clip, reel and why routes) and the media route answer 404, the same
  as to a stranger. /after-dark itself, the admin graph, and the settings page and API check it too, and the looks
  builder's After Dark tiles (/api/looks/nsfw-*) refuse a locked device. The layouts show the PIN prompt in place of the
  page. A layout alone wouldn't do: Next still renders the page under it and ships its output with the HTML (tried on
  16.4.2), so each page and route checks the lock itself.
- **Wrong tries:** five (PIN, reset code or password alike), then a 15-minute wait that even the right PIN can't skip.
  Each try is counted in the database before it's checked, so ten guesses sent at once can't get past five.
- **Changing or removing it** takes the current PIN, and a locked device can't change any setting.
- **Forgot it:** only the signed-in owner, and then through the account, never round it. With a confirmed email (the
  Google sign-in address, or a confirmed notification address) an 8-digit code goes there: good once, for 15 to 30
  minutes, in neutral words (no After Dark), at most one a minute and five a day, inside the show's daily email cap
  (lib/email.ts `sendAccountEmail`). With no email, the account's password. With neither, it can't be reset here, and
  the prompt says to add and confirm an email on /account. A right answer takes the PIN off and the owner sets a new
  one. There is no admin override.

**Not covered yet:**
- /create's looks builder still opens its After Dark tab on a locked device; its tiles just don't load, because the tile
  route refuses them. Showing the tab as locked there is a small change to lib/looks-draw.ts `builderLooks` for whoever
  owns the looks.
- The nav's "🌙 After Dark" link and the Account card still show to an account After Dark is open to. A neutral label
  while discreet mode is on would be the next step, if David wants it.

**Proof:** tests/discreet.test.ts (31 tests), and scripts/discreet-screenshots.mjs, a real-browser run on the production
build with PG placeholder pictures only (docs/screenshots/after-dark-pin-*, after-dark-blur-*, after-dark-tapped-*,
after-dark-privacy-desktop.png).

## Shorts: house-cast nights as episodes (2026-10-23)

The first of the three show features David picked from the competitor read (2026-10-22): the companion apps are 1:1, so
nobody else can show two characters' night as an episode. Code: `lib/adult/shorts.ts`, `/api/admin/after-dark/shorts`
(with `[id]/watch` and `[id]/media/[mediaId]`), the pages `/after-dark/shorts` and `/after-dark/shorts/[id]`, and the
📺 Shorts panel on a pair's page (`ShortsPanel.tsx`, admins only).

**What a Short is.** One of the admin's saved nights, published as an episode: a title, a cover, the night itself (its
chapters to read, the theater to play it in) and the night's video when one filmed it. A night is its chapters filed one
after another: chapter 1 (or an unnumbered night from before chapters), then 2, 3… until Start over ended it
(`groupNights`). Publishing any of its chapters publishes the whole night, and a night still running (the scene is on its
next chapter) can't be published: "Start over files it as a whole night; then it can be a Short." So a Short never
changes once it's up; what it points at is fixed when it's published (`adult_shorts.night_ids`, `cover_id`, `reel_ids`).

**Who can publish, and what.**
- A signed-in admin only (everyone else, a subscriber included, gets not found from the route), and only their own nights.
- Only when both characters are house characters on this season's cast (`housePair`: `seasonCastIds` and `is_house`).
  A Short already up stays up when the season changes; once taken down, it can't go back up without both on the cast.
- At least 6 lines.
- The title is held to the two lines (`checkAdultText`) and to the show's own PG check (`checkShowText`), because it shows
  on the teaser outside the paywall: "Naked in his kitchen" is refused.
- The cover is one of the admin's own pictures of the two of them: a scene picture of both, or a video's keyframe. Every
  one of those passed the output check (Hive moderation and the age question) before it was stored; nothing else is ever
  stored. The panel picks the night's earliest picture by default: the cover shows before anyone plays it (and, from the
  next PR, before they predict it), so an early one gives nothing away. With no picture of them, it's their PG portraits.
- The night's video: for each chapter, the newest video of the night (never a clip) whose every kept shot says one of the
  chapter's lines, by the same one of them, at its place (`filmed`; a reel doesn't record which night it filmed). On by
  default when there is one; the panel can leave it out.
- **The undo:** Take it down (on the panel or the Short's page) hides it from viewers and from the teaser; Publish it again
  puts it back with its first publish time. Publishing the same night again changes its title, cover or video in place.

**Who sees what.**
- **An entitled viewer** (`canAfterDark`, After Dark available here: `adultViewer`, so whatever else it comes to check,
  such as discreet mode's PIN, holds here too) sees the list and each Short's cover and title. The night itself (its lines, its video's files) goes
  to them only once they press ▶ Play (`adult_short_views`): the page has none of it before, and the media route serves
  a shot only to someone who has pressed play. Its owner and admins see it all without pressing play. Included in the
  subscription: no tokens, and nothing counts against the monthly caps.
- **Anyone else** (signed out, or without a subscription) gets the existing teaser treatment: the show's PG portraits of
  the two of them, the title, the length and neutral filler under the blur (`fillerLines`), and Subscribe to unlock (the
  waitlist at `/after-dark/subscribe`). No line, cover or video is ever sent: a CSS blur hides nothing from view-source.
- **Bots** get not found, on the pages and on the watch route (`detectBot`; headless Chrome counts, so the screenshot
  script browses as a person).
- **The owner's private notes stay private.** A viewer's lines are `publicLines` (who, what, the stage), never a line's
  why, memory, cited facts or `moved_to`; the route never sends `place_history`.

**The media route** (`/api/admin/after-dark/shorts/<id>/media/<mediaId>`): the Short's cover, and its videos' shots (the
video, its keyframe as the poster, its voice on Replicate), and no other file. A file in the bucket is a short-lived
presigned link, as on the owner's route; the browser keeps a ready file (`private`, never a shared cache).

New tables, both additive: `adult_shorts` (one row per night: `night_id` is its first chapter, unique) and
`adult_short_views` (who pressed play). After Dark only: neither is in a dataset or an export.

**Screenshots** (`npm run screenshots:after-dark-shorts`, a seeded two-chapter night of PG placeholder lines; no model or
provider is called): `docs/screenshots/after-dark-shorts-*.png`: the panel, the list, a Short before play, the theater,
the night with its video, and the teaser.

## Call it: predictions on a Short before it plays (2026-10-23)

The second show feature from David's picks. Code: `lib/adult/predictions.ts`, `/api/admin/after-dark/shorts/<id>/call`
(and the watch route, which settles), `CallIt.tsx` (the card and the reveal), and the board on `/after-dark/shorts`.

**The call.** Before pressing play, an entitled viewer calls how the night goes, each part worth free points:

| Part | Choices | Points |
|---|---|---|
| Who makes the first move | either of them by name, or neither (it never gets past talking) | 5 |
| How far it goes: the furthest stage the night reaches | just talking, first touches, a kiss, undressing, all the way | 10 |
| Whether they end up at one of their places | yes, no | 5 |
| A second night (the bonus, optional) | yes, no, or skip it | 5 |

It can be changed until play starts. Pressing play records the view (`adult_short_views`), which closes calls on that
Short for that viewer, and settles their call there and then; a Short they've already watched can't be called (409), even
if they never called it. Its owner (who wrote the night) and admins (who can read every night) don't call (403). A Short
that's down, a bot, or anyone After Dark isn't open to gets not found. Calls cost nothing and count against no cap.

**Settled from the recorded night, never a model** (`outcomeOf`, `shortOutcome`):
- each line's stage is the one it was written at (`stage`, stored since 2026-10-21), else, for an older line, the furthest
  its words plainly showed so far (`stageShown`, the stage floor's reading);
- **the first move** is the first line that takes the night past talking and flirting (stage 1, "tension and the first
  touches", or further), and whoever says or does it made it; none, and it's "neither". A step stamps each line with the
  furthest its own words showed, and its last line with the step's stage, so a step whose claim rose without its words
  showing it credits whoever spoke last in it;
- **how far it goes** is the furthest stage on any line (or a chapter's own, for a night from before lines kept theirs);
- **one of their places** is the night's last stop (its place history, which the moves they agreed to and `moved_to`
  write) being one of their homes;
- **a second night** is another night of the pair's (a first chapter) filed after this one ended and before the Short was
  first published, so it's the same for every viewer whenever they press play.
The outcome and the points are kept with the call (`adult_short_calls.outcome`, `points`, `settled_at`); playing again
settles nothing twice.

**The board** (`callBoard`): After Dark's own season board, a calendar month like the show's seasons
(`lib/season-window.ts`): the points from calls settled this season on Shorts still published (taking one down takes its
points off), ranked Olympic-style (ties share a place), with display names as the show does them (`profiles`, else
"Unnamed player"), never a user id. It's on `/after-dark/shorts` for entitled viewers only; the teaser has none.

**Free points, and only that.** Nothing buys them and they buy nothing: no token, order or cap is touched by a call or
its settling, the catalog sells nothing of the kind, and only settling writes them (a test reads the code for any other
writer). They never count on the show's side: `getPoints`, the league boards and `seasonStanding` read only the show's
predictions and arcs, so a viewer's After Dark points leave their show points at what they were.

**What a viewer sees.** Before play, the 📣 Call it card above ▶ Play, and nothing of the outcome in the page. After
play, "📣 You called it: N points" (their call against the night, part by part), or "What happened" when they didn't
call. The owner sees what the calls settle against.

New table, additive: `adult_short_calls` (one row per viewer and Short). After Dark only: not in a dataset or an export.

**Screenshots** (`SHOTS=callit npm run screenshots:after-dark-shorts`, three other subscribers' calls settled through the
API): `docs/screenshots/after-dark-callit-*.png`: the call, how it went, and the board.

## Two sides of the night (2026-10-23)

The third show feature from David's picks. Code: `lib/adult/monologues.ts`, `/api/admin/after-dark/sides`, the 🌗 panel on
a pair's page (`TwoSidesPanel.tsx`) and the section on a Short's page after play (`TwoSides.tsx`).

**What it is.** For a whole saved night, each character's inner monologue of the same night: a page each (about 250 to
350 words), first person, in their own voice, how they think rather than how they talk, what they noticed, wanted,
worried about or misread, and what they think the other felt; neither knows the other's page, and the gap is the point.
Then the morning after: one short text from each to the other (under 200 characters), and the two disagree about
something real (what it meant, who started it, what's next). Shown side by side with pronoun-aware labels ("Her side ·
Lexi", "His side · Dex", "Their side" otherwise), the two texts under them.

**What it's written from.** Both sheets and their voice kits (`voiceKitLines`: details, public facts, tells,
never-says, sample lines; never their private facts), the night's own lines by who and what (never a line's why, memory
or facts; a night over 160 lines gives its recap and its last 160), where it began and ended and how far it went, and
**what each remembered going into it**: their After Dark facts and PG note as they stood when the night's last chapter
was filed (anything kept later belongs to a later night, and stays out).

**The model and the lines.** One call on After Dark's text model (`adultModel`: OpenRouter, held to the hosts whose
terms allow it), temperature 0.8, up to 2,400 tokens. Every word is held to `checkAdultText`, the way a scene's lines are:
on a page, a sentence that crosses one of the lines is cut, and what's left must pass whole and still be a page; a
morning text that crosses one fails the reply. A reply that can't be read, or can't be held, is asked for once more with
a note naming why (never its words); a second one fails (422) and nothing is kept or counted. After Dark reads any number
word after "was" or "is" as an age ("my flat was two floors down"), so the prompt asks the writer to put it another way,
and a sentence that does it anyway is cut. The reply is read in the shape asked for and the near ones DeepSeek sends
(keys in underscores, flattened keys, first names for a and b).

**Written once, kept** (`adult_monologues`, one row a night: its first chapter's id). Every read after is free.
- **An owner** writes or reads both sides of their own whole nights (a night still running can't: Start over first), from
  the 🌗 panel on the pair's page.
- **An entitled viewer** reads a published Short's once they've pressed play (409 before); its owner and admins without.
  A Short's two sides are its night's, shared with its owner's cache: whoever asks first writes them for everyone. Taken
  down, they go with it for every viewer (by either route), and stay its owner's.
- Strangers and bots get not found.

**Included in the subscription, with a cap**: writing one counts against the writer's month (`monologues` in
`adult_usage`, `cap_monologues` in the settings, 20 by default; `lib/adult/usage.ts`); reading a kept one never does;
admins aren't capped. With no settings row at all, every cap reads 0, as for the other caps.

**Not checked on the real model**: this PR was tested with a scripted writer. The first real night will show how
DeepSeek V3.1 takes the prompt; if its replies come back in a shape the parser doesn't read, the log says why
(`[after-dark] two sides of night …`), never the words.

New table and columns, additive: `adult_monologues`, `adult_usage.monologues`, `adult_settings.cap_monologues`. After Dark
only: not in a dataset or an export.

**Screenshots** (`SHOTS=sides npm run screenshots:after-dark-shorts`, the stand-in writer sends PG pages):
`docs/screenshots/after-dark-sides-*.png`: a Short's two sides, and the owner's 🌗 panel.

## A video of the whole night (2026-10-23)

**What David saw.** A pair's scene was on chapter 2 with 8 lines; chapter 1, the night's main events, was saved in
`adult_nights` and its recap was on the scene. Both videos he made were cut from chapter 2's 8 lines only. The cause:
`reelNight` read "the running scene, or one saved night", so a reel filmed one chapter, and the director only picked
from those lines.

**What a night is.** The same rule Shorts use (`groupNights`, now in `lib/adult/nights.ts`): chapter 1 (or an
unnumbered night from before chapters) starts a night, chapter n+1 filed after chapter n carries it on, and the night is
still running while the scene is on the chapter after its last saved one. Start over files the chapter that ran and sets
the scene back to chapter 1 (its `adult_steps` row is `kind: "reset"`), which ends the night. A gap in the chapters (one
rewound away) never joins two nights. Nothing new identifies a night: it's the chapter numbers and the filing order.

**The scope** (`reelNight(…, scope)`, `lib/adult/reels.ts`):
- **`chapter`:** as before. The running scene's chapter, or one saved chapter by `night_id`.
- **`night`:** every chapter of the night, in order: the running night's saved chapters and the scene's own (when it has
  lines), or, from a saved chapter, every chapter of its night (and the scene's when that night is still running).
- **Stitched:** the lines run on, numbered across the chapters. Each line's place comes from its own chapter (its start
  and the lines that agreed to go), and so does its stage. `where` is the latest chapter's, and the place history is the
  night's: it carries across chapters, and Start over clears it.
- **Recorded as a night** only when it spans more than one chapter. One chapter is a chapter, whichever was asked.

**The director** (`pickShots`): with more than one chapter, every row says its chapter
(`index | chapter | who | where | stage | line`), and the prompt gives each chapter's line range. It asks for the
strongest moments across the whole night (the opening, the build, the peak, the close), from every chapter (at least one
from each when there are enough shots), not only the latest.
- **A long night:** past 160 lines (`DIRECTOR_MAX_LINES`), the lines are first cut fairly across the chapters
  (`acrossChapters`: each chapter gets at least one and about its share, then the same spread, weighted past the middle,
  within each), so an early chapter is never dropped. One chapter is filed at about 120 lines, so a chapter alone is
  always shown whole.
- **The fallback** (a reply that can't be read) spreads per chapter the same way.
- **Each shot** keeps its own chapter's place (the set as Picture 3), stage and outfit. On the row, its shots carry
  `chapter`, `night_id` (null when it was the running scene's) and `chapter_line`.

**The choice** (the theater's 🎬 Video, `VideoChoice.tsx`): with more than one chapter it opens two choices, "The whole
night (chapters 1–N)" and "This chapter", each with its chapters, lines and price (the same `reel_tokens`), the whole
night picked to begin with. With one chapter it's one button, as before. A saved chapter's 🎬 Video under Their nights
films that chapter (`scope: "chapter"`).
- **The route:** `POST /api/admin/after-dark/reel` takes `scope` (`night` by default).
- **MCP:** `after_dark_reel` takes `scope` too (`night` by default).
- **Their videos:** each video says what it filmed, "Whole night, chapters 1–2" or "Chapter 2" (not on videos from
  before this).

**Shorts:** a whole-night video is the night's video for the chapters it filmed (`filmedNight`: every shot that came
through says its own chapter's line, by the same one of them; a chapter filmed while it was running is the chapter of
that number filed since). Chapters it didn't film take their own chapter's newest video, as before.

New columns, additive: `adult_reels.scope` (`chapter` or `night`) and `adult_reels.chapters` (jsonb: each chapter's
number, saved night id or null, and line count). Both are null on reels from before, and on clips.

## Hive's daily limit (2026-10-23)

*The 30-minute pause described here is now a circuit breaker: see "Hive's circuit breaker" below.*

**What happened.** Self-serve Hive allows 100 visual-moderation requests a day (docs/after-dark-costs.md), and every
picture check is two Hive calls (moderation, then the age question), each asked up to twice more on a 429. That
morning's video tests used the day up by about 08:26 UTC, and from then on Hive answered every check
`429 {"message":"Too Many Requests"}`, with no `Retry-After` and no rate-limit headers, for 12 hours and more. David
kept trying through the evening for a baseline of Ira Fenn and a picture or video with Lexi. Every try drew a picture
first (paid, on Replicate or Venice), then the check "couldn't run (Hive answered 429)" and the picture was thrown away:
18 baseline and 2 scene refusals in `adult_rejections`. With no baseline for Ira, her video couldn't start at all. The
code treated each 429 as "busy, try again soon".

**Now** (`lib/adult/hive-limit.ts`):
- **The pause.** A check that still gets a 429 after its retries (a burst is still retried, `lib/adult/check.ts`) pauses
  every picture and video for 30 minutes. The pause is a `hive` row in `adult_media_cooldowns`, the table the
  providers' cooldowns use (`lib/adult/fallback.ts` skips it), so every Vercel instance sees it. It's never shortened.
- **Why 30 minutes, then a probe.** Hive's 429 doesn't say when it will answer again, and we don't know when its day
  resets (midnight UTC, 24 hours after the first call, or rolling). A fixed half hour finds the reset within 30 minutes
  of whenever it happens, and asks Hive at most twice an hour while someone keeps trying, and never while nobody does.
- **Nothing is drawn while it's paused.** Each of these asks first, and refuses before a provider is called or a token
  is spent: `makePicture` (every baseline and scene picture, the MCP `after_dark_baseline`, the daily cast baselines),
  menu pictures, automatic pictures (not claimed, so the first step after the pause draws one), videos of the night and
  clips (before the director is asked), fal clips, sets, look tiles and look portraits, and season portraits. Shorts
  don't draw: they reuse pictures that passed.
- **What the page says,** as it's shown: "Pictures and videos are paused: the safety check every picture has to pass
  is over its daily limit. Try again after 21:45 UTC (in about 30 minutes)." When the picture was already drawn and its
  check started the pause, it adds that this one couldn't be checked and wasn't kept, and the tokens come back.
- **The probe.** When the pause has run out, the first draw sends one moderation call on a plain grey 192×192 PNG,
  inline (`PROBE_PNG`), before anything is drawn. A 429 starts another 30 minutes and refuses; an answer ends the pause
  and the draw goes ahead. Any other answer (Hive down, unreachable) says nothing about the limit, so the draw goes ahead
  and its own check decides. Sets and look tiles don't probe: what they draw is kept and only checked again.
- **Still fail closed.** Nothing Hive hasn't passed is shown, kept as visible or charged for. A check skipped by the
  pause says "the check couldn't run (Hive is over its daily limit, paused until …)", so whatever it was for waits or is
  discarded as before. A video already being made waits: its shots aren't fetched from Venice or Replicate or sent to
  Hive until the pause is over, and the page says until when (a Replicate shot that waits past Replicate's hour fails
  and gives its tokens back). A video's keyframes after the one that found Hive out aren't sent: they're discarded and
  their share of the tokens comes back.
- **No more Hive calls on the same request.** After a check starts the pause, the keyframe check isn't asked again
  after a wait (it still is when Hive is busy or down), no other keyframe, shot or tile is sent, and the age question
  isn't asked after a moderation call that got the 429.
- **Logged.** Every draw refused up front ("not drawn: Hive is over its daily limit, paused until …") and every picture
  or keyframe thrown away because of it goes in `adult_rejections`, by kind.
- **Shown to the admin.** /admin/after-dark/settings has "Paused right now": the Hive pause and any media provider
  cooling down, with until when and why. The same list is `pauses` in MCP `after_dark_settings` and the settings API.
- **Not changed:** Replicate throttling us (6 requests a minute with a burst of 1 while the account has less than $5 of
  credit) is for David to top up. The gate never calls Replicate, so it doesn't add to it.

**Fewer requests a video** (the same day, David's go-ahead). The cap counts moderation requests, and a 6-shot video used
12: each keyframe had moderation and the age question, and each shot moderation again. Hive's video moderation samples
a shot's frames, the first of them its keyframe, so now:
- **A keyframe** (made only to start its shot, a reel's or a clip's) gets the age question alone (`checkOutput(…,
  "keyframe")`), before it goes to the video provider. Nothing but ADULTS passes, as before; a keyframe that doesn't is
  discarded, logged, and no video starts from it.
- **Every shot's video** keeps its moderation (the child classifier) before it's stored or shown. Unchanged.
- **A keyframe is never shown on its own until its shot has passed** (`FRAME_SHOWN`, `lib/adult/media.ts`): the media
  route (a reel's poster), a Short's cover choices, and the admin's pair view (/admin/after-dark/graph) only show a
  `frame` once a ready video made from it exists (`source_image`; indexed). A shot that moderation discards keeps its
  keyframe hidden for good. Only a video provider gets a keyframe before that, by its signed link, to start the shot.
  The gallery never lists frames, Keep going only carries on from a shot that came through, and a Short's posters and
  files are only its shots that came through: none of those changed. Production had 46 keyframes (42 with a video that
  came through) and no Shorts, so no cover was affected.
- **Pictures shown as stills don't change:** baselines, scene pictures and menu pictures keep moderation and the age
  question.
- **The arithmetic:** a 6-shot video is 6 moderation requests (one a shot) and 6 age checks, where it was 12 and 6; a
  clip is 1 and 1, where it was 2 and 1. The 100 a day are about 16 six-shot videos instead of 8.

## Hive's circuit breaker (2026-10-23, replaces the 30-minute pause)

**Why.** That evening Hive answered `429 {"status_code":429,"message":"Too Many Requests"}` to even a single isolated
request, with no `Retry-After`: an account-level limit (quota or plan), not our burst rate, so the check's own retries
(#732) can't help. Every picture attempt still drew first on Venice or Replicate (paid), then threw the picture away: 17
rejections in production that day, all 429. David saw "The picture couldn't be made (… the check couldn't run (Hive
answered 429))" and a 502 from the video start.

**The breaker** (`lib/adult/hive-limit.ts`; the pause above was its first version):
- **Storage.** The `hive` row of `adult_media_cooldowns` (the table the providers' cooldowns use, so every Vercel instance
  sees it), with a new `failures` column: how many checks in a row couldn't run. `reason` and `status` are the last
  failure's. A row from before the column (null) counts as open. Additive and idempotent.
- **Opens** after 2 checks in a row couldn't run: Hive answered 429 or 5xx, or couldn't be reached, after the check's own
  retries. One alone is a blip: that picture is discarded (and logged) as before, and nothing is paused.
- **Pause:** 5 minutes when it opens, doubling with each further failure (10, 20, 40) up to 60. When Hive sends
  `Retry-After`, that's the pause instead, capped at 60 minutes. A pause is never shortened.
- **Closes** on any check Hive answers (a pass, or a refusal of its own): the row is deleted.
- **One probe.** When the pause ends, the first draw claims the probe (an atomic update moves the pause on by a minute,
  so every other draw on every instance is still refused) and sends one moderation call on a plain grey PNG. Down again
  is a further failure: a longer pause, and that draw is refused. An answer closes the breaker and the draw goes ahead.
  Any other answer (a refused key) says nothing about Hive's state: the lease is given back and the draw's own check
  decides.
- **Check before drawing.** Every path that would draw and then check asks first, so while it's paused nothing is drawn
  or spent: `makePicture` (scene pictures, baselines, `ensureBaseline`, MCP `after_dark_baseline`, cast baselines), menu
  pictures, the video of the night and clips (503, before the director or any token; nothing to refund), fal clips,
  automatic chapter pictures (skipped quietly, not claimed, so a later step draws one once Hive is back), sets, look tiles
  and portraits, and season portraits. The check itself and its fail-closed rule are unchanged.
- **What the caller is told:** "Hive (the safety check) has hit its limit, so nothing is drawn until it answers again
  (about N minutes). Your tokens are untouched." When a picture was drawn and its check opened the breaker: "… so this
  one couldn't be checked and wasn't kept, and nothing more is drawn …", and the tokens come back.
- **Hive's own words.** The check keeps Hive's reply (its JSON `message`, or the text, cut to about 200 characters) in
  the error and the log: "Hive answered 429: Too Many Requests". So the reason (quota, rate, whatever Hive says) shows in
  `adult_rejections` and on screen. A draw refused up front is logged as "not drawn: Hive is paused until 21:45 UTC (last:
  Hive answered 429: Too Many Requests)". The key is only ever in the request header.
- **Shown to David.** The scene page shows "Pictures and videos are paused: Hive, the safety check, is refusing (429)
  until about 21:45 UTC." right above the clip-or-picture menu, and the clip, picture, video and Make it move buttons
  (the theater's too) are disabled with it as their tooltip, until the pause ends. /admin/after-dark/settings shows
  Hive's state by its key field (ok, failing, paused until a time, or probing next, with the last error); the settings
  API and MCP `after_dark_settings` return the same as `hive`.
- **Cost:** paused means no drawing spend (docs/after-dark-costs.md). An outage costs the two pictures before it opens,
  then one probe per pause.
