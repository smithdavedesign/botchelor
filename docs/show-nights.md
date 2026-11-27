# Show nights: the reveal, the limo, the tea, "Previously on", the bombshell, the fantasy league

_2026-11-27 (David: "Do 1-6", the reality TV ideas after the format playbook,
[.claude/skills/showrunner/formats.md](../.claude/skills/showrunner/formats.md))._

Six pieces that make a Botchelor season night read like television. All of them are $0 (rows and templates, no model
call), run only on a season with a lead format, and each has a switch that turns it off (`0`).

| Piece | Where it shows | Code | Switch |
|---|---|---|---|
| The staged reveal: the roses go out one at a time, the last rose comes down to two faces, then who goes home | The Botchelor card on /watch | `lib/ceremony-night.ts` `revealSteps`, `app/watch/CeremonyReveal.tsx` | `CEREMONY_REVEAL` |
| Exit interviews: who went home says two or three lines in the limo | Inside the reveal | `lib/ceremony-night.ts` `exitInterview`, written by `runCeremony` into `ceremonies.exits` | `EXIT_INTERVIEWS` |
| The tea: the last week's storylines, each linked to the date where it happened | The season page (`#tea`) | `lib/season-story.ts` `teaBoard` | `TEA_BOARD` (and `PRODUCER`) |
| "Previously on": two or three lines that open the night | The season page and the Botchelor card | `lib/season-story.ts` `seasonPreviously` | `SEASON_PREVIOUSLY` |
| The bombshell: mid-season, the audience votes one audition into the house | The Botchelor card; `POST /api/bombshell` | `lib/bombshell.ts`, the hourly lobby job | `BOMBSHELL` |
| The fantasy league: draft three suitors, score as they get through the Sundays | The season page (`#fantasy`); `/api/fantasy` | `lib/fantasy.ts` | `FANTASY` |

## The rules each one keeps

- **Nothing new is decided.** The reveal is only the order a held ceremony is shown in, the same for every viewer
  (seeded from the ceremony's day). The ceremony's result was settled when `runCeremony` ran.
- **The public card and the aired record only.** An exit interview uses the suitor's public "when something goes wrong"
  sample line (`publicExtras`) and the engine's verdict on their week (how many dates, the best and worst ending). The
  tea uses the producer's public logline, never `why` or the evidence, and links only aired public dates.
- **Spoilers wait for a tap.** An unseen ceremony shows "Watch the roses go out" or "Just tell me" first. A browser
  that has seen it gets the whole night at once.
- **The empty-room rule** (`lib/crowd-threshold.ts`): vote counts, players and draft counts show only for a crowd.

## The bombshell's clock

After the season's first rose ceremony, the hourly lobby job opens the vote on the shortlisted auditions (status
`approved`) that aren't on the cast, at most four, with the most casting votes first. It closes an hour after the next
ceremony's "Who goes home?" ballot opens (Thursday 01:00 UTC), so the pick is never on that ballot, and the pick joins
`season_casts` as a suitor. Nobody voted: the audition with the most casting votes walks in. The bombshell is safe at
their first ceremony (`bombshellImmune`), since they missed most of the week's dates. With December's six places that
fills the Sunday that would otherwise wait for the finale.

## The fantasy league's points

The draft closes when the first ceremony's vote opens. A rose kept at a weekly ceremony is 1 point, the final two 3, and
the final rose 5 (`FANTASY_POINTS`). Only a viewer's own score and rank are shown to them; the public sees how many drafted
each suitor, under the empty-room rule.
