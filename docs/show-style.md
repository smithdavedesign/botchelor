# The show's style: how Botchelor should feel

David's ask (2026-11-02): "think about ui/ux to make it feel more visually appealing to visitors … bring your own
flare and personality into this product." Botchelor is an AI reality-dating show people **watch**. The test for every
visitor-facing surface: does it read like television, or like a database UI?

This doc distills a research pass (reality-TV companion apps, streaming title treatment, fantasy/prediction apps,
viral web toys) into the show's voice, its visual principles, and where each applies. The safe show side only; After
Dark has its own pages and owner.

## Where this came from

- **Love Island's app / ITV votes:** the home surface is a play-along organized around what airs *next*, not a
  catalog. Votes are named, windowed events ("The Recoupling Vote"), confirmed and final — never an always-on form.
  Cast members are a cohort with faces and status ("Islanders"), not a list.
- **Netflix / streaming:** one bold image per title, varied down a row so a shelf never looks like a grid of clones.
  "Previously on" recaps are what make isolated episodes a serial. Episode codes + a one-line tease ("S2 · Night 4 ·
  'The Fountain Incident' — A bombshell arrives."). The Top 10 badge is loud, shared by everyone, and travels with
  the title.
- **Fantasy sports / prediction apps:** the deadline is tied to the event and surfaced on the home page, not buried
  on the form. Your record and your streak are separate numbers ("12–5 · streak 4 · best 7"), and a broken streak
  gets "new streak starts tonight", never guilt. Hide the crowd until you've committed; then "73% called it" is the
  payoff.
- **Wordle / neal.fun:** one daily appointment, a spoiler-free share artifact, stats + next-episode countdown + share
  in a single moment. Handcrafted means plain words, no exclamation inflation, and care spent on small places (empty
  states, footers). "The trick is patience, not polish."

## The voice

1. **Present tense, inside the show.** "They're on their third date. It's not going well." Never database captions
   ("date completed", "status: aired"). The viewer is watching *now*.
2. **Name everything like television.** Seasons have numbers, nights have numbers, episodes have titles, votes have
   names. "S2 · Night 2" over "created 2026-11-02". Ordinals ("their third date") are the serialization signal.
3. **Small-caps labels in the genre's register.** PREVIOUSLY ON, TONIGHT, JUST AIRED, FIRST LOOK, LIVE — one to three
   words, doing the framing so the body copy can stay quiet.
4. **Tease, never summarize.** A synopsis sets the scene and stops ("Trivia night. Quiz Pro Quo is winning again.").
   The ending is a reveal, not metadata — nothing above the fold spoils what a visitor could still predict.
5. **Playful restraint.** A dry wink in small places; no hype copy, no exclamation marks doing the enthusiasm's work.
   Streak copy is kind. Empty states stay in-world ("The house is quiet. Cameras are up in a few minutes.").

## The visual principles

1. **Lead with tonight.** The first thing on home is the show on the air right now — what's airing, what's being
   voted on, what just ended — as one band. The product pitch moves under the show, not over it.
2. **Faces first.** Every list that names a character shows the face. A shelf of episodes is led by the couple, not
   by text rows. Vary the composition down a row (Netflix's page-diversity rule) so shelves don't read as a grid.
3. **Title-card treatment for episodes.** Venue backdrop + the two faces + the episode's own title and code. The
   ending is staged as a beat (a card with weight, revealed deliberately), never a trailing "Ending:" line.
4. **A clock you can feel.** Countdowns and lock times live where the eye already is (the tonight band, airing-soon
   cards), as server-rendered relative text — honest "locks in ~2h", no ticking JS.
5. **Elevation and rhythm, not boxes.** The existing tokens (--radius 16px, --shadow, --space-*) are the rhythm;
   drama comes from the dark title-card surfaces against the warm paper, not from new borders. Both themes get the
   same care; the title cards are dark in both.
6. **Motion that respects the viewer.** CSS-only: a gentle rise on the tonight band, a live-dot pulse, hover lift on
   shelf cards. Everything inside `prefers-reduced-motion: no-preference`. Nothing moves that doesn't mean something.
7. **Phone-first.** 16px gutters, no horizontal scroll except deliberate shelves (scroll-snap, edge-faded), 44px
   targets. A phone viewer should see the show — not the chrome — on their first screen.

## What applies where

| Surface | Treatment |
| --- | --- |
| Home | A "tonight" band at the top: live/airing-soon/just-aired as the hero of the page, the vote as a named moment with its close time, the cast as a face row. The pitch hero follows for first-timers. |
| /watch | A TV guide: tonight's schedule in air order with countdowns, listings-style cards, the ballot framed as the live vote. "Nothing live" becomes the next appointment, never dead air. |
| Episode pages | The title card: venue backdrop, faces, "S2 · Night 2" code, the episode's own title. A "Previously on" cold-open strip for pairs with history. The ending staged as the episode's final beat. |
| Couple pages | The pair as a story so far: the stage as a headline, dates as a season arc, meters as the running score. |
| Character pages | Cast cards: headshot-led, temperament and tells as personality, secrets ("1 of 3 out") as intrigue. |
| Season pages | The finale special: the recap as a cold open, numbers as the season's stats board. |
| Everywhere | Episode titles (generated once at air time, template fallback), small-caps framing labels, faces, kind streak copy, in-world empty states. |

## Episode titles

Episodes get a display title — a 3–6 word TV-episode title ("The Fountain Incident") — written once at air time by
the cheap model (the season-recap pattern: one call, checked by `checkSheetText`, stored once, template fallback).
Already-aired episodes cost $0: the template builds "<ordinal> at <venue>" from data that exists. The title never
contains or implies the ending.

## What this never touches

- After Dark pages (botchelor-4a's code) and the 18+ gate logic (bots skip it by UA — load-bearing).
- SEO titles/descriptions, JSON-LD, the share cards' no-spoiler rule.
- The agent/MCP front door, or any wording agents parse.
- The audit's rules (docs/audits/2026-10-31-ux-audit.md): one filled button per screen, tap-anywhere cards,
  `.ux-fold`, `When` for times, grouped footers. This pass styles within those rules, it doesn't relitigate them.
