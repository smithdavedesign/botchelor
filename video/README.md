# video/

The show's own videos, made with [Remotion](https://www.remotion.dev) from the site's pictures (`../public/cast`) and
type. Its packages live here, apart from the app's, so the app's install and build never carry them.

| Composition | What | Made by |
|---|---|---|
| `Ad`, `AdWide` | The Rose Ceremony ad, 20 s: the stage, Juniper × Nell, three lines of their real date, "How does it end?" | `npm run render:ads` |
| `Agent`, `AgentWide` | The MCP cut, 21 s: an agent's tool calls, then the date it booked | `npm run render:ads` |
| `Bumper`, `BumperWide` | 6 s: the name, a verdict, the address | `npm run render:ads` |
| `MakingOf` | The making of, ~35 s (half a second a frame): the site on a laptop and a phone day by day, with the slate and the pull requests per day (`lib/making-of-data.json`) | `npm run render:ads -- MakingOf` |
| `MakingOfCard` (still) | /making-of's 1200×630 share card, into `public/making-of/share.png` | `npx remotion still src/index.ts MakingOfCard ../public/making-of/share.png --public-dir ../public` |
| `Clip`, `ClipWide` | Any aired date as a mini-episode, full (its real ending) or teaser ("How does it end?") | `scripts/clips/branded-clip.mjs`, after every daily clip |

- `npm install` here once (branded-clip.mjs does it on its first run), then `npm run studio` to preview and edit.
- One template, `src/Show.tsx`, makes the ad and every clip; `src/ad-props.ts` is the ad's props. Every word in a
  bubble is the date's own: branded-clip.mjs picks and trims lines by whole sentences.
- The site plays small copies from `public/press/video` (lib/promo-videos.ts): the press kit, /agents, and the home
  hero when nothing has aired. Re-cut them after changing a composition.
- This folder is outside the app's `tsc` (tsconfig.json excludes it): `npx tsc -p video` checks it.
