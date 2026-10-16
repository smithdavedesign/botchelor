# The relationship graph

How a pairing grows past one date. This doc is for anyone working on dates, prompts, the engine or anything that
shows couples. The code is in `lib/relationships.ts`.

## The model

Characters are nodes. Every pair that has dated is one **edge**: one row in `relationships`, with the lower id
first (`pairKey`), so an unordered pair is never stored twice.

An edge holds:

| Field | Meaning |
|---|---|
| `stage` | Where they stand: 👋 just met → ✨ sparks → 💞 dating → 💍 going steady, or 🤝 friends, 💔 exes, 🔥 bad blood (`stageOf`). |
| `tie_strength` | 0..1. Frequency (how often they've met), recency (halving every 21 days), intensity (running chemistry) and reciprocity (how often both wanted more). This is Granovetter's tie strength. |
| `chemistry`, `trust` | The running relationship state, 0..100: a moving average of each date's final values, the newest weighing most. |
| `mutual_yes` | Dates after which both wanted another. |
| `detail.facts` | What each one said about themselves (self-disclosures, never questions), by who said it. |
| `detail.jokes` | Inside jokes: a phrase both of them used on a date that comes back in the texts or a later date. |
| `detail.plans` | Plans from the morning-after texts, marked **kept** when a later date picks up their words, else **missed** (or **open** until they meet again). |
| `detail.history` | The dates, with each side's private wish for another, the night's chemistry and trust, and which date a second date followed. |

## Principles

- **Derived, never edited.** An edge is recomputed from the dates it's made of (`refreshRelationship`). This happens
  when a date between the pair is stored, airs, changes visibility, or is reported or moderated. The same dates
  always give the same edge, so nothing drifts and there's nothing to repair. It costs $0 and is deterministic: it
  reads only what the engine decided and what was said. Rows from before this heal on first read
  (`healRelationships`).
- **One undirected edge, directed knowledge.** What Cass knows about Ira isn't what Ira knows about Cass. Each
  side's wish for another date is its own, and it's private.
- **Layered visibility.**
  - *Public layer* (`public_*` columns, `viewRelationship` for a spectator): only dates that aired publicly and
    weren't hidden by reports. No spoilers, no private dates.
  - *Owner layer*: an owner of either character also sees the dates they set up themselves (private, unlisted or not
    aired yet), plus the plans and the mutual count.
  - *Prompt layer* (`pairContext`): what a character may bring into a date is the public record plus the dates of
    whoever set this one up. So nobody's private date leaks into someone else's date.
  - User ids stay on the server. Views never return them.
- **The engine stays fair and reproducible.** It reads the running chemistry and trust as a nudge, at most ±8 to the
  night's starting chemistry and ±6 to trust. The history it read is snapshotted on the date's setup
  (`setup.history`), so the background worker, Sliding Doors and the chaos replay re-decide on the relationship as it
  stood that night. Dates decided before the graph replay exactly as they did.
- **Blocks win.** A pair whose owners blocked each other gets no second date and no suggestion.

## Where it shows up

- **On a date:** each side's prompt gets `your_relationship_with_them`: the stage, how it's been, what the other
  has told it, inside jokes, and on a second date `tonight_is_the_plan_you_made`. The director gets the same facts.
  The critic treats all of it as shared knowledge, so bringing it up isn't "profile reading".
- **The morning after:** the afterglow texts know their history too.
- **The Reunion and the cast page:** only the public layer. They used to count private and unaired dates, which
  could reveal a pairing or spoil an ending.
- **The ex-returns format:** it uses public edges only.

## The second date (`lib/second-date.ts`)

The morning after, if **both** characters want to see each other again (the engine's `wants_another` on both
sides, the afterglow's "it was mutual"), an owner can book their second date from the afterglow card. Agents use the
`plan_second_date` tool. Otherwise there's no second date to plan.

- **Consent.** The characters agreed. The other character's owner has agreed if it's a house character or open to
  dates. Otherwise that owner says yes too (`second_date_requests`), and whichever owner completes the agreement
  books it. Blocks always win. The episodes route re-checks all of this (`checkSecondDate`), so it can't be skipped.
- **Cost and limits.** It's a date like any other: a token, the same rate limits, and for agents the shared daily
  budget.
- **The plan carries over.** `episodes.followup_of` links the second date to the first; it's unique, so there's one
  second date per date. The setup stores the plan from their texts (`setup.plan`). When the plan names a kind of
  place ("coffee"), the venue follows it (the corner café). Both prompts get `tonight_is_the_plan_you_made`, and the
  director opens act one on it.
- **Visibility.** A second date is never more public than the date it follows.
- **Measured.** The analytics events are `second_date_yes` and `second_date_planned`; `episode_created` carries
  `second_date`.
