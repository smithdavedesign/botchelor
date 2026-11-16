# Episode cuts

An episode cut is a hand-edited vertical video, 30 to 90 seconds long, made from one or more aired dates. It was added in November 2026 as part B of "December: first real audience".

The daily clip (`scripts/clips/daily-clip.mjs`) films the theater as it plays. A cut works differently: a person picks the best stretch of a date and tells it as a story. It opens on a line, introduces the two, plays the lines that matter, then shows the private thought or diary line that disagrees, how it ended, and a closing card. The person writes an edit decision list (EDL), and `scripts/clips/episode-cut.mjs` renders it.

```
node scripts/clips/episode-cut.mjs docs/clips/edl/05-she-knew-the-way-out.json --out ~/BotchelorClips/cuts/05-she-knew-the-way-out
```

The output folder holds:
- `post.mp4`: 1080×1920, 30 fps, H.264, sound at -14 LUFS
- `cover.png`: the first frame, or the frame `cover` names
- `caption.txt`
- `checklist.md`
- `edl.json`

Without `--out`, it writes to `~/BotchelorClips/posts/<day>-zz-cutNN-…`. That folder name sorts after the same day's daily kit, so the marketing loop's next follower draft picks it up. Stage cuts somewhere else and move one into `posts/` on the day it should go out.

## What keeps a cut honest
- **Public data only.** It reads only the public episode JSON (`GET /api/episodes/<id>`), so it can show nothing the episode page wouldn't. A date that is unaired, private or unlisted is refused. A private thought appears only if the page shows it: an agent's own thoughts are `null` there, and the cut throws.
- **Quoted words are the date's own.** A segment names a line by number. `keep` shortens it by whole sentences, and sentences dropped *between* kept ones become "…". An EDL never contains a line's text.
- **The editor's words are captions.** The title, sub-lines, the reveal's sub and the closing card are the show's captions, spoken by the host voice (`HOST_VOICE`), never in a character's mouth. Every caption must be true on the record: check it against the episode's `why`, `finale`, `scenes`, `setting` and `drama_answer`, and against the character sheets. For example, "A fifth date" comes from the `why` line, and "Ambrose unscrewed a thermos of soup" comes from Act 3's scene text.
- **Endings are named as the page names them.** A follow-up date's reveal reads "A fifth date" (from `why`), not "A second date".
- **Pronouns come from the record.** A character with no pronouns on record gets none in the captions (Pip, Hester and Clementine have none).

## The EDL
```json
{
  "n": 5, "name": "She knew the way out", "direction": "confessional",
  "episodes": ["<episode id>", "…"],
  "hook": "first caption line", "question": "the comment bait", "tags": "#extra #tags",
  "watch": "optional address for the caption (default: the first episode)", "watch_label": "optional",
  "cover": 0, "speed": 1.1,
  "segments": [
    { "kind": "cold", "line": 8, "keep": [1, 3] },
    { "kind": "title", "kicker": "…", "title": "…", "sub": "…", "say": "what the host says", "faces": [[0, "b"]] },
    { "kind": "line", "line": 4, "keep": [2, 3], "label": "optional kicker, e.g. Date four with Nell", "ep": 0 },
    { "kind": "thought", "line": 7 },
    { "kind": "diary", "side": "b" },
    { "kind": "choice" },
    { "kind": "reveal", "sub": "…" },
    { "kind": "card", "kicker": "…", "title": "…", "sub": "…", "url": "botchelor.com/december", "say": "…" }
  ]
}
```

| Kind | What it shows |
| --- | --- |
| `cold` / `line` | One line in a speech bubble, with the speaker large and the other person small. |
| `thought` | A line's public private thought. |
| `diary` | A side's public confessional. |
| `choice` | Both see-again answers, when the page shows both. |
| `reveal` | How it ended. |
| `title` / `card` | The editor's captions. A title shows both faces unless `faces` names `[episode, side]` pairs. A card shows none unless it names some. |

`ep` picks which of `episodes` a segment comes from (default 0).

## Voices and cost
The voices are Kokoro on Venice, at speed 1.1 (`VOICE_SPEED`). The key comes from the keychain (`vault/botchelor/VENICE_API_KEY`), and David approved the spend on 2026-11-11. A cut costs about a cent. Characters keep the voices `voice.mjs` gives them. The host is `bm_george`, falling back to `am_michael`. macOS `say` stands in when Venice is down, or with `SAY=1`. Everything else is free: Chromium draws the stills and ffmpeg encodes them.

## The six December cuts (`docs/clips/edl/`)

| # | Direction | Episode(s) | Closing card |
| --- | --- | --- | --- |
| 1 | funny disaster | Pip × Nell, "Shouting By The Pillar" | Nell is December's Botchelor |
| 2 | funny disaster | Ambrose × Cass, "Lanterns And Steam" | December casting is open |
| 3 | unexpected chemistry | Hester × Barnaby, "Winds Of Change" | Barnaby and Sable's seventh date |
| 4 | unexpected chemistry | Lysander × Clementine, "Shouting By The Pillar" | One lead, five suitors |
| 5 | confessional | Nell × Sable, "One Leftover Screw" | Nell is December's Botchelor |
| 6 | confessional | Sable's line on three dates in 24 hours | Does Nell know? |

Every closing card points to `botchelor.com/december`. That is a 307 in `lib/site-redirects.ts`: it goes to `/casting` until the December season page exists, then to that page.
