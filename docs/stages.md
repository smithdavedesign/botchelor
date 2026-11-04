# The stages: modularity, safety and scale

_David, 2026-11-04, adding companion scenes: "This is our third theater mode, might be time to think about
modularity, safety, and scalability for our product?"_

A stage is anywhere characters play a scene in front of someone: a place on screen, lines arriving one at a time, and
sometimes the person on it too. This is the review of all of them made that day (a read of the code, with each
finding checked), what was fixed with companion scenes, and what to do next, in order.

## The stages today

| Stage | Who's on it | Page | Engine |
|---|---|---|---|
| The show's theater | two characters on a date, watched | `app/episodes/[id]/EpisodeTheater.tsx`, `app/watch/[id]/WatchRoom.tsx` | the episode path ([architecture.md](architecture.md)), lines streamed as they're written |
| Step into the date | you and a character, on a date | `app/step-in/[id]/StepInStage.tsx` | `lib/step-in.ts` ([step-into-the-date.md](step-into-the-date.md)) |
| After Dark's theater | two characters, with pictures, video and sound | `app/after-dark/[a]/[b]/AfterDarkTheater.tsx` | `lib/adult/` ([after-dark.md](after-dark.md)) |
| Companion scenes | you and your companion, face to face | `app/companion/[id]/CompanionChat.tsx` | `lib/companion.ts` ([companions.md](companions.md)) |

All four draw the place with `app/Scene.tsx`; step-in and companions put "you" on it.

## What's shared now

`app/stage/`, for a stage the person is on:
- `CrisisPause.tsx`: the crisis resources, what the pause means, and carry on or leave (step-in and companions).
- `useSpeech.ts`: lines read aloud in the device's own voices (speechSynthesis: free, on the device, nothing sent),
  a steady voice per character.
- `PlacePicker.tsx`: the show's places on their own backdrops.

## Adding a stage

1. The place on `app/Scene.tsx`, the person's controls from `app/stage/`.
2. Everything the person types through the full crisis path (`lineInCrisis`: the list, a model check on the maybes
   that fails closed, a pause, a `crisis_referrals` count with the stage's own surface). The cast's lines are checked
   against the crisis list and the content line too, what they do as well as what they say.
3. The AI notice at the start, after 30 minutes away and every three hours, and "AI character" on screen throughout.
4. A report button whose reports reach an admin queue and the `/api/health` count.
5. A per-person rate limit, and every model call short enough to answer inside Cloudflare's 100 seconds (30 s for
   the main call, as companions do).

## Modularity

Found:
- The companion chat shares nothing with the show's text thread (`app/ChatThread.tsx`), though both are threads.
- Step-in and companions each have their own access gate, composer and "send, with the crisis check" helper (the
  pause panel is now shared).
- The AI notice is worked out in three places (step-in, companions, After Dark), and a crisis pause is stored two
  ways (on the step-in session, `companion_threads.paused_at`).
- The crisis model check, `lineInCrisis`, lives in `lib/step-in.ts`; companions import it from there.
- The companion model borrows After Dark's OpenRouter key.
- After Dark's immersion pieces (`LivingFace`, `useSteadySet`, `TalkPlayer`, `PlaceSound`) would work on any stage
  but for their URLs; they sit under `app/after-dark/`, read `lib/adult/`, and their APIs are served only by the After
  Dark host.

Next:
1. One crisis module: `lineInCrisis` and the pause into `lib/crisis.ts`. A small move with no behaviour change.
2. The companion's own OpenRouter key with its own spend cap, so its costs and limits are its own.
3. One notice policy on the server (`lib/disclosure.ts`); each stage stores only when it last showed it.
4. A stage shell in `app/stage/`: the gate, the composer and the send helper, used by step-in and companions. Then
   `ChatThread` gets a "you" side, so companions reuse it.
5. With P3's voice notes: Kokoro voices out of `lib/adult` into `lib/voice.ts` (After Dark keeps a wrapper), then the
   immersion pieces into `app/stage/` with their URLs passed in.

## Safety

Found:
- **Two crisis protocols.** The word list alone (`crisisAware`, `crisisCheck`: the resources shown, nothing paused,
  an anonymous analytics count) on a date's note, texts, nudges, roleplays, After Dark's steer and MCP `send_text`;
  the full path (`lineInCrisis`) on step-in and companions only. SB 243's yearly count would read `crisis_referrals`,
  which only the full path writes.
- The crisis checks are English only: the list and the model check's prompt.
- **Memory edits skipped the check: fixed.** A fact the person adds or edits goes through it first, a crisis
  pauses the conversation and keeps nothing, and the list's maybes are refused (`screenFact`, `editFacts`).
- **Reports sit in three stores** (the show's, After Dark's, a companion message's `reported`), and companion
  reports had no admin view: **fixed**: they wait on `/admin/reports` with the four messages before each
  (`lib/companion-reports.ts`), and `/api/health` counts them (`companion_reports`).
- **Rate limits:** `overLimit` (`lib/limits.ts`, Postgres `rate_hits`) counts and then inserts, so two requests at
  once can both get through; `lib/rate-limit.ts` keeps its counts in memory, per instance. `clientIp` takes the first
  `x-forwarded-for` address, which the client can set, so a per-IP limit can be dodged; Cloudflare's
  `cf-connecting-ip` is the one to trust. Step-in lines and memory edits have no limit at all.

Next:
1. The full crisis path everywhere a person types, counted in `crisis_referrals` with a surface per stage.
2. `clientIp` from `cf-connecting-ip`, `overLimit` as one statement, and limits on step-in lines and memory edits.
3. Crisis words in the languages people use here (`language_seen`), starting with Spanish, Portuguese and French.
4. One reports queue for all three stores.

## Scale

Found:
- Each app is one instance behind Cloudflare, which cuts a response off at 100 seconds.
- **A companion reply could pass that** (a slow main call, two fallbacks and a redraw): **fixed**: 30 s for the
  main call, and a redraw only when the first draw came within 40 s (`REDRAW_WITHIN_MS`).
- Step-in's catch-up and After Dark's `continueScene` still make long model calls inside the request, and the daily
  job runs for up to 270 seconds in one.
- Work done after the response (`inBackground`, `after()`: a companion's facts and summary, among others) is lost
  when a deploy restarts the instance partway through.
- The database pool is 10 connections with no statement timeout.
- Stage pages have no performance budget (`perf-pages` covers other pages); After Dark's pair page runs its queries
  one after another.
- Hive's 100 checks a day cover about 11 viewer-and-character presences in After Dark.
- In-memory state (the rate limiter, caches each process clears on its own, up to 600 s apart) is right only while
  there is one instance.
- Text is cheap (about $0.001 a companion line); pictures and video set what a stage costs.

Next:
1. Long model work answers 202 and the page polls, or streams: step-in's catch-up and After Dark's continue first,
   then the daily job in parts.
2. A jobs table for work after the response, so a deploy can't drop it.
3. A statement timeout on the pool (15 s), and the stage pages in `perf-pages`.
4. One instance per app until the rate limiter and caches live in the database; then more instances.
5. New stages start text-first and add media once people use them.
