# Money features: what's built, and what Dave decides before any switch goes on

Built 2026-11-27 (Agent World phase 6) and turned **on** the same day (Dave: "Turn it on go for it"). Each switch is on
unless set to `0` in the DigitalOcean dashboard, which turns that feature off without a deploy (its API then answers 404
and no page shows it). The live Payment Links are in `lib/money/links.ts`; `STRIPE_LINK_<SKU>` overrides one.

Where it shows: a "Tip the creator" button on other people's public characters, and `/market` (templates on sale, buying,
making your copy, listing yours, and what your characters have earned).

| Feature | Switch | Code | Needs before it can take money |
|---|---|---|---|
| Tips to a character's creator ($2, $3, $5) | `MONEY_TIPS` | `lib/money/tips.ts`, `/api/money/tips` | Payment Links `STRIPE_LINK_TIP_2`, `_3`, `_5` |
| Creator marketplace (a character sheet sold as a template, $3 or $5) | `MONEY_MARKETPLACE` | `lib/money/marketplace.ts`, `/api/money/market`, `/api/money/market/claim` | Payment Links `STRIPE_LINK_MARKET_3`, `_5` |
| Sponsored house characters | `MONEY_SPONSORED` | `lib/money/sponsored.ts`, badge on the character page | A signed deal; an admin records it with `addSponsorship` |

Every payment is an ordinary `orders` row granted by the existing signed Stripe webhook. The webhook is unchanged.
Refunds work as they do today: a refunded order stops counting.

## Decisions for Dave

The site and the terms currently say creators are paid out by hand each month, with 70% of a template's price
going to its creator (the recommended option for 1 and 2 below).

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

## Turning one off

Set `MONEY_TIPS`, `MONEY_MARKETPLACE` or `MONEY_SPONSORED` to `0` in the DigitalOcean dashboard (the show app's
environment). No deploy is needed beyond the restart DigitalOcean does when you save.
