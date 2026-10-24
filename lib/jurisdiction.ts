/**
 * Where After Dark may open, by the law of the place a visitor connects from (docs/after-dark-legal-review.md; David's OK,
 * 2026-10-24: block where the law wants a real age check, text only where only pictures, video and voice are covered,
 * an 18+ self-declaration everywhere else). The PG show is the same everywhere; admins (the operator) are exempt.
 *
 *   blocked     After Dark isn't offered: no scenes, no subscribing, no teasers.
 *   text_only   the scenes, but no pictures, video or voiced lines (the UK: Online Safety Act s.79(4) leaves content that
 *               "consists only of text" outside Part 5; Japan: uncensored explicit images are obscene under Art. 175).
 *   open        everything, after an 18+ self-declaration.
 *
 * A place we can't read (no country, or a US visitor with no state) is blocked: the rules can't be applied to it.
 * Pure and dependency-free, so pages, APIs and the middleware can all ask it. Reading the place from a request is
 * lib/place.ts.
 */

export type AfterDarkMode = "open" | "text_only" | "blocked";
/** ISO 3166-1 alpha-2 country, and for the US the state's two-letter code (Vercel's x-vercel-ip-country-region). */
export type Place = { country: string | null; region: string | null };
export type Access = { mode: AfterDarkMode; place: Place; reason: string | null };

/**
 * The US states with an adult age-verification law in force (RecordingLaw's tracker, 2026-10-18; Free Speech
 * Coalition v. Paxton upheld them in 2025). Texas-style laws count written descriptions too, so text doesn't help.
 */
export const US_AGE_CHECK_STATES: Readonly<Record<string, string>> = {
  AL: "Alabama", AZ: "Arizona", AR: "Arkansas", FL: "Florida", GA: "Georgia", ID: "Idaho", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia", WV: "West Virginia", WY: "Wyoming",
};

/** Countries whose law wants a certified age check for adult content. */
export const AGE_CHECK_COUNTRIES: Readonly<Record<string, string>> = {
  FR: "France requires certified age checks for adult sites (Arcom).",
  IT: "Italy requires certified age checks on every visit (AGCOM).",
  DE: "Germany requires a closed adult user group (JMStV).",
  AU: "Australia requires age checks for AI companions that can be explicit (eSafety codes).",
  BR: "Brazil requires age checks for adult content (ECA Digital).",
};

/** Where publishing or distributing pornography is a crime, so After Dark isn't offered at all. */
const ILLEGAL_THERE = [
  "AE", "AF", "BD", "BH", "BN", "BY", "CN", "DZ", "EG", "ID", "IN", "IQ", "IR", "JO", "KP", "KR", "KW", "LB", "LY", "MA",
  "MM", "MY", "OM", "PH", "PK", "QA", "RU", "SA", "SD", "SO", "SY", "TH", "TM", "TN", "TR", "UA", "UG", "UZ", "VN", "YE",
] as const;

/** Countries where the scenes may run but pictures, video and voiced lines may not. */
export const TEXT_ONLY_COUNTRIES: Readonly<Record<string, string>> = {
  GB: "UK law (the Online Safety Act) requires a strict age check for pictures and video, so here After Dark is the scenes only.",
  JP: "Japanese law restricts explicit images, so here After Dark is the scenes only.",
};

const code = (value: string | null | undefined): string | null => {
  const v = value?.trim().toUpperCase();
  return v && /^[A-Z]{2}$/.test(v) ? v : null;
};

/** A place with its codes tidied (upper case, two letters, or null). */
export const place = (country: string | null | undefined, region?: string | null): Place => ({ country: code(country), region: code(region) });

/** What After Dark is allowed to be for someone connecting from this place. */
export function afterDarkAccess(where: Place): Access {
  const p = place(where.country, where.region);
  if (!p.country) return { mode: "blocked", place: p, reason: "We couldn't tell where you're connecting from, so After Dark can't open." };
  if (p.country === "US") {
    if (!p.region) return { mode: "blocked", place: p, reason: "We couldn't tell which US state you're in, so After Dark can't open." };
    const state = US_AGE_CHECK_STATES[p.region];
    if (state) return { mode: "blocked", place: p, reason: `${state} requires an age check by ID for adult sites, so After Dark isn't offered there.` };
    return { mode: "open", place: p, reason: null };
  }
  const check = AGE_CHECK_COUNTRIES[p.country];
  if (check) return { mode: "blocked", place: p, reason: `${check} After Dark isn't offered there.` };
  if ((ILLEGAL_THERE as readonly string[]).includes(p.country)) return { mode: "blocked", place: p, reason: "Adult content is against the law there, so After Dark isn't offered." };
  const textOnly = TEXT_ONLY_COUNTRIES[p.country];
  if (textOnly) return { mode: "text_only", place: p, reason: textOnly };
  return { mode: "open", place: p, reason: null };
}

/** The operator is exempt: an admin's After Dark is open wherever they are. */
export const adminAccess = (where: Place): Access => ({ mode: "open", place: place(where.country, where.region), reason: null });

/** Whether pictures, video and voiced lines may be made or shown here. */
export const mediaAllowed = (access: Pick<Access, "mode">): boolean => access.mode === "open";

/** The cookie After Dark's own host keeps the visitor's signed place in (lib/place.ts signs and verifies it). */
export const PLACE_COOKIE = "bz_place";
/** Set for a minute when the hop for a place has run, so a host that can't sign one never loops (middleware.ts). */
export const PLACE_TRIED_COOKIE = "bz_place_tried";

/** Just the expiry of a place cookie, unverified: the middleware's cheap "renew it?" check (pages verify it properly). */
export function placeCookieFresh(token: string | null | undefined, now = Date.now()): boolean {
  const expires = token?.split(".")[4];
  return Boolean(expires && /^\d+$/.test(expires) && Number(expires) >= Math.floor(now / 1000));
}
