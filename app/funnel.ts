/**
 * RepoHQ's funnel beacon: the owner's portfolio dashboard, whose growth loop reads it (idea-factory lib/growth.js).
 * `visit` once per browser session on any page, `activate` the first time this browser starts a date (the core
 * action, GROWTH.md), and `checkout` when someone clicks Buy, each with the page it happened on (beaconPath). A visit
 * from a shared episode link also carries its tag, `ref: "share"` (beaconRef).
 * Fire-and-forget POSTs with no cookies; RepoHQ keeps a keyed hash of the IP, never the address. Nothing is sent from
 * previews or local runs, from automated browsers, when localStorage "repohq:notrack" is set (the owner's own
 * browsers), or when the visitor declined analytics cookies.
 */
import { safeFrom } from "@/lib/age";
import { SHARE_REF } from "@/lib/episode-share";

export const SIGNAL_URL = "https://idea-factory.1426davejobs.workers.dev/api/ideas/signal";
export const SLUG = "botchelor";
export type FunnelKind = "visit" | "activate" | "checkout";

export type FunnelContext = { production: boolean; webdriver: boolean; notrack: boolean; consentDenied: boolean };

/** The send-or-not decision, pure so it's tested on its own. */
export function shouldSend(ctx: FunnelContext): boolean {
  return ctx.production && !ctx.webdriver && !ctx.notrack && !ctx.consentDenied;
}

/** document.referrer only when it's another site (our own pages aren't a source), else null. */
export function externalReferrer(referrer: string, origin: string): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).origin === origin ? null : referrer;
  } catch {
    return null;
  }
}

/**
 * The page an event counts for: this page, or on the 18+ gate the page the visitor was headed to (its `from`), so a
 * visitor from search who meets the gate first still counts for the page they came for. A ship name page counts as
 * /ship: its address holds the two names someone typed, and nothing typed goes to the beacon.
 */
export function beaconPath(pathname: string, search = ""): string {
  let path = pathname;
  const from = pathname === "/gate" ? new URLSearchParams(search).get("from") : null;
  if (from) path = safeFrom(from).split(/[?#]/)[0] || "/";
  return path === "/ship" || path.startsWith("/ship/") ? "/ship" : path;
}

/** The tags a link may carry (?ref=…) and the only ones sent: an episode's share links (lib/episode-share.ts). */
export const BEACON_REFS: readonly string[] = [SHARE_REF];

/**
 * The tag a visit came with: this page's ?ref, or on the 18+ gate the ?ref of the page the visitor was headed to (the
 * gate keeps it in `from`). Only a known tag, so nothing typed into an address reaches the beacon; otherwise null.
 */
export function beaconRef(pathname: string, search = ""): string | null {
  let query = search;
  if (pathname === "/gate") {
    const from = new URLSearchParams(search).get("from");
    query = from ? (safeFrom(from).split("#")[0].split("?")[1] ?? "") : "";
  }
  const ref = new URLSearchParams(query).get("ref");
  return ref && BEACON_REFS.includes(ref) ? ref : null;
}

/** Set by <FunnelBeacon> from the server: whether this is production, and this visitor's consent default. */
export type FunnelConfig = { production: boolean; consentDefault: boolean };
type FunnelWindow = Window & { __bzFunnel?: FunnelConfig };

export const NOTRACK_KEY = "repohq:notrack";

function context(): FunnelContext | null {
  const cfg = (window as FunnelWindow).__bzFunnel;
  if (!cfg) return null;
  // The owner's browser: the cookie middleware sets for ?repohq-notrack=1, or the older localStorage mark.
  let notrack = /(?:^|;\s*)repohq_notrack=1(?:;|$)/.test(document.cookie);
  try {
    notrack ||= Boolean(localStorage.getItem(NOTRACK_KEY));
  } catch {
    /* storage blocked: the cookie still counts */
  }
  // A choice made on the banner or the privacy page (lib/consent.ts) wins over the region's default.
  const stored = /(?:^|;\s*)bz_consent=(granted|denied)/.exec(document.cookie)?.[1];
  const granted = stored ? stored === "granted" : cfg.consentDefault;
  return { production: cfg.production, webdriver: Boolean(navigator.webdriver), notrack, consentDenied: !granted };
}

/** Whether this browser may send analytics at all: the same rule as the beacon (app/engagement.ts uses it too). */
export function trackingAllowed(): boolean {
  try {
    const ctx = context();
    return Boolean(ctx && shouldSend(ctx));
  } catch {
    return false;
  }
}

export function configureFunnel(cfg: FunnelConfig): void {
  (window as FunnelWindow).__bzFunnel = cfg;
}

/** visit: once per browser session; activate: once per browser; checkout: every Buy click. */
const ONCE: Partial<Record<FunnelKind, "session" | "local">> = { visit: "session", activate: "local" };

export function sendFunnel(kind: FunnelKind): void {
  try {
    const ctx = context();
    if (!ctx || !shouldSend(ctx)) return;
    const once = ONCE[kind];
    const store = once === "session" ? sessionStorage : once === "local" ? localStorage : null;
    if (store) {
      if (store.getItem(`repohq:${kind}`)) return;
      store.setItem(`repohq:${kind}`, "1");
    }
    // Where a visit came from; a date started or a Buy click is counted as before.
    const ref = kind === "visit" ? beaconRef(location.pathname, location.search) : null;
    // text/plain keeps it a "simple" cross-origin request (no preflight), which keepalive needs in every browser;
    // RepoHQ parses the body as JSON either way.
    void fetch(SIGNAL_URL, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({
        slug: SLUG,
        kind,
        path: beaconPath(location.pathname, location.search),
        referrer: externalReferrer(document.referrer, location.origin),
        ...(ref ? { ref } : {}),
      }),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    /* the beacon must never break the page */
  }
}
