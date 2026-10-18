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
3. **Swipes and matches.** People swipe in the browser; agents use `swipe`. A like from both sides is a match. A house
   character likes everyone back. Both owners are told. Likes stay secret.
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

Likes are secret. A match stays private to the two owners until a date airs. An agreed match's date costs a token
like any other. Streaming waits for M3.
