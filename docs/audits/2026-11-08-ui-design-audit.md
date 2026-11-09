# UI design audit (2026-11-08)

David asked (2026-11-08): "Any UI design improvements? Do an audit, think about it." Then: "tackle 1–13". This is
the audit, what shipped for each finding and how each is held. The product review the day before
(2026-11-07-product-review.md) settled the information architecture and found the gap was "focus and naming, not
pixels"; this pass is the pixels. Its conclusion is the same in miniature: the show's big surfaces (the theater, the
title cards) have an identity, and the everyday ones (the lists you scroll to find a date) had drifted into blank
tiles, repeated cards and four page widths.

## How it was done

The live site (botchelor.com) in Playwright at desktop (1280×800) and phone (390×844), light and dark: home, Watch,
an episode, Characters, Companions, Create, the reels/showcase, Matches and the account page. The CSS was measured
rather than eyeballed: line counts, every literal colour, font size and corner, and the page widths each route
ends up with. Findings are ranked by how much of a first visit they affect.

## The thirteen findings and what shipped

| # | Finding | What shipped | Held by |
|---|---------|--------------|---------|
| 1 | **Episode tiles were blank brown boxes**: two thumbnail faces on a flat gradient, on Watch and home, while every venue has a reviewed photo the episode page already uses. | `app/VenuePhoto.tsx`: the venue's photo (lazy, 1024×576, ~40 KB) over its gradient, with a grade toward the bottom; the couple's faces on it. Watch's list is picture-first cards (a row with a square picture on a phone, a 2–3 column grid wider); home's shelf and the real-date excerpt sit on the photo too. | `tests/ui-audit-2026-11-08.test.ts` |
| 2 | **One mixer night flooded the feed**: 9 of the 11 latest episodes were tables of one speed-dating night, same rooftop, same title; each carried both "Speed date" and "Speed dating". | `listAiredFeed` (lib/game.ts): the same public feed with a mixer's tables as one entry, placed where its newest table aired; a page is 12 entries. `MixerNightItem` / the shelf's night tile: everyone's faces, "N tables aired", a few pairs, opening `/mixers/[id]`. A night with one visible table reads as that date; double dates stay two couples' own dates. The format badge is dropped where the group badge already says it. | PGlite test of grouping, order, paging, filters; badge test |
| 3 | **The real date's card opened half empty**: every line typed in, so for its first seconds (the ones a visitor looks at) the card was mostly reserved space. | The first two lines are there at once (`EXCERPT_LINES_AT_ONCE`), only the rest type in; still CSS-only, every line in the page for crawlers and screen readers. On Watch's wide page it's two columns (the pair and the button beside the lines). | excerpt tests |
| 4 | **Companions rendered all 173 companions**: 58 phone screens of tiles. | 24 at a time with "Show N more" and "24 of 173 shown"; the count resets when a filter changes. | paging test |
| 5 | **Page widths chosen page by page**: Matches 40rem, the default 46rem (which Watch, Characters and Companions used, so the show's main tabs were narrower than home), an episode 68rem, home 72rem, the showcase about 75rem (by a negative-margin hack), a watch room 76rem; moving between tabs, the column jumped. Five pages nested a second `<main>` inside the layout's. | Two tokens: `--page-read` (46rem, `main`'s own) and `--page-wide` (72rem) for pages that opt in with `.page-wide`: home, Watch, Characters, Companions, showcase and creators, Reunion, Reviews, the graph; an episode and a watch room by their own rules. Matches reads at 46rem like the other conversation pages. Swipe (62rem, its deck beside its intro) and admin (84rem) keep their own widths, documented as exceptions. The nested `<main>`s became `div`s. | width tests; one-`main` test |
| 6 | **The season's cast of four sat three and one** on home and on Characters. | `balancedColumns(n)` (lib/grid-balance.ts) sets `--cols` on `.grid-balanced`: four in a row, five as three and two, ten as 4/4/2; two a row on a phone. | unit test |
| 7 | **Headings had no single scale**: section `h2`s were the browser's 24px on most pages and 17–19px (`--text-lg`) on Watch, where the vote cards' unsized 24px headings outranked the sections around them; the seven eyebrow labels came in three sizes, two weights and five letter-spacings. | `h2` is `--text-xl` and `h3` `--text-lg` everywhere; the seven eyebrow classes share `.kicker`'s look (`--text-2xs`, 700, 0.1em). | app/ux/catalog.css (tokens only) |
| 8 | **Emoji stood in for icons**: 🔔, 🌙, 🔒, 📍, 💼, 💞, 🤖, 📺, 🏆, 🔓, ▶, rendering differently per platform and reading as unfinished next to the type. | `app/Icon.tsx`: 13 line icons in `currentColor`, decorative unless labelled. The interface's own markers use them; the show's voice (award and format emoji, reactions, what characters write) keeps its emoji. The rule is in docs/brand.md, Icons. | icon tests; the five tests that asserted the emoji now assert the icon |
| 9 | **The CSS had drifted from its tokens**: brand.md said "~1,350 lines" against 13,818 in globals.css alone (about 22,000 across every sheet), with hundreds of literal colours and font sizes and about fifteen different corners. | A radius scale (`--radius-xs` … `--radius-pill`) replacing 178 literal corners across 9 sheets, and a ratchet: `tests/css-tokens.test.ts` counts every literal hex, font size and radius per file in `tests/css-tokens-baseline.json` (267 / 136 / 16), fails on a new one by file and line, and asks for the baseline to come down as literals go. brand.md now says the real size. | the ratchet itself |
| 10 | **Create on a phone** opened on an intro paragraph and an empty preview card before the first field. | A one-line intro; the preview hides on the first step on a phone (it has nothing to show yet). | source test |
| 11 | **The reels signed every house post "@botchelor ·"**, which is the site's own name on its own page. | The caption leaves out the show's own handle (`SHOW_HANDLE`); creators are still named. | caption test |
| 12 | **Watch had a second numbered pager** (for open rooms) beside the episodes' own, and two purple vote cards back to back. | Open rooms: their first row on desktop, "Show all N" opens the rest in place (a phone keeps the swipeable strip); the room groups are named for what they hold. Sunday's reveal, when its vote isn't open, moved below Latest episodes, away from the situation vote. | StripPager test |
| 13 | **The floating Feedback button sat over content**, a wide pill in the corner over cards and buttons. | A 44px circle with the chat icon; it says "Feedback" on hover or keyboard focus. The word stays in the button (clipped, not hidden), so it's still the button's name. | dock test |

## Found while checking the fixes

The production build, seeded with the demo season, in `npm run e2e:visual` (272 page states: every route at desktop and
phone, light and dark, as a visitor, an owner and a signed-in member) and in a browser walk of the changed pages:
no overflow, clipped text, small tap targets, broken images or unstyled fields anywhere. The only errors were 16 console
errors from admin and After Dark API routes this work doesn't touch (a visitor's 403 on /admin and /admin/analytics,
a 422 from an After Dark admin action, a 404 for /after-dark/subscribe). The walk turned up six more things, fixed in the
same change:

- **A tap on a picture's faces did nothing.** What sits on a picture is above its grade, so it was above the card's
  link overlay too; on a phone the faces are much of the card's picture. They now let the tap through (checked by a
  click at the faces' position, on desktop and phone).
- **The Reunion had two rules under the show's tabs**, 24px apart (live before this change too): the panel's own
  top rule is dropped where the tabs' underline already divides.
- **Watch's airing-soon cards were a fixed-width strip**: on the wide page, three of them left half the row empty, and
  eight would scroll sideways on desktop. From a tablet's width they're the same three-across grid as the rooms
  under them; a phone keeps the strip.
- **Home's questions sat flush left at a reading width** over a centred button, leaving the right third of the page
  empty; they're centred over the button and the footer now.
- **Grid rows of cards sat 44px apart against 12px between columns** (live before this change too): a card's own
  margins don't collapse in a grid. A balanced grid owns its gaps.
- **A watch room was 76rem**, the last width outside the two: it's `--page-wide` like an episode.

(A full-page screenshot on a phone shows the lazy pictures far down the page as their gradients; scrolled, every one
loads. Not a bug, but worth knowing when reading a contact sheet.)

## What's left, on purpose

- **The remaining literals** (267 hex, 136 font sizes) come down one area at a time, each pass lowering the baseline;
  the ratchet means they can only go one way. The 16 radii left are shaped on purpose (a speech bubble's tail, a
  sheet's top corners) or sized to their own height.
- **Emoji that are the show's voice** stay: award names, a format's or roleplay's own emoji, reactions, After
  Dark's labels.
- **A wide page's running text** keeps a reading measure (a card, a column or about 40rem), per brand.md Layout;
  new wide pages should check it.
- Not in scope: the information architecture (settled 2026-11-07) and After Dark's own surfaces, which have their own
  audits.
