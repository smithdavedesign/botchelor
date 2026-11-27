---
name: show-assets
description: |
  Build Botchelor's visuals: share cards and posters (next/og), promo videos (Remotion in video/),
  show sets and venue backdrops, and the cast's show-kit shots, wired into the pages that show them.
  Use when asked for more visuals, a poster, a trailer, a cast reveal, a better link preview, a
  set, or as the pictures step of `showrunner`.
---

# Show asset builder

## The toolbox (reuse before you add)

| Asset | How | Example |
|---|---|---|
| Share card / poster (PNG) | `next/og` ImageResponse in an `opengraph-image.tsx` or a `.png/route.tsx`; every picture goes in as a small JPEG (`lib/date-photo.ts` `smallJpeg`, `castJpeg`, `portraitJpeg`: the rasterizer draws WebP as nothing); mark it AI-generated with `markedImageResponse` (`lib/ai-mark.ts`) | `app/seasons/season-poster.tsx` (og, ph, story sizes) |
| Promo video | Remotion in `video/` (own packages, outside the app's tsc: `npx tsc -p video`); one composition, 9:16 and 16:9; props from public JSON; rendered on the Mac by a script in `scripts/clips/` | `video/src/CastReveal.tsx` + `scripts/clips/season-promo.mjs`; `video/src/Show.tsx` + `branded-clip.mjs` |
| Show sets, venue backdrops | Drawn free on Workers AI from a plate (`lib/show-sets.ts`, `scripts/prompts.mjs` `freeBackdropPrompt`), reviewed, committed to `public/cast/` with a new version in the name | `set-stage-v3.webp` |
| A character's expressions and moments | The show kit (`lib/show-shots.ts`): nine shots per contestant from their portrait, free, PG-checked, drawn nightly; read with `shotsFor` | the lead's rose shot on the rose card and poster |
| Site copies of videos | small cuts in `public/press/video` (`lib/promo-videos.ts`): ffmpeg 720p, CRF 27, `-movflags +faststart` | the home hero, /press |

## Building a playbook move

When the request names a move from [../showrunner/formats.md](../showrunner/formats.md), its "pictures" line is
your brief. Build it on the toolbox above: the season poster's layout for a format's poster, `CastReveal`'s
scenes for its clip, and the share-card pattern for its card.

## Rules

- **Look at what you made.** Render it (a test that writes the PNG, `npx remotion still … --frame N`)
  and look at it at phone and desktop size before calling it done. Check the dark title-card
  surfaces read in both themes.
- **Faces first, varied.** Every list that names a character shows the face; the lead gets the gold
  ring, suitors the pink (`season-poster.tsx`, `CastReveal.tsx`).
- **Only public, PG pictures.** Approved PG portraits and show-kit shots; never After Dark media on
  a show surface. A private character is named only, no face.
- **$0.** Workers AI's free budget for drawing (leave `SHOTS_RESERVE_NEURONS` for people's own),
  Remotion and ffmpeg locally. No paid image or video model without the owner's yes.
- **The page carries it.** A new card is wired as the page's preview (pass `image: null` to
  `pageMetadata` so the file wins) and, when it's a file to post, served at a stable URL.
- **Tests:** a new card gets a test that it renders at its size; a new composition's props builder
  gets a pure test (like `tests/season-promo.test.ts`).

## Hand-off

List each finished file the owner posts, with its size and where it goes (Product Hunt gallery,
story, Reels/TikTok/Shorts, X). Never post it yourself.
