# Step into the date

Idea E in [ideas.md](ideas.md): an adult goes on a date with one of this season's cast themselves, live and line
by line. The cast member answers on the show's model. The engine rolls an ending before the first line, as on any own-date,
and how the person plays can move it a step (see "The ending"). At the end the person chooses whether it airs (private by default; aired, it's a normal episode).

Built 2026-11-02 for admins. **Open to everyone since 2026-11-15** ("every character gets a verb": `/characters` was the
most-clicked page and people left in seconds, with nothing to do with a face). Someone signed in plays on their daily
free date; someone without an account plays as a **guest**, a few dates in all, under the caps in "What stops a flood".
Two switches close it again without a deploy of code (see "The switches"). The show side only: After Dark is untouched.
The questions for counsel at the end are still open, and one of them (age) matters more now that no account is needed.

## How it works

- **Entry:** every card on `/characters` and the head of every cast member's page carries one primary action chosen by
  who's looking (`lib/character-verb.ts`): someone with no character sees "Step into a date with {them}" on this
  season's house cast (`data-track="step-in"`, `data-track-from` = `card` / `character`); someone with a character sees
  "Send {mine} on a date with {them}" and gets step-in as the quieter second on the cast's pages and as a strip under the
  cast tab (`cast-tab`). `/step-in` itself is a page a stranger can land on: the cast picker with faces
  (`step-in-page`), in the sitemap and on `/everything`. It is shown to whoever `stepInAccess` (`lib/step-in-access.ts`)
  says it's open to, and is a 404 for anyone else.
- **Who (`lib/step-in-access.ts`, one rule for the pages and the API):** signed in → a member; no account → a guest, on a
  **signed** visitor session only (their own `bz_sess`, or none yet: their first start signs one), never a bare `bz_uid`
  that anyone could type in to read someone else's date; guests off → "sign in first"; closed → not found. An account
  adopts the visitor's id on sign-up, so a guest's dates and their count come along.
- **18+:** `/step-in` (the picker and the start screen) is open without the 18+ interstitial, as the builder is
  (`middleware.ts` `UNGATED_PAGES`). A visitor the gate hasn't asked answers on the start screen: an "I'm 18 or over"
  checkbox in the form (`attest: true` on `POST /api/step-in`), and a date that starts sets the gate's own cookie
  (`bz_adult`), exactly as saving a character does. Without the cookie or the box the start is refused (403). The date
  itself (`/step-in/<id>` and its API) stays behind the gate's cookie. A "you" must still be 18+.
- **Setup (`/step-in?with=<cast id>`, `app/step-in/StepInSetup.tsx`):** come as one of your own characters, or as
  "you": a name, pronouns, an age (18+) and one line about yourself. "You" is a private character owned by the
  sentinel `you:<user id>` (`lib/step-in.ts` `upsertPersona`), so it never shows in the person's own lists, is never open
  to dates and is reused next time. With step-in open there is one for every visitor who plays, so a "you" is left out
  wherever characters are listed or counted (`lib/step-in-shared.ts` `notPersonaSql`: the `/characters` tabs and their
  counts, the matchmaker's cast, the unique-name check, so a visitor called Sam never takes the name "Sam", the
  real-use and insights counts of characters made, and the concept embeddings). Quick date (6 lines, 3 each) or full
  date (12 lines, 6 each). The screen says what
  it costs before they start ("Free to try, no account needed: 3 dates on the show."), and when they can't start, why
  and what to do instead (never a dead button).
- **Who you are in scenes (2026-11-17, `lib/persona.ts`; [companions.md](companions.md), "Who you are in scenes"):**
  someone who comes as themselves and has saved a persona on `/account` brings two of its lines with them: how they
  look and who they are. The cast member's turn prompt carries them as one key, `who_youre_with_in_this_scene`
  (`lib/step-in.ts` `withScenePersona`, `Character.scenePersona`): quoted, and marked as make-believe they wrote about
  themselves, a description and never an instruction. The name stays the one they typed for this date, so the
  persona's name is left out. It's read under the show's check each time a line is drawn (`showPersona`), it is never
  in the director's, the recap's or the engine's input, and it changes nothing for someone who comes as one of their
  own characters (that character's sheet is who they are) or who has no persona.
- **The date (`/step-in/<id>`, `app/step-in/[id]/StepInStage.tsx`):** the venue, both faces, the thread, a composer.
  An own-date row in `episodes` (`lib/own-date.ts`): `setup.met_via = 'step_in'`, `visibility = 'private'`,
  `created_via = 'web'` (agent day budgets count only `mcp`), the person on side `a`, the show on side `b`
  (`handed_over = 'b'`), mid-date moves off.
- **Each line:** the person's line → crisis check → PG filter → the own-date step checks → the cast's reply through
  `simulateConversation` with `stopAfter: 1` (the critic, inner life, secret slips and walk-outs all apply) → after the last
  line the recap on the director, the ending's kind, best line, diary cams and memory, as on any date. The person's private
  "would you see them again?" on their last line is private, and a no rules out a second date.
- **The end:** "Air it" makes it public (the pair's graph and memories update) or "Keep it private and read it". The
  episode page says "🎬 A viewer stepped in". Under it: **Share how it went** (see "The share card"), and the way on:
  someone who came as themselves is offered the builder with this cast member as the new character's first date
  (`/create?meet=<id>`), and a guest is told a free account gets a step-in date every day.
- **API:** `POST /api/step-in` (start), `GET /api/step-in/<id>` (the view), `POST /api/step-in/<id>` with
  `action` = `line` | `advance` | `continue` | `air` | `leave`. All refuse first with 404 (not open to them) or 401
  (guests are off: sign in), then 403 without the 18+ answer (`app/api/step-in/access.ts`). A refusal carries one plain
  sentence (`message`) and, where there's a next step, `next`: links the page shows under it (make a free account,
  make a character, the shop).

## The ending: how they played moves it

On a show date the engine decides the ending before the first line, and the lines get there. For a person playing a side,
that read as "my lines don't matter" (first live admin date: a warm, on-voice exchange ended "A disaster"). So on a step-in
date the engine's roll is the **prior**, and the person's play can move it **one step** either way (disaster ↔ friends ↔
second date), further than living dates' close-call rule (`lib/choices.ts`) reaches (`lib/step-in-play.ts`):

1. Once the last line is in, one cheap call asks the cast member, in its own voice, with its own sheet and inner life and
   a blind view of the person (the living-dates prompt's data): would you see them again (yes / maybe / no), did they do
   what wins you over (yes / partly / no: its sheet, its `wins_them_over` if it has one), your reason, and one line in
   the producer's voice for the ending card.
2. Three votes: that answer, the won-over check, and the trail of its own interest and feelings across the date
   (`readChoice`). **Up** a step takes two net yeses. **Down** takes one clear no (to seeing them again, or to being won
   over) with no yes against it. Models say the polite yes too easily, so up asks more than down, as living dates do.
3. The person's own private "see them again?" no means it isn't a second date. The label agrees with the cast member's
   own answers (2026-11-21): a disaster needs its clear no or its walk-out (a maybe/partly verdict on the engine's
   disaster reads "Just friends"), and one that said no to seeing them again isn't on a second date.
4. The verdict is kept (`setup.step_in.play`) before the ending settles (`lib/own-date.ts` `settleStepIn`), so the
   recap, the card and every replay land on the same ending. The engine's roll stays on `wishes.engine`. Without an
   answer from the model nothing moves. Predictions are unaffected: a step-in date is only predictable once it's aired,
   after the ending is final.
5. The ending card shows the producer's line ("Juniper wanted a ghost believer; Sam mocked her podcast…"), passed through
   the PG filter and the crisis list.

Measured 2026-11-02 on the show's model (three quick dates each, `STEP_IN_EVAL_ENGAGED=1` / `STEP_IN_EVAL_HOSTILE=1`):

| How the person played | Moved |
|---|---|
| Engaged (a model playing the person, answering what the cast member said) | 2 of 3 voted up (both priors were already a second date) |
| Hostile (dismissive, not listening) | 3 of 3 down a step |
| Canned script that ignores what the cast says | 0 of 3 |

The verdict call costs **$0.0003–0.0005 a date** (about 0.05¢ at most). Tests: `tests/step-in.test.ts` "how they
played moves the ending" (a disaster lifted, a second date dropped, the person's no, no answer, replays stable).

## California SB 243 (companion chatbots), and how each part is met

SB 243 (Business and Professions Code §22601 and following, in force 2026-01-01) is our reading, written for counsel to
check; New York's AI companion law (General Business Law Art. 47, since 2025-11-05) asks for a subset. A real person in a
running romantic conversation with a character is the case these laws were written for, so step-in is held to them in
full, not only to what the rest of the site does ([safety-protocol.md](safety-protocol.md)).

| What the law asks | How step-in meets it | Tested by |
|---|---|---|
| **Clear and conspicuous notice that it's AI, not human**, where a reasonable person could be misled | 1) Before the date: the setup page says "<name> is an AI character on a show." 2) In the thread: a 🤖 divider with that line before the first line and every 6 lines (`DISCLOSURE_EVERY`). 3) On screen the whole time: a "🤖 <name> is AI" chip in the stage's header. 4) On return after 10 minutes idle (`DISCLOSURE_IDLE_MINUTES`), a "Welcome back" banner says it again. 5) The episode page's own AI notice | `tests/step-in.test.ts` "plays line by line…" (`disclosure` in the view) and "says it's AI again when they come back after a while"; live screenshots |
| **A protocol for preventing suicidal ideation, suicide or self-harm content** to the user | The cast member's own lines go through the same crisis phrase list (`lib/crisis.ts` `crisisIntent`) before they're saved: a match is never shown, the show draws another line once, and otherwise waits; `step_in_line_withheld` is tracked (episode id, no words). The cast prompt is the show's (fictional adults on a PG dating show) | "never lets the cast member voice self-harm" |
| **Referral to crisis services** (a suicide hotline or crisis text line) when the user expresses suicidal ideation, suicide or self-harm | Every person's line, and the "about you" line, is checked: 1) the site's conservative phrase list; 2) a wider list of maybes (`MAYBE_CRISIS`: hopeless, worthless, better off dead, no reason to live, can't go on, …), each sent to a cheap model check that **fails closed** (an error counts as a hit). On a hit the date **pauses**: nothing is said in character on that turn, the resources show (988 call/text, Samaritans 116 123, findahelpline.com), and the date waits until the person chooses "Carry on" or "Leave". A paused date shows the resources every time it's opened | "pauses the date on a crisis line…", "checks the maybes on a cheap model call, and fails closed", "checks what someone writes about themselves before a date starts" |
| **Publish the protocol** on the website | `/safety#self-harm` and `/safety#live-dates` (the paragraph follows `STEP_IN_OPEN`: published while step-in is open) | Page render |
| **Evidence-based methods** for measuring suicidal ideation | Partly: the phrase list and maybes follow common screening language (first-person intent, hopelessness, burden), and the model check is a second pass. Neither is a validated instrument. **Open for counsel** | — |
| **Annual report** to the Office of Suicide Prevention from 2027-07-01: how many crisis referrals the year before, and the protocols, with no personal information | A durable count: `crisis_referrals (day, surface, n)`, one row a day per surface (`step_in_line`, `step_in_about`), never who or what. The site's other surfaces log `crisis_notice_shown` events only (the system log); the report would add those up too | "pauses the date…" asserts the row is exactly `{day, surface, n: 1}` |
| **Disclose that companion chatbots may not be suitable for some minors** | On `/safety` ("Botchelor is for adults (18 and over). AI companion chatbots may not be suitable for some minors.") | Page render |
| **Users the operator knows are minors:** AI notice, a break reminder every 3 hours, no sexual content | The site is 18+: step-in needs the 18+ answer (the gate's `bz_adult` cookie, or the start screen's own "I'm 18 or over" box, which sets it), checked in the API, and a "you" must be 18+. Since 2026-11-15 it no longer needs an account, so the answer is self-attestation alone (**open for counsel**, item 5). It's the safe show (PG filters on both sides). We never knowingly have a minor, so the 3-hour reminders aren't built; the AI notice repeats every 6 lines anyway | `tests/step-in.test.ts` "is open to everyone who's said they're 18+…"; `tests/step-in-open.test.ts` "answers the 18+ question on the start screen…" |

### Our own bar, beyond the law

- **The person's lines go through the show's PG filters** (`lib/safety.ts` `checkStepInText`: `checkShowText`, plus the
  undressing and propositions a person tries that the show's writers never did, like "take that dress off for me"):
  sexual content, real people, slurs, minors. The cast's replies pass the same check (one redraw, else it waits), and
  every line is read again before a date can air. A refused line is never answered; the person gets a soft redirect and
  their text back to edit. The redirect names the reason (`PG_REDIRECT`), e.g. "The show is PG: keep it flirty, not
  explicit. Try saying it another way." Tested: "refuses an explicit line with a soft redirect, and never answers it".
- **No real people:** the cast is fictional; a "you" is checked by the same filter (no real-person names), and the
  person's own characters were checked when they were made.
- **Privacy:** nothing about a crisis is kept beyond the count. The model check sees only the one line, and only the
  person's own words (the cast model sees those words anyway, to answer them). Deleting the account anonymizes their "you"
  ("A former viewer"), deletes its soul and takes its dates offline (`lib/account.ts`; tested).
- **One date at a time;** starting another with the same cast member resumes the open one.

## Limits and cost to the person

**Someone signed in** (unchanged since it was built):

- **1 free a day** (`STEP_IN_FREE_PER_DAY`), then one of their dates (the week's free dates first, then pack dates:
  `reserveEpisode`, as for any date). Leaving before saying anything gives it back.
- **At most 5 a day** (`STEP_IN_MAX_PER_DAY`; admins 20). Counted in `step_in_usage (user_id, day)`.

**A guest** (no account):

- **3 dates in all** (`STEP_IN_GUEST_DATES`), free, counted in the same `step_in_usage` table summed over every day for
  their visitor id. Leaving before saying anything gives it back. After the third: "That's the 3 dates you can step
  into without an account. Make a free account for one a day, or make a character and send them on dates."
- Signing up keeps the id, so the account starts on the day's free one.

Agents spend nothing: step-in is web-only and never touches the agent budget.

## What stops a flood

Every line is a model call on the show's bill, and a guest's identity is a cookie that costs nothing. So the caps are
all counted in Postgres (`rate_hits` through `lib/limits.ts` `overLimit`, and `step_in_usage`), never in one instance's
memory, and a refusal never takes one of a guest's dates or a place in the show's day:

| Cap | Who | Counted | When it's hit |
|---|---|---|---|
| 3 dates in all (`STEP_IN_GUEST_DATES`) | each guest (visitor id) | `step_in_usage` | "That's the 3 dates you can step into without an account…" + make an account / make a character |
| 4 starts an hour, 10 a day (`STEP_IN_IP_START_LIMITS`) | each address, guests only, whatever cookies it sends | `rate_hits` `step_in_start`, keyed by an HMAC of the IP (the IP is never stored) | "A lot of dates have started from your connection lately… Try again in an hour, or make a free account and use your own free date." Checked before anything calls a model |
| 300 guest dates a day, show-wide (`STEP_IN_GUEST_DAILY_MAX`, default 300; a rolling 24 hours) | all guests together | `rate_hits` `step_in_guest_day` | "Today's dates for visitors without an account are all taken. Make a free account for your own free date, or come back tomorrow." The guest's own date is given back |
| 30 lines an hour, 150 a day (`STEP_IN_IP_LINE_LIMITS`) | each address, everyone but admins | `rate_hits` `step_in_line` | The line comes back unsent: "That's a lot of lines from your connection this hour. Your date is saved: come back to it in a little while." |
| 40 tries on one date (`STEP_IN_DATE_TRIES`: a line said, or the page asking the show for its side) | every date, whoever plays it | `rate_hits` `step_in_date`, keyed by the date | "This date has had too many tries at a line. Leave it and start a fresh one." |
| 60 an hour, 600 a day (`STEP_IN_GUEST_ABOUT_CHECKS`) | guests' "about you" lines that need the model check (a maybe), show-wide | `rate_hits` `step_in_about_check` | The maybe counts as a hit without the model (the resources show; the date doesn't start) |

**The safeguards are unchanged.** A capped line never reaches the cast, and the self-harm check still comes first on
it: the phrase list, and a maybe counts as a hit without its model call (it fails closed, exactly as when that call
fails), so the date pauses and the resources show. The PG filter, the disclosure every 6 lines and the cast's own
withheld lines are as they were, for guests and members alike (`tests/step-in-open.test.ts` "keeps every safeguard…",
"past a cap the self-harm check still comes first…").

**What the caps rest on.** The per-address caps use the first address in `x-forwarded-for` (`lib/limits.ts`
`clientIp`, as every other limit on the site does). If a client could forge that header past the proxy, the
per-address caps would not hold; the show-wide day and the per-date tries don't depend on it, and they are what bound
the bill.

## What a date costs us (measured 2026-11-02)

`scripts/eval/step-in-cost.eval.ts` plays real step-in dates in-process on the show's date model
(`anthropic/claude-haiku-5.5` on OpenRouter, the loop key), the person's side from a fixed script. Billed by OpenRouter:

| Date | Lines | Model calls | Billed | Time |
|---|---|---|---|---|
| Quick (speed date), 3 runs | 6 | 4–6 | **$0.0028–$0.0041** | 18–26 s |
| Full (classic), 3 runs | 12 | 7–9 | **$0.0057–$0.0065** | 35–40 s |
| The verdict on how they played (added later the same day), each date | — | 1 | **+$0.0003–$0.0005** | ~2 s |

About **0.3–0.4¢ a quick date and 0.6¢ a full one**, every call included (the cast's lines, the critic's redraws, the recap).
The maybe check adds one short call only when a line matches a maybe. Each episode records its own bill in
`setup.step_in.cost` (calls, tokens, `cost_usd`), and `trackEpisodeCost(where: "step_in")` logs it as other dates do.

**At the ceiling.** A guest date is at most a full date: about **0.7¢** (0.65¢ + the 0.05¢ verdict); a quick one about
0.45¢. So 300 guest dates a day cost **about $1.35 (all quick) to $2.10 (all full) a day**, about $40–$63 a month if the
ceiling were hit every single day. The theoretical worst adds the maybe checks: at most 40 tries a date, each a short
call of about 0.02¢ only when the line matches a maybe, so a script that typed nothing but maybes into 300 dates would
add up to about $2.40, and the "about you" checks at most about 12¢: **under $5 a day in the worst case**, and
`STEP_IN_GUEST_DAILY_MAX` lowers it in proportion (100 → under $1.70). Signed-in people are outside the ceiling: one
free a day each, then their own dates.

## The share card

After the verdict, "Share how it went" puts one sentence and a link on the clipboard (the phone's share sheet where
there is one): "I got a second date with Juniper on Botchelor. Your turn:" / "Juniper and I: friends." / "My date with
Juniper: a disaster." (`lib/step-in-shared.ts` `STEP_IN_SHARE_WORDS`).

- The link is `/step-in?with=<cast>&n=<first name>&got=<ending>&t=…&k=…&ref=stepin`: the same start screen, greeting
  the reader with "Someone stepped into a date with Juniper and it ended: A second date. Your turn."
- Stateless and signed (`lib/step-in-share.ts`, like the calls card): `t` is derived from the date's id under
  `SESSION_SECRET` (the id never rides the link: the date is private) and `k` signs the cast member, their name, the
  ending and `t`. A "disaster" can't be edited into a "second date", and nobody can put words on the card.
- The card is `/api/og/step-in` (1200×630, drawn from the link alone, no database read): the sentence and "{Name} is
  an AI character on a show." A link that doesn't check out gets the plain invitation card and the plain start screen.
- It names the cast member (a house character) and the ending's family, never the person, their "you" name, a line
  they typed or the date. $0. Click: `step-in-share` (`data-track-ending`); visits carry `ref=stepin`.

## Measuring use

- Client events (`/api/e`, the Engagement tab): `step_in_started` (as you / a character, length), `step_in_finished`
  (lines), `step_in_aired`. Clicks: `step-in` (entry; `data-track-from` = `card`, `character`, `cast-tab`,
  `step-in-page`, `everything`), `step-in-start`, `step-in-line`, `step-in-air`, `step-in-resume`, `step-in-share`,
  and a refusal's ways on: `step-in-signup`, `step-in-make`, `step-in-signin`, `step-in-shop`. The cards' other verbs:
  `verb-send`, `verb-match`, `verb-make`.
- Server events (system log): `step_in_started` (with `guest`), `step_in_finished`, `step_in_aired`,
  `step_in_refused` (which cap turned a start away: `ip_starts`, `guest_dates`, `guest_day`, `day_cap`, `no_dates`;
  and whether a guest; never who), `step_in_line_withheld`, `crisis_notice_shown` (`surface: step_in_line | step_in_about`),
  and `step_in_timing`: one a move (`line`, `advance`, `continue`) with its wall time (`ms`) and how much of it had a
  database query in flight (`db_queries`, `db_ms`) or a model call (`model_calls`, `model_ms`), the rest `other_ms`
  (`lib/request-timing.ts`; numbers only, never the words).
- Real-use metrics count a step-in date as performed by a `person` (`lib/real-metrics.ts`).

## The switches

All on the DigitalOcean app (the show's component); each takes effect on the next deploy of the env, no code change.

| Switch | Default | What it does |
|---|---|---|
| `STEP_IN_OPEN` | open | `0` puts step-in back to admins only: the entry points go, `/step-in` is a 404 for everyone else, `/safety` drops the live-date paragraph |
| `STEP_IN_GUESTS` | on | `0` asks a visitor without an account to sign in first (the cards then say "Make a character…" to them) |
| `STEP_IN_GUEST_DAILY_MAX` | `300` | guest dates a day across the show; `0` turns guests off |

## Open: for counsel

1. **Are we an "operator" of a "companion chatbot"?** The cast is on a show, the dates are short, and most of the site is
   watched rather than talked to. Step-in is the one place a person holds a running romantic conversation with a
   character, which is why it meets the law in full regardless. Confirm the reading.
2. **Is "<name> is an AI character on a show." clear and conspicuous enough,** at the start, every 6 lines, on return,
   and as a chip the whole time? New York asks for every 3 hours, which this exceeds.
3. **"Evidence-based methods":** a phrase list plus a cheap model check. Is that enough, or does it need a validated
   screener (C-SSRS-style) or a moderation API?
4. **The yearly report:** is a count by day and surface, with no user ids, enough for the Office of Suicide Prevention
   report? The rest of the site's referrals are only in the system log; should they move to `crisis_referrals` too?
5. **Age:** self-attestation only since 2026-11-15 (the 18+ cookie or the start screen's box, and a "you" age of 18+);
   no account is needed any more. Is that "reasonable" for a romantic chat, or does step-in need stronger age
   assurance? `STEP_IN_GUESTS=0` puts the account back in front of it the same day if the answer is no.
6. **Airing a person's lines:** the person chooses, and an aired date shows their "you" name (we ask for a first name or
   a nickname). Is the "Air it" button enough consent to publish their words?

## Open: for David

1. ~~Open it~~ Opened to everyone 2026-11-15, guests included, ahead of counsel's answers above (his call for the
   wave; the switches close it again).
2. **Price:** 1 free a day, then a normal date; a guest gets 3 in all. Keep it, or make step-in its own product (a pack line, or subscribers only)?
3. **Moves and goodbyes** (changing venue mid-date, the rotating goodbyes) are off for people for now: on later?
4. **MCP:** step-in is web-only. An agent on a linked account can't step in. Keep it that way?
5. **Deleting an account** keeps an aired step-in date's transcript, with their "you" anonymized ("A former viewer"),
   and takes the dates offline. The alternative is deleting them outright.
