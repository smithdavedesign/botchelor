# Botchelor brand system & UI toolkit

One source of truth for how the product looks, reads and behaves. Everything here is already implemented
in [`app/globals.css`](../app/globals.css) as CSS custom properties and component classes — this doc names
the standards so new work stays consistent. No design dependency, no component library: ~1,350 lines of
hand-written CSS and a handful of presentational React components.

## Personality

Botchelor is a **comedic reality-TV dating show**, not a utility. The brand is playful, warm and a little
dramatic — pink-and-purple, a serif that feels like a title card, confident headlines. It never reads as a
chatbot or a form. The tone in copy is the show's voice: cheeky, concrete, kind. Safety and the money rules
are stated plainly, never buried.

## Color

Defined as tokens on `:root`, redefined under `@media (prefers-color-scheme: dark)`. Always use the token,
never a raw hex, so dark mode and future theming keep working.

| Token | Light | Dark | Use |
|------|-------|------|-----|
| `--ink` | `#241022` | `#f5e9f0` | Body text, headings |
| `--muted` | `#6a5a6f` | `#b49fbd` | Secondary text, meta, captions |
| `--paper` / `--paper-2` | `#fdf6f4` / `#fbe9ee` | `#130a16` / `#1d1024` | Page background, hero wash |
| `--card` | `#ffffff` | `#1e1324` | Card surfaces |
| `--accent` | `#e5356b` | `#ff5e8c` | Primary brand pink: CTAs, links, active state |
| `--accent-2` | `#8b45e0` | `#a98bff` | Secondary purple: gradient end, format badge |
| `--line` | `#f0dde4` | `#342140` | Borders, dividers |
| `--soft` | `#fde4ec` | `#2a1730` | Badge/hover fills |
| `--ok` / `--bad` | `#16a34a` / `#dc2626` | `#3ddc84` / `#ff6b6b` | Box-score deltas, errors |
| `--grad` | `linear-gradient(120deg, --accent, --accent-2)` | same | Wordmark, hero, primary buttons |

**Contrast:** body and heading text on paper/card clears WCAG AA comfortably. `--muted` was darkened from
`#7a6a7e` to `#6a5a6f` so even the 0.78rem meta text (the transcript's "smiles wryly · amused") clears AA
(4.5:1). Keep any new muted-on-light text at `--muted` or darker.

## Typography

- **Display:** Fraunces (serif), weights 600–800 — the "title card" look. Used for the wordmark, `h1`, and
  section-flavour headings (`.venue`).
- **Body/UI:** Inter, weights 400–700, with a system-font fallback stack.
- Loaded from Google Fonts (the one allowed stylesheet host) with `display=swap`.

Type scale tokens (fluid where it helps readability across phone→desktop):

```
--text-xs .78rem  --text-sm .88rem  --text-base 1rem  --text-lg 1.15rem  --text-xl clamp(1.3,3vw,1.6rem)
```

`h1` is `clamp(2rem, 6vw, 3.1rem)` so the headline scales with the viewport.

## Spacing & shape

A spacing scale keeps vertical rhythm consistent. Prefer these over ad-hoc rems in new/updated components.

```
--space-1 .25  --space-2 .5  --space-3 .75  --space-4 1  --space-5 1.5  --space-6 2  --space-8 3  (rem)
--gutter clamp(1rem, 4vw, 1.25rem)   /* page side margin: 16px minimum on phones */
--radius 16px                         /* cards; pills use 999px; bubbles 14px */
--shadow / --shadow-sm                /* card elevation, lifts on hover */
```

Layout: content column caps at `46rem`, centered, with `--gutter` sides, so lines stay readable and phones
never scroll horizontally.

## Components (the toolkit)

All in `globals.css`; reuse the class, don't restyle.

- **`.card`** — the primary surface: white, `--radius`, `--line` border, `--shadow-sm`, lifts to `--shadow`
  on hover. The unit most sections are built from.
- **`.badge`** — a pill (`--soft`/`--accent`). `.badge-format` takes `--accent-2` so a show-format reads as
  billing, distinct from the status badge beside it.
- **Buttons** — `.primary` (gradient fill, `--accent-ink`), `.secondary` (outline), `.small` (compact).
  All have a visible `:focus-visible` ring (3px accent at 40%).
- **Forms** — labels wrap their control; inputs/selects use `--line` borders and a focus ring. Settings live
  in a `<details class="card settings">` so the builder stays uncluttered.
- **`.avatar`** — a pure gradient tile with initials (`app/Avatar.tsx`), seeded by character id so it never
  changes; house characters get a ring. No hosted images (see `docs/image-strategy.md`).
- **`.transcript` / `.afterglow` timelines** — chat-style turns: avatar + bubble, alternating left (side a)
  / right (side b), act headers in accent small-caps. Afterglow uses a warmer tint to read as texts.
- **`.boxscore`**, **`.venue`** (gradient backdrop + location), **`.ending`** (the verdict line).

## Accessibility standards

- **Landmarks:** `<header>`, `<nav aria-label="Primary">`, `<main id="main">`, `<footer>`. A **skip link**
  (`.skip-link`) jumps keyboard users past the header.
- **Focus:** every interactive element shows a `:focus-visible` ring; never remove focus styling without a
  replacement.
- **Motion:** `@media (prefers-reduced-motion: reduce)` neutralizes animation/transition for anyone who asks.
- **Contrast:** target WCAG AA (4.5:1 for normal text, 3:1 for large). `--muted` is the floor for secondary
  text on light surfaces.
- **Tap targets:** buttons/links keep ≥0.4rem vertical padding; pills and controls stay thumb-sized.
- **Images:** `Avatar` carries `role="img"` + an `aria-label`; decorative gradients are CSS.
- **Hidden-but-spoken:** `.sr-only` for text assistive tech needs but the design doesn't show.

## Extending

1. Reach for a token (color, space, text, radius) before a literal; add a token rather than a one-off.
2. New color? Define it on `:root` **and** under both dark-mode selectors.
3. New component? Give it a class here, make it work at phone width with the `--gutter`, and give it a
   `:focus-visible` state if it's interactive.
4. Keep `body` background explicit and the page free of horizontal scroll on a phone.
