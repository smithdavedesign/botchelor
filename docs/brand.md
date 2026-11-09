# Botchelor brand system & UI toolkit

One source of truth for how the product looks, reads and behaves. Everything here is already implemented
in [`app/globals.css`](../app/globals.css) and the sheets in [`app/ux/`](../app/ux/) as CSS custom properties and
component classes; this doc names the standards so new work stays consistent. No design dependency, no component
library: hand-written CSS (about 22,000 lines by November 2026, 13,800 of them in globals.css) and a handful of
presentational React components. At that size the tokens only hold if a test holds them: see Extending.

## Personality

Botchelor is a **comedic reality-TV dating show**, not a utility. The brand is playful, warm and a little
dramatic — pink-and-purple, a serif that feels like a title card, confident headlines. It never reads as a
chatbot or a form. The tone in copy is the show's voice: cheeky, concrete, kind. Safety and the money rules
are stated plainly, never buried.

## Color

Defined as tokens on `:root`, redefined under `@media (prefers-color-scheme: dark)`. Always use the token,
never a raw hex, so dark mode and future theming keep working. Pick by job, not by look:

| Token | Light | Dark | Use |
|------|-------|------|-----|
| `--ink` | `#241022` | `#f5e9f0` | Body text, headings |
| `--muted` | `#6a5a6f` | `#b49fbd` | Secondary text, meta, captions |
| `--paper` / `--paper-2` | `#fdf6f4` / `#fbe9ee` | `#130a16` / `#1d1024` | Page background, hero wash |
| `--card` | `#ffffff` | `#1e1324` | Card surfaces |
| `--accent` | `#e5356b` | `#ff5e8c` | Brand pink for **decoration**: outlines, active indicators |
| `--accent-text` | `#b52c59` | `#ff5e8c` | Brand pink for **text and links** (4.5:1 on every surface) |
| `--accent-btn` | `#c82f60` | `#ff5e8c` | Gradient start for filled buttons |
| `--accent-2` | `#7a36c9` | `#a98bff` | Secondary purple: gradient end, format badge |
| `--accent-ink` | `#ffffff` | `#130a16` | Label on any `--grad` or `--accent-btn` fill |
| `--line` | `#f0dde4` | `#342140` | Decorative borders and dividers (not control edges) |
| `--field` | `#9a7d91` | `#7a5f93` | Control edges: inputs, toggles, chips, reaction buttons (3:1) |
| `--focus` | `#e5356b` | `#ff5e8c` | Keyboard focus ring (3:1 on paper and card) |
| `--soft` | `#fde4ec` | `#2a1730` | Badge and hover fills |
| `--ok` / `--ok-text` | `#16a34a` / `#166534` | `#3ddc84` / `#3ddc84` | Success icon or delta / success text |
| `--warn` | `#92400e` | `#fbbf24` | Low-token warning |
| `--bad` / `--bad-text` | `#dc2626` / `#b91c1c` | `#ff6b6b` | Error icon or border / error text |
| `--grad` | `linear-gradient(120deg, --accent-btn, --accent-2)` | same | Wordmark, hero, primary buttons |
| `--photo-bg` | `#1d1030` | same | Behind a photo while it loads (a venue's, a reel's) |
| `--on-photo` | `#fff` | same | Words and rings laid on a photo, under its dark grade |

The two photo tokens are the one exception to "redefine it for dark": a photo looks the same in either theme, so
what sits on it does too.

**Contrast is checked, not assumed.** Every text token clears 4.5:1 on every surface it sits on, and every
control edge and focus ring clears 3:1, in light and dark, and again under `prefers-contrast: more`. When you
add a colour, check it on each surface it will sit on (a WCAG ratio script is enough) before you use it. Text
on a gradient fill uses `--accent-ink`, which flips to dark in dark mode: white on the bright dark-mode
gradient is only 2.9:1.

Other accessibility modes: `prefers-contrast: more` darkens `--muted` and `--field`. `forced-colors` (Windows
High Contrast) keeps a real border on buttons and badges, since gradients and shadows are dropped there.
`color-scheme` is set on `:root` so native controls (selects, scrollbars) follow the theme.

## Typography

- **Display:** Fraunces (serif), weights 600–800 — the "title card" look. Used for the wordmark, `h1`, and
  section-flavour headings (`.venue`).
- **Body/UI:** Inter, weights 400–700, with a system-font fallback stack.
- Loaded from Google Fonts (the one allowed stylesheet host) with `display=swap`.

Every type size is a fluid token: `clamp(min, preferred, max)` grows from the phone size to the desktop size,
so small text never drops below 12px on a phone, and a control's label shrinks a little in a narrow card rather
than wrapping badly. Use a token, never a fixed rem or px, for text. A size that's off the scale takes the nearest
step (2026-11-09: 100 literal sizes moved onto the scales, none by more than 1.6px at a phone's or a desktop's width).

```
--text-2xs      clamp(.75rem … .8rem)     pills, eyebrow labels
--text-xs       clamp(.8rem … .86rem)     meta, captions, chips
--text-sm       clamp(.84rem … .92rem)    secondary text, compact buttons, .small
--text-btn      clamp(.92rem … 1rem)      button labels
--text-base     1rem                      body text, exactly (a message, a caption that reads as body)
--text-md       clamp(1rem … 1.08rem)
--text-lg       clamp(1.08rem … 1.2rem)
--text-xl       clamp(1.3rem … 1.6rem)
--text-2xl      clamp(1.5rem … 2rem)
--text-display  clamp(2rem, 6vw, 3.1rem)  a page's h1
```

`h1` is `--text-display`, so the headline scales with the viewport. Inside a card that needs to shrink with its own
width, use container units (`cqi`) inside a clamp, as `.owner-actions` does.

**Icons** that stand alone in a button or a tile (a close ×, a back ‹, a ★, a ▾, an empty state's emoji) take the
icon scale. It's fixed, not fluid: an icon is drawn for the size of its target, so a 44px close button keeps its
1.6rem × on a phone. An `<Icon>` beside words takes their size (1em) instead.

```
--icon-xs  1rem     a glyph at body size: a pip, the × in a chip, ↑ in a send button
--icon-sm  1.25rem  header and toolbar glyphs: ⓘ, ⛶, a ★ rating, a reel's rail
--icon-md  1.6rem   a close × or a swipe button in a 44px+ target, review stars, a card's emoji
--icon-lg  2rem     a phone's back ‹, an empty state's emoji
--icon-xl  2.6rem   a stamp, or a figure standing in for a tile's missing picture
```

**One heading scale** (2026-11-08 audit): every `h2` is `--text-xl` and every `h3` `--text-lg`, on every page
(app/ux/catalog.css). Don't resize a section heading for one page; if a heading should read smaller, it's an
eyebrow. **Eyebrows** (`.kicker` and the labels styled like it: "Tonight", "Latest", "Previously") are one look:
`--text-2xs`, Inter 700, uppercase, 0.1em tracking. Fraunces is for `h1`, the wordmark and title-card names, not
for small labels.

## Spacing & shape

A spacing scale keeps vertical rhythm consistent. Prefer these over ad-hoc rems in new/updated components.

```
--space-1 .25  --space-2 .5  --space-3 .75  --space-4 1  --space-5 1.5  --space-6 2  --space-8 3  (rem)
--gutter clamp(1rem, 4vw, 1.25rem)   /* page side margin: 16px minimum on phones */
--shadow / --shadow-sm                /* card elevation, lifts on hover */
```

**Corners** are a scale too (2026-11-08: there were about fifteen different literal radii). Pick by what the thing
is, not by eye:

```
--radius-xs   4px    hairline bars, progress tracks, a bubble's tail corner
--radius-sm   8px    small chips, thumbnails, tags
--radius-md   12px   controls (--control-radius), inner panels, message bubbles
--radius      16px   cards
--radius-lg   22px   heroes, sheets, the big feature cards
--radius-pill 999px  pills and round buttons (50% for a circle)
```

**Layout: two widths** (2026-11-08 audit; there had been four). `main` is the reading column, `--page-read`
(46rem): forms, settings, an account page, legal text, a conversation. The pages you browse, home, Watch,
Characters, Companions, the showcase and creators, Reunion, Reviews and the graph, opt into `--page-wide` (72rem)
by putting `.page-wide` on their root element (`main:has(> .page-wide)` in app/ux/catalog.css); an episode is wide by
its own rule. Both are centred with `--gutter` sides, so phones never scroll sideways. A wide page still keeps
running text to a readable measure: a paragraph in a wide page should sit in a card, a column or a `max-width`
of about 40rem, never across the whole 72rem. The layout's `<main id="main">` is the only `main`: a page's root is
an `article` or a `div`, never another `main`. Two exceptions size themselves to their own layout and say why in a
comment: Swipe on a wide screen (62rem, the deck beside its intro, so the deck stays near the words) and admin's
tables (84rem).

**Short grids balance** (`.grid-balanced` with `--cols` from `balancedColumns(n)` in lib/grid-balance.ts): a row
of a few cards, such as the season's cast, never ends on one lonely card. Four is four in a row, five is three and
two, ten is four, four and two. Two a row on a phone.

## Components (the toolkit)

All in `globals.css`; reuse the class, don't restyle.

- **`.card`** — the primary surface: white, `--radius`, `--line` border, `--shadow-sm`, lifts to `--shadow`
  on hover. The unit most sections are built from.
- **`.badge`** — a pill (`--soft`/`--accent`). `.badge-format` takes `--accent-2` so a show-format reads as
  billing, distinct from the status badge beside it.
- **Buttons** — the default is a gradient pill (`--accent-ink` on `--grad`). `.secondary` is an outline, `.small`
  is compact, `.button-ghost` is a quiet outline. **`.link-button`** is an action that reads as a link inside a
  sentence ("Sign in", "Delete", "Watch again"): no fill, no shadow, no lift, underlined, 24px tap target. Use it
  instead of restyling a button inline. `.danger` makes it red. Every button shows a 3px `--focus` ring on
  `:focus-visible`.
- **Forms** — one control system for every field; never restyle a control, set its tokens. Labels wrap their
  control and stack above it.
  - **Tokens:** `--control-h` (44px, every single-line field *and* default button), `--control-h-sm` (36px,
    `button.small`), `--control-px`, `--control-radius` (12px), `--control-border` (1.5px `--field`, 3:1),
    `--control-ring` / `--control-ring-bad` (the focus halo). A component that needs a shorter control sets
    `--control-h` on it; the button's padding is derived from it, so text stays centred.
  - **Text fields:** every input that takes text, *whatever its type or none* (text, password, email, url,
    search, number, untyped), plus `textarea` (6rem, vertical resize) and `select` (same box, a token-coloured
    chevron, `width: auto` unless a layout widens it). Hover tints the edge, focus adds the ring,
    `:user-invalid` / `aria-invalid="true"` turns the edge `--bad` (only after the person has interacted),
    disabled sits on `--paper-2`, autofill keeps the card fill. On phones (≤640px) field text is at least 16px
    so iOS doesn't zoom on focus.
  - **Toggles:** checkboxes and radios are the native control at 18px in `--accent-btn` (`accent-color`); put
    one in `<label class="check">` with its words beside it. Sliders get `accent-color` and a 24px hit area.
    File pickers render their button as a secondary pill.
  - `fieldset` has `min-width: 0` so a group never pushes its card wider than a phone. Settings live in a
    `<details class="card settings">` so the builder stays uncluttered.
  - Live, desktop and phone: [`account-form-desktop.png`](screenshots/account-form-desktop.png) ·
    [`account-form-mobile.png`](screenshots/account-form-mobile.png).
- **`.avatar`** (`app/Avatar.tsx`): the character's reviewed portrait when they have one, otherwise a gradient
  tile with initials, seeded by character id so it never changes; house characters get a ring.
- **Pictures** (`app/VenuePhoto.tsx`, 2026-11-08 audit): anything that's an episode, such as Watch's cards, home's
  shelf or the real-date excerpt, shows its venue's photo with the couple's faces on it, never a blank tile.
  `VenuePhoto` lays the venue's reviewed backdrop (lazy) over the venue's own gradient, which is the picture
  until a venue has a photo, with a grade that darkens toward the bottom so faces and words read on any photo. A
  label on a picture is a `.photo-chip`. A mixer night is one card (its faces in a row), never one per table.
- **`.transcript` / `.afterglow` timelines** — chat-style turns: avatar + bubble, alternating left (side a)
  / right (side b), act headers in accent small-caps. Afterglow uses a warmer tint to read as texts.
- **`.boxscore`**, **`.venue`** (gradient backdrop + location), **`.ending`** (the verdict line).

## Icons

The interface's own markers are drawn icons, not emoji: `<Icon name="…" />` from [`app/Icon.tsx`](../app/Icon.tsx),
line icons on a 24px grid (2px stroke, round caps and joins) in `currentColor` at `1em`, so an icon takes its
text's colour and size and sits on its baseline. Emoji drew differently on every platform and read as unfinished
next to the type (2026-11-08 audit). Use an icon for the nav and its bell, badges and chips, a fact's marker (a
job, a hometown), locks, the feedback bubble and a button's play mark.

Emoji stay where they're **the show's voice, not the interface**: an award's or a format's own emoji, a
roleplay's icon, a reaction, anything a character writes. A new icon is a new name in `IconName` with its paths
in `PATHS`, drawn to the same grid. An icon is decorative (`aria-hidden`) because the words beside it carry the
meaning; pass `label` when it stands alone, and it becomes `role="img"` with that name.

## Accessibility standards

- **Landmarks:** `<header>`, `<nav aria-label="Primary">`, `<main id="main">`, `<footer>`. A **skip link**
  (`.skip-link`) jumps keyboard users past the header.
- **Focus:** every interactive element shows a `:focus-visible` ring; never remove focus styling without a
  replacement.
- **Motion:** `@media (prefers-reduced-motion: reduce)` neutralizes animation/transition for anyone who asks.
- **Contrast:** WCAG 2.2 AA: 4.5:1 for text, 3:1 for control edges and focus rings. The token table in Color is
  the palette; any new pairing must be checked before it ships.
- **Tap targets:** every button and link is at least 24px tall (WCAG 2.5.8). `.link-button` and the removable-chip × get that minimum from their own rules.
- **Live feedback:** status and error text inside a card sits in a `role="status"` region (`aria-live="polite"`), so a result is announced without a focus change. Errors add `.error`.
- **Images:** `Avatar` carries `role="img"` + an `aria-label` (or is `decorative` beside the name); a venue's
  photo has `alt=""` because the card's words say where it is; decorative gradients are CSS. An `Icon` is hidden
  unless it's given a `label`.
- **Hidden-but-spoken:** `.sr-only` for text assistive tech needs but the design doesn't show.

## Extending

1. Reach for a token (color, space, text, radius) before a literal; add a token rather than a one-off.
   `tests/css-tokens.test.ts` holds you to it: every literal hex colour, font size and corner in `app/**/*.css`
   is counted in `tests/css-tokens-baseline.json`, and a new one fails with its file and line. When you remove
   literals, lower the baseline (`UPDATE_CSS_BASELINE=1 npx vitest run tests/css-tokens.test.ts`) so they can't
   come back; never run it to let a new one in. On 2026-11-08: 267 hex, 136 font sizes, 16 radii (the radii left are
   shaped on purpose: a bubble's tail, a sheet's top corners).
2. New color? Define it on `:root` **and** under both dark-mode selectors.
3. New component? Give it a class here, make it work at phone width with the `--gutter`, and give it a
   `:focus-visible` state if it's interactive.
4. Keep `body` background explicit and the page free of horizontal scroll on a phone.
5. Run `npm run e2e:visual` (needs `CHROMIUM_PATH`). It opens every page at desktop and phone size in light and
   dark, as a spectator, an owner and a signed-in member, and fails on unstyled or short fields, a label and
   field sharing a line, tap targets under 24px, field text under 16px on a phone, light fields on the dark
   theme, sideways scroll, controls off the edge, broken images and console errors. Screenshots and a contact
   sheet land in `.data/visual/index.html`.
