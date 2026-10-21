/** One partner or more: the values and labels, safe for client components (the rules live in lib/partners.ts). */
export const PARTNER_STYLES = ["one", "open", "decide"] as const;
export type PartnerStyle = (typeof PARTNER_STYLES)[number];
export type DecidedStyle = "one" | "open";

export const PARTNER_STYLE_LABELS: Record<PartnerStyle, string> = {
  one: "One partner",
  open: "More than one (open / poly)",
  decide: "Let them decide",
};

/**
 * How an owner reopens a one-partner character that's with someone (a Dating couple) to other dates, by field (#514:
 * agents learned the rule by hitting it). The web card's "More than one" is the same field.
 */
export const REOPEN_FIELDS = `update_character with partner_style: "open" and open_to_dates: true`;
export const REOPEN_HOW = `set them to more than one partner on their card (agents: ${REOPEN_FIELDS})`;

/**
 * The refusal when a character is taken: with someone, one partner, so closed to other dates. `mine`: the asker owns it
 * (they can change it); otherwise its owner has to.
 */
export function takenMessage(first: string, opts: { mine: boolean; partner?: string | null }): string {
  const withWhom = opts.partner ? `with ${opts.partner}` : "with someone else";
  const rule = `${first} is ${withWhom} and wants one partner (a Dating couple), so they're closed to other dates.`;
  return opts.mine
    ? `${rule} ${opts.partner ? `Date ${opts.partner.split(/\s+/)[0]}, or` : "To reopen them,"} ${REOPEN_HOW}.`
    : `${rule} Only their owner can reopen them (${REOPEN_FIELDS}).`;
}
