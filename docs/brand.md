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
than wrapping badly. Use a token, never a fixed rem or px, for text.

```
--text-2xs  clamp(.75rem … .8rem)     pills, eyebrow labels
--text-xs   clamp(.8rem … .86rem)     meta, captions, chips
--text-sm   clamp(.84rem … .92rem)    secondary text, compact buttons, .small
--text-btn  clamp(.92rem … 1rem)      button labels
--text-md   clamp(1rem … 1.08rem)
--text-lg   clamp(1.08rem … 1.2rem)
--text-xl   clamp(1.3rem … 1.6rem)
--text-2xl  clamp(1.5rem … 2rem)
```

`h1` is `clamp(2rem, 6vw, 3.1rem)` so the headline scales with the viewport. Inside a card that needs to shrink
with its own width, use container units (`cqi`) inside a clamp, as `.owner-actions` does.

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
- **Buttons** — the default is a gradient pill (`--accent-ink` on `--grad`). `.secondary` is an outline, `.small`
  is compact, `.button-ghost` is a quiet outline. **`.link-button`** is an action that reads as a link inside a
  sentence ("Sign in", "Delete", "Watch again"): no fill, no shadow, no lift, underlined, 24px tap target. Use it
  instead of restyling a button inline. `.danger` makes it red. Every button shows a 3px `--focus` ring on
  `:focus-visible`.
- **Forms** — labels wrap their control; inputs/selects use `--field` borders (3:1, so the edge is visible) and a focus ring. Settings live
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
- **Contrast:** WCAG 2.2 AA: 4.5:1 for text, 3:1 for control edges and focus rings. The token table in Color is
  the palette; any new pairing must be checked before it ships.
- **Tap targets:** every button and link is at least 24px tall (WCAG 2.5.8). `.link-button` and the removable-chip × get that minimum from their own rules.
- **Live feedback:** status and error text inside a card sits in a `role="status"` region (`aria-live="polite"`), so a result is announced without a focus change. Errors add `.error`.
- **Images:** `Avatar` carries `role="img"` + an `aria-label`; decorative gradients are CSS.
- **Hidden-but-spoken:** `.sr-only` for text assistive tech needs but the design doesn't show.

## Extending

1. Reach for a token (color, space, text, radius) before a literal; add a token rather than a one-off.
2. New color? Define it on `:root` **and** under both dark-mode selectors.
3. New component? Give it a class here, make it work at phone width with the `--gutter`, and give it a
   `:focus-visible` state if it's interactive.
4. Keep `body` background explicit and the page free of horizontal scroll on a phone.
