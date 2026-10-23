import { GA_OFF_PATH } from "./ga-guard";

/**
 * Botchelor as an installable app (a PWA): the manifest (app/manifest.ts), the iOS tags (app/layout.tsx) and the
 * "Install the app" hint (app/InstallHint.tsx). Installed, it opens from the Home Screen in its own window, and on an
 * iPhone that's the only way its notifications reach you (web push needs the Home Screen app). Pure, so tests pin it.
 */

/** The app's name, and docs/brand.md's paper colour in each theme: the status bar and splash screen blend with the page. */
export const APP_NAME = "Botchelor";
export const PAPER_LIGHT = "#fdf6f4";
export const PAPER_DARK = "#130a16";

/**
 * The icons, all PG: the show's gradient tile and its heart (public/icon.svg), drawn to PNG by scripts/make-icons.mjs.
 * An installed app never shows anything from After Dark, whichever page it was installed from.
 */
export const APP_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const;
export const APPLE_TOUCH_ICON = "/icons/apple-touch-icon.png";
/** What a notification shows (public/sw.js): the tile, and the heart alone as Android's monochrome badge. */
export const NOTIFICATION_ICON = "/icons/icon-192.png";
export const NOTIFICATION_BADGE = "/icons/badge-96.png";

/* ------------------------------------------------- the install hint ------------------------------------------------- */

/** localStorage: "shown" once it has been on screen, "dismissed" or "installed" once the person chose. Never asked again. */
export const INSTALL_HINT_KEY = "bz_install_hint";
export type InstallChoice = "shown" | "dismissed" | "installed";

export type Platform = "ios" | "android" | "other";

/** iPhone and iPad (an iPad asks as a Mac, but with touch), Android, or anything else. */
export function platformOf(ua: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** An app's own browser (Instagram, Facebook, TikTok…) can't add to the Home Screen, so the hint would only nag. */
export const inAppBrowser = (ua: string): boolean => /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat|Line\/|LinkedInApp|Pinterest|GSA\//i.test(ua);

/** Where it never appears: After Dark and its admin pages (lib/ga-guard.ts), the admin pages, the 18+ gate, email links. */
export function installHintPathBlocked(pathname: string): boolean {
  return GA_OFF_PATH.test(pathname) || /^\/admin(\/|$)/.test(pathname) || pathname === "/gate" || pathname.startsWith("/email/");
}

export type InstallContext = {
  pathname: string;
  /** A phone-sized touch screen. */
  phone: boolean;
  /** Already running as the installed app. */
  standalone: boolean;
  /** What localStorage says (INSTALL_HINT_KEY), null when nothing yet. */
  stored: string | null;
  ua: string;
};

/** Whether to show the hint on this page view: a phone browser that can install, not installed, never shown before. */
export function shouldShowInstallHint(c: InstallContext): boolean {
  if (!c.phone || c.standalone || c.stored) return false;
  if (inAppBrowser(c.ua)) return false;
  return !installHintPathBlocked(c.pathname);
}

/** How to install, for a browser with no install prompt of its own. */
export function installSteps(platform: Platform): string {
  if (platform === "ios") return "In Safari, tap Share (the square with the arrow), then Add to Home Screen. Open Botchelor from there to turn on notifications.";
  return "Open your browser's menu (⋮), then Install app or Add to Home screen.";
}
