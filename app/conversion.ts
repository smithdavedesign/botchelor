import { track } from "@vercel/analytics";
import { gaOff } from "@/lib/ga-guard";
import { sendFunnel } from "./funnel";

/**
 * The show's conversions, sent from the browser to Vercel Web Analytics (custom events), to GA4 as gtag events
 * when GA is loaded (mark them as key events in GA4), and to the GTM dataLayer when the container is loaded.
 * Props are small enums and booleans only — never a name, id, bio or anything a person typed.
 */
export type Conversion =
  | "character_created"
  | "date_started"
  | "prediction_made"
  | "character_rated"
  // The showcase's reels (app/showcase/reels): which call to action was tapped (date, see_all, after_dark, create).
  | "reel_cta"
  // GA4's recommended names, so its reports and key-event suggestions pick them up.
  | "sign_up"
  | "begin_checkout"
  | "purchase";

type Props = Record<string, string | number | boolean>;
type DataLayerWindow = Window & { dataLayer?: Record<string, unknown>[]; gtag?: (...args: unknown[]) => void };

export function trackConversion(name: Conversion, props: Props = {}): void {
  try {
    track(name, props);
  } catch {
    /* analytics must never break the page */
  }
  try {
    const w = window as DataLayerWindow;
    // Nothing for Google from a tab that has shown After Dark (lib/ga-guard.ts; gtag.js would drop it anyway).
    if (!gaOff(w)) {
      // gtag is defined by the GA4 snippet (NEXT_PUBLIC_GA_ID set); a plain dataLayer object isn't a GA4 event.
      if (typeof w.gtag === "function") w.gtag("event", name, props);
      // Push only when GTM is on the page (NEXT_PUBLIC_GTM_ID set); otherwise there's no container to read it.
      if (Array.isArray(w.dataLayer)) w.dataLayer.push({ event: name, ...props });
    }
  } catch {
    /* ignore */
  }
  // Starting a date is the core action RepoHQ counts as activation (GROWTH.md); the beacon sends it once per browser.
  if (name === "date_started") sendFunnel("activate");
}
