---
name: showrunner
description: |
  Run one production cycle of the Botchelor show end to end, the way gstack chains roles: the
  producer picks what the show needs next, the writer and the asset builder make it, the editor
  checks it against the show's style, then it ships as one PR. Use when asked to "improve the show",
  "make it more dramatic", "produce this week", "what should the show do next", or for any change
  to the show's pages, copy, visuals or videos that spans more than one of those roles.
---

# Showrunner

Botchelor is a reality dating show people **watch**. Every cycle answers one question: what would
make tonight's viewer stay, vote, share or come back tomorrow? The roles are skills in this folder:

| Step | Skill | Output | In the factory (Agent HQ) |
|---|---|---|---|
| 1. Produce | `show-producer` | A beat sheet: ranked bets, each with impact, effort and the file it lands in | `/show-producer` (report) |
| 1b. Cast | `show-casting` | Who's ready for which move, and what to ask each creator for | `/show-casting` (report) |
| 2. Write | `show-writer` | In-world copy: ceremony lines, exits, twists, teases, empty states | `/show-writer` (PR) |
| 3. Build assets | `show-assets` | Visuals: share cards, posters, Remotion cuts, sets, show-kit shots | `/show-assets` (PR) |
| 4. Edit | `show-editor` | A pass/fail review against docs/show-style.md, with fixes | `/show-editor` (report) |
| 5. Ship | (this skill) | One PR, `npm run gate`, CI green, merged | the factory's own judge and automerge |

## The cycle

1. **Load the show's state.** Read `docs/show-style.md` (the voice and the visual rules),
   `docs/seasons.md` (formats, the producer, the house, confrontations, December's The Botchelor),
   `docs/season-page.md` and the newest entries of `ROADMAP.md` "Now". Note today's date against the
   season's clock: preseason, which week, the next Sunday ceremony, the finale.
2. **Produce.** Follow `show-producer`, and `show-casting` when a bet needs particular characters. Pick at most three bets for this cycle; prefer the one that
   lands before the next on-air moment (a premiere, a ceremony, a launch).
3. **Make.** For each bet, follow `show-writer` for words and `show-assets` for pictures and video.
   One bet, one commit. Keep the engine's rules (below).
4. **Edit.** Follow `show-editor` on every surface you touched, at phone width and desktop. Fix what
   it finds before shipping.
5. **Ship.** `npm run gate`, then a PR whose body lists each bet with its expected impact. Merge
   only when every check is green (AGENTS.md). Hand the owner the files he posts (posters, cuts,
   captions) in `/mnt/project-files/promo/` or `~/BotchelorClips/`, never by posting them yourself.

## The format playbook

[formats.md](formats.md) lists the reality TV moves the show can stage: the cliffhanger, the interruption,
unequal dates (including the two-on-one), the first impression rose, hometowns, the reunion, the spinoff for
the rejects, and the villain edit. For each move it gives the Botchelor version, the words, the pictures, what
already exists, and when it has landed. Every role reads it: the producer picks from it, the writer and the
asset builder take their brief from it, and the editor checks against it.

## Rules that never bend

- **Never the engine.** Drama comes from what is staged, shown and said around a date, never from
  changing how a date is decided (`lib/engine.ts`, the odds, the endings). The producer sets
  situations, not outcomes (`lib/producer.ts` header).
- **Never spoil.** Nothing above the fold says how a date a viewer could still call ended.
- **Only the public record.** Public, aired dates between public characters; never After Dark data
  on a show surface; every viewer-visible generated line passes the PG checks (`lib/safety.ts`).
- **Only the public card.** A show surface or skill uses a character's public card
  (`publicExtras`, `lib/extras.ts`) and their aired record. Never their soul, temperament,
  opinions, story-state wants, lessons, private facts, baggage or What-they're-hiding: those are
  owner-only (docs/character-depth.md, the "Public?" column). Never invent a detail the card lacks
  (a hometown, a family, a rivalry): skip the character, or ask the creator through
  `show-casting`.
- **A user's character is cast, never typecast.** The villain edit, or any framing that makes a
  user's character look bad, needs the owner's yes (`extras.villain_ok`). The house cast is the
  show's own. A creator's character is someone's work, and the show treats it that way.
- **No claim is judged true.** A rivalry board or a tease names who said what, never who is right
  (`lib/story-state.ts`: `is_true` is server-side only).
- **$0 by default.** Free models and Workers AI for drawing; a paid call is proposed to the owner
  with what it buys (AGENTS.md "Money").
- **Every switchable feature gets an off switch** documented in `docs/switches.md`.
