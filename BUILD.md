# BUILD: Botchelor

## Plan

M4 of 4, final pass: "Seasons", made able to take money. A previous run built M4's seasons, badges, packs and allowance; see "Plan (M4 seasons and packs, built)" below. That run's 366 tests all pass. But it sold packs through Stripe Checkout Sessions created with `STRIPE_SECRET_KEY`.

The owner's note (David, 2026-10-13) replaces that:
- Use the Stripe **Payment Link**: `STRIPE_PAYMENT_LINK` / `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` (test mode), with `STRIPE_PRICE_LABEL` as the button text.
- Remove every use of `STRIPE_SECRET_KEY`, Checkout Sessions and the Stripe SDK.
- The webhook is optional; `STRIPE_WEBHOOK_SECRET` is set.
- `CONTACT_EMAIL` is set for the legal page.

REVENUE.md adds the must-haves before charging (checkout, privacy and terms pages, a refund path) and "the free first date and a '5 more dates, $4' button".

This plan applies gstack plan-eng-review's Step 0, 1. Architecture and 3. Test review to that change. Nobody was available to ask, so each question is answered here.

### Step 0: Scope challenge

1. **What already solves it.**
   - **M4 itself is built:**
     - `lib/seasons.ts`: lazy, idempotent season close, with badges for the top 3 per league.
     - `lib/allowance.ts`: free dates per season plus pack dates, each reserved atomically.
     - `episode_pack` orders.
   - **The webhook** (`app/api/webhooks/stripe`) already does three things:
     - verifies `Stripe-Signature` with `node:crypto`
     - grants on `checkout.session.completed` / `async_payment_succeeded` with `payment_status = paid`
     - maps the payment back to our random order id through `client_reference_id`, never the cookie

     **A Payment Link carries `client_reference_id` as a URL parameter into the same event**, so the grant path stays. Only checkout changes:
     - **Before:** create a Stripe session with the secret key.
     - **After:** create a pending order and hand back the link with `?client_reference_id=<order id>`.
   - **Test patterns stay:** `buy()` (checkout plus a signed webhook) and the before/after score snapshot.
2. **Minimum change set:**
   - **`lib/stripe.ts`.**
     - Delete `stripeCheckout`, `PaymentError`, `STRIPE_SECRET_KEY` and every `api.stripe.com` call.
     - Add `paymentLinkFromEnv()`: an https URL, or null.
     - Add `paymentLinkUrl(link, orderId)`.
     - Add `priceLabelFromEnv()`.
     - `verifyStripeSignature` stays.
   - **`lib/catalog.ts`.**
     - One pack, `pack_5`: "5 more dates", list price $4 (REVENUE.md).
     - `ON_SALE` is the items the Payment Link sells: just that pack.
     - Premium characters and frames stay in the catalog, so already-paid orders keep working, but they are **off sale**: one Payment Link sells one thing.
   - **`lib/rules.ts`:** `FREE_EPISODES_PER_SEASON` goes from 10 to **3**. See decisions.
   - **`POST /api/checkout {sku, attest}`:**
     - It is 422 unless the sku is on sale, and 503 when no valid link is configured. Nothing is stored in either case.
     - Otherwise it creates a pending order at the list price and returns 200 `{url}`.
     - There is no Stripe call, so there is no 502 and no Origin-based return URL. The Payment Link's after-payment redirect is set in the Stripe dashboard.
   - **`lib/payments.ts` `grantOrder`:** we no longer create the session, so the grant changes:
     - It requires `payment_link` on the session, currency USD, and `amount_total` ≥ the order's list price.
     - It records the session id and the amount Stripe actually charged.
     - A second payment through the same link URL (an already-used reference) grants a **new** pack order, keyed by its own session id.
     - A duplicate delivery of the same session grants nothing (`stripe_session_id` is unique).
   - **Pages:**
     - **`/shop`:** lists the pack, with the Buy button labeled by `STRIPE_PRICE_LABEL`, plus already-owned items. "Purchases open soon" shows when there is no link.
     - **Home and StartForm:** show "N of 3 free dates left this week", with a "5 more dates" link to the shop. Premium characters appear only to their owners.
   - **Legal and launch checks:** `/terms` and `/privacy` (REVENUE.md's launch checks).
     - Both render shared sections from `app/legal/sections.tsx`. `/legal` keeps rendering both, so old links and tests still work.
     - Copy changes from Stripe Checkout to "Stripe's hosted payment page (a Payment Link)", and says what Stripe receives.
     - Plus `app/robots.ts`, `app/sitemap.ts` and `app/opengraph-image.tsx`, all Next built-ins.
   - **`scripts/screenshots.mjs`:** also drives a pack purchase through the shop. The Payment Link is intercepted by Playwright, and the webhook is signed with a random secret made at runtime.

   **Deliberately NOT in this pass:**
   - **A second Payment Link** for premium characters or frames. They stay off sale until David makes one per item.
   - **Re-fetching the session from Stripe.** That needs the API key the owner removed. The signed event is trusted as delivered.
   - **Pinning the Payment Link id (`plink_…`).** We know the link's URL, not its id; see "Review".
   - **Refund webhooks, accounts, emails and promo codes.**
   - **Live mode:** first blocked by Vercel Hobby's no-commercial-use rule. The team is on Vercel Pro (2026-10-13), so it now waits only on a live Payment Link (see "Deploy").
3. **Complexity check: it doesn't trigger.**
   - New files: 3 small route-convention files (`robots.ts`, `sitemap.ts`, `opengraph-image.tsx`), 2 thin pages (`/terms`, `/privacy`) and 1 sections component.
   - Edited: about 10 files.
   - New services or classes: none. One is removed (the Checkout Sessions client).
4. **Search check** (WebSearch; stripe.com itself was unreachable through the sandbox's fetch proxy):
   - **[Layer 1]** Stripe documents `client_reference_id` as a Payment Link URL parameter that is copied into `checkout.session.completed`. It allows letters, digits, `-` and `_`, up to 200 characters, so our UUID order id fits. **Invalid values are silently dropped**, so the webhook must cope with a null reference: it logs, and the order is granted by hand.
   - **[Layer 1]** Every Checkout Session has `payment_link`, the id of the link that created it. Stripe's fulfilment guide says to fulfil from the webhook, not the success page, to expect duplicate and concurrent deliveries, and to record fulfilment per session id. `orders.stripe_session_id` is already `unique`.
   - **[Layer 2] Pitfall:** Stripe's sample re-fetches the session with the API key, but this app has no key. The signed event body (`amount_total`, `currency`, `payment_status`) is authenticated by the signature, so it is enough.
   - **[EUREKA]** A Payment Link URL with a reference can be paid **more than once**. With Checkout Sessions, one session paid once.
     - If someone pays twice through the same URL (Back, then pay again), the old "update the pending order" grant would silently swallow the second payment.
     - So the grant is "one paid order per Stripe session": the first payment fills the pending order, and a later one clones it as a new paid order.
   - **[Layer 1]** Next.js `robots.ts`, `sitemap.ts` and `opengraph-image.tsx` (`ImageResponse` from `next/og`) are file conventions, with no package to install.
5. **TODOS.** There is no `TODOS.md`. Follow-ups go under "What's left".
6. **Completeness.** Every new path gets a test:
   - checkout: 503, 422 off sale, and the URL format (existing query kept, no cookie in it)
   - webhook: no `payment_link`, an under-price amount, a repeat payment on one reference, and a duplicate session
   - the link env: https only, or null
   - the price label, the pages, robots, sitemap and the og image route
7. **Distribution.** No new artifact.

### 1. Architecture

```
 /shop ── BuyButton (text = STRIPE_PRICE_LABEL) ──► POST /api/checkout {sku: "pack_5", attest: true}
                                                     ├─ sku not on sale / no attest ──────────────► 422, nothing stored
                                                     ├─ no https STRIPE_PAYMENT_LINK ──────────────► 503, nothing stored
                                                     ├─ INSERT orders(id = random uuid, user, pack_5, episode_pack,
                                                     │                amount = list price 400, episodes = 5, 'pending')
                                                     └─ 200 {url: <payment link>?client_reference_id=<order id>}
 browser ─► Stripe-hosted Payment Link (test mode) ─► pays ─► Stripe redirects per the link's dashboard setting
 Stripe ─► POST /api/webhooks/stripe (signed; unchanged checks: secret set, ≤256 KB, v1 HMAC, 300 s tolerance)
            └─ completed | async_payment_succeeded, payment_status = paid
                 grantOrder(ref = client_reference_id, session, payment_link, amount_total, currency)
                   ├─ no ref / not a uuid / unknown order ───────────────────────► 200, logged, nothing granted
                   ├─ no payment_link, currency ≠ usd, amount < list price ──────► 200, logged ("mismatch")
                   ├─ UPDATE pending order → paid, session id, amount charged ───► granted
                   ├─ this session already recorded (duplicate delivery) ────────► already_paid
                   └─ ref already paid/refunded, pack, new session ──────────────► INSERT a cloned paid order
                                                                                    ON CONFLICT (session) DO NOTHING
 allowance = 3 free per season + Σ episodes of paid pack orders − pack dates used   (lib/allowance.ts, unchanged)
 points    = Σ predictions on aired episodes   (no join to orders anywhere, unchanged)
```

Decisions:
- **One thing on sale: "5 more dates", $4, as REVENUE.md recommends.**
  - The price lives in Stripe, on the Payment Link. The catalog's $4 is the list price and the minimum a payment must reach.
  - The button text comes from `STRIPE_PRICE_LABEL`. Without it, the button reads "Buy 5 more dates for $4".
  - **Assumption, recorded:** David's link sells 5 dates for $4 with quantity fixed at 1. If it doesn't, edit `PACK_5` in `lib/catalog.ts`.
- **3 free dates per creator per week** (it was 10). REVENUE.md says to sell "5 more dates" after a free first date. At 10 a week, almost nobody would ever need a pack.
  - 1 a week was tried, and it breaks real M2 flows: block a blind date, then get matched again. 4 M2 tests need more than one date per creator.
  - 3 keeps the first date free, lets a creator try a blind date and a house date, and still makes "5 more for $4" a real offer.
  - It is still the per-cookie cap on free-model calls.
- **Premium characters and frames are off sale, not deleted.** Any paid order keeps working: the premium date unlocks and the frame shows. But nothing can be bought without its own Payment Link.
  - No key was ever configured, so there are no such orders in production.
  - The landing page hides premium characters you don't own.
- **Anything Stripe sees is not a credential.** The link carries our random order id, never the `bz_uid` cookie (tested).
- **The webhook stays required for self-serve fulfilment.** Without `STRIPE_WEBHOOK_SECRET`, it answers 500 so Stripe retries. Orders stay pending, and David can grant one by hand with the SQL in "Run it locally".

Realistic production failures:

| Codepath | Failure | Handling |
|---|---|---|
| Checkout | `STRIPE_PAYMENT_LINK` unset or not https | 503 `payments_unavailable`, nothing stored; the shop says "Purchases open soon". Tested. |
| Payment Link | Stripe drops an invalid `client_reference_id` | Can't happen with a UUID, but the webhook logs the session id as `unknown_order`, and David grants by hand. Tested (null reference). |
| Payment Link | The buyer pays twice through the same URL | The second session gets its own paid order. Tested. |
| Payment Link | David's link costs less than $4, or allows a quantity | Not granted (`mismatch`, logged), or granted for one pack only. Docs say to keep quantity at 1 and the price at $4. |
| Payment Link | Another of David's links on the same Stripe account is paid with a botchelor reference | Granted only if it is at least the list price, in USD, from a Payment Link. Pinning the link id is listed under "Review". |
| Webhook | Duplicate or concurrent deliveries of one session | The pending row is updated once. A clone hits `unique(stripe_session_id)`, so nothing doubles. Tested by repeat deliveries. |
| Shop | The buyer returns before the webhook lands | The shop says the dates appear once Stripe confirms; the allowance is read live. |

### 3. Test plan

| Exit criterion | Tests |
|---|---|
| A season closes at its deadline and badges are awarded to the top 3 in each league | Built in the previous run and unchanged: `tests/seasons.test.ts`, "closes a season at its deadline and awards badges to the top 3 in each league" (1 ms before the deadline closes nothing; at the deadline, each league's top 3 get 1st, 2nd and 3rd), plus the lazy close over HTTP. |
| Buying an episode pack adds exactly N episodes to the creator and changes no spectator's score | `tests/packs.test.ts`, "buying pack_5 through the Payment Link adds exactly its 5 episodes to the creator and changes no spectator's score", rewritten for the Payment Link and failing until it is built:<br>• Three spectators on a board have 20, 10 and 0 points.<br>• The creator uses their 3 free dates, then buys through `POST /api/checkout`. The url must be the configured link with `client_reference_id` = the order id.<br>• Then a signed `checkout.session.completed` arrives with `payment_link`.<br>• `left` grows by exactly 5, every score and the board are unchanged, exactly 5 more dates go through, and the next is 429. |

New tests for the new paths:
- **Checkout** (`purchases.test.ts`):
  - 200 with the link plus `client_reference_id=<order id>`, keeping a query already on the link.
  - The pending order is stored at the list price, with no user id in the url or the body.
  - 503 when the link is unset, http, or not a URL.
  - 422 for premium characters, frames and unknown skus, with nothing stored.
  - A repeat buy is allowed, and smuggled prices are ignored.
- **Webhook** (`webhook.test.ts`):
  - Not granted without `payment_link`, below the list price, or in another currency.
  - The session id and the amount charged are recorded.
  - A second payment on the same reference adds a second pack.
  - The same session delivered twice grants once.
  - The 11 bad-signature cases stay, now against a pack order.
- **Env** (`webhook.test.ts`): `paymentLinkFromEnv` (https only, `STRIPE_PAYMENT_LINK` first, then `NEXT_PUBLIC_`) and `priceLabelFromEnv`.
- **Routes** (`routes.test.ts`): nothing in `app/`, `lib/` or `scripts/` mentions `STRIPE_SECRET_KEY`, `api.stripe.com` or `checkout/sessions`. This replaces "talks to Stripe from lib/stripe.ts only", which is stronger.
- **Pages** (`waitlist.test.ts`, `pages.test.ts`):
  - `/terms` has refunds, points and contact.
  - `/privacy` has storage, processors and the checkout ID disclosure.
  - `/legal` still has both.
  - `robots` allows `/` and disallows `/api/`.
  - `sitemap` lists the public pages.
  - The shop's `BuyButton` renders the label.
  - The og image route exports the right size and content type.

**Earlier tests that change, because the owner's note supersedes Checkout Sessions:**
- **Removed, as the code they tested is removed by the owner's instruction:**
  - the "Stripe Checkout client" tests (REST call, `PaymentError`, secret key on and off)
  - checkout's 502 and Origin return-URL tests

  Each is replaced by a link-based test above.
- **Changed for the new pricing and catalog:**
  - The M3 "buys every SKU" exit test buys every SKU **on sale** through the link. The off-sale items are granted the way David restores a purchase by hand. Every user's points and rank are still compared after each one.
  - Premium and frame tests get ownership the same way.
  - "409 already owned" becomes "off-sale items → 422".
  - "returns a Stripe Checkout url for every SKU" becomes the link url for the pack.
  - "a checkout session other than the one created" becomes "a session not from a Payment Link".
  - The pack tests use `pack_5`.
  - "prices every pack between $5 and $10" (ROADMAP) becomes "$4 for 5 dates" (REVENUE.md, the later and more specific decision, inside the $3–$8 the shop already used).
  - "never picked for a blind date" clears the creator's free-date counter between its 8 draws, because 3 free dates can't cover 8 draws.

## Plan (M4 seasons and packs, built)

> **Superseded in part by the Payment Link pass above.**
> - Checkout now hands out the owner's Stripe Payment Link instead of creating a Checkout Session.
> - One pack is sold: `pack_5`, 5 dates for $4. `pack_10` and `pack_25` are gone.
> - There are 3 free dates a week, not 10.
>
> Seasons, badges, the allowance and the migrations below are unchanged.

M4 of 4: "Seasons". M1–M3 are built, and their 323 tests stay green. This plan applies gstack plan-eng-review's Step 0 (scope challenge), 1. Architecture and 3. Test review to M4. Nobody was available to ask, so each question is answered here and the answer recorded.

### Step 0: Scope challenge

1. **What already solves part of M4.**
   - **Friend leagues exist (M2).** Members join through the invite link. The board ranks by points from episodes that aired that week, starting Monday 00:00 UTC. A season is that same week, so there is no new league model and no new week rule.
   - **Season standings can't change after the deadline:**
     - Points are derived from predictions and never stored (M1).
     - Picks lock atomically when the finale airs (`predictions` route, `for share`).
     - `revealed_at` is set once.

     So a season's result is a pure function of rows stamped before its deadline.
   - **Packs reuse M3's checkout, webhook and `orders`.**
     - A pack is a third catalog kind.
     - Its order row carries the number of episodes, priced from the catalog like `amount_cents`.
     - "Episodes bought" is the sum over paid pack orders, derived the same way ownership is.
     - The webhook and the signature check don't change.
   - **The episode route already gates before the model call** (the premium 402). The allowance check goes in the same place.
   - **Test patterns:** `buy()` (checkout plus a signed webhook) and the before/after snapshot from `purchases.test.ts`.
2. **Minimum change set:**
   - **`lib/seasons.ts`:**
     - `seasonAt(now)`. A season's id is its Monday, as `YYYY-MM-DD`.
     - `closeDueSeasons(db, now)`.
     - A league's past podiums, and a user's badges.
     - `weekWindow` moves here; `lib/leagues.ts` re-exports it.
   - **`lib/allowance.ts`:** `episodeAllowance`, `reserveEpisode` and `releaseEpisode`.
   - **`lib/db.ts`:**
     - New tables: `seasons`, `badges`, `free_episode_usage` and `pack_episode_usage`.
     - A new `orders.episodes` column.
     - The `orders.kind` CHECK is widened in place.
     - An index on `episodes.revealed_at`.
   - **`lib/catalog.ts`:** a new kind, `episode_pack`. "10 more dates" costs $5 and "25 more dates" costs $10.
   - **`POST /api/checkout`:** packs can be bought again, so they never get a 409. The order stores `episodes` from the catalog.
   - **`POST /api/episodes`:**
     - It reserves one date before the model call, or returns **429 `episode_limit_reached`** with `resets_at` and `shop_path`.
     - The reservation is released if nothing is saved (a 502, a 409 or an error).
   - **`GET /api/leagues/:id` and the league page:** they close due seasons first, then return `season {id, closes_at}` and `past_seasons` (the last 4 podiums).
   - **Pages:**
     - The league page shows the season, its closing time, and past podiums with medals.
     - `/feed` gets "Your badges".
     - The home page and `StartForm` show "N free dates left this week (+M from packs)". A 429 links to the shop.
     - The home page lists your characters, each with "Send on another date", backed by `listMyCharacters` in `lib/game.ts`.
       - *Added during the build.* Before this, the builder could only send a character created in the same visit. A pack's dates would have meant retyping a sheet for every date.
     - `/shop` gets a packs section and "N pack dates left".
     - `/legal` covers packs and badges, and the footer copy changes.

   **Deliberately NOT in M4:**
   - A cron job or any scheduler (see the search check).
   - A new API route. Pages read `lib`, as before, so there is no `GET` for the allowance or for badges.
   - Season numbers ("Season 1"). Seasons are labeled by their week ("week of Oct 12"), because launch day isn't known.
   - Emails or notifications when a season closes, and a season archive beyond the last 4 podiums.
   - Badge cosmetics on board rows. Leaderboard entries keep their M2/M3 shape.
   - Prizes of any kind, ever (a PRD non-goal).
   - Gifting packs, pack expiry and a refund webhook. Refunds are still done by hand, as in M3.
   - Per-league season lengths.
   - Accounts. The allowance is per anonymous cookie, so it is soft (see "Review").
3. **Complexity check: it triggers.** M4 adds 2 lib modules (`seasons`, `allowance`), 1 small component file (`app/Badges.tsx`) and 2 test files, and touches about 12 files. It adds no new external service and no new route.
   - Reductions applied:
     - No cron route, no new API route and no seasons page.
     - A badge's kind is just its place number (1–3); there is no badge-type table.
     - **Two counter tables instead of a credits ledger.**
     - Packs give no points, by construction.
   - This is a non-interactive run, so the recommendation is recorded and the work proceeds as reduced.
4. **Search check** (WebSearch):
   - **[Layer 1]** Vercel Cron is the built-in scheduler, and it is **not used here**.
     - On Hobby it runs at most once a day, anywhere within the scheduled hour (±59 min), with no retries. It can't close a season "at its deadline".
     - The planned live host (Netlify) has a different scheduler.
   - **[EUREKA]** A season doesn't need to be closed *at* its deadline, only *as of* it.
     - The standings depend only on rows stamped before the deadline: episodes aired in the window, picks locked when the finale airs, and members who joined before the deadline.
     - So the first read after the deadline (a league board, `/feed`) closes the season in one idempotent statement, with exactly the result a close on the second would give.
     - There is no scheduler to miss a run, and nothing depends on the host.
     - It needs one cutoff the M2 board doesn't have: `league_members.joined_at < deadline`. Otherwise a Monday joiner would land on last week's podium.
   - **[Layer 1]** Postgres `INSERT … ON CONFLICT DO UPDATE SET used = used + 1 WHERE used < limit RETURNING` is race-safe under READ COMMITTED: it takes a row lock and re-checks the latest version. So the allowance needs no advisory lock and no transaction API on `Db`.
   - **[Layer 2] Pitfall:** checking for allowance and then inserting after a multi-second model call would let parallel requests overspend. Instead, a date is reserved before the call and released if nothing is saved.
5. **TODOS.** There is no `TODOS.md`.
   - M1's "no rate limit on `POST /api/episodes`" is partly addressed: the weekly allowance caps model calls per cookie.
   - It stays open, because a new cookie gets a fresh allowance.
6. **Completeness.** Every new path gets a test:
   - 429, and release on a 502 and on a 409.
   - Season rollover and pack carry-over.
   - Repeat, refunded and pending packs.
   - Ties, zero points, a late joiner and out-of-window episodes.
   - Several missed seasons, and idempotent closing.
   - An M3 database upgrading in place.
   - Component markup.
7. **Distribution.** No new artifact.

### 1. Architecture (M4)

```
 POST /api/episodes {character_id, partner_id | blind}
   ├─ 404 / 422 / 402 premium (as before; nothing reserved)
   ├─ reserveEpisode(user, season = this week)
   │     1. free:  INSERT free_episode_usage(user, season, 1) ON CONFLICT DO UPDATE used+1 WHERE used < 10
   │     2. pack:  INSERT pack_episode_usage(user, 1)        ON CONFLICT DO UPDATE used+1
   │                 WHERE used < Σ orders.episodes of the user's paid episode_pack orders
   │     └─ neither ─► 429 episode_limit_reached {resets_at: next Monday 00:00 UTC, shop_path}  (no model call)
   ├─ showrunner ─✗─► 502 ┐
   ├─ insert     ─✗─► 409 ┼─► releaseEpisode: used − 1 on the row that was reserved
   └─ 200                  ┘   (thrown errors too, via finally)

 /shop ─► POST /api/checkout {sku: pack_10 | pack_25}          (no 409: packs stack)
            └─ orders(kind 'episode_pack', episodes = N from CATALOG) ─► Stripe ─► signed webhook ─► 'paid'
 dates bought = Σ episodes of paid pack orders (refunded ⇒ not counted). Nothing here touches predictions.

 GET /api/leagues/:id · /leagues/[id] · /feed
   └─ closeDueSeasons(now)
        weeks = distinct Monday(revealed_at) of episodes aired before this week's start
                and after the last closed season's end          (index on revealed_at; usually 0 rows)
        for each week, oldest first, ONE statement:
          week_points = Σ points of picks on episodes aired in [start, end)
          podium      = rank() over (partition by league order by points desc)
                        among members with joined_at < end and points > 0
          INSERT badges (season, league, user, place ≤ 3, points) ON CONFLICT DO NOTHING
          INSERT seasons (id, starts_at, ends_at)                 ON CONFLICT DO NOTHING
   └─ getLeague: + season {id, closes_at}, + past_seasons (last 4 podiums, names from profiles, no user ids)
```

Decisions:
- **A season is the leaderboard week.** It runs from Monday 00:00 UTC to the next Monday. Its id is the Monday (`2026-10-12`), and it closes at the next Monday 00:00 UTC.
- **Badges.**
  - 🥇 1st, 🥈 2nd and 🥉 3rd, per league, per season, by Olympic rank, so ties share a place:
    - 25, 25, 10 → 1st, 1st, 3rd.
    - 25, 10, 10, 5 → 1st, 2nd, 2nd, and nothing for the 5.
  - **A badge needs at least 1 point that week.** Otherwise a league where nobody played would give everyone a gold.
  - A badge also needs membership before the deadline.
  - Badges are stored, with their place and points, because a podium is a record. Names are read live from `profiles`.
  - A badge has no value, can't be bought, and nothing reads it for scoring.
- **Where badges show.** The league page lists each past season's podium. `/feed` lists your own badges across your leagues. Badges never appear on episodes, so creator anonymity is unchanged.
- **Free dates: 10 per creator per season.**
  - That is a generous weekly cadence (more than one a day), and it doubles as the per-cookie cap on free-model calls.
  - Every episode the creator asks for counts, blind or house. Failed generations don't count.
- **Episode packs.**
  - "10 more dates" costs $5; "25 more dates" costs $10.
  - Pack dates are spent only after the week's free ones. They never expire, and they stack with repeat purchases.
  - A refunded pack's dates stop counting, and the remainder floors at 0.
  - **Packs add episodes, never points.** A purchase writes only `orders`. Spending a date writes only the usage counters, which count dates and nothing else.
- **Migration.**
  - `orders.kind`'s CHECK is replaced in place by a `DO` block, only when the old definition lacks `episode_pack`.
  - New tables are `create table if not exists`.
  - All of it runs inside the same advisory-locked bootstrap, so M1–M3 databases upgrade in place.

Realistic production failures:

| Codepath | Failure | Handling |
|---|---|---|
| Season close | Nobody visits for weeks | The first read closes every missed season, oldest first, with the same result as an on-time close. Tested. |
| Season close | Two requests close it at once | Badges and the season row are `ON CONFLICT DO NOTHING`, and both requests compute the same podium. Tested by closing twice. |
| Season close | Someone joins a league on Monday morning | The `joined_at < deadline` cutoff keeps them off last week's podium. Tested. |
| Season close | A finale airs in Sunday's last milliseconds and commits after the close ran | That episode's points miss the podium (`revealed_at` is the transaction start). The window is a few ms. Listed under "Review". |
| Allowance | Two tabs ask for dates at once with 1 left | The conditional upsert lets exactly one through; the other gets 429. The logic is tested; real concurrency relies on Postgres's documented re-check (PGlite has a single connection). |
| Allowance | The model call fails | The date is released in `finally`. Tested for 502 and 409. |
| Allowance | The process dies between reserve and release | That date is lost for the week. Accepted; listed under "Review". |
| Allowance | A request straddles Monday 00:00 | It is reserved and released against the same week's row. |
| Packs | The webhook is late | The shop says pack dates appear once Stripe confirms. The allowance is read live. |
| Packs | A refund after the dates were used | `pack_left` floors at 0. Nothing is clawed back. |

### 3. Test plan (M4)

| Exit criterion | Tests |
|---|---|
| A season closes at its deadline and badges are awarded to the top 3 in each league | `seasons.test.ts`, "closes a season at its deadline and awards badges to the top 3 in each league":<br>• Two leagues share members. The scores are 25, 20, 15, 10, 5 and 0, from two aired episodes with drama questions.<br>• `closeDueSeasons` at the deadline minus 1 ms closes nothing and awards nothing.<br>• **At the deadline** it closes that season, exactly once. Each league's podium is its own top 3 (1st, 2nd, 3rd, with names and points), and the 4th member gets nothing.<br>• A member placed in both leagues holds both badges.<br>A second test does the same over HTTP. With last week's data, the first `GET /api/leagues/:id` closes the season lazily and shows the podium, idempotently. |
| Buying an episode pack adds exactly N episodes to the creator and changes no spectator's score | `packs.test.ts`, one case per pack SKU:<br>• Three spectators in a league have 20, 10 and 0 points. A creator has used 3 of their 10 free dates.<br>• After the creator buys the pack through checkout and a signed webhook, `left` grows by exactly N. Every spectator's `/api/me` points and the league board are unchanged.<br>• Then exactly 7 + N more dates go through `POST /api/episodes`, and the next one is refused with 429. The scores are still unchanged. |

Other codepaths covered:
- **Allowance:**
  - Exactly 10 free dates, then 429 with `resets_at` and `shop_path`. The 429 makes no model call and stores nothing.
  - The limit is per creator, and blind dates count.
  - Free dates reset the next season. Pack dates carry over, and free dates are spent first.
  - A 502 or a 409 doesn't spend a date, and a 404, 422 or 402 doesn't reserve one.
  - Parallel reservations never exceed the limit.
  - Anonymous viewers see the full free allowance and no packs.
- **Packs:**
  - Priced between $5 and $10, with a whole number of episodes.
  - Checkout stores `episodes` from the catalog, and a smuggled `episodes` field is ignored.
  - Buying twice stacks, with no 409.
  - A pending order adds nothing, and neither does a webhook with a bad signature. A refunded order stops counting.
- **Seasons:**
  - `seasonAt` edges: Monday 00:00, Sunday's last millisecond, and a month boundary.
  - Ties share places (1, 1, 3 and 1, 2, 2), and zero points earn no badge.
  - A late joiner is excluded, and only episodes aired inside the window count.
  - Several missed seasons close oldest first, and closing is idempotent.
  - The league view has `season {id, closes_at}`.
  - No user ids appear in `past_seasons` or in badges.
- **Data:**
  - The `orders.kind` CHECK accepts `episode_pack`, and `episodes` must be positive.
  - **An M3 database** with the old CHECK upgrades in place.
  - A badge's place is 1–3 and its points are positive. The usage counters can't go negative.
- **Components:** `Podium` and `BadgeList` render medals, names, places and league names, and no user ids.

**One earlier test changes, because M4's roadmap supersedes it:**
- `routes.test.ts`, "sells nothing but premium house characters and cosmetic frames" (M3), now also accepts the `episode_pack` kind that M4 adds.
- Its name check (no point, coin, credit, token, gem, boost, rank, bet, odds, score or cash in any SKU or name) is unchanged, as is every route check.
- The `tests/helpers.ts` reset also clears the new tables.

## Plan (M3, built)

> **Superseded in part by the owner's Payment Link note (M4 final pass).**
> - `lib/stripe.ts` no longer creates Checkout Sessions, and nothing reads `STRIPE_SECRET_KEY`.
> - Premium characters and frames are off sale: owned ones still work, but checkout refuses them.
> - The webhook's signature check is unchanged. Its grant now matches Payment Link sessions (see "Plan" at the top).

M3 of 4: "Paid items and a landing-page test". M1 and M2 are built, and their 224 tests stay green. This plan applies gstack plan-eng-review's Step 0 (scope challenge), 1. Architecture and 3. Test review to M3. Nobody was available to ask, so each question is answered here and the answer recorded.

### Step 0: Scope challenge

1. **What already solves part of M3.**
   - **Identity.** The anonymous `bz_uid` cookie is the buyer. No accounts are added.
   - **Premium characters reuse the house-character path.**
     - House characters are already rows in `characters` (`is_house`), seeded by `ensureSchema`.
     - `POST /api/episodes {partner_id}` already picks one.
     - A premium house character is the same kind of row with a `premium_sku`, behind an ownership check. There is no new partner or episode path.
   - **Points can't be bought by construction.** They are derived from predictions on aired episodes (M1's EUREKA), so there is no balance a purchase could write to. Purchases write only `orders`. The exit-criterion test proves this; the design guarantees it.
   - **The league board** (`getLeague`) is the only place a user's display name is shown, so that is where frames appear.
   - **Reused patterns.** `lib/model.ts` (a plain `fetch` client, configured from env, swappable in tests) is the pattern for Stripe. `handle`/`readJson`/`parseBody` handle the JSON routes. The M1 route-listing test is extended.
2. **Minimum change set for the three exit criteria and the deliverables:**
   - **Catalog** (`lib/catalog.ts`, pure data and safe to import from the browser). Four one-time items in USD:
     - Two premium house characters: Vesper Lark ($3) and Captain Odalys Reyes ($5).
     - Two profile frames: Rose and Gold ($2 each).
     - Every item is one of two kinds, `house_character` or `frame`. No item sells points, odds, rank or episodes.
   - **Orders** (`lib/payments.ts`). An `orders` table, where ownership means a `paid` order. A refunded order is set to `refunded` by hand and no longer counts.
   - **Stripe** (`lib/stripe.ts`), the only file that talks to Stripe.
     - It creates a Checkout Session through the REST API with `fetch`: form-encoded, inline `price_data` (so David needs no product setup in Stripe), and `Idempotency-Key` set to the order id.
     - It verifies webhook signatures with `node:crypto`.
   - **`POST /api/checkout {sku, attest: true}`** → 200 `{url}`, or 409 `already_owned` / 422 / 503 `payments_unavailable` (no key) / 502 (Stripe error, nothing left stored).
   - **`POST /api/webhooks/stripe`**:
     - It verifies the signature, then grants the order on `checkout.session.completed` or `checkout.session.async_payment_succeeded` when `payment_status = paid` → 200.
     - A bad signature → 400, and nothing is granted. A missing secret → 500, so Stripe retries once it is set.
   - **The premium gate in `POST /api/episodes`.**
     - A premium partner the creator doesn't own → 402 `premium_character_locked`, before any model call.
     - Blind dates fall back only to the three free house characters.
   - **Frames.** League board entries get a `frame`: the latest frame bought, shown as a border on the name. The key is omitted when there is no frame, so M2 responses are unchanged.
   - **Pages:**
     - `/shop`: buy buttons, owned items, checkout success and cancel notices.
     - `/legal`: terms of sale, refunds and privacy, which Stripe needs before live mode.
     - The **landing page** `/`, rewritten for the AI-friendly roleplay audience, with the waitlist and the existing character builder below.
     - Nav and footer links.
   - **Waitlist.** `POST /api/waitlist {email, attest, community?, ref?}` → always 201 `{ok: true}`, so it can't be used to check whether an email is on the list.
     - It stores one row per lowercased email.
     - `?ref=` on the landing URL is kept with the signup, so David can see which community's link converts (the "landing-page test").

   **Deliberately NOT in M3:**
   - Episode packs, seasons and badges (M4).
   - Restoring purchases on another browser. That needs accounts; for now it's done by hand with SQL, from the Stripe receipt.
   - Refund and dispute webhooks. Refunds are made in the Stripe dashboard, and the order is set to `refunded` by SQL.
   - Choosing among owned frames. The latest purchase is worn.
   - Emailing the waitlist, visit analytics and A/B variants.
   - Stripe Customers, subscriptions, coupons and Stripe Tax (a paid add-on).
   - A payment SDK, and a `GET` catalog API. Pages read `lib` directly, as `/feed` does.
   - Deploy config for a second host. The code stays host-agnostic (see Infrastructure).
3. **Complexity check: it triggers.** M3 adds 10 files and touches about 12. It adds **1 new external service (Stripe)** and 1 small error class (`PaymentError`, like `ModelError`). The count comes from the roadmap's nouns: items, checkout, webhook, landing page, waitlist.
   - Reductions applied:
     - One legal page instead of three.
     - No `GET /api/shop`, and no frame picker.
     - **No processed-events table:** the order row is the idempotency key.
     - No refund webhook.
     - The landing page is `/` and keeps the builder, so no route moves.
   - Non-interactive run, so the recommendation is recorded and the work proceeds as reduced.
4. **Search check** (WebSearch):
   - **[Layer 1]** The Stripe SDK's `webhooks.constructEvent` is the built-in. It is **not used here**, for two reasons:
     - This sandbox can't install packages.
     - The repo already calls its model with plain `fetch`.

     Stripe documents manual verification:
     - `HMAC-SHA256(secret, t + "." + rawBody)`, hex.
     - Accept any `v1`, since secret rotation sends several.
     - Compare in constant time.
     - Reject stale timestamps; the SDK default is a 300 s tolerance.
     - Ignore `v0`.

     Each rule has a test.
   - **[Layer 1]** App Router route handlers don't pre-parse bodies, so `await req.text()` is the raw payload. No `bodyParser` config is needed. The route runs on the Node runtime, which has `node:crypto`.
   - **[Layer 2]** The usual webhook pitfalls are duplicate deliveries, slow handlers that Stripe retries, and the test/live secret mix-up. Here the handler does one `UPDATE`, and duplicates are no-ops.
   - **[Layer 2]** Vercel Hobby forbids "any method of requesting or processing payment from visitors". Netlify's free plan allows commercial use. **So Stripe stays in test mode on Vercel Hobby, and live mode needs a commercial-use host** (requested from David in `.provision`).
   - **[EUREKA]** Never send the session cookie to Stripe.
     - `bz_uid` is a bearer credential. Putting it in `client_reference_id` (the usual tutorial pattern) would hand every buyer's login to anyone with Stripe dashboard access.
     - Instead, a random **order id** goes to Stripe. The webhook maps it back to the buyer and re-checks the session id, amount and currency we stored.
     - The same row makes the webhook idempotent. `UPDATE orders … WHERE status = 'pending'` turns a duplicate delivery or a replay into a no-op, with no events table.
5. **TODOS.** There is no `TODOS.md`. Follow-ups are listed under "What's left".
6. **Completeness.** Every new error path gets a test (400, 402, 409, 413, 422, 500, 502, 503), along with the abuse cases: a tampered body, a stale timestamp, a wrong secret, a duplicate delivery, an amount mismatch, an unknown order, a foreign session, smuggled amount or points fields, and a points SKU.
7. **Distribution.** No new artifact. It is the same Next.js app. Hosting for live payments is an infrastructure request, not code.

### 1. Architecture (M3)

```
 /shop  ──BuyButton──►  POST /api/checkout {sku, attest}
                          ├─ zod: sku ∈ CATALOG (no points SKU can exist) ─────────────────► 422
                          ├─ no STRIPE_SECRET_KEY ──────────────────────────────────────────► 503, nothing stored
                          ├─ already owns sku ──────────────────────────────────────────────► 409
                          ├─ INSERT orders(id=random uuid, user, sku, kind, price from CATALOG, 'pending')
                          ├─ lib/stripe: POST api.stripe.com/v1/checkout/sessions
                          │     client_reference_id = order id (never the cookie), Idempotency-Key = order id
                          │     └─ error ─► DELETE pending order ─► 502
                          ├─ UPDATE orders SET stripe_session_id = session.id
                          └─ 200 {url} ─► browser goes to Stripe Checkout ─► back to /shop?checkout=success
 Stripe ──► POST /api/webhooks/stripe   (raw text, ≤ 256 KB)
              ├─ no STRIPE_WEBHOOK_SECRET ─► 500 (Stripe retries)
              ├─ verify Stripe-Signature (any v1, constant-time, |now - t| ≤ 300 s) ─✗─► 400, grants nothing
              ├─ checkout.session.completed | async_payment_succeeded, payment_status = 'paid'
              │     UPDATE orders SET status='paid' WHERE id = client_reference_id AND status='pending'
              │       AND stripe_session_id = session.id AND amount_cents = amount_total AND currency = currency
              │     (0 rows: duplicate, unknown order or mismatch ─► logged, nothing granted)
              └─ 200 {received: true}
 ownership = EXISTS(orders paid)   ──► POST /api/episodes {partner_id: premium} ─ not owned ─► 402
                                   ──► league board: frame = latest paid frame (LATERAL), rank/points untouched
 points = Σ predictions on aired episodes  (no join to orders anywhere)
 /  landing ─► WaitlistForm ─► POST /api/waitlist ─► waitlist(email PK lowercased, community, ref) ─► 201 {ok:true}
```

Decisions:
- **What a purchase is.** A one-time, non-transferable digital item tied to this browser's anonymous session.
  - Losing the cookie loses the item. The shop says so before you buy, and `/legal` says how to get it restored.
  - Restoring means David moves the order to the new browser in SQL, using the Stripe receipt.
  - Buying needs the 18+ attestation in the request.
- **Premium house characters.**
  - They are labeled house characters, seeded like the free three, and checked by the same content filter test.
  - Only their owner can choose them as a partner, and they never appear in someone else's blind date.
  - Spectators watch and predict their episodes for free.
- **Frames.**
  - A frame shows only on league boards, where display names already appear. It never appears on episodes, which would undo creator anonymity.
  - It is derived at read time (the latest paid frame). There is no stored "equipped" column.
- **Prices.** They live in `CATALOG` on the server and are sent to Stripe as `price_data`. The client sends only a `sku`, and smuggled `amount`, `price_cents` or `points` fields are ignored.
- **Landing page.**
  - `/` speaks to AI-friendly roleplayers: "written by AI, on purpose".
  - It explains the show and the free game, shows the cast with premium prices, collects waitlist signups for Season 1 (M4's weekly seasons) and keeps the builder below.
  - The `ref` slug is the only attribution. There are no analytics or third-party scripts.
- **Legal page.** It is a plain draft, and needs counsel before live mode (REVIEW.md). It covers:
  - who may use the show
  - that points have no value and can't be bought
  - what you buy
  - refunds (on request within 14 days)
  - what is stored, and who processes it (Stripe, the model provider)
  - the contact address, from `CONTACT_EMAIL`
- **Migration.** `characters.premium_sku` is added with `ADD COLUMN IF NOT EXISTS`. `orders` and `waitlist` are `CREATE TABLE IF NOT EXISTS`. Both run in the same locked bootstrap, so M1 and M2 databases upgrade in place.

Realistic production failures:

| Codepath | Failure | Handling |
|---|---|---|
| Checkout | Stripe is down or the key is wrong | 502, and the pending order is deleted. The user can retry. The key is never logged. Tested. |
| Checkout | No key configured yet | 503 `payments_unavailable`, nothing stored. The shop shows "purchases open soon". Tested. |
| Checkout | Two tabs pay for the same item | Both orders become `paid`, and the item is owned once. The duplicate is a manual refund. A buy for an owned item → 409. Listed under "Review". |
| Webhook | Stripe delivers the same event twice, or late | `WHERE status = 'pending'` makes the repeat a no-op → 200. Tested. |
| Webhook | Wrong secret (test vs live), proxy rewrites the body | 400 and nothing granted; Stripe shows failed deliveries. Tested with a wrong secret and a tampered body. |
| Webhook | Event arrives after the user is back on `/shop` | The shop says "your item appears once Stripe confirms; refresh". Ownership is read on every request. |
| Webhook | Async payment method (`payment_status = unpaid`) | Not granted until `checkout.session.async_payment_succeeded`. Tested. |
| Webhook | Event for another app on the same Stripe account | Unknown order id → 200, ignored, logged. Tested. |
| Premium | Buyer clears cookies | The item is lost until David restores it by SQL. Disclosed before purchase. Accounts are listed under "What's left". |
| Waitlist | Someone checks whether an email is on the list | The same 201 `{ok: true}` either way. Tested. |
| Hosting | Payments taken on Vercel Hobby | Not allowed. Stripe stays in test mode until David picks a commercial-use host. |

### 3. Test plan (M3)

| Exit criterion | Tests |
|---|---|
| Buying any item never changes a user's points balance or leaderboard rank (a test buys every SKU and compares before and after) | `purchases.test.ts`, "buys every SKU and leaves every user's points and league rank unchanged".<br>A league of three has 20, 10 and 0 points. The middle and last players each buy **every** SKU through checkout and a signed webhook. After each purchase, every member's `/api/me` points and the board's `(rank, name, points)` are unchanged, and the item is owned. The buyer then dates a premium character, and points are still unchanged. |
| A webhook with a bad signature returns 400 and grants nothing | `webhook.test.ts`. Each of these returns **400**, the order stays `pending`, and the item isn't owned (no 402 unlock, no frame): wrong secret, tampered body, missing header, header without `v1`, `v0` only, a stale timestamp (replay), a future timestamp, a `v1` for another timestamp, a garbage header, a non-hex `v1` and a non-numeric timestamp. A correctly signed control event grants the item. |
| Points have no purchase, cash-out or transfer route (route listing test) | `routes.test.ts`:<br>• The only routes whose path looks like money are exactly `POST /api/checkout` and `POST /api/webhooks/stripe`.<br>• No route mentions points, rank or cash-out, and no mutating route mentions transfers.<br>• `/api/me` stays GET-only.<br>• Every catalog item is a `house_character` or a `frame`, and none is named like points or currency.<br>• `POST /api/checkout` with `points`, `points_100`, `coins`, `boost` or `rank_up` → 422, nothing stored, Stripe not called.<br>• Only `lib/stripe.ts` contacts Stripe, and no payment SDK is imported. |

Other codepaths covered:
- **Checkout:**
  - 200 `{url}` for every SKU, with the order stored at the catalog price.
  - Stripe receives the order id (not the cookie), the success and cancel URLs, and the price.
  - The response contains no user id.
  - 409 when already owned; 422 without `attest`; 503 with no key; 502 on a Stripe failure, with no order left behind.
  - Smuggled `amount` and `price_cents` are ignored.
  - A first-time visitor gets a session cookie.
  - An abandoned checkout doesn't block a retry.
- **Stripe client:**
  - URL, auth header, form body and `Idempotency-Key`.
  - Non-2xx, network error, a missing `url`, a non-https `url` and a non-JSON body → `PaymentError`.
  - The key is never in an error message.
  - No key → disabled.
- **Signature verification** (pure): rotation (several `v1`), the tolerance edges, the exact signed-payload format, and spaces and extra schemes in the header.
- **Webhook:**
  - A duplicate delivery grants once.
  - `unpaid` doesn't grant, then `async_payment_succeeded` does.
  - Unknown, missing or malformed order id → 200, nothing granted.
  - Amount, currency or session mismatch → 200, not granted.
  - Unrelated event types → 200.
  - Invalid JSON, or a non-event, with a valid signature → 400.
  - A body over the limit → 413.
  - No secret configured → 500, nothing granted.
- **Premium characters:**
  - Not owned → 402, with no model call and nothing stored. Owned → 200 with a house partner.
  - Ownership is per user; a `refunded` order locks it again.
  - Blind dates never pick a premium character.
  - Their sheets pass the content filter.
- **Frames:**
  - A frame appears on the board after a purchase, and the latest one wins.
  - It is absent for others and for a pending order.
  - Rank and points are unchanged.
- **Waitlist:**
  - 201 `{ok: true}`. The email is stored trimmed and lowercased, with `community` and `ref`.
  - A duplicate in a different case gives the same 201 and one row.
  - 422 for a bad email, a missing attestation, an over-long community or a bad `ref`, with nothing stored. 415 for a non-JSON body.
- **Data:**
  - The CHECK lists for order status and kind accept every TS value and reject others.
  - Amounts must be positive, and the currency must be USD.
  - Waitlist emails and Stripe session ids are unique.
  - The premium characters are seeded, adult and labeled.
  - An M1 database upgrades in place.
- **Pages:**
  - The landing page renders the waitlist.
  - `/legal` has refunds, "points can't be bought", the processors, and a contact address or a plain "not yet".
  - The layout links to `/legal` and `/shop`.

**Two earlier tests change, because M3's roadmap supersedes them:**
- `routes.test.ts`, "has no route whose path takes a payment" (M1). M3 *adds* payment routes, so it becomes "no payment route except exactly the two M3 routes". The allowlist is exact (method and path), and the points, transfer and SDK checks are unchanged.
- `db.test.ts`, "seeds exactly three labeled, adult house characters" (M1). It now counts the three *free* house characters and checks the premium ones separately (seeded, adult, labeled, priced).

## Plan (M2, built): decisions still in force

- **Creators are anonymous.** `creators` (display names) appears in an episode response only once every creator of the episode has POSTed `/api/reveal`. The names are joined in SQL only at that point, so no later code can leak them.
- **Blind dates** pair with a random OC from another creator, with no block in either direction, and otherwise with a random *free* house character (M3). An explicit `partner_id` must be a house character, so nobody can aim at a chosen stranger.
- **Roles.** The host (who asked for the date) airs the finale. The partner creator sees the episode, but can't predict or air it.
- **Hidden** is derived at read time: 3 or more distinct reporters. Creators still see a hidden episode, and it can't air while hidden.
- **Blocks are per episode.** They follow the visible characters of that episode, never the person, so nothing links a creator's other episodes.
- **Leagues.**
  - The UUID id doubles as the invite link, with a soft cap of 50 members.
  - The week runs from Monday 00:00 UTC, and points count in the week the episode airs.
  - Ranks are Olympic (`rank()`). M3's `frame` sits beside an entry and never in its ordering.
- **Drama question.** Chosen and answered by the model: `leaves_first` or `rejected`, answered `a`, `b` or `neither`. A right drama pick earns 5 points; the ending pick earns 10.
- **Disclosure.** `ai_generated: true` is on every episode response, and the AI disclosure and crisis links are on every episode page and in the footer.
- **Migrations** are `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS`, inside the advisory-locked bootstrap.

## Plan (M1, built): decisions still in force

- **Stack:** Next.js 16 route handlers under `/api/*`, Postgres via `pg` (Neon), PGlite for tests and local runs, and zod for untrusted model output.
- **Identity:** an anonymous random UUID in the `bz_uid` cookie (`HttpOnly`, `SameSite=Lax`). It never appears in a response body, and since M3 it never goes to Stripe either.
- **Model:** one OpenAI-compatible showrunner call (Gemini free tier by default; any LiteLLM or OpenRouter endpoint works via `LLM_*`).
  - Output must parse, match the zod schema, fit 400 words and pass the content filter. One retry, then 502 with nothing stored.
- **Points** are computed from picks on aired episodes, never stored, so there is no write path for points.
- **Schema** is applied on first use under `pg_advisory_xact_lock`. Every query is parameterized.
- **The host can't predict** their own episode; they see the ending as soon as it's written.

## Status (M4 done: the MVP can take money)

`npm test` runs **386 tests in 19 files, and all pass**.
- **M1–M3:** their exit tests all pass. The M3 payment tests were rewritten for the owner's Payment Link (see "Earlier tests that change" in the Plan). The M1, M2 and seasons test files are untouched.
- **Builds:** `npm run typecheck` and `npm run build` are clean on Next.js 16.4. The build prerenders `/robots.txt`, `/sitemap.xml` and `/opengraph-image`.
- **Mutation check:** the new grant tests catch three deliberately broken builds:
  - the Payment Link and price checks switched off
  - repeat payments never granted
  - one-time items cloned
- **Browser run:** `npm run screenshots` also buys a pack through the production build's shop in a real browser, at both sizes. The Buy button opens the Payment Link with the order reference, a signed `checkout.session.completed` arrives, and the shop shows "plus 5 pack dates".

### What the product does now

1. **`/` is the landing page** for AI-friendly roleplayers:
   - The pitch: "written by AI, on purpose; you can't steer it".
   - Steps, a link to the feed, and a **Season 1 waitlist** (email, optional community, 18+ attestation, `?ref=` kept).
   - The character builder: 18+, the content filter, then a blind date or a house character.
   - **3 free dates a week; the first date is always free.**
   - When a creator is down to their last date, the dates line offers "5 more dates" (the `STRIPE_PRICE_LABEL` text), linking to the shop.
   - Returning creators see their characters, with "Send on another date".
2. **One showrunner call** writes the episode, with the drama question. Invalid output gets one retry, then a 502 with nothing stored. No date is spent on a failure.
3. **`/episodes/[id]`**:
   - AI disclosure and crisis links for everyone.
   - Creators see the whole episode; spectators see a teaser and predict (10 + 5 points).
   - Mutual-consent identity reveal, the report button and blocks.
4. **`/feed`**: your dates, the latest episodes, your leagues, **your badges** and your block list.
5. **`/leagues/[id]`**: **seasons** (M4).
   - The weekly board, plus when this season closes (Monday 00:00 UTC).
   - The last 4 podiums, with 🥇🥈🥉 for the top 3. Ties share a place.
   - The first visit after the deadline closes the season.
6. **`/shop`** sells one thing, **"5 more dates"**, through the owner's **Stripe Payment Link**:
   - The Buy button's text is `STRIPE_PRICE_LABEL`. It asks for the 18+ and terms checkbox.
   - The app stores a pending order, then sends the browser to the link with `?client_reference_id=<order id>`.
   - Stripe's signed `checkout.session.completed` adds 5 dates. Pack dates never expire, are used after the free ones, and never add points.
   - Without a valid link, the shop says "Purchases open soon" and the button is disabled.
   - Premium characters and frames are off sale. Anyone who owns one sees it there as "Yours".
7. **`/terms`, `/privacy`, and `/legal` (both on one page):**
   - who may use it
   - points and badges have no value
   - what you can buy, the 14-day refund policy, what's stored, what Stripe gets and who processes it
   - the contact address (`CONTACT_EMAIL`)
8. **`/robots.txt`, `/sitemap.xml` and an og:image** for link previews.
9. **Points and badges are free.** They can't be bought, cashed out or transferred, and carry no prizes. Nothing bought changes anyone's points, picks or rank.

API (all JSON; identity is the anonymous `bz_uid` cookie; no user id is ever returned):

| Route | Result |
|---|---|
| `POST /api/characters` | 201 character, or 422 / 400 / 413 / 415 |
| `POST /api/episodes` `{character_id, partner_id}` or `{character_id, blind: true}` | 200 full episode (with `ai_generated: true` and the drama fields), or 402 `premium_character_locked` / 404 / 409 `match_unavailable` / 422 / **429 `episode_limit_reached` `{resets_at, shop_path}`** / 502 |
| `GET /api/episodes` | 200 `{episodes: [...]}`: the feed, newest 30 |
| `GET /api/episodes/:id` | 200 the episode as this viewer may see it, or 404 |
| `POST /api/predictions` `{episode_id, pick, drama_pick?}` | 201, or 403 / 404 / 409 / 422 |
| `POST /api/episodes/:id/reveal` (air the finale, host only) | 200 `{ending, predictions, ai_generated}`, or 403 / 404 / 409 |
| `POST /api/reveal` `{episode_id}` (identity consent) | 201 / 200, or 403 / 404 / 422 `name_required` |
| `POST /api/reports` `{episode_id, reason?}` | 201 / 200, or 404 / 422 |
| `POST` / `DELETE /api/blocks` `{episode_id}` | 201 / 200, or 404 / 422 |
| `POST /api/profile` `{name, attest: true}` | 200 `{name}`, or 422 |
| `POST /api/leagues` `{name}` · `GET /api/leagues/:id` · `POST /api/leagues/:id/join` | as in M2. Board entries may carry `frame`; the league view has `season {id, closes_at}` and `past_seasons` (M4) |
| `GET /api/me` | `{points}` (all-time) |
| **`POST /api/checkout`** `{sku: "pack_5", attest: true}` | 200 `{url}`: the Payment Link with `client_reference_id`. Or 415, 422 (not on sale, or no attestation), or 503 `payments_unavailable` (no https link). Nothing calls Stripe. |
| **`POST /api/webhooks/stripe`** (Stripe only, signed) | 200 `{received: true}`, or 400 `invalid_signature` / `invalid_payload`, 413, 500 `webhook_not_configured` |
| **`POST /api/waitlist`** `{email, attest: true, community?, ref?}` | 201 `{ok: true}` (new or repeat), or 415 / 422 |

### Exit criteria

| Milestone | Exit criterion | Status | Test |
|---|---|---|---|
| M1 | `POST /characters` age 17 → 422 and stores nothing; age 18 → 201 | PASS | `tests/characters.test.ts` |
| M1 | Bio with a blocklisted real-person name or a sexual term → 422 | PASS | `tests/characters.test.ts` |
| M1 | `POST /episodes` → 200 with setting, two goals, twist, ending in the enum, body ≤ 450 words | PASS | `tests/episodes.test.ts` |
| M1 | Invalid JSON twice → 502 and no episode stored | PASS | `tests/episodes.test.ts` |
| M1 | `POST /predictions` after the reveal → 409 | PASS | `tests/game.test.ts` |
| M1 | A matching pick gives exactly 10 points; a mismatch gives 0 | PASS | `tests/game.test.ts` |
| M1 | No endpoint accepts a payment or a points transfer (route listing) | PASS, as amended by M3: no payment route except exactly the two M3 routes, and no points transfer | `tests/routes.test.ts` |
| M2 | A creator's name never appears in the episode API until both creators POST `/reveal` | PASS | `tests/identity.test.ts` |
| M2 | A leaderboard for 3 users with 20, 10, 0 returns them in that order | PASS | `tests/leagues.test.ts` |
| M2 | `POST /reports` → 201, and the episode leaves the feed after 3 distinct reporters | PASS | `tests/reports.test.ts` |
| M2 | Every episode response includes `ai_generated: true` | PASS | `tests/disclosure.test.ts` |
| M3 | Buying any item never changes a user's points balance or leaderboard rank (buys every SKU, compares before and after) | PASS. Every SKU on sale is bought through the Payment Link; each off-sale SKU is granted by hand, the way a purchase is restored. Both are compared after each one. | `tests/purchases.test.ts` "buys every SKU (on sale: through the Payment Link; off sale: by hand) and leaves every user's points balance and league rank unchanged" |
| M3 | A webhook with a bad signature returns 400 and grants nothing | PASS | `tests/webhook.test.ts` "a webhook with a bad signature returns 400 and grants nothing (exit criterion)" (11 bad-signature cases plus a signed control) |
| M3 | Points have no purchase, cash-out or transfer route (route listing test) | PASS | `tests/routes.test.ts` "points have no purchase, cash-out or transfer route (M3 exit criterion)", plus the amended money-route allowlist |
| **M4** | **A season closes at its deadline and badges are awarded to the top 3 in each league** | **PASS** | `tests/seasons.test.ts` "closes a season at its deadline and awards badges to the top 3 in each league": 1 ms before the deadline nothing closes; at it, each league's own top 3 get 1st, 2nd and 3rd. The lazy close over HTTP is tested too. |
| **M4** | **Buying an episode pack adds exactly N episodes to the creator and changes no spectator's score** | **PASS** | `tests/packs.test.ts` "buying pack_5 through the Payment Link adds exactly its N episodes to the creator and changes no spectator's score". It runs checkout, the link with the order reference, then a signed `checkout.session.completed`. `left` grows by exactly 5, the scores and the board are unchanged, exactly 1 free + 5 pack dates go through, then 429. |

### Run it locally

```bash
npm install          # works with npm_config_ignore_scripts; no native builds, no new dependencies in M4
npm test             # 386 tests, under a minute; no network, no secrets
npm run dev          # http://localhost:3000
npm run screenshots  # needs CHROMIUM_PATH; builds, plays a sample season, buys a pack, saves docs/screenshots/
```

- **Database.** Without `DATABASE_URL`, the app uses a file-backed Postgres (PGlite) in `.data/`, which is gitignored. An older `.data/` is upgraded in place on the first request.
- **Model.** Without a model key, `POST /api/episodes` returns 502 (it fails closed). Export a free Google AI Studio key as `GOOGLE_API_KEY` in your shell, or point `LLM_*` at another free OpenAI-compatible endpoint.
- **Payments (test mode).** Without `STRIPE_PAYMENT_LINK`, the shop shows "Purchases open soon" and checkout returns 503. To try a purchase locally:
  1. In your shell, export your **test-mode** Payment Link as `STRIPE_PAYMENT_LINK`, and the button text as `STRIPE_PRICE_LABEL`.
  2. Run the free Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe --events checkout.session.completed,checkout.session.async_payment_succeeded`. It prints a signing secret; export it as `STRIPE_WEBHOOK_SECRET`.
  3. Start `npm run dev` from that shell, press Buy in `/shop`, and pay with one of Stripe's documented test cards. The 5 dates appear on `/shop` once the event arrives.
- **Granting a pack by hand.** Use this if the webhook isn't set up, or Stripe dropped the reference:
  1. Find the payment in the Stripe dashboard. Its `client_reference_id` is our order id.
  2. Run: `update orders set status = 'paid', paid_at = now(), stripe_session_id = '<cs_… id>' where id = '<order id>' and status = 'pending';`
  3. For a payment with no reference:
     - Ask the buyer to press Buy once more in the browser they use, but not pay. Then ask them to send you the `client_reference_id` from the Stripe page's address bar.
     - That is a fresh order id, safe to share. Mark that pending order paid with the SQL in step 2.
     - Never ask for the `bz_uid` cookie. It is the browser's login.
- **Refunds.** Refund in the Stripe dashboard, then call `refundOrder(db, orderId)` (`lib/payments.ts`) from a script, or run the same SQL. It caps the dates already used, so the refunded pack's dates stop counting.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection (Neon free tier) | Unset: local PGlite. Required on Vercel. |
| `GOOGLE_API_KEY` | Gemini API key (free tier) | Unset: episodes return 502 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Another OpenAI-compatible endpoint. `GOOGLE_API_KEY` is only ever sent to Google. | Gemini, `gemini-3.5-flash-lite` |
| `STRIPE_PAYMENT_LINK` (or `NEXT_PUBLIC_STRIPE_PAYMENT_LINK`) | The owner's Stripe Payment Link for "5 more dates". It must be https, and is read per request. | Unset or not https: purchases closed (503) |
| `STRIPE_PRICE_LABEL` | The Buy button's text (at most 60 characters) | "Buy 5 more dates for $4" |
| `STRIPE_WEBHOOK_SECRET` | Verifies `Stripe-Signature` on `/api/webhooks/stripe` | Unset: webhook answers 500, so Stripe retries |
| `CONTACT_EMAIL` | Support address on `/terms`, `/privacy` and `/legal` | Unset: "will be posted here before purchases open" |
| `VERCEL_PROJECT_PRODUCTION_URL` | Set by Vercel itself; the absolute URL in `robots.txt`, `sitemap.xml` and og:image | `http://localhost:3000` |

There is no `STRIPE_SECRET_KEY`. The app holds no Stripe API key, and `tests/routes.test.ts` fails if any file in `app/`, `lib/` or `scripts/` mentions one.

### Deploy on a free tier

1. **Vercel Pro + Neon free + Stripe test mode** (current, 2026-10-16). Payments run on a dedicated Stripe account (product "Botchelor: 5 more dates", $4 one-time); while its Payment Link is a test-mode one, production shows "Purchases open soon" (`lib/stripe.ts`; `STRIPE_ALLOW_TEST_LINK=1` only for a test run such as `npm run e2e:live`):
   - The Vercel project `botchelor` has `DATABASE_URL`, `GOOGLE_API_KEY`, `STRIPE_PAYMENT_LINK`, `NEXT_PUBLIC_STRIPE_PAYMENT_LINK`, `STRIPE_PRICE_LABEL`, `STRIPE_WEBHOOK_SECRET` and `CONTACT_EMAIL` from the credential broker.
   - Vercel auto-detects Next.js, so no `vercel.json` is needed.
   - The schema is applied on the first request, under an advisory lock. There is no migration step, and M4 adds no schema change.
   - **In the Stripe dashboard (test mode), on the Payment Link** (requested in `.provision`):
     - Sell "5 more dates" for $4, with quantity fixed at 1.
     - Under "After payment", redirect to `https://botchelor.com/shop?checkout=success` (the canonical domain since 2026-10-16: the buyer's session cookie lives there).
   - **The webhook endpoint:** `https://botchelor.vercel.app/api/webhooks/stripe` (still served; never point it at a URL that redirects, since Stripe doesn't follow redirects), with the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   - `/terms`, `/privacy` and `/legal` are rendered per request, so `CONTACT_EMAIL` shows once set. `robots.txt` and `sitemap.xml` are built with the production URL.
2. **Taking real money** (live mode). **Live since 2026-10-16** on botchelor's dedicated account `acct_1UR4AVAFlr4wKG3U` (product `prod_VRyMwmKYkCcYnb`, link `plink_1UR4Q3AFlr4wKG3UmmuW1Z7E`, webhook `we_1UR4Q5AFlr4wKG3U5oebgkvY` → `https://botchelor.com/api/webhooks/stripe`). Its restricted key is the keychain's `vault/botchelor/STRIPE_RESTRICTED_KEY_LIVE` (ai-stack `provision` prefers a repo's own key over the shared one, which tiebreak uses). How it was done, to redo or change it:
   - David activates the Stripe account for live mode, sets its public details (website, statement descriptor), and stores a live **restricted** key (Products, Prices, Payment Links and Webhook Endpoints, write) with `~/ai-stack/bin/secrets add botchelor STRIPE_RESTRICTED_KEY_LIVE` (not the shared `provision token stripe-live`).
   - Then `provision stripe botchelor 4 --live --success-path '/shop?checkout=success' --webhook /api/webhooks/stripe --label 'Buy 5 more dates for $4'` (single quotes: zsh would swallow `$4`) makes the live product, price, link and webhook, puts the link and webhook secret in Vercel and redeploys. A live link isn't hidden, so Buy appears. The product was renamed "Botchelor: 5 more dates" afterwards (provision names it after the repo).
   - (Superseded: the Netlify free plan was the $0 alternative while the team was on Hobby.)
   - The code is host-agnostic: only `lib/db.ts` checks `VERCEL`, to refuse a throwaway local database there.
   - Off Vercel, `VERCEL_PROJECT_PRODUCTION_URL` isn't set. Set it by hand to the public host name, or robots.txt, the sitemap and og:image say localhost.
   - This is requested in `.provision`, as is a counsel review of the terms.

### What's left

- **Before charging real money (David):**
  - The four `.provision` requests: Payment Link settings, webhook events, removing any old `STRIPE_SECRET_KEY`, and a commercial-use host.
  - Counsel on SB 243, contest and gambling rules, and the terms (REVIEW.md).
  - A check of the live flow at botchelor.com as a stranger (REVENUE.md). It can't be done from this sandbox.
- **Payments follow-ups:**
  - **Pin the Payment Link's id.** Grant only sessions whose `payment_link` is ours. That needs the `plink_…` id as an env var (see "Review").
  - **Accounts, or an email sign-in, to restore purchases across browsers.** Today it's done by hand from the Stripe receipt.
  - **A refund and dispute webhook.** `charge.refunded` doesn't carry `client_reference_id`, so it needs the payment intent stored.
  - **A Payment Link per premium character and frame,** if they should be sold again. The code still honours owned ones.
  - **Cleanup of abandoned `pending` orders.** They are harmless, but they accumulate.
- **Hardening carried over:**
  - Rate limits on `POST /api/reports`, `POST /api/checkout` and `POST /api/waitlist`. `POST /api/episodes` is capped by the weekly allowance, per cookie.
  - A moderation queue, consent withdrawal and feed pagination.
  - A real test-mode payment on the deployed site. The local browser run stands in for Stripe's page.
- **Product (REVENUE.md):** run the hand-run mini-season, then offer "5 more dates" to creators whose episodes got a reaction. The waitlist's Season 1 email is sent by hand (SQL export).

## Infrastructure

The code reads every value from environment variables, and no test needs a real one. Test fakes are built at runtime from a prefix and a filler.

| `.provision` line | Gives | Used by |
|---|---|---|
| `neon db botchelor` (M1) | `DATABASE_URL` (Postgres, Neon free tier) | `lib/db.ts` (`pg` pool, max 3). Prefer Neon's pooled connection string. |
| `gcp key botchelor generativelanguage.googleapis.com` (M1) | `GOOGLE_API_KEY`, restricted to the Gemini API | `lib/model.ts` |
| `vercel project botchelor` (M1) | The Vercel project, with every stored value as env | Hosting (Hobby, $0; test-mode payments only) |
| `request "GCP project check …"` (M1) | David confirms no billing account is linked to the key's project | Keeps Gemini on the free tier |
| `request "Stripe account for botchelor …"` (M3) | A Stripe account in test mode and `STRIPE_WEBHOOK_SECRET`. The M3 `STRIPE_SECRET_KEY` part is **superseded**: David's 2026-10-13 note set a Payment Link instead, and the app reads no Stripe key. | `app/api/webhooks/stripe/route.ts` |
| Set by David (2026-10-13): `STRIPE_PAYMENT_LINK`, `NEXT_PUBLIC_STRIPE_PAYMENT_LINK`, `STRIPE_PRICE_LABEL`, `STRIPE_WEBHOOK_SECRET`, `CONTACT_EMAIL` in Vercel | The test-mode Payment Link, its button text, the webhook secret and the support address | `lib/stripe.ts`, `app/shop`, `app/api/checkout`, `app/api/webhooks/stripe`, `app/legal/sections.tsx` |
| **`request "Stripe Payment Link settings for botchelor …"`** (M4, in `.provision`) | The link sells "5 more dates" at $4 with quantity 1, and redirects to `/shop?checkout=success` after payment | `lib/catalog.ts` `PACK_5` (5 dates, $4 floor) |
| **`request "Stripe webhook for botchelor …"`** (M4) | Confirms the endpoint and its two `checkout.session.*` events | `app/api/webhooks/stripe/route.ts` |
| **`request "Remove STRIPE_SECRET_KEY …"`** (M4) | No unused Stripe key left in the Vercel env | (nothing reads it) |
| **`request "Commercial-use host for botchelor …"`** (M3, repeated in M4) | David's call before live mode: Netlify free ($0, commercial use allowed) or Vercel Pro (paid). Also counsel for the terms. | Taking real payments |

No new database, API key or paid service is needed for M4.

## Review

Self-review of the M4 Payment Link pass. It checks `git status` / `git diff` against gstack's pre-landing checklist ("Review Categories", "Fix-First Heuristic"), and every changed file was read. Findings use the format `[severity] (confidence) file — finding`.

**Fixed during review (tests re-run: 386 passing, typecheck and build clean):**
- **[P2] (8/10) BUILD.md: the first draft of "grant a pack by hand" asked a buyer for their `bz_uid` cookie.** That cookie is the browser's login.
  - **Fix:** the buyer presses Buy again and sends the fresh `client_reference_id`, which is only an order id.
- **[P3] (9/10) `app/globals.css`: `.price` was dead after the shop stopped printing catalog prices.** Removed.
- **[P3] (8/10) `lib/payments.ts`: an extra "session already recorded?" query on the mismatch path could never change the outcome.** Removed.

**Pass 1, CRITICAL categories, with nothing open:**
- **SQL and data safety.**
  - Every value is a bound parameter.
  - The grant is one conditional `UPDATE … WHERE status = 'pending'`, then an `INSERT … ON CONFLICT (stripe_session_id) DO NOTHING`. Neither is a read-then-write without a constraint behind it.
  - `orders.stripe_session_id` is `unique`, so one Stripe session can't be recorded twice.
- **Races.**
  - Two deliveries of one session: the second `UPDATE` waits on the row lock, re-checks `status = 'pending'`, finds it paid and returns `already_paid`.
  - Two deliveries of a repeat payment race on the unique session id.
  - Each path is covered by a repeat-delivery test, and mutation-checked.
- **Trust boundaries.**
  - The event is trusted only after the HMAC check, which is unchanged and still covered by 11 bad-signature tests.
  - The amount floor and the 5 dates come from `CATALOG`, never from the client or Stripe metadata. Smuggled `amount`, `episodes` and `points` are ignored (tested).
  - The Payment Link URL carries our random order id, never the cookie (tested).
  - The link itself must be https (tested).
  - `STRIPE_PRICE_LABEL` is rendered as escaped React text and capped at 60 characters.
- **XSS and CSRF.**
  - There is no `dangerouslySetInnerHTML`.
  - `POST /api/checkout` is JSON-only (415 otherwise), so a cross-site form can't create orders, and an order costs nothing anyway.
- **Enum completeness.** No new enum value: `episode_pack` already existed.
  - The sku changed from `pack_10`/`pack_25` to `pack_5`. Every consumer reads by `kind` (allowance, refunds) or through `catalogItem`.
  - A legacy `pack_10` order would still count its dates.
  - A legacy reference to one gets `mismatch` and is logged. None exist, because no Stripe key was ever configured.

**Open (ASK category: design decisions, left for David):**
- **[P2] (6/10) `lib/payments.ts`: the grant can't tell David's Payment Links apart.**
  - It checks that the session came from *a* Payment Link, at no less than $4, in USD. It can't check that it was *this* link, because the app knows the link's URL, not its `plink_…` id.
  - **The abuse case:** a buyer opens our link, copies `client_reference_id`, and appends it to another, cheaper-or-equal Payment Link on the same Stripe account. Two conditions: the webhook endpoint must listen to account-wide events, and David must have another link at $4 or more.
  - **The cost:** the buyer pays David at least $4 and gets 5 dates, so it's no loss in money.
  - **Fix:** an optional `STRIPE_PAYMENT_LINK_ID` env var, compared with the session's `payment_link`. About 5 lines and a test. Left out because the owner didn't set one.
- **[P3] (7/10) A shared link-with-reference pays for its original buyer.** A Payment Link URL carrying our order id can be paid by anyone it is sent to, and each payment adds 5 dates to the original browser. That makes it a gift, not a loss.
- **[P3] (6/10) `lib/catalog.ts`: the pack size lives in code; the price lives in Stripe.**
  - If David's link sells something other than "5 dates for $4", one of two things happens:
    - under $4: buyers aren't granted (logged as `mismatch`)
    - more dates than 5: buyers get 5
  - **Mitigation:** `.provision` asks David to set the link to exactly this, and BUILD.md says to edit `PACK_5` otherwise.
- **[P3] (6/10) Free dates went from 10 to 3 a week.** This follows REVENUE.md ("free first date, then 5 more for $4"); 1 a week broke M2's real block-and-rematch flows. David may want a different number. It's one constant, `FREE_EPISODES_PER_SEASON`.
- **[P3] (5/10) Premium characters and frames are off sale, not deleted.** Their code paths (402 gate, frames on boards) stay tested and honour owned orders. Deleting them is a product call.
- **[P3] (5/10) No rate limit on `POST /api/checkout`.** Each call stores a pending row; there is no Stripe call or cost. This joins the open rate-limit items.

**Informational:**
- `api.stripe.com` was unreachable through the sandbox's fetch proxy. The Payment Link facts come from WebSearch summaries of Stripe's docs: `client_reference_id` rules, `payment_link` on sessions, and fulfilment advice.
- The screenshot script's webhook secret is random per run and is only passed to the app it starts. Playwright answers for Stripe's payment page, so no request leaves the machine.

## Review (M3)

> Kept for the record. The Checkout Session findings below (session-id match, Origin-based return URLs, two open checkouts) concern code that the Payment Link pass removed. Their replacements are covered in "Review" above.

This is a self-review of the M3 change set against gstack's pre-landing checklist ("Review Categories", "Fix-First Heuristic"), plus an independent adversarial review pass by a second agent that ran the tests and the typecheck itself. Nothing is committed yet (M1–M3 are untracked), so `git diff` only shows `README.md`, and every M3 file was read directly. Findings use the format `[severity] (confidence) file — finding`.

**Fixed during review (tests re-run: 323 passing, typecheck and build clean):**
- **[P2] (7/10) `lib/payments.ts`: a grant wasn't tied to the session we created.** Any signed `checkout.session.*` event carrying a pending order's id, amount and currency would grant it. Only someone with Stripe dashboard access could create one, but the fix is one condition.
  - **Fix:** the grant also requires `stripe_session_id` to equal the session id we stored. The checkout URL only reaches the browser after that id is stored, so a real payment always matches.
  - **Test:** "acknowledges but grants nothing for a checkout session other than the one created for the order".
- **[P2] (6/10) `app/api/checkout/route.ts`: buyers could return from Stripe to the wrong host.**
  - **Cause:** the return URLs used `new URL(req.url).origin`. Off Vercel, Next 16 builds `req.url` from the server's own host and port, so on Netlify (the planned live host) or `next start` behind a proxy, a buyer could pay and land on `localhost`.
  - **Fix:** the URLs come from the browser's `Origin` header, which browsers send on every POST, when it is a clean http(s) origin; otherwise from `req.url`.
  - **Why it's safe:** a forged `Origin` only redirects its own sender, and cross-site JSON posts can't get past CORS preflight.
  - **Test:** "sends Stripe back to the site the browser is on".
- **[P3] (7/10) `app/legal/page.tsx`: the page was prerendered.** A `CONTACT_EMAIL` set after the build never showed. It is now `force-dynamic`. Tested.
- **[P3] (6/10) `app/legal/page.tsx`: the privacy notice understated what purchases link.** It said "not your card, name or address", but the stored checkout ID lets the operator match this browser's anonymous characters to the Stripe receipt (email and name). The notice now says so, and says it's only looked up on request. Tested.
- **[P3] (5/10) `tests/webhook.test.ts`: the 413 test signed its body,** so it couldn't show that the size check runs before the signature check. It now also sends a bad signature and still expects 413.

**Pass 1, CRITICAL categories, with nothing else open:**
- **SQL and data safety.**
  - Every value is a bound parameter. The new SQL interpolates only code constants (`CHARACTER_COLUMNS`), and tests interpolate only into test-only `count()` filters.
  - The grant is one atomic `UPDATE … WHERE status = 'pending' AND stripe_session_id AND amount AND currency`, with no read-then-write.
  - Waitlist emails, order ids and Stripe session ids each have a primary key or unique index.
  - Ownership and frames are read-only `EXISTS` and `LATERAL … LIMIT 1` queries.
- **Races.**
  - Duplicate, late or concurrent webhook deliveries can't double-grant, because the second `UPDATE` finds no pending row. This is tested with repeat deliveries.
  - The one accepted race is the double-pay case under "Open".
- **Trust boundaries** (the LLM-output category applied to Stripe and the browser):
  - Prices come from `CATALOG`, never from the client or from Stripe metadata.
  - The webhook checks the signature on the raw text before parsing, then zod-checks the event and session shapes.
  - Stripe's checkout `url` must be https.
  - Stripe sees our order id, never the `bz_uid` cookie (tested), and no response carries a user id.
- **XSS and CSRF.**
  - There is no `dangerouslySetInnerHTML`.
  - New writes are JSON-only (`readJson`, tested with a 415 on the waitlist).
  - The webhook uses no cookie and is authenticated by its signature.
- **Enum completeness.** I read every consumer of `ITEM_KINDS` and `ORDER_STATUSES`:
  - the SQL `CHECK` lists, which `tests/db.test.ts` checks by inserting every value and some bad ones
  - `KIND_LABELS`, `KIND_NOTES` and `OWNED_NOTES`, typed `Record<ItemKind, …>`, so the compiler enforces completeness
  - `ownedSkus` and `grantOrder` (only `paid` counts; `refunded` is "already handled")
  - the board's frame join (`kind = 'frame'`)

  All of them handle every value.

**Open (ASK category: design decisions or larger changes, left for David or a later milestone):**
- **[P2] (7/10) `lib/house.ts`, `app/api/episodes/route.ts`: a premium house character is a weak creator fingerprint.**
  - Only buyers can date Vesper or Odalys, and episodes are public. While a premium character has few buyers, a creator who reveals themselves on one premium date hints that the other dates with that character are theirs too.
  - This is the same class as M2's accepted "a reveal on one episode names that character's creator everywhere".
  - **Mitigated:** the shop says so before purchase, and the reveal form warns on premium dates.
  - **The structural fixes are product calls:** let premium characters also appear in other creators' blind dates (diluting the signal, but giving them away), or show spectators a generic "premium cast member" instead of the name.
- **[P3] (8/10) `app/api/checkout/route.ts`: two open checkouts for the same item can both be paid.** For example, two tabs, or Back and then Buy again. Stripe sessions stay payable for 24 hours.
  - "Already owned" (409) only stops a new checkout *after* a payment.
  - Both orders become `paid`, and the item is owned once.
  - A duplicate shows up in `select user_id, sku, count(*) from orders where status = 'paid' group by 1, 2 having count(*) > 1` and is refunded by hand.
  - **Fix options:** reuse an open pending session per `(user, sku)` with a shorter `expires_at`, or auto-refund. Either is about 30 lines plus tests.
- **[P3] (5/10) Oversized bodies.** `app/api/webhooks/stripe/route.ts` and M1's `lib/http.ts` check `Content-Length` before reading, but a chunked body without one is read fully before the size check. The host's own body limit (Vercel 4.5 MB) bounds it. **Fix:** a streaming byte counter.
- **[P3] (5/10) No rate limits on `POST /api/checkout` and `POST /api/waitlist`.**
  - Checkout spam costs Stripe API calls and leaves pending rows, and it could hit Stripe's rate limit, so real buyers get 502s.
  - Waitlist emails are unverified.
  - The free-text `community` could carry a spreadsheet formula. Export with formula escaping, or as plain text.
  - These join M1's open rate-limit item.
- **[P3] (5/10) Leaderboard tests, M2 and M3, use the current UTC week.** A run that crosses Monday 00:00 UTC mid-test could fail falsely; it can never pass falsely.
- **[P3] (6/10) Pages and client components are only type-checked, built and partly render-tested.** `CreatorReveal` and `BuyButton` need the app router, so they aren't rendered in tests. The next step is a Playwright run with a Stripe test-mode purchase.

**Informational:**
- `npm view` and package installs are blocked in this sandbox, so the Stripe SDK was never an option. The hand-written verification follows Stripe's documented algorithm. The test helper signs with Web Crypto, a different implementation from the app's `node:crypto`, and three mutations of the verifier (always-true, skipping the HMAC, premium in the blind fallback) each failed tests.
- Stripe API versions: the session fields read (`id`, `object`, `client_reference_id`, `payment_status`, `amount_total`, `currency`) are stable. A signed event with an unexpected shape gets a 400, so Stripe retries instead of the order being dropped silently.

## Status (M5: the Full $0 vision, built)

The PRD's "Soul vs. Persona" direction, built on free models at **$0**. `npm test` runs **403 tests across 22 files, all passing**; `npm run typecheck` and `npm run build` are clean on Next.js 16.4.

### The one architectural change everything rests on

Outcomes moved from the showrunner **model** to a deterministic, seeded **engine** (`lib/engine.ts`). The model now only narrates toward the outcome the engine already decided. This is what makes predictions fair, gives the box score real numbers, and makes Sliding Doors reproducible. Because the engine owns the outcome, a frontier model can be switched on or off per environment with no gameplay risk (see `docs/upgrade-cost.md`).

- `lib/engine.ts` — pure, seeded (`mulberry32`), fully unit-tested. Inputs: two sheets, each side's soul signals, the owner's date settings, a seed, and the pair's history. Outputs: ending, drama question/answer, the four box-score arcs, per-side satisfaction.
- `lib/showrunner.ts` — `narrateEpisode()` is given the decided outcome and the private souls, and returns setting/goals/scenes/twist/finale plus a best line and one confessional per character. Outcome fields were removed from its schema.
- `lib/simulation.ts` — assembles a date from stored souls + relationship memory; `slidingDoors()` recomputes an alternate timeline from the stored seed with no model call.

### What the product does now (added to M1–M4)

- **Private soul** per character (`souls` table): owner-only, content-filtered like a sheet, optional on creation, editable and deletable at `GET/PUT/DELETE /api/characters/[id]/soul`. Never in any spectator-facing response.
- **Date settings**: autonomy, strategy, a fictional game budget (never bought), a secret agenda (owner-chosen or dealt), and a note in the pocket. All on `POST /api/episodes`.
- **The payoff**, on the episode page: the box score, the revealed secret agendas, the confessionals (host approves sharing at `POST /api/episodes/[id]/confessionals`), the owner's private debrief, and the surprise reveal (self-prediction vs. actual).
- **$0 spectator mechanics**: guess the dealbreaker (`POST /api/dealbreaker-guesses`, a seeded 4-option quiz), matchmakers (`POST/GET /api/matchmakers`), and Sliding Doors (`POST /api/episodes/[id]/sliding-doors`, owner-only).
- **The cast** (`/cast`): the relationship graph and a matchmaker form.
- `getPoints` now sums the prediction game plus the free side games; **league and season boards stay prediction-only**, and nothing bought still changes points, picks or rank.

### Data and privacy

- The private soul is sent to the configured (free) model as behaviour guidance and is used by the engine locally; it is never returned to spectators and is deleted with its character. `docs/upgrade-cost.md` §5 recommends a zero-data-retention endpoint and an optional local-only soul once a paid model is switched on.

### Deferred (needs spend approval — see docs/upgrade-cost.md)

Frontier text model, character portraits and video, the compute-budget enforcement gate, and the Redis/BullMQ + S3/CDN stack. None is switched on; each is proposed, not built.

### From the PRD review (added 2026-10-13)

Acting on a PRD review's two biggest buildable-at-$0 points:

- **A three-act date + the AI producer.** Every date is narrated as three acts — first impressions, a revealing challenge, the decision (`DATE_ACTS`). The challenge is dealt from a bounded producer library (`PRODUCER_EVENTS`, seeded, no model call), fed to the narration as act 2, and revealed with the agendas after the finale. Addresses "define what makes a date entertaining": the engine decides the outcome, the model writes believable dialogue that leads to it.
- **Local-only souls.** A soul can be marked `local_only`: it still drives the engine (via `deriveSoulSignals`) but its text is never sent to any model. Addresses the review's strongest privacy point (the soul is the most damaging thing to leak) and is the control `docs/upgrade-cost.md §5` recommended.

The review's other points were already satisfied (episodes are immutable once stored; predictions lock at reveal; the private soul is gated server-side, never in a spectator response) or are doc/legal/metrics items rather than code.

## Status (next-level pass: avatars, customization, E2E)

A competitor-driven polish pass (docs/competitive-analysis.md), all $0.

- **Avatars** (`lib/avatar.ts`, `app/Avatar.tsx`): deterministic SVG avatars (gradient + initials, optional owner-chosen hue) on the episode matchup, feed, cast gallery, builder preview and the box-score OG card. No image upload, so nothing to moderate and no real-person risk.
- **Customization**: `characters.appearance` and `characters.avatar_hue` columns (idempotent migration), wired through the sheet, refs and cast; a builder with a live avatar preview, an appearance line and a colour picker.
- **Visual overhaul** (`app/globals.css`): Fraunces/Inter type, a richer palette with real dark mode (`prefers-color-scheme`), gradients, a hero, a cast gallery and chips. Every existing class is preserved.

### New scripts

```bash
npm run seed   # fills .data/pglite (the dev DB) with a demo season; export DATABASE_URL to seed a remote DB
npm run e2e    # full end-to-end test in a real browser (needs CHROMIUM_PATH); 10 steps, build + stub showrunner
```

- `scripts/harness.mjs` is the shared app/showrunner lifecycle used by `e2e.mjs` and `seed.mjs`; the stub showrunner returns a valid three-act narration matching the engine's decided ending.
- `npm run e2e` covers the whole product: custom-character build (soul, appearance, avatar colour) → send on a date → the three-act episode with avatars/box score/debrief/agendas → Sliding Doors → a spectator predicts and guesses the dealbreaker → the host airs the finale → the spectator is scored → the cast gallery/matchmaker → a shop purchase. All 10 steps pass.

### Using an image to customize a character

Shipped the safe $0 form: in the builder, an owner can pick a reference image and the browser reads its dominant colour with a canvas (`hueFromPixels`, `lib/avatar.ts`) to tint the avatar. The image is **never uploaded or stored** — only the derived hue is sent, exactly like choosing a swatch — so there is nothing to moderate and no real-person risk. Plus **shareable contestant cards** at `/characters/[id]` (public persona only, with their own OG image), linked from the cast gallery.

Uploading and **storing** an image, or "training" the look on it, stays proposed (docs/competitive-analysis.md): it needs object storage, a vision model, and automated image moderation (CSAM scanning + a real-person classifier), since the product bans real people. The engine `CharacterSheet` already carries `appearance`, so a future reference image slots in without touching the engine.

## Status (seeded content: the cast, the set, the look gallery, the asset ledger)

Acting on the competitor report's image strategy (`docs/image-strategy.md`), which chose **first-party
assets only** — competitor imagery is research, never republished — and on its instruction to populate
the first version with a house cast, a reusable set of date locations and a curated gallery, rather than
generating an image per character. All $0: nothing here hosts, uploads or generates an image.

- **A house cast of 17** (`lib/house.ts`): fifteen free plus the two premium ones, each with a distinct
  `archetype` (the sarcastic romantic, the confident flirt, the awkward intellectual, the mysterious
  loner, the chaotic extrovert, the caretaker, the sceptic, the drifter, …), a curated `appearance` line
  and a curated `hue`. `ensureSchema` now writes the appearance and hue too, so the gallery shows a
  designed cast instead of fifteen id-derived colours. The blind-date fallback and the matchmaker both
  got a much wider pool out of it.
- **Temperaments for the house cast.** Each house character carries the four behavioural signals the
  engine decides with, seeded into `souls` as engine-only rows (empty text, `local_only = true`, the
  curated `signals`). **This was a real imbalance, not a polish item:** a house character had no soul,
  so `avg(oc, 0)` halved warmth, openness and humour on every house date. Measured against the engine's
  own thresholds (`FRIENDS_AT` 42, `SECOND_DATE_AT` 56): a date with no cue matches scores **31.7**, so
  the *default* house date is a disaster, and a best-case one capped around **52** — a second date was
  unreachable. A search over 1,200 (OC × house character × strategy × seed) combinations found **zero**
  second dates before the change. The owner-only soul route still answers 404 for a house character
  (nobody owns one), so there is nothing new to leak; `tests/cast.test.ts` asserts both.
- **A curated look gallery** (`lib/presets.ts`): twelve palettes in the builder, next to the colour
  swatches. The report's "pick a portrait from a curated gallery", with a palette standing in for a
  portrait. `lib/avatar.ts` was refactored so a picked look and a read image both resolve through one
  pure mapping (`traitsFromPalette`), which means picking "Golden hour" sets exactly what uploading a
  golden-hour photo would: the colour, the appearance line, the traits and the AI's instincts. A test
  reads a synthetic solid-colour image and asserts it lands on the same values as the matching preset.
- **A reusable venue library** (`lib/venues.ts`): eight date locations, dealt from the episode's seed
  like the producer's situation, stored on `episodes.setup.venue`, given to the showrunner as
  `date_location` ("your `setting` must put them there"), and painted on the episode page as a two-hue
  backdrop behind the location's name. The model no longer invents a location per date. `DateSetup.venue`
  is optional so episodes stored before the library still render (`venue()` falls back).
- **An asset provenance ledger** (`character_assets`, `lib/assets.ts`): kind, source type, generator,
  prompt and prompt version, seed, source URL, licence, attribution and review status. Licensed assets
  cannot be stored without a source and licence, generated ones without a generator, and nothing can be
  approved without a file to serve — enforced as CHECK constraints *and* in code. `listApprovedAssets`
  is the only read path and returns approved rows only, so an unreviewed image cannot reach a page. The
  table is **empty by design**: it exists now so that shipping real portraits later needs no migration
  and no retrofitted rules.
- **Sliding Doors fix** (`lib/simulation.ts`): the replay re-derived signals from soul text, ignoring
  image-trained ones, so an image-trained character's "what if" was computed from different inputs than
  the real date it claimed to vary. It now uses `signals ?? deriveSoulSignals(soul)`, like `buildDate`.

### The seeded season

`npm run seed` now drives eleven OCs across eleven creators, sixteen dates, two friend leagues, eighty
predictions, dealbreaker guesses, four matchmaker proposals and thirteen aired finales, all over HTTP
exactly as the UI would. The pairings are **chosen rather than left to luck**, because the engine decides
from cue matches between the two sheets, the signals on each side and the owner's dials:

- a note plus a guided AI against a warm house character lands on *friends*;
- a bare date against the guarded end of the cast ends badly, which is the show;
- one pair is built to earn a *second date* — her want names his bakery, his want ("taste-test without
  lying") finds "tastes" in her bio, they share the trait "generous", and neither trips the other's
  dealbreaker — and dates twice, so the relationship graph has a progressed pair and a matchmaker
  proposal that can pay off.

The mix went from 11 disasters / 3 friends / 0 second dates to **8 friends / 6 disasters / 2 second
dates**, so the demo feed shows the whole range of the game. The stub showrunner in
`scripts/harness.mjs` now honours `date_location`, so seeded and screenshotted episodes read
consistently with the venue they were dealt.

```bash
npm run seed                        # the local dev DB (.data/pglite)
DATABASE_URL=… npm run seed         # a remote database (the house cast arrives on deploy by itself)
```

The code-seeded content (the cast, its souls and looks, the venues, the asset table) lands on any
database by itself: `ensureSchema` is idempotent and runs on the first query of a cold start. Only the
invented creators, episodes and leagues need the seeder.

### Also

- `tests/cast.test.ts`, `tests/venues.test.ts` and `tests/assets.test.ts` cover the new seed data: cast
  size and spread, the content filter on every house field, hue coverage round the wheel, the gallery's
  behaviour range, preset/image agreement, the venue library and its delivery into the prompt and the
  episode JSON, and the asset ledger's provenance and approval gates.
- One e2e selector had to become exact: the new "Ice violet" look chip collides with the "Violet"
  swatch under a substring accessible-name match.

## Status (M8: watch parties, built)

The feature that turns "watch two bots talk" into a social event (see ROADMAP.md M8 and the feature
brief). A synchronized **date room** over one pre-generated episode, with live reactions, live chat and
audience polls. **Model A ("spectator mode")**: the audience reacts and predicts, it never steers the
characters — the engine already decided the outcome, and the room reveals it on a shared clock.

### The one design choice everything rests on

There is **no realtime server and no video infra**. A room's phase is a pure function of the clock
(`lib/watch.ts` `watchClock`): the start time plus `now` gives the beat, so every viewer sees the same
thing with nothing to keep in sync. The client just polls one heartbeat (`POST
…/sync`) for presence and fresh tallies. That heartbeat is also where every side effect lives — the read
path (`getRoomState`) never writes:

- a **template** room (always-on, house-vs-house) has `starts_at` null until the first viewer joins,
  then the heartbeat sets it once — "join and the date starts", so the lobby always has a date in motion;
- the finale **airs automatically** when the clock reaches the decision (the heartbeat sets `revealed_at`
  if a report hasn't hidden it), so predictions resolve into points at the room's climax with no manual
  step and no cron — a premiere is just a timed airing.

### What the product does now (added to M1–M7)

- **Two kinds of room** (`watch_parties.kind`): a creator hosts a **premiere** of their own date
  (`POST /api/episodes/:id/watch-party`, host-only, one room per episode); **templates** are system
  content over house pairs, created through the token-gated internal route (`WATCH_ADMIN_TOKEN`) that the
  seed and the e2e use and that 404s when the token is unset.
- **The live loop**: pre-show predictions → first impressions → the challenge (plus an audience-chosen
  question, flavour only) → the twist → the chemistry verdict → the decision → the payoff ("the room
  called it X; the characters chose Y"). Content unlocks strictly in that order; nothing leaks early.
- **Audience inputs, all kept separate** (feature brief §3): emoji **reactions** (one of each per viewer,
  so a count is distinct viewers, never spam), **live chat**, the **chemistry verdict** (opinion, never
  scores, never reaches the engine, split hidden until the decision), and **predictions** (the existing
  prediction game, scored on reveal). Creators can't predict their own date and don't see the panel.
- **Moderation before scale** (feature brief §5): every message passes the shared content filter
  (`lib/safety.ts`), plus a length cap, slow mode, a rolling per-viewer rate limit, report-to-hide at the
  episode threshold, and a client-side "watch without chat" toggle. Anonymous viewers get a stable,
  friendly handle derived from their id (never the raw id).
- **A lobby** (`/watch`, in the sitemap) with a live "N watching" count from a presence table, and a
  doorway on every episode page.

### Data and privacy

`watch_parties`, `watch_messages`, `watch_message_reports`, `watch_reactions`, `watch_poll_votes` and
`watch_presence` (all `IF NOT EXISTS`, so a live M7 database upgrades in place). Template episodes carry a
`system` creator id that no real user can match. Creator privacy is unchanged: a room shows the fictional
character, never the person, and no soul, note or private debrief is ever selected into a room payload.

### Exit criteria (tested — `tests/watch.test.ts`, 23 cases, and the Playwright e2e)

- The phase is a pure, reproducible function of the clock; content unlocks in order, never early.
- A template starts on the first join and only once; the finale airs exactly at the decision, and a
  correct prediction then scores.
- A reaction is one-per-emoji-per-viewer; a chemistry vote never scores; the split is hidden until the
  decision; chat enforces the content filter, slow mode, the rate limit and report-to-hide.
- No watch-party route takes money or moves points (the route-listing exit criterion still holds).
- The e2e drives a host premiere and a viewer who reacts, chats and predicts live, plus joining a
  template room from the lobby, in a real browser (16/16 steps).

### Also

- `npm run screenshots` now captures the room (`docs/screenshots/watch-{desktop,mobile}.png`), seeded with
  a few live reactions and chat messages; `scripts/harness.mjs` `seedTemplateRooms` fills the lobby for
  `npm run seed` and the e2e.
- Deferred (needs spend or new infra): push-based realtime in place of polling once rooms are busy; a cron
  that refreshes/loops template rooms; and Model B (bounded, advertised audience-chosen twists the engine
  actually responds to), only once Model A's retention is proven.

## Status (the first portraits, generated locally and reviewed)

The house cast and the venue set now have first-party art, generated on the owner's 16 GB M1 Pro at
$0 with **Z-Image Turbo** (Apache-2.0, via mflux on MLX — it is not in the Ollama registry) and
committed as WebP under `public/cast/`: 17 portraits and 8 backdrops, about 1 MB. `npm run portraits`
builds every prompt from `lib/house.ts` and `lib/venues.ts`, generates, records each image in the
`character_assets` ledger as pending, and writes a contact sheet; `--approve` is the only step that
publishes, and it now refuses to write anything to `public/` without a ledger row.

It took three portrait prompts, and the failures are the useful part (`docs/image-strategy.md` has the
detail; `tests/prompts.test.ts` pins every fix):

- **portrait-v1, rejected, all 17.** An age number and a clothing line, no presentation, no physical
  description, an anime style: one young face for the whole cast, several reading as teenagers, one in
  what looked like a school uniform, one bare-chested. On an adults-only dating show, that is the case
  the review gate exists for.
- **portrait-v2, stopped after one image.** Age and presentation fixed by a per-character `look`, but
  "semi-realistic" came out photographic — the real-person-resemblance risk in its purest form.
- **portrait-v3, approved.** An editorial illustration, both failure modes negated, tested on the three
  hardest characters before the batch. Two characters needed their `look` corrected and regenerated.

The backdrops failed once for the same reason one level down: the prompt reused each venue's showrunner
text, so the double date was drawn with its couple and the tasting menu with its waiter. A separate,
people-free `plate` per venue fixed all three failures.

Approved by Claude on the owner's explicit delegation; every ledger row's `reviewed_note` records that
and what was checked. The portraits are not displayed anywhere yet — that is a separate, visible change
to the avatars.
