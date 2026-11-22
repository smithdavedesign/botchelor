import { afterDarkOrigin } from "./after-dark-host";

/**
 * The headers every response carries (next.config.ts; 2026-11-10 company pass: the live site sent none). Each one is
 * safe for every route here:
 *  - HSTS: browsers that have been here once never try plain http again, on any of the site's addresses
 *    (includeSubDomains since 2026-11-22: www, ad, staging and media all serve https, and the mail records under it,
 *    Resend's, serve no pages at all). No preload: that list is hard to leave.
 *  - nosniff: a file is only ever read as the type we sent.
 *  - The Content-Security-Policy's three rules that can't break a page here: frame-ancestors 'self' (and X-Frame-Options
 *    for older browsers), so another site can't put the show in a frame and trick a click; object-src 'none', as no page
 *    embeds a plugin; base-uri 'self', so injected markup can't move where the page's relative links and scripts load
 *    from. The full policy is Report-Only for now (reportOnlyPolicy below): the browser says what it would block and
 *    blocks nothing.
 *  - Permissions-Policy: the browser features no page uses are off, for the page and anything framed in it. The
 *    microphone stays the site's own (a companion's live call, app/companion/[id]/live-audio.ts); fullscreen, autoplay,
 *    sharing and the clipboard keep the browser's default (this site only). Only names Chrome knows: it logs an error
 *    for any it doesn't.
 *  - Referrer-Policy: another site learns only that a visitor came from botchelor.com, never the page.
 */
export const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** The request header that carries a page load's nonce from the middleware to the layout (app/layout.tsx). */
export const NONCE_HEADER = "x-nonce";
/** Where browsers send what the Report-Only policy would have blocked (app/api/csp-report). */
export const CSP_REPORT_PATH = "/api/csp-report";
/** One page load in this many asks the browser to send its reports; every load still lists them in its console. */
export const CSP_REPORT_SAMPLE = 4;

/** A fresh nonce for one page load: 128 random bits, base64 (Web Crypto, so it runs in the middleware too). */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

type Env = Record<string, string | undefined>;

/** The settings the policy reads, spelled out (the middleware's process.env is read name by name). */
function policyEnv(): Env {
  try {
    return {
      MEDIA_BUNNY_CDN_HOST: process.env.MEDIA_BUNNY_CDN_HOST,
      MEDIA_S3_ENDPOINT: process.env.MEDIA_S3_ENDPOINT,
      SITE_URL: process.env.SITE_URL,
      AFTER_DARK_ORIGIN: process.env.AFTER_DARK_ORIGIN,
    };
  } catch {
    return {};
  }
}

/** An https origin from a setting that holds a URL or a bare host name, or null. */
function httpsOrigin(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v.includes("://") ? v : `https://${v}`);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Google Analytics 4's hosts, from Google's own guide to the tag under a CSP: the tag, its pings, and Signals'. */
const GOOGLE_TAG = ["https://*.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.g.doubleclick.net"];
/** RepoHQ's funnel beacon (app/funnel.ts SIGNAL_URL). */
const FUNNEL = "https://idea-factory.1426davejobs.workers.dev";
/** A companion's live call: Deepgram's listening socket (lib/companion-live.ts) and Simli's face stream, over LiveKit. */
const LIVE_CALLS = ["wss://api.deepgram.com", "https://api.simli.ai", "wss://api.simli.ai", "https://*.livekit.cloud", "wss://*.livekit.cloud"];

/**
 * The full policy, Report-Only (2026-11-22): a strict one, scripts by this load's nonce only ('strict-dynamic' lets the
 * scripts those load run too; 'self', https: and 'unsafe-inline' are what older browsers fall back on), and every
 * other kind of file from the hosts the pages really use: the media stores (Bunny's pull zone, the show's bucket), both
 * of the site's hosts, the Google tag, the funnel beacon and the live calls. Nothing is blocked: each browser lists what
 * would be in its console, and one load in CSP_REPORT_SAMPLE sends it to CSP_REPORT_PATH, logged there. Once those
 * logs are quiet the policy can be enforced. The nonce goes on Next's own scripts by itself (it reads it from this
 * header on the request: middleware.ts) and on the layout's inline ones by hand (app/layout.tsx).
 */
export function reportOnlyPolicy(nonce: string, opts: { report?: boolean } = {}, env: Env = policyEnv()): string {
  const sites = [httpsOrigin(env.SITE_URL), httpsOrigin(afterDarkOrigin(env) ?? undefined)];
  const media = [...new Set([httpsOrigin(env.MEDIA_BUNNY_CDN_HOST), httpsOrigin(env.MEDIA_S3_ENDPOINT), ...sites].filter((o): o is string => o !== null))];
  const list = (...parts: (string | string[])[]) => parts.flat().join(" ");
  const directives = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self' https: 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    list("img-src 'self' data: blob:", media, "https://launchnest.io", GOOGLE_TAG),
    list("media-src 'self' data: blob:", media),
    "font-src 'self' data:",
    list("connect-src 'self' data: blob:", media, GOOGLE_TAG, FUNNEL, LIVE_CALLS),
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];
  if (opts.report) directives.push(`report-uri ${CSP_REPORT_PATH}`);
  return directives.join("; ");
}
