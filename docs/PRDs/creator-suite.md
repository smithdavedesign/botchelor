# PRD: the creator suite

**Status:** approved by David, 2026-10-26 ("use the research and add all these features … make it addicting to use and
great to look at and use … go wild", then "go ahead and tackle 1-3"). **Owner:** David. **Plan:**
~/.claude/plans/zesty-jumping-candle.md. Built as a sequence of PRs, each merged once green.

## Why

The research (2026-10-26): two-person pictures fail far more than POV, but per act (prod ratings, last 21 days:
face_to_face both in frame 2👍/8👎, afterglow 0/4, on_top POV 0/5, oral POV 8/0, close/kiss/lap both in frame all 👍).
Creators need the same character in every picture, native social sizes, SFW versions for public posts, exports marked
as AI, captions, bigger shoots and carousels. Clips need: save a moment, continue where it left off, boomerang and loop.

## David's calls (2026-10-26)

1. **Both Studios, shared code.** Export, native sizes, captions, carousel and the identity pack in the PG Studio too;
   Fix faces, clip moments and framing in After Dark only.
2. **Prices** (settings, admins free): Fix faces free (counts toward the month's cap); moments, boomerang, loop, export
   and captions free; SFW twin 1 token; carousel (6 angles) 1; identity pack (8 views) 2; bigger shoots 1 token per 4
   pictures, 20 for 4 tokens.
3. **Engagement: delight, no pressure.** Reveals, a swipe deck to rate pictures, progress, a one-tap next step. No
   streaks, countdowns or loss-aversion nudges.
4. **AI label:** the IPTC "AI-generated" mark in every exported file; a visible "AI" badge as an export option, off by
   default.

## The PRs

| # | What | Status |
|---|---|---|
| 1 | Media tools + a clip's moments: save a still, boomerang, loop, keep going from here | #923, live |
| 2 | Export pack + captions in their voice + tile tools (both Studios, the scene gallery) | #927, reverted (#929: the deploy ran out of disk); re-landed as #931 after #930 shipped ffmpeg to its routes only; live |
| 3 | Framing scores + POV for two people | #932, live |
| 4 | Fix faces + identity pack (and the face anchor follows a new face) | #933, live |
| 5a | Native sizes + carousels (both Studios; fixes PG shoots without a portrait) | #934, live |
| 5b | Bigger shoots (8, 12, 20) landing as they're kept, After Dark Studio | #936, live |
| 6 | SFW twin + camera-move tiles (content ratings from a level: not done, see docs/after-dark.md) | this PR |
| 7 | Rating deck + favorites + delight pass + docs and screenshots | |

## Open, for David or the legal workstream

- Commercial-use terms for creators (their own characters; house and other people's characters for personal use only).
- Venice's written answer on explicit output still stands for the whole of After Dark.
- A model-made seamless loop needs a live test of an uncensored model that honours `end_image_url`.
