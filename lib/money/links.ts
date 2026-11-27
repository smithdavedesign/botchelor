import { paymentLinkFromEnv } from "../stripe";

type Env = Record<string, string | undefined>;

/**
 * The live Payment Links for the money skus, made in the owner's Stripe account on 2026-11-27 (metadata sku and
 * repo botchelor). A Payment Link's URL is public: every buyer sees it. STRIPE_LINK_<SKU> overrides one, as for the
 * packs (lib/stripe.ts), so a link can be replaced without a deploy.
 */
export const MONEY_LINKS: Readonly<Record<string, string>> = {
  tip_2: "https://buy.stripe.com/fZu3cu1DtclF11u7oCfAc04",
  tip_3: "https://buy.stripe.com/3cIaEWbe33P939CdN0fAc05",
  tip_5: "https://buy.stripe.com/cNiaEW81RetN6lOeR4fAc06",
  market_3: "https://buy.stripe.com/8x23cu4PFclF11ufV8fAc07",
  market_5: "https://buy.stripe.com/8x28wO3LBdpJ11u7oCfAc08",
};

/** The link that sells this money sku, or null. */
export function moneyLink(env: Env, sku: string): URL | null {
  const set = paymentLinkFromEnv(env, sku);
  if (set) return set;
  const known = MONEY_LINKS[sku];
  return known ? new URL(known) : null;
}
