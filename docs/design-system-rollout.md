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

## Wave 2: the show's pages

- [ ] Home: `LiveNow` presence in the Tonight band's footer ("Kaz is texting Ines now", "3 dates filming",
      "412 watched tonight"); the hero wash as the one wash.
- [ ] Watch, episode page, couple, theater: the prediction block's "Just watch" beside the picks; `RoomState`
      badges (Filming now · Aired · replay · Starts in 0:23); the venue chip; replay controls as a player.
- [ ] Sunday's reveal: `Reveal` (the envelope's unseal, the one signature motion) with `ShareCard` baked in;
      `CallsLine` and `BestCallers` as the kit draws them.
- [ ] `SeasonBanner` as the running arc under the header on spectator pages (today only the "season is over" strip).
- [ ] States: `PageSkeleton` shapes per route (profile · date · couple · list), `LimitNotice` copy ("when it comes
      back, then the way around"), every empty state ending in a step (`copy-deck.md`).
- [ ] Chrome emoji → icons on Matches, Messages, Characters, Create, Account, Notifications (the show's voice keeps
      its emoji); the five older tests that assert emoji updated with them.

## Wave 3: After Dark

- [ ] A price on every button that spends tokens (`◈ n`, or "included" under the subscription), from
      `lib/adult/settings.ts`; `TokenPacks` with "Best value" on /after-dark/tokens and the shop.
- [ ] The night's theater: the tool words fold under 760px; the player bottom right; the PIN gate, blocked and
      text-only states as the kit's components; the gallery's filter bar unchanged.
- [ ] The AI line once per page (`AiFiction`), the `AiTag` once per picture.

## Wave 4: proof

- [ ] `npm run e2e:visual` clean; live screenshots (desktop and phone, light, dark and After Dark) under
      `docs/screenshots/` and at the top of the README.
