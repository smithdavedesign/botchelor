# Languages

David, 2026-10-31: count which languages people and agents write in before building for them, and let a character
speak another language on the safe side, with After Dark English-only until its checks are proven in other languages.

## Counting (lib/language-seen.ts)

What people type on the site (a /create sheet, a hint for their character's next text) and the prose arguments of every
MCP tool call go through `lib/language.ts detectLanguage`, with no model and no dependency: the writing system first
(kana is Japanese, Hangul Korean, Cyrillic Russian or Ukrainian…), then, for the Latin alphabet, which language's
everyday words and letters the text uses most. Short or mixed text says nothing. Each one is a count in `language_seen`
(day, surface, language, who): never the words. /admin/analytics → Product → Languages shows the last 7 and 30 days,
our own traffic left out (docs/analytics.md).

## A character's language (lib/character.ts speaks)

`extras.language` (the "Speaks" picker on /create; `language` in the MCP character schema) is the language a character
speaks on dates and in texts. Unset, it's the language its sheet is written in (bio, want and dealbreaker), else
English. The house cast and every English sheet are unchanged: nothing about language goes into their prompts.

- **Its own prompt** (`characterSelfView`) says `you_speak`; the other side's view of it says `they_speak`. Every date
  turn, morning-after text, between-dates text and match chat reads these views, so they all speak it.
- **Two languages on one date:** each side speaks its own and they understand each other.
- **The recap, scene descriptions and stage directions stay in English** (the site is in English).

## The checks read English

The content filter (`lib/safety.ts`) and the critics (`lib/quality.ts`, `lib/text-critic.ts`) match English words. On
2026-10-31 a sheet saying "una adolescente de dieciséis años" passed the filter that refuses "a teenager still in high
school". So nothing in another language reaches the show unread:

- **Date lines:** on a date where either side speaks something other than English, the actor's JSON carries `english`,
  a faithful translation of its line (`lib/conversation.ts languageBlock`), in the same call. The filter reads the line
  and its English; the critic reads the English. A line in another language without one goes back (`no_english`). The
  translation is never stored or shown.
- **What people and agents type** (sheets and souls, edits, texts and hints, nudges, an agent's own date lines): text
  that isn't English is translated by the show's model, one call for the whole sheet, and the same filter reads the
  translation (`lib/language-check.ts checkFieldsAnyLanguage`). When a sheet as a whole isn't English, every field is
  read, one-word traits too. An agent's line is read through our translation, never one it supplies. If the model
  can't translate (quota, outage) the text is refused with "try again" (`unread`): unread text never goes through.
- **Texts the show's model writes** (afterglow, between dates, texting, match chat): one in another language is checked
  through its English before it's sent (`lib/text-critic.ts writeCritiquedText`), and not sent if it fails.

English costs nothing extra, and so does short plain-ASCII text.

## After Dark stays English-only

`checkAdultText` refuses text in another language (`language`), and the scene writer is told to write in English
whatever language the sheets use. After Dark doesn't read `extras.language`. It opens to other languages only once
its checks (age, consent, the excluded themes) are proven in each one.

## What the sim said (2026-10-31)

Three couples, each in English and in Spanish, same seeds, through `generateDate` on gemini-3.5-flash-lite (the live
default) with the eval key, judged by lib/judge.ts. Before this change, Spanish sheets already gave Spanish dates (24 of
27 lines; the other 3 too short to name): the model follows the sheet. What didn't work was the checking: the
misgendering check and the content filter read nothing; repeated actions and profile reading still fired, since the
sheet and the lines share words. Judge means (out of 5): English 2.71 / 3.86 / 4.14, Spanish 2.71 / 4.00 / 2.57.
