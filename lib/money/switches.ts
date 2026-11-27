/**
 * The money switches (Agent World phase 6). Built off on 2026-11-27, then turned on the same day (owner: "Turn it on go
 * for it"). Each feature is on unless its env var is exactly "0", read per request, so setting one to 0 in the
 * DigitalOcean dashboard turns it off without a deploy. While a switch is off its API answers 404 and no page shows it.
 *
 *  - MONEY_TIPS: a viewer tips a character's creator ($2, $3 or $5, lib/money/tips.ts).
 *  - MONEY_MARKETPLACE: a creator sells a copy of a character's sheet as a template (lib/money/marketplace.ts).
 *  - MONEY_SPONSORED: a brand's house character on the cast, labelled sponsored (lib/money/sponsored.ts).
 *
 * Each sku has a live Payment Link (lib/money/links.ts); STRIPE_LINK_<SKU> overrides one. The money lands in the owner's
 * Stripe account and creators are paid from it (docs/money-decisions.md).
 */
type Env = Record<string, string | undefined>;

export const MONEY_SWITCHES = { tips: "MONEY_TIPS", marketplace: "MONEY_MARKETPLACE", sponsored: "MONEY_SPONSORED" } as const;
export type MoneyFeature = keyof typeof MONEY_SWITCHES;

export const moneyOn = (feature: MoneyFeature, env: Env = process.env): boolean => env[MONEY_SWITCHES[feature]]?.trim() !== "0";
