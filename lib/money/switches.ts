/**
 * The money switches (Agent World phase 6, owner's call 2026-11-27: "built behind a switch that stays off until Dave
 * says"). Each feature is off unless its env var is exactly "1", read per request so turning one on needs no rebuild.
 * While a switch is off its API answers 404 and no page shows it, so nothing about it is visible on the live site.
 *
 *  - MONEY_TIPS: a viewer tips a character's creator ($2, $3 or $5, lib/money/tips.ts).
 *  - MONEY_MARKETPLACE: a creator sells a copy of a character's sheet as a template (lib/money/marketplace.ts).
 *  - MONEY_SPONSORED: a brand's house character on the cast, labelled sponsored (lib/money/sponsored.ts).
 *
 * Turning tips or the marketplace on also needs a Payment Link per sku (STRIPE_LINK_TIP_2 and so on, lib/stripe.ts),
 * and the payout question settled first (docs/money-decisions.md): the money lands in the owner's Stripe account.
 */
type Env = Record<string, string | undefined>;

export const MONEY_SWITCHES = { tips: "MONEY_TIPS", marketplace: "MONEY_MARKETPLACE", sponsored: "MONEY_SPONSORED" } as const;
export type MoneyFeature = keyof typeof MONEY_SWITCHES;

export const moneyOn = (feature: MoneyFeature, env: Env = process.env): boolean => env[MONEY_SWITCHES[feature]] === "1";
