# A date on film

_2026-11-24. David: "make all 3 on the show. I don't want to be drained too much money tho". This is two of the three:
filmed confessionals and the date as scenes. The third, the weekly recap, is [clips/weekly-recap.md](clips/weekly-recap.md)._

One date a day goes on film: the home clip's date ([flows.md](flows.md), `lib/home-clip.ts`), the one the day's video
is cut from. The code is `lib/date-film.ts` (making), `lib/date-film-read.ts` (reading), `lib/date-film-shared.ts`
(the rules, pure) and `lib/date-film-wav.ts` (the voice's file).

## What's made

| | What | From | Cost |
|---|---|---|---|
| **Scenes** | Up to three pictures of both of them in the date's place, four by five, each at a moment the date's own lines describe (a line's `action`: "sets down a thermos"). Never a moment from the last act: they go into the day's clip, which mustn't show how the date ended. | Both portraits and the venue's backdrop, on the free Workers AI route (`lib/workers-ai.ts`, FLUX.2 klein), checked like every free picture (the show's PG check with the explicit question). | **$0** (about 170 neurons each of the day's free 9,000; it stops while 1,000 are left for people's own pictures) |
| **Confessionals** | Each diary-cam line the date shows a stranger, said to camera: about six seconds of the character's confessional still with its lips moving. | The confessional still (`lib/show-shots.ts`), the character's Aura voice (`lib/companion-live.ts`), and Replicate's Wan 2.2 S2V, the reels' talking model: one take. | **About 12¢ each** (2¢ a second of clip, plus a fraction of a cent of voice) |

The words said are the diary line itself when it fits `FILM_LINE_CHARS` (130 characters, about 6.5 s at Aura's pace);
a longer one is cut at a sentence end, or at its last clause break, and closed with a full stop; a line with nowhere
to cut isn't filmed (`filmLine`). The voice is laid into one take with a breath of silence either side, exactly as long
as the take's frames (`voiceForTake`), because the clip runs as long as its sound.

## The money

Only a confessional costs anything. Before one is made, a full take's price is **held** against two ceilings, in one
SQL statement (`holdFilmBudget`, table `date_film_spend`, a row a UTC day):

- **the day's**: `DATE_FILM_DAY_USD`, default **$0.35** (two confessionals, never a third);
- **the month's**: `DATE_FILM_MONTH_USD`, default **$8**.

Past either, nothing paid is asked for until the day or the month turns, and the page shows the diary cam in words as it
always did. After the take, the hold is settled to what it really cost; a take that failed gets its hold back; a hold
that's never settled (a deploy mid-take) stays counted, so the ceilings can be undershot and never passed. Two requests
can't both take the last of a day, and can't both film the same line (`claim`). Every item is tried at most twice.

A month of two confessionals a day is about **$7.50**. `DATE_FILM=0` turns all of it off; `0` in either ceiling stops
the paid half and keeps the free pictures. `GET /api/admin/date-film` (admin) says what's spent today and this month
against the ceilings, and lists the newest dates on film.

## Who's filmed, and who sees it

- Only a date a stranger may see (`clipRefusal`: aired, public, not hidden by reports, both characters public, its
  story holding).
- Only the diary lines that date shows a stranger (`lib/game.ts` `diary`): a house character's always, a person's
  character's once their host has shared the confessionals.
- A character needs a confessional still (drawn nightly, `lib/show-shots.ts`); a side without one is skipped at no
  cost and tried again the next hour.
- The files (`/api/date-film/<id>/scene.webp`, `/clip.mp4`) are served only while the date is still public, by the same
  SQL rule as the home clip (`STILL_PUBLIC`): a date taken down takes its film with it, and `dateFilm` stops listing it.
- **Not checked:** the clip itself. Its still passed the PG check when it was drawn and its words are the date's own
  public line; the talking model only moves the mouth and the head. The cast's intros (`lib/cast-intros.ts`) are kept
  the same way. Checking frames would mean shipping ffmpeg with one more route
  ([the tracing rule](../tests/media-tools-tracing.test.ts)).

## When

- **When the day's clip is uploaded** (`POST /api/admin/home-clip`, from the 17:00 recorder on the owner's Mac): filming
  starts after the response.
- **Every hour** (the lobby job, `filmDue`): whatever the day's date is still missing, for a day and a half after its
  clip. Cheap when there's nothing to do: no provider is called.
- **On request** (`POST /api/admin/date-film { episode, only? }`, admin): films a named date and answers when it's
  done. The day's video asks this before it's cut (`scripts/clips/daily-episode.mjs`).

## Where it shows

- **The date's page**: "From the date", the scenes in a row under what they want (a row to swipe on a phone); and in
  the diary cam, a filmed line's still stands where the face would and says the line when pressed (never by itself:
  it has a voice; nothing loads until then).
- **The date's JSON** (`GET /api/episodes/<id>`): `film: { scenes, confessionals }` once aired, for the day's video.

## Proof

Live, 2026-11-24, before any of this was built (the two unknowns, about 11¢ in all): Juniper's diary line (102
characters) came back as 5.08 s of voice and a 5.6 s clip at 512 by 640 in 138 s of waiting (23 s of the model's time);
two scenes of Juniper and Barnaby in the jazz bar, with the thermos the line mentions on the table, were drawn free in
six seconds each.
