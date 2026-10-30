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
| 4 | **Talking moments** | "Hear it from them" on a line worth it: a 5 s clip of that face saying the voiced line (Wan, audio in). One face only: lip-sync on a shot of two moved the wrong mouth (#688) | ~$0.28 a clip: a token item | 🔜 |
| 5 | **Pictures that feel instant** | Show the closest picture they already have at once (scene-match) and swap the new one in when it lands; start drawing the next moment's picture while the lines before it play | the same pictures, sooner | 🔜 |
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
  so it's queued, and it's collected on a later ask, polled every 20 s for up to 12 minutes. The test bed (a jazz bar,
  2026-10-29) took about 9 minutes at Venice, so the first night at a new place is quiet for a while. Every call to
  Venice gives up after 30 s. At most 20 new places a day. A
  failure keeps its reason and isn't asked again for 6 hours. The settings have an on/off switch and the model.
- **On the stage:** `PlaceSound.tsx` loops it at a fifth of full volume under the voices, fades in, crossfades when they
  move, and pauses with ⏸.
- **Other models Venice lists for it** (2026-10-29): Stable Audio 2.5 (19¢, 5 s to 3 min, no loop), MMAudio v2 (0.09¢ a
  second, no loop), Sonilo SFX (0.2¢ a second, no loop). Only ElevenLabs loops.
