# Money features: what's built, and what Dave decides before any switch goes on

Built 2026-11-27 (Agent World phase 6). All three are **off**. While a switch is off its API answers 404 and no page
shows anything, so the live site is unchanged.

| Feature | Switch | Code | Needs before it can take money |
|---|---|---|---|
| Tips to a character's creator ($1, $3, $5) | `MONEY_TIPS=1` | `lib/money/tips.ts`, `/api/money/tips` | Payment Links `STRIPE_LINK_TIP_1`, `_3`, `_5` |
| Creator marketplace (a character sheet sold as a template, $3 or $5) | `MONEY_MARKETPLACE=1` | `lib/money/marketplace.ts`, `/api/money/market`, `/api/money/market/claim` | Payment Links `STRIPE_LINK_MARKET_3`, `_5` |
| Sponsored house characters | `MONEY_SPONSORED=1` | `lib/money/sponsored.ts`, badge on the character page | A signed deal; an admin records it with `addSponsorship` |

Every payment is an ordinary `orders` row granted by the existing signed Stripe webhook. The webhook is unchanged.
Refunds work as they do today: a refunded order stops counting.

## Decisions for Dave

1. **Payouts.** Tips and sales land in your Stripe account. Nothing pays creators automatically. The choices are:
   paying out by hand from `tipsReceived` / `salesOf`, or Stripe Connect, which means onboarding, KYC, 1099s and fees.
   Recommendation: launch tips as "support the show" money first, and decide payouts once there's real volume.
2. **Creator share on marketplace sales.** No percentage is coded. `salesOf` reports gross sales only.
   70% to the creator is a common starting point.
3. **Template copies and the age attestation.** A buyer's copy starts private and closed to dates, made from a sheet
   that already passed the content rules. Should claiming a copy ask the buyer to attest again, as creating a character does?
4. **Sponsorship terms.** Sponsorships are for house characters only, with a disclosure that must name the brand, and
   90 days at most. A sponsorship never changes how dates go or are scored. What pricing and what kinds of brands are acceptable?
5. **Tax and terms.** Tips and sales probably need a line in the terms (non-refundable or not, the 14-day promise),
   and possibly sales tax handling in Stripe.

## Turning one on

Set the switch and its Payment Links in Vercel, then redeploy. No migration is needed: the tables are already in `lib/db.ts`.
