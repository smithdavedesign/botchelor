import { track } from "@vercel/analytics";

/**
 * The show's conversions, sent from the browser to Vercel Web Analytics (custom events), to GA4 as gtag events
 * when GA is loaded (mark them as key events in GA4), and to the GTM dataLayer when the container is loaded.
 * Props are small enums and booleans only — never a name, id, bio or anything a person typed.
 */
export type Conversion = "character_created" | "date_started" | "prediction_made" | "character_rated";

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
    // gtag is defined by the GA4 snippet (NEXT_PUBLIC_GA_ID set); a plain dataLayer object isn't a GA4 event.
    if (typeof w.gtag === "function") w.gtag("event", name, props);
    // Push only when GTM is on the page (NEXT_PUBLIC_GTM_ID set); otherwise there's no container to read it.
    if (Array.isArray(w.dataLayer)) w.dataLayer.push({ event: name, ...props });
  } catch {
    /* ignore */
  }
}
