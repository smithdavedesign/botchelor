/**
 * Who runs Botchelor, in one place, for the terms, the privacy notice and the policy pages (/terms, /privacy,
 * /content-policy, /2257, /report, /cancel). Change a constant here and every page follows.
 *
 * Today the operator is David Smith, an individual in the United States, trading as Botchelor (no company yet). When an
 * LLC is formed, set OPERATOR to its legal name (e.g. "Botchelor LLC, a Wyoming limited liability company") and
 * GOVERNING_STATE to the state it's formed in. Pure: no env reads except contactEmail().
 */

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
 * TODO(David): change this to your home state, or to your LLC's state once it's formed. "Delaware" is a placeholder.
 */
export const GOVERNING_STATE = "Delaware";

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
 * the US states with adult age-verification laws, and the countries whose laws need an age check we don't offer. The
 * UK gets text only (the Online Safety Act's Part 5 leaves text out). Keep in step with the gate's own list when it lands.
 */
export const AFTER_DARK_BLOCKED_US_STATES = [
  "Alabama", "Arizona", "Arkansas", "Florida", "Georgia", "Idaho", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
  "Mississippi", "Missouri", "Montana", "Nebraska", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Virginia", "West Virginia", "Wyoming",
] as const;
export const AFTER_DARK_BLOCKED_COUNTRIES = ["France", "Italy", "Germany", "Australia", "Brazil"] as const;
export const AFTER_DARK_TEXT_ONLY = ["the United Kingdom"] as const;
