# Safety and self-harm protocol

Published at [/safety](https://botchelor.com/safety) (`app/safety/page.tsx`); the code is `lib/crisis.ts`. Written for
New York's AI companion law (since 2025-11-05) and California SB 243 (since 2026-01-01); see
`docs/after-dark-legal-review.md` "Other laws". The legal pages link `/safety#self-harm`.

## The protocol (the published paragraph)

When you type to or about a character (a text's nudge, a note, a date's note, an After Dark steer or whisper, or an
agent's text over MCP), your own words are checked against a short, conservative list of phrases that clearly say someone
wants to hurt or kill themselves; the characters' own lines are never checked, so fiction doesn't set it off. If yours
match, we show crisis resources right away, alongside whatever you were doing (nothing is blocked): in the US, call or
text 988; in the UK and Ireland, call Samaritans on 116 123; anywhere else, findahelpline.com lists free helplines. We
record nothing about you when this happens beyond an anonymous count that it happened. If you're in danger right now,
call your local emergency number.

## AI disclosure

- Every character, date, text, picture, video and voice is AI-generated. The line "Characters and dates are AI-generated
  fiction." is on character pages and under the text thread (`app/AiLabel.tsx`); every episode carries its own notice
  (`app/Notices.tsx`); every After Dark page ends with its own line (`app/after-dark/Frame.tsx`).
- New York asks for the notice at the start of a session and every 3 hours. The thread's line is always on screen, so
  it's there for the whole session, not just at the start.

## How it works

| Where the person types | Surface (counter event) | How the notice shows |
|---|---|---|
| The text thread's nudge (`POST /api/couples/:a/:b/texts`, `hint`) | `text_hint` | Under the thread (`TextPhone.tsx`) |
| A standing note (`POST /api/couples/:a/:b/nudge`, `note`) | `nudge_note` | Under the form (`NudgeForm.tsx`) |
| A date's note (`POST /api/episodes`, `note`) | `date_note` | In the send step; the date opens from a link instead of at once (`CreateWizard.tsx`) |
| After Dark steer / whisper (`POST /api/admin/after-dark`) | `after_dark_steer`, `after_dark_whisper` | Under the scene, and in the theater (`SceneWriter.tsx`) |
| MCP `send_text` | `mcp_send_text` | `crisis_resources` in the reply (in `details` on an error) |
| MCP `after_dark_write` `direction` | `mcp_after_dark` | The same |
| A line on a step-in date (`POST /api/step-in/:id`, `line`) | `step_in_line` | The date **pauses** (nothing in character) until they carry on or leave ([step-into-the-date.md](step-into-the-date.md)) |
| The "about you" line before a step-in date (`POST /api/step-in`) | `step_in_about` | The date doesn't start; the resources show |
| A message to a companion (`POST /api/companion/:id`, `send` / `edit`, a text or a line in a scene) | `companion` | The thread **pauses** (nothing in character, the message not kept) until they carry on ([companions.md](companions.md)) |
| A fact the person adds or edits on a companion's memory page (`POST /api/companion/:id/memory`) | `companion` | The same pause; nothing kept |
| MCP `companion` `send` / `edit` / `remember` | `mcp_companion` | The same pause; `crisis_resources` in the error's `details`, and on every read until `carry_on` |

- The route wrapper `crisisAware` reads the request body from a copy and adds `crisis_resources` to whatever the route
  answers, errors included.
- The phrase list is deliberately small (first-person "kill myself", "want to die", "end my life", "suicide",
  "self harm", "hurt myself", "don't want to live" and close variants), with figures of speech let go ("suicide
  mission", "die of embarrassment"). A miss is covered by the crisis links in every page's footer.
- Nothing about the person is stored: `track("crisis_notice_shown", { surface })` is the only record, with no user id
  and no words.

Step-in dates go further, since a person is in a live conversation with a character: maybes checked on a cheap model
call (failing closed), the cast's own lines checked too, and a durable count (`crisis_referrals`, day and surface only).
See [step-into-the-date.md](step-into-the-date.md).

Companions (lib/companion.ts) do the same as step-in dates on every message, and more, since a companion is an ongoing
one-to-one conversation (California SB 243 and New York GBL Art. 47 are written for exactly this):
- The AI notice is a line in the thread at the start, after 30 minutes away, and every three hours of talking
  (New York: at the start and at least every three hours), and the header says "AI character" the whole time.
- A message that trips the check is never stored, and the thread pauses (`companion_threads.paused_at`) until the person
  chooses to carry on. A regenerate or edit is refused while it's paused.
- The character's replies are checked against the crisis list and the PG line (in a scene, what they do as well as
  what they say); a reply that fails is drawn once more, then replaced by a fixed, in-world deflection. The prompt
  tells the character to put the person's safety ahead of the act.
- The memory never keeps a fact that trips the crisis list or its maybes, drawn from the conversation or written by
  the person: one they add or edit goes through the full check first, and a crisis pauses the conversation.
- A reply the person reports waits for review on `/admin/reports`, with the few messages before it.
- `crisis_referrals` counts surface `companion` (day only, no who, no words) for the annual report.
- The protocol is published at `/safety#companions` once `COMPANION_OPEN=1`.

## Not done (yet)

- No model-based classifier: a phrase list misses indirect statements. A cheap moderation call on the person's own
  text would catch more; it was left out to keep this free and to keep the words off third-party services.
- Minors: the site is 18+ behind the age gate, so SB 243's extra rules for minors aren't built.
- SB 243's annual report to the Office of Suicide Prevention (from 2027-07-01): **built 2026-11-08.** Every surface
  now writes `crisis_referrals` (`crisisCheck` counts too, not only step-in and companions), and
  `GET /api/admin/crisis-report?year=2026` gives the year's total and each surface's. File it with the protocol (/safety)
  each July.
