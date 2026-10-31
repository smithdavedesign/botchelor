/**
 * Cookie consent for Google Analytics (Google Consent Mode v2). Our own engagement log (app/engagement.ts) follows the
 * same choice: nothing is sent when analytics cookies are turned off.
 *
 * Visitors in the EEA, the UK and Switzerland start with analytics cookies off and see a banner; everyone else starts
 * with them on. Either way the choice lives in the CONSENT_COOKIE, which the privacy page can change at any time.
 * Ad storage is always denied: the site runs no ads.
 */

export const CONSENT_COOKIE = "bz_consent";

// EEA (EU 27 + Iceland, Liechtenstein, Norway), the UK and Switzerland, as ISO 3166-1 alpha-2 codes.
const CONSENT_REGIONS = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT",
  "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
]);

/** An unknown country (no geo header) asks, so a gap in geo data never sets cookies without consent. */
export function consentRequired(country: string | null | undefined): boolean {
  return !country || CONSENT_REGIONS.has(country.toUpperCase());
}

export type AnalyticsConsent = { granted: boolean; ask: boolean };

/** A stored choice wins; otherwise the region decides, and a consent region gets the banner. */
export function analyticsConsent(stored: string | null | undefined, country: string | null | undefined): AnalyticsConsent {
  if (stored === "granted") return { granted: true, ask: false };
  if (stored === "denied") return { granted: false, ask: false };
  const required = consentRequired(country);
  return { granted: !required, ask: required };
}

/** The consent default, which must run before the Google tags load (it shares their dataLayer). */
export function consentDefaultScript(granted: boolean): string {
  const state = JSON.stringify({
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: granted ? "granted" : "denied",
  });
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',${state});`;
}

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

/** Store the visitor's choice for a year and apply it to the Google tags already on the page. */
export function saveConsent(granted: boolean): void {
  const value = granted ? "granted" : "denied";
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
  try {
    (window as GtagWindow).gtag?.("consent", "update", { analytics_storage: value });
  } catch {
    /* analytics must never break the page */
  }
}
