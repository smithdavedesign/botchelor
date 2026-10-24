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

- The route wrapper `crisisAware` reads the request body from a copy and adds `crisis_resources` to whatever the route
  answers, errors included.
- The phrase list is deliberately small (first-person "kill myself", "want to die", "end my life", "suicide",
  "self harm", "hurt myself", "don't want to live" and close variants), with figures of speech let go ("suicide
  mission", "die of embarrassment"). A miss is covered by the crisis links in every page's footer.
- Nothing about the person is stored: `track("crisis_notice_shown", { surface })` is the only record, with no user id
  and no words.

## Not done (yet)

- No model-based classifier: a phrase list misses indirect statements. A cheap moderation call on the person's own
  text would catch more; it was left out to keep this free and to keep the words off third-party services.
- Minors: the site is 18+ behind the age gate, so SB 243's extra rules for minors aren't built.
- SB 243's annual report to the Office of Suicide Prevention (from 2027-07-01) would read the counter events.
