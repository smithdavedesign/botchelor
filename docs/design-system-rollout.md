# The design system, applied to every page

The Botchelor Design System (Claude Design, four rounds, 2026-11-10/11; the artifact's `project/readme.md` is its
spec) was built from this app's own tokens and copy, then settled a handful of rules the app didn't yet follow. This
is the plan for bringing every page onto them, one PR a wave, each merged on the local gate (`npx tsc --noEmit -p .`
+ `npx vitest run --maxWorkers=1`). Its proposals (Characters as the hub, the first-run track, the intensity picker,
"Make more", the chapter reader) stay proposals until David calls them; nothing below changes what the product does,
only how it looks and reads.

What a page gets from the system: tokens only (the CSS ratchet, `tests/css-tokens.test.ts`), the two page widths,
drawn icons for the interface's chrome and emoji only in the show's voice, a whole-card link that is a real link,
states that say when a limit comes back and then the way around, and copy from `copy-deck.md` where the kit lifted
it from here.

## Wave 1: the foundation every page inherits (this branch, `design-system`)

- [x] **Themes.** Light / Dark / System on /account (`app/ThemeSetting.tsx`, `lib/theme.ts`), a cookie into
      `<html data-theme>`; the dark tokens in two identical blocks (`tests/theme.test.ts`).
- [x] **Header: five kinds of thing.** Tagline out (it's the hero's); the After Dark door as a night-coloured link
      in the tools with ↗, "Back to the show" on After Dark's host; the moon badge beside the wordmark there; one
      call to action (words → plus → menu); tighten at 1180, fold at 900, marks at 560 (`app/Nav.tsx`,
      `app/layout.tsx`, `app/globals.css`).
- [x] **Two meters, two units.** The show's dates: a clapper on the outline pill. After Dark's tokens: ◈ on a night
      pill (`.token-pill--dates` / `--tokens`).
- [x] **After Dark control edges.** `.after-dark-mode --field` `#241a3a` → `#7a5f93` (3.2:1 on the night card).
- [x] Icons: `clapper`, `arrowUpRight`, `chevronLeft`, `plus`. `docs/brand.md`: Header, Themes.

## Wave 2: the show's pages (branch `ds-wave-2`)

- [x] Home and Watch: live facts under the Tonight band ("2 dates filming · 7 watching", "Sunday's secret comes out
      in 20 min"): facts the page already has, never pressure (`app/TonightBand.tsx`).
- [x] Sunday's reveal: `Reveal` (`app/Reveal.tsx`), the envelope that unseals, the show's one signature motion.
      Sealed while the vote is in and the secret is minutes away; opened once it's out, and the card now stays on
      /watch while the result is fresh (it used to vanish at the airing). The unseal plays once per week per browser;
      prefers-reduced-motion opens it at once. The share stays in `CallsLine`, one card down.
- [x] `SeasonBanner` is the running arc under the header on home and /watch (season · month · night of 30 · days to
      the finale · the format), linking to the Reunion; the first week of a month keeps last season's finale strip.
- [x] Chrome emoji → icons: the season strips' 🎬, After Dark's 🌙 in headings and kickers (teaser, hub, subscribe,
      unavailable, account), the Companion Plan's 💬. The show's voice keeps its emoji (endings, formats, reactions,
      notification kinds, the theater's own tools).
- [x] Theater: the room already says its state in its own words (the "Replay" chip, "N watching", the phase chip with
      the pre-show countdown) and plays a replay with player controls; the kit's `RoomState` wording isn't adopted
      over the show's.
- [x] States: `LimitNotice` wording is already the deck's; `PageSkeleton` shapes exist; every `EmptyState` (Matches,
      Notifications, Companions) ends in a step.
- [x] The remaining emoji (the showcase filters' facet names, the Matches status chips, notification kinds) are the
      show's voice and stay.

## Wave 3: After Dark

- [ ] A price on every button that spends tokens (`◈ n`, or "included" under the subscription), from
      `lib/adult/settings.ts`; `TokenPacks` with "Best value" on /after-dark/tokens and the shop.
- [ ] The night's theater: the tool words fold under 760px; the player bottom right; the PIN gate, blocked and
      text-only states as the kit's components; the gallery's filter bar unchanged.
- [ ] The AI line once per page (`AiFiction`), the `AiTag` once per picture.

## Wave 4: proof

- [ ] `npm run e2e:visual` clean; live screenshots (desktop and phone, light, dark and After Dark) under
      `docs/screenshots/` and at the top of the README.
