# The theater, more alive: a roadmap

David, 2026-10-29: "any ideas to make the theater even more immersive? better audio voices? instant image generation for a
scene? a short loop of your character instead of the icon so it looks like they are talking and are real?"

The answer's principle: **presence that's made once and reused, and spend per line only on the moments that matter.**
A night is about 120 lines. Anything paid per line has to be cheap (a voice), anything heavier (a lip-synced clip) is
per moment, and the rest (a face's expressions, a living portrait, a place's sound) is made once and reused all night.

**Legend:** ✅ done · 🔜 next · 🧭 later · ⏸ parked

## What others do (the research, 2026-10-29)

- **Character.AI AvatarFX:** one picture plus a voice and a script gives a clip of them talking or singing; 5 a day
  free, more on c.ai+ ([TechRadar](https://www.techradar.com/computing/artificial-intelligence/character-ais-newest-feature-can-bring-a-picture-to-uncanny-life)).
- **Kindroid:** live video calls with lip-synced, gesturing custom avatars, out of beta in March 2026, billed by the
  minute; reviews are mixed (the avatar doesn't always move) ([Stork](https://www.stork.ai/en/kindroid)).
- **SillyTavern's Character Expressions:** a set of expression pictures per character, swapped as each new message is
  read for its emotion; a "talkinghead" that animates one picture; a visual-novel mode
  ([docs](https://docs.sillytavern.app/extensions/expression-images/)).
- **Candy.ai, OurDream:** voice messages, pictures, GIFs and short videos (mostly affiliate coverage; unverified).
- **Hosted real-time avatars (Tavus and the like)** ban adult content outright
  ([Tavus AUP §4.9](https://tavus.io/acceptable-use-policy)): a live call would mean our own GPU.

What Venice, After Dark's provider, already offers (its model list and quotes, 2026-10-29):

- **Voices:** Kokoro ($3.50 per million characters, today's), Inworld 1.5 Max ($12.50), Chatterbox HD ($50, an emotion
  strength), Orpheus ($62.50, laughs, sighs and gasps written into the line), xAI, ElevenLabs Turbo v2.5, MiniMax. A
  night's 80 or so spoken lines: about $0.03 on Kokoro, $0.10 on Inworld, $0.50 on Orpheus or Chatterbox.
- **Video that takes our audio in** (Wan 2.5, 2.6 and 2.7): a face and a voiced line give them saying it. Wan 2.6 Flash
  quoted $0.28 for 5 s at 720p.
- **Short clips:** Grok Imagine 1.5 Lite, $0.08 for 3 s at 480p; Seedance 2.0 Mini, $0.18 for 4 s.

## The roadmap

| # | What | How | Cost | Status |
|---|------|-----|------|--------|
| 1 | **A living portrait** in place of the round icon | A few seconds of them, still and natural (breathing, blinking, a small smile), made once from their portrait (below); played over it, faded back into it at the end, so the loop never shows its seam | one clip per face, once | ✅ #960, from a portrait in the follow-up |
| 2 | **Expressions**, SillyTavern's way | Seven edits of their portrait (smile, laugh, flirty, intense, tender, surprised, annoyed), made once; the writer gives each line a `face`, and the theater shows the speaker's | seven pictures per face, once; nothing per line | ✅ #960 |
| 3 | **Voices that act** | A voice model for the night's lines: Kokoro, Inworld or Orpheus, with a stock voice each by their pronouns; on Orpheus, a laugh, sigh, gasp or groan in the line's action is heard | 0.04¢ to 0.6¢ a line | ✅ #960; pick by ear in settings |
| 4 | **Talking moments** | "Hear it from them" on a line worth it: a 5 s clip of that face saying the voiced line (Wan, audio in). One face only: lip-sync on a shot of two moved the wrong mouth (#688) | ~$0.28 a clip: a token item (a clip's price) | ✅ #965 |
| 5 | **Pictures that feel instant** | A moment being drawn is on the stage at once, as the closest picture they already have, and swaps to its own the moment it lands (checked every 6 s); drawing ahead, as soon as a moment is written, is a setting (off) | the same pictures, sooner | ✅ #967 |
| 6 | **The sound of the place** | A quiet bed per place (a jazz bar's murmur, waves, rain), made once per place and shared, under the voices while 🔈 is on | about 5¢ a place, once | ✅ #964 |
| 7 | Living expressions | A loop per expression, not only the still one, so a laugh moves | seven clips per face | 🧭 after 1 and 2 are watched |
| 8 | The phone's stage | The living face in the phone's thread and header, not only on the desktop stage | — | 🧭 |
| 9 | Talk back | Say a steer or whisper out loud (speech to text) | per steer | 🧭 |
| 10 | A live call | Real-time lip-synced video both ways (Kindroid's) | our own GPU; hosted services ban adult | ⏸ |

Already there and worth more use: slow camera moves over stills (#2546's camera moves), first-person framing (#930),
texts between nights, the reel storyboard.

## 1–3, as built

- **Their portrait first** (found live, 2026-10-29): a kept face is often a whole-body picture, sometimes undressed, and
  on the stage's 132 px tile the face in it is about 25 px, so no expression read. So the first thing made is one checked
  edit of the kept face, from the collarbones up, in a plain top. The expressions and the loop are made from it, and it's
  the still the theater shows. A new portrait starts the rest over. Providers fetch it by a short-lived signed link
  (`signedPresenceUrl`), the media route's kind, scoped to presence files.
- **Where the presence lives:** `adult_presence`, one row per viewer, character, face and part (the portrait, an
  expression or the loop), kept out of `adult_images` so no gallery, library or export ever lists it; served by
  `/api/admin/after-dark/presence/<id>` to its owner only, behind the privacy blur's `/after-dark/` hook.
- **When it's made:** only when asked ("✨ Bring them to life" in the theater's ⋯), once per face: a new face kept makes
  the old one's presence stale. What would stop it (no face yet, no output check, the month's pictures used) is said at
  once. The portrait is drawn first; then the loop is queued, so Venice renders it while the seven expressions are drawn,
  three at a time, inside one function's five minutes (live: both of a pair done 138 s after the click); the theater asks again every 30 s until they're in. Each expression is checked like any
  picture; the loop like any video (Hive). One left "making" by a function that died counts as missing after 10 minutes.
- **On the stage:** the speaker shows their line's expression; the one listening, their loop over the still face, faded
  back into it before its end so the seam never shows (with no loop yet, their last look is held). With reduced motion,
  the still face only. Expressions load ahead.
- **The writer's `face`:** one word per line from the list, like `doing`; a line without one is neutral.
- **Voices:** `voice_model` in After Dark's settings (Kokoro by default), the voice per character picked from that
  model's own voices by their pronouns and id, like Kokoro's always was; a line already voiced in one model is kept, and
  another model voices it again. Only Kokoro gives MP3; the others give WAV (about ten times the bytes, fine for a line).
  The lines asked for are voiced at once, not in turn, and a call not back in 25 s leaves its line silent.
- **How fast each is** (one line, timed 2026-10-29, cold then warm): Kokoro 2.4 s / 1.0 s, Inworld 3.1 s / 2.7 s,
  Orpheus 297 s / 4.0 s, Chatterbox HD 24.6 s / 23.5 s. The theater waits 8 s for a line's voice, so Chatterbox can't
  keep up and isn't offered; Orpheus keeps up once warm, but a night's first lines after a quiet spell play silent.
  Inworld is the one to try first.

## 6, as built

- **What it is:** `lib/adult/place-sounds.ts` and the `place_sounds` table. There's one bed per place: a library venue
  by its id, anywhere else by its words (`normalizeScene`), the same as a drawn set. It's made once on Venice's
  `/audio/queue` with ElevenLabs Sound Effects v2: 20 s, `loop: true` so it splices back with no seam, about 5¢. It's
  shared by every night there, since nobody's in it.
- **When:** a theater with 🔈 on asks for its place's sound (`/api/admin/after-dark/place-sound?venue=`). There's none,
  so it's queued, and it's collected on a later ask, polled every 20 s for up to 12 minutes. On prod the first bed (the
  street, 2026-10-29) was ready 36 s after it was asked for; a test from here took far longer and its last call hung, so
  every call to Venice gives up after 30 s. At most 20 new places a day. A
  failure keeps its reason and isn't asked again for 6 hours. The settings have an on/off switch and the model.
- **On the stage:** `PlaceSound.tsx` loops it at a fifth of full volume under the voices, fades in, crossfades when they
  move, and pauses with ⏸.
- **Other models Venice lists for it** (2026-10-29): Stable Audio 2.5 (19¢, 5 s to 3 min, no loop), MMAudio v2 (0.09¢ a
  second, no loop), Sonilo SFX (0.2¢ a second, no loop). Only ElevenLabs loops.

## 4, as built

- **What it is:** `lib/adult/talks.ts` and the `adult_talks` table. "🗣 Hear it from <name>" in the theater's ⋯ makes a
  few seconds of the line on stage being said by its speaker. It starts from their presence portrait, so there's one
  face and the lip-sync can't land on the wrong mouth (#688). The voice is the line's own: made or found by
  `voiceLines`, and given to Wan 2.6 Flash as `audio_url`. The model is the `talk_model` setting.
- **Price:** a clip on demand's (`clip_tokens`; admins don't pay), counted in the month's clips. Checked like any video
  before it's kept. Refunded when Venice fails, the check refuses it, or it's given up after 20 minutes.
- **Kept** per viewer, speaker and words: asking again plays the one already made, for nothing.
- **Found live:** the first one, of Sweet thang, had garbled subtitles burned into most frames. The direction now asks
  for a clean frame with no text of any kind, and an A/B with the same portrait and voice came back clean on both Wan
  2.6 Flash ($0.28, 152 s) and Wan 2.7 ($0.55, 67 s). The default stays 2.6 Flash, and 2.7 is the faster choice in
  settings. Talks made before the fix (`version` 1) are never matched or played again.
- **On the stage:** it opens over the stage when it's ready (`TalkPlayer.tsx`), with sound, and the theater waits while
  it plays. Once made, a "🗣 Hear <name> say it ▶" chip offers it whenever that line is on stage again. It needs their
  portrait (✨ Bring them to life) and a line with words in it.

## 5, as built

- **The finding:** the theater never showed the pictures it drew. A moment's picture went to the gallery under it, the
  theater learned of it at 20, 60 and 120 s, and only the scene-match backdrop ever reached the stage.
- **Now:**
  - `momentPictures` (`lib/adult/scene-match.ts`, `/api/admin/after-dark/moment-pictures`) gives the running chapter's
    moments that are being drawn or are drawn. For each one still drawing it gives a stand-in: the pair's closest
    picture, scored for that moment's act, place and stage the way the backdrop is, and never past how far the night
    has gone.
  - The theater (`useMomentPictures`) asks whenever the beats change, and every 6 s while one is drawing, for up to
    4 minutes. From the moment's line, for 8 lines, the stage shows its picture, or the stand-in with "📸 Drawing this
    moment" until it lands. `SceneBackdrop` loads the new one before fading it in.
- **Drawing ahead** (`draw_ahead`, off): each new moment starts drawing as soon as its step is written, so it's ready when
  its line comes. It only uses the chapter's own unasked pictures (`pictures_per_chapter`), the ones its close would draw
  anyway, so it costs nothing more except a picture wasted by a rewind past it. It's off because it skips agreeing on the
  picture before it's drawn (David, 2026-10-24); Redraw stays. A step takes about 70 s to write and lines play every
  2.6 s, so a moment k lines into a step gets about k × 2.6 s of head start.

## What a scene picture is drawn from (the brief, 2026-10-29)

David, on drawing ahead: "the copy or story doesn't give a full picture … add a quick call to a llm to summarize the
scene, location, what's happening … this is even true for when we stop to take an image of the scene, like it's
important to know what they're wearing if there is a cosplay ongoing."

- **The gap:** a scene picture's context was a guess from the last three lines' actions, their usual outfits (or the
  stage's words once they undress) and the place's name. A costume put on twenty lines back, the shirt that came off and
  the counter they moved to never reached the picture.
- **Now** (`lib/adult/picture-brief.ts`): one short call on the fast writer (`FALLBACK_WRITER`, DeepSeek V3.1 on the
  reviewed hosts) reads the chapter up to the picture's line. Alongside it, it gets who they are, what each usually
  wears, where the night is, the chapter's roleplay with who plays whom, how far it has gone and what the picture shows.
  It says as facts: the place, what each has on at that line (a costume exactly), what's still on once they're naked,
  what's happening, and the mood.
- It's the night's guess in the picture's form (`planBeat`), for every scene picture: asked for, drawn ahead, the
  chapter's own and its close's. The owner's changes still replace it, field by field. Each field is held to David's
  lines and the pair's limits; one that crosses them keeps the old guess.
- **Clothes by stage:** dressed, "…, both still dressed"; undressing, as it says; naked, the stage's spelled-out words
  unless something is still on ("both completely naked apart from her gold mask…").
- **Kept per moment** (`adult_picture_briefs`, keyed by everything it read): the form shows what's then sent, and a
  redraw reads the same; a rewind or a redo that changes the lines reads it again.
- **Fail-open:** without the OpenRouter key, past 10 s, on an error or an unreadable reply, the old guess stands.
- **Cost:** about 0.1¢ a picture (a chapter of at most 120 lines in, about 150 tokens out), free to the viewer, and kept
  on each row (`cost`).
