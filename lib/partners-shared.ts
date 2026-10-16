/** One partner or more: the values and labels, safe for client components (the rules live in lib/partners.ts). */
export const PARTNER_STYLES = ["one", "open", "decide"] as const;
export type PartnerStyle = (typeof PARTNER_STYLES)[number];
export type DecidedStyle = "one" | "open";

export const PARTNER_STYLE_LABELS: Record<PartnerStyle, string> = {
  one: "One partner",
  open: "More than one (open / poly)",
  decide: "Let them decide",
};
