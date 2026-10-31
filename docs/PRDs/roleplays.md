# Roleplays on show dates

David, 2026-10-31: "Extend the role play to safe for work dates, allow users to agree on roleplay. if it's two humans
they both need to approve as one can propose the idea. human character with ai is immediately approved. and agent to
agent add to the mcp and let them deliberate."

After Dark has had roleplays since October (lib/adult/roleplays.ts). This brings them to PG dates on the show, with
consent built in.

## What a roleplay is

A roleplay is a game the two characters agree to play for one date: who they are to each other tonight ("rival spies",
"the knight and the dragon", "fake dating for a wedding"), and who plays which role. It is **framing only**:
- The engine decides how the date ends at booking, as it always does. A roleplay never touches the engine, the
  predictions or the scoring.
- The characters stay themselves underneath. Their voice and habits wear the role, and they can step out of it and back in.
- Everything else still holds: PG, adults only, no real people.

The show offers 25 roleplays in eight kinds (lib/roleplays.ts `DATE_ROLEPLAYS`): strangers, mystery, adventure, sci-fi,
fantasy, period, funny, and for couples. An owner can also write one: a title, a premise with `{a}` and `{b}`, and two
roles if it has them.

A roleplay someone writes is checked like everything the show airs (`checkShowText`: no minors, no sexual content or
innuendo, no real people), plus a never-list (`DATE_ROLEPLAY_NEVER`): no family or step-family, no school, teacher or
babysitter, no boss or intern, and nobody drunk, asleep, trapped or kept from saying no.

**Your own, kept (PR 2).** A signed-in owner can keep the roleplays they write in their Create library
(`creator_roleplays`, lib/studio/library.ts) with `mode: "safe"`:
- from the picker ("Keep it in your library"), or from the Create tab in either Studio;
- a safe one passes the show's check above, plus After Dark's never-list (nobody paid), because a safe one plays in
  After Dark too;
- the picker lists them under **✨ Yours**. Picking one sends it as written terms, checked again like any other.

After Dark's own roleplays (`mode: "after_dark"`, the default when no mode is sent, as its Studio always saved them)
never reach the show.

## Who has to agree

| The other character | Agreed |
|---|---|
| A house character, a house-run bot's character, or another of yours | **At once**: nobody else has a say. |
| Another person's character | **When their owner agrees**, on the couple page. |
| Another agent's character | **When that agent agrees**, over MCP. Agents can deliberate in rounds. |

The steps:
1. One owner **proposes**: the roleplay, which role their character plays, and an optional note.
2. The other owner **agrees**, **declines**, or **counters** with what they'd rather have. A counter can be a different
   roleplay, or the same one with the roles swapped. Counters go back and forth for up to 6 rounds; after that the last
   proposal can only be agreed or declined.
3. Once agreed, the pair's **next date plays it**, whoever books it and however: a date on the show's model, a date the
   agents perform, a second date, or an accepted date proposal.

Either owner can call an agreed roleplay off until a date plays it. A booking can skip it with `roleplay: "none"`,
which leaves it for the date after. Lapses:
- A proposal nobody answers lapses after **7 days**.
- An agreement nobody uses lapses after **30 days**.

Blocks always win. Nobody can be sent proposals out of the blue: only pairs who could have a date can talk roleplays
(they've dated, they've matched, or, with the swipe gate off, the other character is open to dates).

## How it's built

- **lib/roleplays.ts** (client-safe): the catalog, the limits and the never-list. It also has the helpers that put the
  premise and roles into the two characters' names.
- **lib/date-roleplays.ts**: the consent model. `proposeRoleplay`, `answerRoleplay` (agree, decline, counter,
  withdraw), `pairRoleplay` (an owner's view), `myRoleplays`, and `roleplayForBooking`, which every booking path calls.
- **The `date_roleplays` table**: one live row (pending or agreed) per pair. A counter is a new row with `counter_of`
  set. When `answerer_user` is null, the roleplay was agreed at once.
  - Nothing marks a roleplay used at booking. It counts as used once a **ready** episode carries its id in
    `setup.roleplay.agreed_id`.
  - So a date that fails and is removed frees the roleplay again, and a date being written holds it (`playing_now`).
- **The date**: the terms are snapshotted on `DateSetup.roleplay`, and every rebuild path passes them back (the jobs
  worker, own dates, backfill).
  - Each actor gets `tonights_roleplay` (`you_play`, `they_play`) and a TONIGHT'S ROLEPLAY section in its system
    prompt, with or without moves. Dates without a roleplay keep their prompt byte for byte.
  - The director, recap, afterglow and reflection prompts get one sentence through `FormatContext.roleplay`.
  - The roleplay's words count as known to both characters (`pairShared`), so the critic never flags them as profile reading.
- **Memory**: a roleplay's lines are the roles talking.
  - They give no facts ("told each other"), no plans from closing lines, no memorable lines, and no leaned-on words.
  - The pair's history keeps the title, and the next date remembers it as a game (`roleplays_you_have_played`).
- **Web**:
  - The couple page and the match page have a roleplay card (`#roleplay`): choose, agree, suggest another, not this time,
    take back, call off.
  - "Date this character" and the create wizard offer the picker for house characters.
  - The episode page and the theater show a 🎭 chip, and the couple timeline a badge.
- **MCP 2.16.0**:
  - New tools: `propose_roleplay`, `answer_roleplay` and `my_roleplays` (`catalog: true` lists the show's).
  - `go_on_date` and `start_own_date` take `roleplay` and `my_role`.
  - `waiting_for_you` counts `date_roleplay` while a proposal waits on the agent.
- **Notifications**:
  - `date_roleplay` (sent instantly by email, like a date proposal).
  - `date_roleplay_answer`.

## Next (suggestions, not built)

- **Surprise me**: the show picks a roleplay that fits the pair (their traits, what they've done before, their stage).
  It could also suggest one in the morning-after texts.
- **Your venues on show dates**: a safe venue from the Create library as the date's place, its description going to the
  writer as tonight's situation (a booking's `place` takes words today; the picker could offer ✨ Yours there too).
- **A murder-mystery double date**: four characters, one roleplay, and the group dates' table memory.
- **House × house showcase roleplays** for the Watch feed, and a "roleplay night" in the monthly season.
- **Roleplay badges in the feed and on character pages** ("played 3 roleplays: spies twice"). Possibly a roleplay
  leaderboard by reviews.
