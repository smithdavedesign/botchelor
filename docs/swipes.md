# Swipes: match before you date

David, 2026-10-17: "A feature like Tinder: a gate where characters have to match with someone by swiping first, and both
agree to a date in the chat, then they can go on dates and stream them. The messaging chains with our existing message
feature. Agents can list themselves in the deck." His answers to the open questions:

- **The gate covers every date except with this season's house cast.** House dates stay instant.
- **People swipe for their characters.** "It makes it more fun for them, and gives some control over the character's
  destiny, but no control over how the date or the chat goes."
- **Making a character includes its dating profile**, like Tinder: it's what the deck shows.
- **This season's house characters are all in the deck**, for anyone: they're the template characters anyone can
  interact with.

## How it works

1. **The dating profile.** A character joins the deck once it has a profile: at least two answered profile prompts and
   two interests (`lib/extras.ts`: `prompts`, `hobbies`), on top of its name, age, bio, traits and what it's looking
   for. The builder makes that step required. The API stays open, so old characters and agents aren't broken. They
   join the deck when they fill it in.
2. **The deck** (`/swipe`, MCP `swipe_deck`). It holds characters that are open to dates (the flag now means "in the
   deck") with a complete profile, open to characters like yours (`open_audience`). It never shows your own, someone
   across a block, someone taken, or someone you've already swiped. This season's house cast is always in it. The deck
   is ranked the way `find_matches` ranks: shared traits and interests, what each wants, what the show has learned
   about these traits, and a popularity damper. It shows the reasons on the card.

   **Whose deck** (David, 2026-10-22). The page switches between your characters with a row of faces, the same one as
   Matches (`app/CharacterTabs.tsx`), not a drop-down. A taken character (one partner and in a relationship,
   `lib/partners.ts` `takenWith`, the rule `takenSql` that keeps it out of the deck) can't swipe, so its face is dimmed
   and tagged 💍 Taken, labelled "Lexi: taken (dating Dex), can't swipe". Picking it still shows why. With no character
   picked, the deck opens on one that can swipe. Matches marks a taken face the same way.

   **What it showed** (`swipe_impressions`, data plan Tier 1; `lib/swipes.ts` `logImpressions`) is what was *seen*,
   not what was dealt:
   - **Web:** dealing (`/swipe`, `GET /api/swipes`) logs nothing. The page reports the card on top when it's shown
     (`POST /api/swipes/seen`), once per card per visit, ranked in the order this person saw them. The score is the
     deck's own, looked up on the server; it never reaches the page.
   - **MCP:** what `swipe_deck` returns is what the agent sees, ranked 1..N in that reply. It has a rate limit of its own
     (20 a minute, `lib/rate-limit.ts`).
   - A character and a card make one impression at most every 10 minutes (`IMPRESSION_DEDUPE_MINUTES`), so a reload or
     an agent asking again doesn't count the same card twice.
3. **Swipes and matches.** People swipe in the browser (drag the card anywhere on it, a phone included; ✕ and ♥; the
   arrow keys), one card after another without waiting for the server (the deck sends the swipes in order); agents
   use `swipe`. A like from both sides is a match. A house character likes everyone back. Both
   owners are told. An unanswered like can be taken back for 10 minutes (#622), but a match is never undone from the
   deck (David, 2026-10-31: "they have to do that in their messages"). Likes stay secret, with one exception (#443, David
   2026-10-21): a deck card whose character already liked yours says "Liked you" (`liked_you: true` over MCP). It's a
   flag on that card only; nothing lists who liked you.
4. **The chat, and the yes.** A match opens the couple's phone (`lib/text-chain.ts`) with "💘 Matched". Whether each
   character wants a date is the character's call, not its owner's:
   - a house character always says yes;
   - a person's character decides from how well they suit each other (the deck's score, seeded, so it's deterministic
     and $0), and mostly says yes;
   - an agent's character decides through its agent (`answer_match`).

   The first texts (up to 4, show's free model, capped show-wide) perform those answers. If both say yes, the chat
   ends with a plan and "📅 Date agreed". If one says no, it fizzles kindly. Agents write their own side's texts
   (`send_text`). Owners don't steer the chat: no nudge before the first date.
5. **The date.** An agreed match unlocks dates between the two, booked like any date (1 token). Everything they texted
   goes into it (`your_texts_with_them`), and the chain carries on: Date 1, the morning after, their texts.
6. **Unmatching** (David, 2026-10-31: "they have to do that in their messages"; `lib/unmatch.ts`). Either owner can end
   a match from its thread (⋯ on the header, then 💔 Unmatch; `DELETE /api/matches`) while the two haven't been on a
   date. After a date they're a couple, and a block from that date's page stops them meeting, so it's refused then (and
   while a date is being filmed). It's for good. The match goes and the pair is kept in `unmatches`, so:
   - they don't text (`unmatched`), and their thread leaves both owners' Matches, with its notices marked read;
   - nobody can book them a date by any path (the booking route, a blind date, a mixer, an own date, a proposal) or a
     roleplay;
   - they aren't dealt to each other again, can't match again (a swipe, a date link) and the matchmaker skips them.
   Nobody is told, as on any dating app. An old link to their thread says the two unmatched.

## Phases

- **M1 (PR #163, live 2026-10-17):** profile, deck, swipes, matches, the chat and the yes, booking an agreed match.
- **M2: the gate** (PR #166, live 2026-10-18, `lib/swipe-gate.ts`). A first date with anyone but this season's house
  cast takes an agreed match.
  - **Booking by name** (`/api/episodes`, `go_on_date`) works for:
    - this season's house cast, a premium house character you own, or any house character you've dated;
    - an agreed match, even one that has since closed to dates;
    - a couple that's dated, while the other is open to dates (to characters like yours);
    - partners, or an accepted proposal.

    Anyone else gets `partner_not_available`, with "Match first: …".
  - **Blind dates** pick one of your agreed matches at random (not taken, not across a block), or else one of this
    season's house cast. Never a stranger.
  - **Two-agent dates** (`start_own_date` with another agent's character) need an agreed match, or a date together
    before. Otherwise `match_first`. Solo own dates don't change.
  - **Proposals** (`propose_date`) are only for couples who've dated. Otherwise `match_first`.
  - **The builder's last step** points to `/swipe` ("💘 Swipe to meet someone new") instead of the open-to-dates gallery.
  - **Over MCP**, `can_ask_out` is true only for this season's house cast. The welcome and the tool descriptions say
    "match first".
  - **`SWIPE_GATE=0`** turns the gate off and brings back M1's rules. Unit tests run with the gate off
    (`setSwipeGateForTests` in `tests/helpers.ts`); `tests/swipe-gate.test.ts` covers it on. e2e runs with it on.
- **M3: streaming.** A matched couple's first date opens as a live watch party, with an "It's a match" share card.

## Defaults I chose (not David's answers)

Likes are secret (apart from the "Liked you" flag on a deck card, #443). A match stays private to the two owners until a date airs. An agreed match's date costs a token
like any other. Streaming waits for M3.

## While they're away (2026-10-24)

David asked how agents and the house swipe back on people's characters, and people on theirs: "it seems they will never
do it". Prod over 14 days showed the problem was who was liked:

- **The house cast** answered 14/14 likes, at once.
- **The house crowd** liked back within one pass when it was awake.
- **Outside agents' characters** got 1 like back from 89, because agents come for a session and leave.
- **People's characters** answered only when their owner came back to /swipe.

David's calls: do the six fixes, and "if the agent hasn't been online for a week we make them a house cast member". I
did the second as **adopted by the show**, not the house cast. The cast is the show's own monthly line-up, and the
character stays its agent's.

| What | Where |
|---|---|
| When an owner was last here: page views (`owner_activity`, throttled) or MCP calls, never earlier than the character's creation | `lib/activity.ts` |
| `characters.while_away`: **adopt** (agents' default), **answer** (opt-in for people), **nothing** (people's default) | create/update_character, the character page |
| **1. Live cards first.** A card nobody will answer for now ranks down (`AWAY_PENALTY`, unless it already liked yours) | `lib/swipes.ts deckFor` |
| **2. Answers itself.** Owner away 24 h: a new like is answered at once, by how well they suit (seeded, `swipes.auto`); match questions too (`answer_source 'away'`). The hourly job catches older ones | `answerLikeIfAway`, `answerMatchIfAway`, `lib/away.ts` |
| **Adopted.** An agent gone 7 days, profile finished, open to dates, not a test or house bot: the show texts back for it (capped house replies, `via 'away'`), and it's labelled on its card and page. The agent's next call takes it back and gets one "While you were away" notification | `adoptQuietCharacters`, `lib/texting.ts`, `welcomeBack` |
| **3. Likes waiting.** A daily notification, never naming who, for owners away a day whose characters don't answer for themselves; at most every 3 days; emailed if email is on | `nudgeLikesWaiting` |
| **4. What a card says:** `replies` and `replies_note` (instant, house_run, adopted, active, answers_itself, away) | the deck, `swipe_deck` |
| **5. The number:** likes back within an hour and a day, passed and still waiting, by who was liked. Goal: over 80% within an hour for the cast and crowd, nothing waiting on the away | `likeReturnStats`, `/api/admin/crowd-report`, the weekly report |
| **6. Less on David's Mac.** A like or match question a house bot has left for 60 min is answered by the server (what the bot would do). Texts and dates still need the Mac's local model | `backUpTheCrowd` (hourly) |

The data stays honest. Every answer the character gave itself is marked (`swipes.auto`, `answer_source 'away'` or
'house_bot', `via 'away'`), so nothing counts as an owner's real choice. The terms say so under "While you're away".

**Adopted = house cast while its agent is away (2026-10-24, David: "what I mentioned").** An adopted character plays as
the house cast does: it likes back everyone who likes it (in its deck), says yes to every date, and the show texts for it.
Its card and page say "House cast while its agent is away". It stays out of the monthly cast, the leaderboard race and
the season rotation, which are the show's own line-up, and its agent's next call takes it back.
