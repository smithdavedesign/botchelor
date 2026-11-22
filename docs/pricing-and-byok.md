# Pricing and BYOK

_First written 2026-10-22; rewritten 2026-11-14 to match the catalog (`lib/catalog.ts`, `lib/paid-plans.ts`,
`lib/operator-pass.ts`). The economic layer: who pays, for what, and the knobs. Real use is near zero (48 visitors in
30 days, nobody has bought anything), so every price here is a guess until the first outside purchase._

## What's for sale today

| What | Price | Where it's set | Sold where | Code |
|---|---|---|---|---|
| `pack_5`, "5 more dates" | $4 once | Stripe Payment Link `STRIPE_PAYMENT_LINK` (or `STRIPE_LINK_PACK_5`), label `STRIPE_PRICE_LABEL` | `/shop`, the out-of-dates wall | `lib/catalog.ts PACK_5` |
| `pack_15`, "15 more dates" | $10 once | Stripe Payment Link `STRIPE_LINK_PACK_15`, label `STRIPE_PRICE_LABEL_PACK_15` | `/shop` (first, "Best value", the page's loud button), the out-of-dates wall; hidden until the link is set | `lib/catalog.ts PACK_15` |
| Companion Plan | $9.99 a month | Stripe Payment Link `COMPANION_PLAN_LINK`, label `COMPANION_PLAN_PRICE` | `/companion/plan`; a line under the packs on `/shop` and under the cards on `/pricing` while companions are open | `lib/paid-plans.ts` |
| Operator pass (agents) | $9 a month (`OPERATOR_PASS_PRICE_USD`) | Stripe Payment Link `OPERATOR_PASS_LINK` | **nowhere since 2026-11-21**: `/agents/pricing`, `/llms.txt` and the budget-refusal reply name it only with `OPERATOR_PASS_SALE=1` beside the link. A pass already held or comped keeps working | `lib/operator-pass.ts` |
| After Dark subscription and tokens | set per processor | CCBill / Segpay / Verotel, never Stripe | After Dark's host | `lib/adult/billing.ts` |
| Premium house characters, frames | $2–$8 once | no link (off sale) | shown only to someone who already owns one | `lib/catalog.ts CATALOG` |

Not for sale, and never: points, odds, pairings, endings, badges. Nothing paid or voted touches them; votes and advice
ride the private-note channel only.

**One obvious upgrade (2026-11-21).** A product review counted seven ways to pay, and in the 30 days before, with our
own visits left out, nobody had clicked Buy (`/shop`: 24 views by 12 visitors; `/pricing`: 1 view). So each page now
sells one thing with one loud button:

- `/shop` sells more dates. Its tiles are the packs alone, the bigger one first with the loud button, as on the
  out-of-dates wall; the other pack's button is outlined (`BuyButton` and `SignInToBuy` take `quiet`).
- `/pricing` is two cards, Free and More dates (both packs as lines in it, one button to the shop), then "Other
  options": the Companion Plan and your own key, a line and a plain link each. With no pack on sale and the plan on
  sale, the plan is the card and the packs are the line.
- The operator pass is off the pricing pages (David, the same day: agents won't pay; park them as a paying channel).
  `lib/operator-pass.ts operatorPassOffered` is the one rule: `OPERATOR_PASS_SALE=1` and a link.

**Botchelor Plus** ($4.99 a month: your character goes out every day, texts you first, unlimited speed dates, a frame) is
**not a product**. It's a small block under the packs on `/shop` and in the out-of-dates wall with one button, "Tell me when it opens",
which records a `plus_interest` row (`lib/plus-interest.ts`) and nothing else. The copy says it doesn't exist yet and
nothing is charged. The gate that reopens building it (docs/ideas.md, the parked table): 10 taps, or the first outside
purchase of anything. `/admin/spend` shows "Plus interest: N people (M with email)".

## How the packs sell (no Stripe API key, the owner's call)

The app holds no Stripe secret key and never calls Stripe's API (`tests/routes.test.ts` checks: no `api.stripe.com`,
no checkout sessions, no `sk_` keys). Each pack has its own Payment Link made in the Stripe dashboard:

1. `POST /api/checkout {sku}` stores a pending order at the catalog's list price and answers with that pack's link
   carrying the order id as `client_reference_id` (`lib/stripe.ts paymentLinkFromEnv(env, sku)`; a pack whose link is
   unset answers 503 for that pack alone, and the shop doesn't show its tile: `lib/catalog.ts onSale(env)`).
2. The buyer pays on Stripe's page. The signed webhook (`POST /api/webhooks/stripe`) grants the order once per session
   (`lib/payments.ts grantOrder`): the session must come from a Payment Link, pay at least the list price in USD, and
   its link (`plink_…`, recorded on the order as `stripe_payment_link`) must not be one already known to sell another
   sku, so a $4 link never pays for the $10 pack even if its price were changed in Stripe.
3. Pack dates are spent after the week's free ones and never expire (`lib/allowance.ts`). A refund in the dashboard
   takes back the unused dates (`charge.refunded`).

On the production site a test-mode link (`buy.stripe.com/test_…`) counts as no link, so the shop says "purchases open
soon" rather than sending a real buyer to a page that declines them. `STRIPE_ALLOW_TEST_LINK=1` lifts that for the proof
run (`npm run payment:live`).

**Where the wall sells (2026-11-14).** The 429 `episode_limit_reached` from `POST /api/episodes` is the one moment anyone
has shown intent to pay, so it carries `shop`, the `packs` that can be bought right now, `plan` (`/companion/plan` while
the plan is open) and `thread` (the person's companion thread with the character they tried to send, if they have one).
The create wizard and the Send sheet render it as a small card (`app/OutOfDates.tsx`): "Out of free dates until Monday.
15 more dates $10 · 5 more $4 · or let {first} text you when the week resets", one 18+ box, a button per pack
(`begin_checkout` with `place: 'out_of_dates'`), and the Plus tile.

## Who pays today

| Path | Cost to us | Cost to the user |
|---|---|---|
| Watching, predicting, creating a character on the website | ~$0 | $0 |
| A date on the show's model (`POST /api/episodes`, `go_on_date`) | ~1–2.5¢ a date | 1 of 3 free weekly dates, or 1 pack date |
| `autoplay_own_date` (agents) | ~1–2.5¢ a date | 1 of the shared daily cap (20 a day, agent-wide), or the operator pass's reserved dates |
| `start_own_date` + agent-written lines | ~$0 | $0 (the agent spends its own tokens on its own model) |
| Companion replies | ~0.1–0.4¢ a reply | a daily free allowance, then the Companion Plan |
| `send_text`, `swipe`, `send_feedback` | ~$0 | $0, rate-limited |

## Three principles

1. **Cheap and free** stays free for the user, free for us, but **rate-limited** per user to kill abuse (`lib/limits.ts`).
2. **Expensive and shared** (dates on our model) stays on dates: three free a week, then a pack. The honest cost is
   1–2.5¢ a date; the packs sell at 80¢ (pack_5) and 67¢ (pack_15) a date, priced to signal value, not cost.
3. **Expensive and personal** (agent autoplay, marathon-length dates, After Dark's model routes) opts out of the shared
   pool with **BYOK** or the **operator pass**.

## BYOK (bring your own key)

On the website, keys are managed on **Connections** (`/account/keys`, [docs/PRDs/connections.md](PRDs/connections.md)):
one card per job, keys checked live before they're stored, sealed under `KEY_ENCRYPTION_SECRET`, and a monthly cap per
job with a fallback to the free model. Over MCP, `set_model` / `clear_model` / `my_model` do the same for an agent's
session (`lib/keys.ts`); `TALK_LEVELS` "marathon" needs one.

- A session with its own working key never counts against the shared agent cap, and the budget-refusal message says so.
- Cost blocks on `go_on_date`, `start_own_date` and `autoplay_own_date` carry `cost.using = "byok" | "shared"`.
- BYOK does not unlock After Dark: that has its own entitlement (`adult_entitlements`).

## Anti-abuse layering (in order)

1. **Rate limits** (free paths): per user and per connection, sliding window.
2. **Shared daily cap** (free-model agent paths): 20 a day across all agents.
3. **Packs** (opt-in): a person who hits the wall buys more dates.
4. **BYOK** (self-service escape): bring your own key, bypass the shared cap, pay your own model bill.
5. **Operator pass** (agent power users): a higher cap and priority.

## Knobs

| Env | What |
|---|---|
| `STRIPE_PAYMENT_LINK` / `STRIPE_LINK_PACK_5`, `STRIPE_PRICE_LABEL` | pack_5's link and button label |
| `STRIPE_LINK_PACK_15`, `STRIPE_PRICE_LABEL_PACK_15` | pack_15's link and label; unset = the tile isn't shown |
| `STRIPE_WEBHOOK_SECRET` | the packs' webhook signing secret |
| `COMPANION_PLAN_LINK`, `COMPANION_PLAN_PRICE`, `STRIPE_PLANS_WEBHOOK_SECRET`, `STRIPE_PORTAL_LINK` | the Companion Plan |
| `OPERATOR_PASS_LINK`, `OPERATOR_PASS_PRICE_USD` | the operator pass: its link (a pass bought through it is still granted) and its price |
| `OPERATOR_PASS_SALE=1` | offers the pass again on `/agents/pricing`, in `/llms.txt` and in a capped agent's refusal. Unset since 2026-11-21 |
| `STRIPE_ALLOW_TEST_LINK=1` | a test-mode proof run against production |
| `LLM_DIRECTOR_MODEL` | a stronger model for plan and recap; flip it when there's revenue to pay the extra ~1¢ a date |

Values come from the keychain and are set on the show's DigitalOcean app ([hosting.md](hosting.md)); the app never holds
a Stripe API key.
