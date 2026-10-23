import type { Metadata } from "next";
import { ADULT_RATING_META } from "./rating";

/**
 * Discreet mode for After Dark (competitor analysis, 2026-10-22: 14 of 15 blur, none has a PIN): what the layouts, the
 * CSS hook (app/after-dark/discreet.css) and the tap-to-reveal script (app/after-dark/DiscreetMedia.tsx) agree on. No
 * node: imports, so client components use it too; lib/adult/privacy.ts keeps the server side (the settings, the PIN).
 */

/** The tab title every After Dark page shows while the neutral title is on: the show's name, nothing more. */
export const NEUTRAL_TITLE = "Botchelor";

/** On the After Dark layouts' wrapper: "blur" while pictures and videos stay blurred until tapped, else "off". */
export const DISCREET_ATTR = "data-ad-discreet";
/** On a picture or video someone tapped to show. Leaving the page (or the tab) takes it off again. */
export const SHOWN_ATTR = "data-ad-shown";

/** A PIN is 4 to 6 digits. */
export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const PIN_RE = /^\d{4,6}$/;
/** Wrong tries before a wait, and how long the wait is. */
export const PIN_MAX_TRIES = 5;
export const PIN_LOCKOUT_MINUTES = 15;
/** How long a device stays unlocked after its PIN is entered. */
export const UNLOCK_HOURS = 12;
/** The emailed reset code: 8 digits, good for 15 minutes. */
export const RESET_CODE_RE = /^\d{8}$/;
export const RESET_CODE_MINUTES = 15;

/** What a person sets (lib/adult/privacy.ts): blur and the neutral title start on, the PIN starts off. */
export type Privacy = { blur: boolean; neutral_title: boolean; pin: boolean };
export const DEFAULT_PRIVACY: Privacy = { blur: true, neutral_title: true, pin: false };

/**
 * The pictures and videos the blur covers, inside a `[data-ad-discreet="blur"]` wrapper: every img, video and SVG image,
 * except the show's own PG portraits (Avatar's `.avatar`, the same pictures the show prints everywhere), unless one
 * of those is After Dark's own file. app/after-dark/discreet.css holds the same selectors (tests/discreet.test.ts).
 */
export const BLURRED_MEDIA_SELECTORS = [
  `:is(img, video, image):not(.avatar):not([${SHOWN_ATTR}])`,
  `:is(img, video)[src*="/after-dark/"]:not([${SHOWN_ATTR}])`,
  `image[href*="/after-dark/"]:not([${SHOWN_ATTR}])`,
] as const;
export const BLURRED_MEDIA = BLURRED_MEDIA_SELECTORS.join(", ");

/** The data attribute value for a wrapper: blur on, or off. */
export const discreetValue = (blur: boolean): "blur" | "off" => (blur ? "blur" : "off");

/**
 * The After Dark layouts' metadata: the adult labels always (lib/adult/rating.ts), and while the neutral title is on, a
 * template with no %s, so every page under it shows just "Botchelor" whatever title it sets. A layout's template never
 * reaches the page in its own folder, so /after-dark sets its own title (afterDarkTitle).
 */
export function afterDarkMetadata(neutralTitle: boolean): Metadata {
  return { other: ADULT_RATING_META, ...(neutralTitle ? { title: { default: NEUTRAL_TITLE, template: NEUTRAL_TITLE } } : {}) };
}

/** A page's own title under the neutral-title switch: "Botchelor" while it's on. */
export const afterDarkTitle = (neutralTitle: boolean, title: string): string => (neutralTitle ? NEUTRAL_TITLE : title);

/** "j•••@gmail.com": enough for the owner to know where the code went, not enough to read someone's address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "your email";
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/** "in 15 minutes", "in 1 minute", "in 40 seconds": when a wait set by wrong tries ends. */
export function waitText(seconds: number): string {
  if (seconds < 60) return `in ${Math.max(1, Math.ceil(seconds))} second${Math.ceil(seconds) === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
