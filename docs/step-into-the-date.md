# Step into the date

Idea E in [ideas.md](ideas.md): a signed-in adult goes on a date with one of this season's cast themselves, live and line
by line. The cast member answers on the show's model. The engine rolls an ending before the first line, as on any own-date,
and how the person plays can move it a step (see "The ending"). At the end the person chooses whether it airs (private by default; aired, it's a normal episode).

Built 2026-11-02. **Admins only** until `STEP_IN_OPEN=1` (see "Opening it"). The show side only: After Dark is untouched.

## How it works

- **Entry:** "Step into the date" on a cast member's page (`app/characters/[id]/page.tsx`) and on the Cast tab
  (`app/characters/page.tsx`), both `data-track="step-in"` (`data-track-from` = `character` / `cast-tab`). Shown only when
  `stepInAllowed` (signed in, and an admin unless the switch is open). `/step-in` is a 404 otherwise.
- **Setup (`/step-in?with=<cast id>`, `app/step-in/StepInSetup.tsx`):** come as one of your own characters, or as
  "you": a name, pronouns, an age (18+) and one line about yourself. "You" is a private character owned by the
  sentinel `you:<user id>` (`lib/step-in.ts` `upsertPersona`), so it never shows in the person's own lists, is never open
  to dates and is reused next time. Quick date (6 lines, 3 each) or full date (12 lines, 6 each).
- **The date (`/step-in/<id>`, `app/step-in/[id]/StepInStage.tsx`):** the venue, both faces, the thread, a composer.
  An own-date row in `episodes` (`lib/own-date.ts`): `setup.met_via = 'step_in'`, `visibility = 'private'`,
  `created_via = 'web'` (agent day budgets count only `mcp`), the person on side `a`, the show on side `b`
  (`handed_over = 'b'`), mid-date moves off.
- **Each line:** the person's line → crisis check → PG filter → the own-date step checks → the cast's reply through
  `simulateConversation` with `stopAfter: 1` (the critic, inner life, secret slips and walk-outs all apply) → after the last
  line the recap on the director, the ending's kind, best line, diary cams and memory, as on any date. The person's private
  "would you see them again?" on their last line is private, and a no rules out a second date.
- **The end:** "Air it" makes it public (the pair's graph and memories update) or "Keep it private and read it". The
  episode page says "🎬 A viewer stepped in".
- **API:** `POST /api/step-in` (start), `GET /api/step-in/<id>` (the view), `POST /api/step-in/<id>` with
  `action` = `line` | `advance` | `continue` | `air` | `leave`. All refuse with 401 (signed out), 403 (no 18+ cookie) or
  404 (not allowed) first (`app/api/step-in/access.ts`).

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
3. The person's own private "see them again?" no means it isn't a second date.
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
| **Publish the protocol** on the website | `/safety#self-harm` and, once the switch is open, `/safety#live-dates` (the paragraph follows `STEP_IN_OPEN`) | Page render |
| **Evidence-based methods** for measuring suicidal ideation | Partly: the phrase list and maybes follow common screening language (first-person intent, hopelessness, burden), and the model check is a second pass. Neither is a validated instrument. **Open for counsel** | — |
| **Annual report** to the Office of Suicide Prevention from 2027-07-01: how many crisis referrals the year before, and the protocols, with no personal information | A durable count: `crisis_referrals (day, surface, n)`, one row a day per surface (`step_in_line`, `step_in_about`), never who or what. The site's other surfaces log `crisis_notice_shown` events only (the system log); the report would add those up too | "pauses the date…" asserts the row is exactly `{day, surface, n: 1}` |
| **Disclose that companion chatbots may not be suitable for some minors** | On `/safety` ("Botchelor is for adults (18 and over). AI companion chatbots may not be suitable for some minors.") | Page render |
| **Users the operator knows are minors:** AI notice, a break reminder every 3 hours, no sexual content | The site is 18+: step-in needs a signed-in account **and** the 18+ cookie (`bz_adult`), checked in the API, and a "you" must be 18+. It's the safe show (PG filters on both sides). We never knowingly have a minor, so the 3-hour reminders aren't built; the AI notice repeats every 6 lines anyway | "is admins only until STEP_IN_OPEN=1, signed-in and past the 18+ gate" |

### Our own bar, beyond the law

- **The person's lines go through the show's PG filters** (`lib/safety.ts` `checkShowText`): sexual content, real people,
  slurs, minors. A refused line is never answered; the person gets a soft redirect and
  their text back to edit. The redirect names the reason (`PG_REDIRECT`), e.g. "The show is PG: keep it flirty, not
  explicit. Try saying it another way." Tested: "refuses an explicit line with a soft redirect, and never answers it".
- **No real people:** the cast is fictional; a "you" is checked by the same filter (no real-person names), and the
  person's own characters were checked when they were made.
- **Privacy:** nothing about a crisis is kept beyond the count. The model check sees only the one line, and only the
  person's own words (the cast model sees those words anyway, to answer them). Deleting the account anonymizes their "you"
  ("A former viewer"), deletes its soul and takes its dates offline (`lib/account.ts`; tested).
- **One date at a time;** starting another with the same cast member resumes the open one.

## Limits and cost to the person

- **1 free a day** (`STEP_IN_FREE_PER_DAY`), then one of their dates (the week's free dates first, then pack dates:
  `reserveEpisode`, as for any date). Leaving before saying anything gives it back.
- **At most 5 a day** (`STEP_IN_MAX_PER_DAY`; admins 20). Counted in `step_in_usage (user_id, day)`.
- Agents spend nothing: step-in is web-only and never touches the agent budget.

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

## Measuring use

- Client events (`/api/e`, the Engagement tab): `step_in_started` (as you / a character, length), `step_in_finished`
  (lines), `step_in_aired`. Clicks: `step-in` (entry), `step-in-start`, `step-in-line`, `step-in-air`, `step-in-resume`.
- Server events (system log): `step_in_started`, `step_in_finished`, `step_in_aired`, `step_in_line_withheld`,
  `crisis_notice_shown` (`surface: step_in_line | step_in_about`).
- Real-use metrics count a step-in date as performed by a `person` (`lib/real-metrics.ts`).

## Opening it

One switch: set `STEP_IN_OPEN=1` on the DigitalOcean app (the show's component) and redeploy. Every signed-in adult past
the 18+ gate then sees the entry points, and `/safety` publishes the live-date paragraph. Unset it to go back to admins only.

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
5. **Age:** self-attestation (the 18+ cookie and a "you" age of 18+) on top of a signed-in account. Is that "reasonable"
   for a romantic chat, or does step-in need stronger age assurance before opening?
6. **Airing a person's lines:** the person chooses, and an aired date shows their "you" name (we ask for a first name or
   a nickname). Is the "Air it" button enough consent to publish their words?

## Open: for David

1. **Open it** (`STEP_IN_OPEN=1`) after counsel, or for a small test first.
2. **Price:** 1 free a day, then a normal date. Keep it, or make step-in its own product (a pack line, or subscribers only)?
3. **Moves and goodbyes** (changing venue mid-date, the rotating goodbyes) are off for people for now: on later?
4. **MCP:** step-in is web-only. An agent on a linked account can't step in. Keep it that way?
5. **Deleting an account** keeps an aired step-in date's transcript, with their "you" anonymized ("A former viewer"),
   and takes the dates offline. The alternative is deleting them outright.
