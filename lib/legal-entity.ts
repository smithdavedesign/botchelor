/**
 * Who runs Botchelor, in one place, for the terms, the privacy notice and the policy pages (/terms, /privacy,
 * /content-policy, /2257, /report, /cancel). Change a constant here and every page follows.
 *
 * Today the operator is David Smith, an individual in the United States, trading as Botchelor (no company yet). When an
 * LLC is formed, set OPERATOR to its legal name ("Botchelor LLC, a California limited liability company"; David's
 * pick, 2026-10-30: his home state). Pure: no env reads except contactEmail().
 */
import { AGE_CHECK_COUNTRIES, TEXT_ONLY_COUNTRIES, US_AGE_CHECK_STATES } from "./jurisdiction";

/** The legal person who runs the service and is the other party to the terms. */
export const OPERATOR = "David Smith";
/** The name the service trades under. */
export const TRADING_AS = "Botchelor";
/** Where the operator is. */
export const OPERATOR_COUNTRY = "the United States";
/** "David Smith, trading as Botchelor": how the pages name the operator in full. */
export const OPERATOR_FULL = `${OPERATOR}, an individual in ${OPERATOR_COUNTRY}, trading as ${TRADING_AS}`;

/**
 * The state whose law governs the terms, and where arbitration and any court case sit.
 * David's home state (2026-10-30), and the LLC's once it's formed there (docs/after-dark-business-setup.md).
 */
export const GOVERNING_STATE = "California";

/** The support address: CONTACT_EMAIL, read per request so one set after the build shows. Null when it isn't set. */
export function contactEmail(env: Record<string, string | undefined> = process.env): string | null {
  return env.CONTACT_EMAIL?.trim() || null;
}

/**
 * Where After Dark subscribers cancel at the card processor, as each processor's own consumer site names them
 * (checked 2026-10-24): segpaycs.com, the name on a Segpay card statement, redirects to cs.segpay.com; Verotel's billing
 * support site (vtsup.com, the name on a Verotel statement) links "Cancel membership" to secure.verotel.com/cancellookup.
 */
export const PROCESSORS = {
  // CCBill's consumer support site (support.ccbill.com, checked 2026-10-30) looks up and cancels a subscription.
  ccbill: { name: "CCBill", statement: "CCBILL.COM", cancelUrl: "https://support.ccbill.com/", supportUrl: "https://support.ccbill.com/" },
  segpay: { name: "Segpay", statement: "SEGPAY or SEGPAYCS.COM", cancelUrl: "https://cs.segpay.com/", supportUrl: "https://cs.segpay.com/" },
  verotel: {
    name: "Verotel",
    statement: "VTSUP.COM",
    cancelUrl: "https://secure.verotel.com/cancellookup",
    supportUrl: "https://www.vtsup.com/",
  },
} as const;

/** How long we take to answer a report, and the faster promise for the urgent kinds (card-network rules; TAKE IT DOWN). */
export const REPORT_RESPONSE = { standard: "7 business days", urgent: "48 hours" } as const;

/** The cap on our liability when the amount paid is smaller (Terms, "Limits on our liability"). */
export const LIABILITY_FLOOR_USD = 50;
/** Days a person has to opt out of arbitration after first agreeing to the terms. */
export const ARBITRATION_OPT_OUT_DAYS = 30;

/** The copyright agent named on /terms#copyright. Not yet registered with the US Copyright Office (docs: a $6 filing). */
export const DMCA_AGENT = OPERATOR;

/**
 * Where After Dark won't open, as the Terms and the content policy say it (docs/after-dark-legal-review.md, 2026-10-24):
 * the US states with adult age-verification laws, and the countries whose laws need an age check we don't offer, and the
 * text-only ones (the UK: the Online Safety Act's Part 5 leaves text out; Japan). Read from the gate's own rules
 * (lib/jurisdiction.ts), so the pages always say what the code does.
 */
export const AFTER_DARK_BLOCKED_US_STATES: readonly string[] = Object.values(US_AGE_CHECK_STATES);
/** A country's English name from its code, "the" where English says it ("the United Kingdom"). */
const countryName = (code: string): string => {
  const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  return /^(United|Netherlands|Philippines|Czech)/.test(name) ? `the ${name}` : name;
};
export const AFTER_DARK_BLOCKED_COUNTRIES: readonly string[] = Object.keys(AGE_CHECK_COUNTRIES).map(countryName);
export const AFTER_DARK_TEXT_ONLY: readonly string[] = Object.keys(TEXT_ONLY_COUNTRIES).map(countryName);
