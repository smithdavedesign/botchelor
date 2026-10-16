import { track } from "@vercel/analytics";

/**
 * The show's conversions, sent from the browser to Vercel Web Analytics (custom events) and, when the Google Tag
 * Manager container is loaded, to its dataLayer (so GA4 and any later tag can use them as conversions).
 * Props are small enums and booleans only — never a name, id, bio or anything a person typed.
 */
export type Conversion = "character_created" | "date_started" | "prediction_made" | "character_rated";

type Props = Record<string, string | number | boolean>;
type DataLayerWindow = Window & { dataLayer?: Record<string, unknown>[] };

export function trackConversion(name: Conversion, props: Props = {}): void {
  try {
    track(name, props);
  } catch {
    /* analytics must never break the page */
  }
  try {
    const w = window as DataLayerWindow;
    // Push only when GTM is on the page (NEXT_PUBLIC_GTM_ID set); otherwise there's no container to read it.
    if (Array.isArray(w.dataLayer)) w.dataLayer.push({ event: name, ...props });
  } catch {
    /* ignore */
  }
}
