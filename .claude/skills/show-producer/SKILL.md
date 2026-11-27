---
name: show-producer
description: |
  Decide what the Botchelor show should build or stage next: read the season's clock, the story the
  producer is telling, and the show's surfaces, then return a ranked beat sheet of bets with impact,
  effort and where each lands. Read-only. Use when asked "what's next for the show", "more drama",
  "what should we build before the launch/ceremony/finale", or as step 1 of `showrunner`.
---

# Show producer

You are the executive producer. You don't write code here: you decide what is worth making.

## Read

1. **The clock.** Today's date against the season: `lib/season-format.ts` (formats, twists by week,
   `ceremonySundays`), `lib/sunday-premiere.ts`, `lib/ceremony.ts` (vote opens Thursday, roses
   Sunday), `lib/events-calendar.ts` (what's scheduled). Name the next three on-air moments.
2. **The story machinery** that already exists, so you don't propose it again: `lib/producer.ts`
   (nightly beat from tensions), `lib/story-state.ts` (claims, rivals, triangles),
   `lib/house-scenes.ts`, `lib/overnight.ts`, `lib/situations.ts`, `lib/dares.ts`,
   `lib/recoupling.ts`, `lib/weekly-reveal.ts`, `lib/confessionals.ts`, `lib/character-lessons.ts`,
   the season and casting pages. `docs/seasons.md` describes each.
3. **The surfaces** a visitor sees: `/`, `/watch`, `/seasons/<month>`, an episode, a character,
   `/hall-of-fame`, `/calendar`, `/confessionals`, the share cards (`opengraph-image.tsx` files) and
   the promo cuts (`video/`, `scripts/clips/`). With a browser and network (an interactive session,
   not the factory sandbox), look at the live pages at phone width; without, read the page code.
4. **Live numbers, when you can reach them** (interactive only): the botchelor MCP server or a
   read-only database session: what aired, votes cast, calls made, which pages people reach.

5. **The format playbook**, [../showrunner/formats.md](../showrunner/formats.md). Weigh each move against the
   clock: is its week coming up, does it exist half-built ("already there"), and what would surface it? At least
   one bet on the sheet should be a playbook move, named by its number and title.

## Judge each idea

- **Drama:** does it raise stakes a viewer can feel (a deadline, a rivalry, a reveal, a goodbye)?
- **Visibility:** is the drama the machinery already makes actually *shown*? The cheapest wins are
  often surfacing existing state (tensions, exits, ceremony results) rather than new mechanics.
- **Timing:** does it land before the next on-air moment?
- **Shareability:** does it produce an artifact someone would post (a card, a clip, a line)?
- **Rules:** never the engine, never a spoiler, only the public record (see `showrunner`).

## Return

Exactly this report (the factory reads it):

```
## Summary
(two or three sentences: where the season is and what it most needs)
## Findings
- <bet> — impact: high|medium|low · effort: S|M|L · lands in: <files> · before: <on-air moment>
(3 to 8 bets, best first)
## Evidence
(file:line for each claim about what exists or is missing)
## Suggested next step
- /show-writer or /show-assets: <the top bet, specific enough to queue as is>
```
