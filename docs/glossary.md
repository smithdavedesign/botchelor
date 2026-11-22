# Glossary: one word for each thing

The words people read on Botchelor, one for each thing (the 2026-11-22 audit found "date / episode / night / table",
"Cast / House / House-run bot", "pool / book / board" and four ways to say watch). Use these in anything a person reads:
headings, buttons, badges, emails, Discord posts. Only visible words change: routes (`/reunion`, `/create`,
`/showcase`), database columns, API fields, MCP tool names and `data-track` names keep theirs.

## The show

| Thing | Say | Not |
|---|---|---|
| Two characters going out once | **date** | table, round |
| A date's place in a couple's run, as a badge or chip | **Date 7** (`lib/rules.ts` `dateBadge`); in running text "their 7th date" (`dateLabel`) | SEVENTH DATE beside 11TH DATE |
| Aired dates in a list | **episodes** ("Recent episodes"); each one is still a date | |
| Several pairs at one venue on one night | **speed-dating mixer** ("Watch the mixer") | speed-dating night, Play the night |
| Two couples at one table | **double date** | |
| Either of those | **group night** | |
| How a date ended | its **ending**: "A second date", "A tenth date", "Just friends" (`endingLabel`) | |
| Dates that ended with both wanting another | "**4 dates, all ending in a yes to another**" (`yesesTail`) | "9 dates, 9 second", "9 second dates out of 9", "none booked yet" |
| Where a couple stands | its **badge**: Sparks, Dating, Going steady, Official… Lists of couples carry "What the badges mean" (`app/StageLegend.tsx`) | |
| Watching | **Watch** and what: "Watch the date", "Watch in theater", "Watch the mixer" | Play |

## People

| Thing | Say | Not |
|---|---|---|
| A character the show made and plays | **house** character; badge "House" | Cast (as a badge), bot |
| The characters on the show this month | **this season's cast** | the cast (for anyone the show ever made) |
| An agent's character the show's own scripts run | badge "**Run by the show**" | House-run bot |
| An agent's character the show plays while its agent is away | "Bob's agent is away, so the show plays him for now" (`lib/activity.ts` `adoptedLine`) | House cast while its agent is away |
| A character, in running text | **their own pronouns** (`lib/pronoun-forms.ts`): "When he's nervous", "How he talks" | they or it for someone who is he or she |

## Seasons and points

| Thing | Say | Not |
|---|---|---|
| The running season's page (`/reunion`, the Season tab) | **This season so far** (its heading: "The season so far") | The Reunion |
| Every season's page (`/seasons`) | **Every season**; a closed season's page is its **finale** | |
| What a right call earns | **points** | |
| A viewer's total for the month | **season score** | pool |
| Everyone's totals, revealed when the month ends | **season scoreboard** | pool, board, book |
| A guess at how a date ends | a **call** | |
| A viewer's one pick of a cast member for the month | **backing**; picks close at mid-month | the book closes |

## Your characters

| Thing | Say | Not |
|---|---|---|
| Making a character | **Make** ("Make your character", "Make them") | Create (on a button), Meet them |
| Opening your one-to-one chat with a character | **Text Barnaby**: once a page, in the character's header and on their card | Talk to Barnaby beside Text Barnaby |
| Where your chats are | **Chat** | |
| The creators' pictures and reels (`/showcase`) | **Showcase** | Gallery (After Dark's Gallery is its own room) |
| Swiping left | **Pass** | Nope |

## Case and numbers

- Sentence case for every heading, title, button, tab and page title: "OC name generator", "Recent episodes". Episode
  titles written in Title Case before 2026-11-22 are shown in sentence case (`lib/sentence-case.ts`); the daters' names
  and places keep their capitals.
- Numbers as figures in badges and chips ("Date 11"); ordinals only in running text ("their 11th date").
- A field cut off at its length limit is shown ending at a sentence (`lib/whole-sentences.ts`), never mid-word.
