/**
 * A character's portrait with its background taken out: the person alone, on transparent pixels, to stand beside a
 * scene's text the way joi.com's chat puts its character on the right (docs/audits/2026-11-20-joi-teardown.md).
 *
 * Made by Cloudflare, not by us: botchelor.com sits behind our own Cloudflare zone (docs/hosting.md, "DNS"), and its
 * image transformations take `segment=foreground` (BiRefNet, run by Cloudflare: developers.cloudflare.com/images/
 * optimization/features/#segment). A cutout is an ordinary transformation: the free plan gives 5,000 unique ones a
 * month and never bills past that (a new one fails instead, and the page falls back to the portrait as it is). Each
 * portrait is one unique transformation however often it's shown; Cloudflare caches it.
 *
 * Only a PG portrait ever goes in (the callers pass `portraitPathSql`'s path: the newest approved pg portrait), and
 * only the zone's own pictures can be transformed (the zone's transformations are set to its own origin). The
 * picture keeps its "AI-generated" XMP (`metadata=keep`; lib/ai-mark.ts stamps the source as it's served).
 *
 * Whether the zone does it at all is the zone's setting (Cloudflare → Images → Transformations), not ours, so the
 * server asks once (cutoutsReady: one tiny cutout of a house portrait) and keeps the answer for a while; until the
 * answer is yes, no page asks for a cutout and the figure shows the portrait itself, softened at its edges.
 * `CUTOUTS=0` turns them off whatever the zone says.
 */

import { siteUrl } from "./site";

/** The pictures a cutout can be made of: a served portrait (`/api/assets/<id>`) or a house file (`/cast/<file>`). */
const CUTTABLE = /^\/(api\/assets\/[^/?.]+|cast\/[\w.-]+\.(webp|png|jpe?g))$/;

/** Wide enough for the figure at twice its widest (34rem) on a 2x screen, near the portraits' own 768 to 1024px. */
export const CUTOUT_WIDTH = 900;

/** The transformation's options, in Cloudflare's URL form. */
export const CUTOUT_OPTIONS = `segment=foreground,width=${CUTOUT_WIDTH},fit=scale-down,format=webp,metadata=keep`;

/**
 * The cutout's address for a portrait path, on the show's own origin (the zone's): null for anything that isn't one of
 * our portraits, or when there's no https origin to ask (a local server).
 */
export function cutoutUrl(portrait: string | null | undefined, origin: string = siteUrl()): string | null {
  if (!portrait || !/^https:\/\//.test(origin)) return null;
  const path = portrait.split("?")[0];
  // The full picture, not a small copy: an asset's served path drops the CDN's .webp (app/Avatar.tsx sized) and its ?w=.
  const src = path.startsWith("/api/assets/") ? path.replace(/\.webp$/, "") : path;
  if (!CUTTABLE.test(src)) return null;
  return `${origin.replace(/\/+$/, "")}/cdn-cgi/image/${CUTOUT_OPTIONS}${src}`;
}

/** The house portrait the server asks for to learn whether the zone makes cutouts (a file every deploy ships). */
export const PROBE_PATH = "/cast/house-dex-v5.webp";
/** How long an answer is kept: a yes for an hour, a no for ten minutes (so turning it on shows up soon). */
const KEEP_YES_MS = 60 * 60_000;
const KEEP_NO_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 2_500;

type Fetch = typeof fetch;
let probeFetch: Fetch | null = null;
let forTests: boolean | null = null;
let known: { ready: boolean; until: number } | null = null;
let asking: Promise<boolean> | null = null;

/** Tests decide the answer (true or false) without asking anyone, and put it back with null. */
export function setCutoutsForTests(ready: boolean | null, f: Fetch | null = null): void {
  forTests = ready;
  probeFetch = f;
  known = null;
  asking = null;
}

/**
 * Whether cutouts can be shown: off with `CUTOUTS=0`, never in tests unless one says so, else the zone's answer to one
 * small cutout (an image back, not Cloudflare's 404 or error), kept as above. Never throws; a failed ask is a no.
 */
export async function cutoutsReady(env: Record<string, string | undefined> = process.env, now = Date.now()): Promise<boolean> {
  if (env.CUTOUTS === "0" || env.CUTOUTS === "off") return false;
  if (forTests !== null && !probeFetch) return forTests;
  if (!probeFetch && (env.NODE_ENV === "test" || env.VITEST)) return false;
  if (known && now < known.until) return known.ready;
  const url = cutoutUrl(PROBE_PATH, siteUrl(env))?.replace(`width=${CUTOUT_WIDTH}`, "width=16");
  if (!url) return false;
  asking ??= (async () => {
    let ready = false;
    try {
      const res = await (probeFetch ?? fetch)(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { "user-agent": "botchelor-cutout-check/1.0" } });
      ready = res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
      await res.body?.cancel().catch(() => {});
    } catch {
      ready = false;
    }
    known = { ready, until: now + (ready ? KEEP_YES_MS : KEEP_NO_MS) };
    return ready;
  })().finally(() => {
    asking = null;
  });
  return asking;
}
