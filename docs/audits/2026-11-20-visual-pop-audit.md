# Visual pop audit, 2026-11-20

David asked (from his phone): *audit the site across all marketing and main pages, and look for more visually catching
ideas: background effects, animations, video elements, and ways to make the design pop.* This is what the sweep found,
the ideas ranked, what was broken along the way, and the order to build them in.

## The sweep

36 live pages on botchelor.com at 1280×860 and 390×844, as a visitor (`scratchpad/pop-sweep.mjs`: a top screenshot
at both sizes, a full page at desktop, and per-page counts of running animations, videos, images and background
images). Two reviewers read the shots: one for the marketing pages, one for the show pages.

| Finding | Count |
|---|---|
| Pages that run no animation at all | 26 of 36 |
| Pages with no picture and no video | 17 of 36: create, shows, ship, pricing, about, faq, reviews, tools, the OC generator, agents, alternatives, prompts, marketing, newsletter, costs, import, shop, everything |
| Pages with any video | 6: home, showcase, character, press, agents, creator. On press and agents the clip waits at 0:00 halfway down. |
| Pages that use the four show sets (`public/cast/set-*-v3.webp`) | 2: the episode page and the Botchelor card |

**The thesis: the stage stops at the front door.** Home opens on a curtain, a neon heart, spotlights and tonight's
couple. One click later, Pricing is white cards on cream. The show already owns four sets, 18 house portraits, 47 venue
photos and a library of aired clips (`public/press/video/`, cast intros). Nearly every idea below reuses them.

## Three shared pieces

Thirty-six one-off redesigns would drift. Three shared pieces, plus moving the existing videos to the top, change the
first screen of almost every page.

1. **`<SetHero set media>`**: a full-bleed title band on one of the four sets, with a slow push-in (the theater's
   `cam-push-in`), a dark grade toward the text, about 5% grain, a kicker, a heading, one line and an optional media
   slot.
   - Booth: pricing, shop, alternatives, import, agents
   - Stage: press, about, reviews, casting
   - Confessional: faq, costs, the episode's diary cam
   - Elimination: newsletter, the season page
   - Legal pages (terms, privacy, 2257, content policy) stay plain on purpose.
2. **`<FaceRibbon>`**: a slow marquee of the house cast or the season cast under a heading. It pauses on hover and
   focus, and shows a still wrapped row under reduced motion. PG portraits only, never After Dark. For: everything,
   alternatives, import, companion, newsletter, and Pricing's Companion Plan card.
3. **Motion kit**: three behaviours used everywhere instead of thirty effects.
   - *Reveal*: cards rise in on scroll, using CSS scroll timelines under `@supports (animation-timeline: view())`
     (the precedent is `app/ux/catalog.css`), always from a visible resting state.
   - *Tilt*: portrait cards lean toward the pointer.
   - *Fill*: meters and vote results fill when seen.
   - Plus `<CountUp>` for headline figures. The real number is in the HTML; it only counts up once on view.

**Video up front**, by the HomeClip rules (poster first, muted, looping, lazy, never sound, a still for reduced motion
and Save-Data, `app/useInViewAutoplay.ts`):
- Agents: the agents clip moves from halfway down into the hero.
- Press: lead with `botchelor-ad-loop.mp4` (334 KB) on the stage set.
- Character pages: the "says hello" intro clip becomes the hero, with the portrait as its poster.
- Alternatives and Import: the home clip's phone frame beside the heading.

## Page by page, ranked

| Page | Idea | Effort |
|---|---|---|
| `/characters/<id>` (277 in the sitemap) | A contestant card hero: the intro clip (or the portrait with a push-in), the name in Fraunces, counts as chips, the last date's venue blurred behind. Today it's a narrow column with the clip buried under "Right now". | M |
| `/seasons`, `/seasons/<month>` | The elimination set behind the hero, the lead's portrait large, and a live countdown to the pilot (Sunday 29 November, 23:00 UTC, `lib/sunday-premiere.ts`) that turns into an ON AIR light. | S |
| `/reunion` | Each award as a dark title card with the winner's portrait large, a gold sheen once on view, and the count ticking up. | M |
| `/ship/<a>/<b>` (58 pages) | Both faces slide together, the dropped letters fall out until the ship name is left, then a stamp. | S |
| `/house` | Draw the six empty rooms once (terrace, kitchen, big sofa, stairs, pool, laundry) on Workers AI via `freeBackdropPrompt`, free, as the sets were. Each scene then runs over its room with a REC dot and the time. | M |
| `/pricing`, `/shop` | "5 more dates" gets five venue thumbnails; "15 more dates" gets a slow venue ribbon, which also fills its dead space. The Companion Plan card gets a house face with the talking pulse. | M |
| `/tools` | Each card previews itself: ship names sliding, the chemistry card's share image, a fanned stack of characters. The generator deals cards in with `reveal-flap`. | S |
| `/step-in`, `/characters`, `/casting` | Silent face loops of the cast on hover or on screen. The four intro clips need re-rendering from the v5 portraits first: about $5 on fal, **David's call**. | S + $5 |
| `/episodes/<id>` | The theater's camera push-in on the venue hero; "Read it line by line" bubbles rise in on scroll; the confessional set behind the diary cam. | S |
| `/couples/<a>/<b>` | Chemistry and trust meters fill on view; the two portraits slide toward each other over their latest venue. | S |
| `/showcase` | The grid on the dark media surface, like a cinema, with one trending reel featured on top. | S |
| `/watch` | "Nothing live right now" becomes a dimmed OFF AIR sign; vote results fill as bars; "Ready to start" cards get venue tops. | S |
| `/create` | The "MV" initials example becomes three real house cards that flip until you type; a slim portrait strip on a phone. | M |
| `/companion` | A phone that types a companion's first message with the existing chat animations; portraits bigger than 64px. | M |
| `/` | The bar the rest should meet. Add drifting dust in the spotlight beams and a push-in on "Just aired" card hover; carry the night one section further down before the page turns pink-white. | S |
| `/about`, `/costs`, `/marketing` | About: a pulse runs down the six layers on scroll. Costs and Marketing: headline figures count up, and Marketing's funnel draws itself above the log. | S |

## Broken or off, seen in the sweep

These go first: they make new polish look careless. A fix PR (branch `audit-pop-fixes`) takes the first group.

- Press kit screenshots are stale: they show the old pink hero.
- The random OC generator is cramped: three cards in the reading column, so values wrap a word per line.
- Emoji used as UI on Reviews and Agents (💗 🛠️ ✅ chips), against the icons rule in `docs/brand.md`.
- Grids orphan: Reviews and Marketing show six items as 4 + 2.
- Ship names break mid-word ("Barnabunipe / r").
- Seasons contradicts itself: "11 nights left in the month" under "10 days to the finale".
- Casting says "No suitors yet" over a grid where Nell, the lead, fills a slot.
- Episode copy: "The finale has aired" on a speed date; "at all times.." has a double full stop.
- The header chip says "3 free dates" on most pages and "3 dates left" on character, couple and ship pages.
- Disabled buttons nearly vanish (Create's "Meet them", Import's "Bring them in": white on pale pink).
- Creator page: "0 followers" is shown, and every tile is captioned "Studio clip".
- `/prompts` didn't settle within 30 seconds in the sweep.

Left for the design pass:
- Barnaby's intro clip is photoreal on grey and doesn't match his illustrated v5 portrait.
- Graph week-map labels collide, and one node shows initials ("CB"), a known data issue.
- "15 more dates" stretches to the Companion Plan's height on Pricing and Shop.
- The couple page's left column ends about 850px before the right.

## Running order

Each pass goes live before the next.

1. **The front door ($0, every asset exists):** SetHero on the twelve marketing pages; FaceRibbon on five of them;
   videos moved up on Agents, Press, Alternatives and Import; the character page contestant card; the season countdown
   to the pilot.
2. **The motion kit ($0):** reveal, tilt and fill as shared pieces; reunion envelopes; Pricing and Shop pack visuals;
   ship merge; Tools previews; couple meters; episode push-in and line reveal.
3. **New footage:** the house's six rooms (free on Workers AI); cast face loops (about $5, David's call); Showcase as a
   cinema with a featured reel; home dust in the beams.

## Guardrails

- **Readable before it moves.** Every page is complete at rest, and motion only adds. Reduced motion gets the still frame.
- **Video by the HomeClip rules.** Poster first, muted, looping, lazy, never sound, off for Save-Data.
- **PG on public pages.** House and season portraits, sets and venues only. Nothing from After Dark.
- **Tokens only.** New colours, sizes and corners go through the design tokens, and `tests/css-tokens.test.ts` still
  holds.
- **Fast first paint.** Only the hero backdrop loads eagerly; everything else is lazy and sized.
- **Legal pages stay plain.**

An interactive version of this audit, with each effect running on the show's own assets, was shared with David
privately.
