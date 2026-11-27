---
name: show-writer
description: |
  Write Botchelor's in-world words: rose ceremony lines, a suitor's exit, twists and teases,
  "Previously on" and "Tonight" lines, vote names, empty states, captions, in the show's voice and
  inside its safety rules. Use when asked to punch up copy, add drama in words, write a new beat's
  lines or templates, or as the words step of `showrunner`.
---

# Show writer

## The voice (docs/show-style.md, read it first)

- Present tense, inside the show: "They're on their third date. It's not going well."
- Name everything like television: seasons and nights have numbers, votes have names, episodes
  have titles ("S3 · Night 4").
- Small-caps labels do the framing (PREVIOUSLY ON, TONIGHT, JUST AIRED, LIVE); body copy stays quiet.
- Tease, never summarize. Nothing above the fold says how a callable date ended.
- Playful restraint: a dry wink, no exclamation marks doing the work, kind streak copy, empty
  states that stay in-world ("The house is quiet. Cameras are up in a few minutes.").

## Where the words live

| Words | File |
|---|---|
| Ceremony lines, sent-home lines | `lib/ceremony.ts` (`SENT_HOME_LINES`, the ceremony's `lines`) |
| Format pitches, weekly twists and teases | `lib/season-format.ts` |
| The producer's Previously / Tonight templates and logline | `lib/producer.ts` |
| Tonight's situations and dares | `lib/situations.ts`, `lib/dares.ts` |
| Calendar titles and blurbs | `lib/events-calendar.ts` (fixed ones marked `msg()` for translation) |
| Page words | the page itself, through `t()` (docs/i18n.md) |
| Clip and promo captions | `scripts/clips/branded-clip.mjs` `captionOf`, `scripts/clips/season-promo.mjs` |

## Rules

- **Templates over model calls.** Prefer a few hand-written variants picked by a seed
  (`seedFrom`) to a live model call. When a line must be generated, use the show's free model, run
  it through `checkShowText` (`lib/safety.ts`), and fall back to a template when it fails.
- **A character's own words stay theirs.** Quote a date's lines verbatim and trim only by whole
  sentences (branded-clip.mjs `bubbleText`). Exits and confessionals in a character's voice come
  from their memory (`lib/character-memories.ts`, `lib/life-record.ts`), PG side only.
- **No verdicts on claims.** A line can say someone said something, never that it was true.
- **Every visible page string is translated.** A new `t("…")` needs all seven catalogs in
  `lib/i18n/messages/` (`tests/i18n.test.ts` fails otherwise). A sentence with a face or a link in
  it is one string with `{slots}`, filled by `app/fillNodes.tsx`. Share cards and captions stay
  English.
- **Tests change with the words** where a test pins them; never weaken a test to fit a line.

## Done when

The lines are in, `npm run gate` passes, and you can quote the three best new lines in the PR body.
