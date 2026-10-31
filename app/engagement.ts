/**
 * The site's engagement beacon, in the browser: page views, the time and scroll on each page, every link and button
 * click, form sends, and the show's conversions (app/conversion.ts), queued and sent to /api/e in small batches
 * (lib/engagement.ts stores them; the admin page's Engagement tab reads them).
 *
 * What a click records: a control's data-track name when it has one (data-track-* attributes become its props), else a
 * link's page (its ids replaced) or the site it leads to, else a button's own label, cut to 40 characters, and the part
 * of the page it sat in (data-track-area, or nav/footer/dialog/main). Never what anyone typed: inputs, textareas and
 * anything inside [data-private] are skipped, and on After Dark's pages a button's label isn't sent at all.
 *
 * Nothing is sent where app/funnel.ts wouldn't send either: previews and local runs, automated browsers, the owner's
 * browsers, and when analytics cookies are turned off.
 */
import { beaconPath, beaconRef, externalReferrer, trackingAllowed } from "./funnel";

export const ENDPOINT = "/api/e";
const VISITOR_KEY = "bz_vid";
const SESSION_KEY = "bz_sid";
/** A visit ends after half an hour with nothing new, as GA4 counts it. */
const SESSION_IDLE_MS = 30 * 60_000;
const FLUSH_MS = 4_000;
const MAX_QUEUE = 25;
const LABEL_MAX = 40;

type Props = Record<string, string | number | boolean>;
type Queued = { e: string; path: string; props?: Props; t: number };
type Source = { ref_host?: string | null; utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_content?: string | null; ref?: string | null };
type SessionState = { id: string; last: number; src: Source };

let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let afterDarkHost = false;

const randomId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** This browser's id: random, kept in localStorage (a fresh one per visit when storage is blocked). */
function visitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = randomId();
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return (memoryVisitor ??= randomId());
  }
}
let memoryVisitor: string | null = null;
let memorySession: SessionState | null = null;

/** Where a visit came from, read once when it starts: the link's utm tags and ref, and the referring site's host. */
export function sourceFrom(search: string, pathname: string, referrer: string, origin: string): Source {
  const params = new URLSearchParams(pathname === "/gate" ? (new URLSearchParams(search).get("from")?.split("?")[1] ?? "") : search);
  const tag = (k: string) => params.get(k)?.trim().slice(0, 60) || null;
  const external = externalReferrer(referrer, origin);
  let host: string | null = null;
  try {
    host = external ? new URL(external).hostname : null;
  } catch {
    host = null;
  }
  return { ref_host: host, utm_source: tag("utm_source"), utm_medium: tag("utm_medium"), utm_campaign: tag("utm_campaign"), utm_content: tag("utm_content"), ref: beaconRef(pathname, search) };
}

/** This tab's visit, renewed after half an hour idle (a new visit keeps no source from the old one). */
function sessionState(now = Date.now()): SessionState {
  const fresh = (): SessionState => ({ id: randomId(), last: now, src: sourceFrom(location.search, location.pathname, document.referrer, location.origin) });
  let s: SessionState | null = null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    s = raw ? (JSON.parse(raw) as SessionState) : null;
  } catch {
    s = memorySession;
  }
  if (!s || typeof s.id !== "string" || now - Number(s.last) > SESSION_IDLE_MS) s = fresh();
  s.last = now;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    memorySession = s;
  }
  return s;
}

const currentPath = (): string => beaconPath(location.pathname, location.search);

/** Queue one event; it goes with the next batch (at most a few seconds later, or when the page is hidden). */
export function queueEvent(name: string, props: Props = {}, at?: string): void {
  try {
    if (typeof window === "undefined" || !trackingAllowed()) return;
    const path = at ?? currentPath();
    // Starts (or renews) the visit now, so its source is read from the address it landed on, not a later page's.
    sessionState();
    queue.push({ e: name, path, props, t: Date.now() });
    if (queue.length >= MAX_QUEUE) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_MS);
  } catch {
    /* analytics must never break the page */
  }
}

/** Send what's queued: sendBeacon (survives the page closing), else a keepalive fetch. */
export function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  const events = queue.splice(0, MAX_QUEUE);
  try {
    const s = sessionState();
    const body = JSON.stringify({ v: visitorId(), s: s.id, src: s.src, events });
    const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }));
    if (!sent) void fetch(ENDPOINT, { method: "POST", headers: { "content-type": "text/plain" }, body, keepalive: true, credentials: "same-origin" }).catch(() => {});
  } catch {
    /* dropped */
  }
  if (queue.length) timer = setTimeout(flush, 0);
}

/* ---------------------------------------------------- pages and time ---------------------------------------------------- */

let page: { path: string; started: number; visibleMs: number; visibleSince: number | null; scroll: number } | null = null;

const scrollPercent = (): number => {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  return max <= 0 ? 100 : Math.min(100, Math.round((window.scrollY / max) * 100));
};

/** Close the page being timed: how long it was on screen (seconds, visible time only) and how far down it was read. */
function leavePage(): void {
  if (!page) return;
  const now = Date.now();
  const visible = page.visibleMs + (page.visibleSince !== null ? now - page.visibleSince : 0);
  queueEvent("page_leave", { seconds: Math.round(visible / 1000), scroll: page.scroll }, page.path);
  page = null;
}

/** A page opened (first load or a client-side move): counts the view and starts its timer. */
export function pageView(): void {
  const path = currentPath();
  if (page?.path === path) return;
  leavePage();
  page = { path, started: Date.now(), visibleMs: 0, visibleSince: document.visibilityState === "visible" ? Date.now() : null, scroll: scrollPercent() };
  if (path === "/create") queueEvent("create_opened", {}, path);
  queueEvent("page_view", {}, path);
}

function onScroll(): void {
  if (page) page.scroll = Math.max(page.scroll, scrollPercent());
}

function onVisibility(): void {
  if (!page) return;
  if (document.visibilityState === "hidden") {
    if (page.visibleSince !== null) page.visibleMs += Date.now() - page.visibleSince;
    page.visibleSince = null;
    // The last beat this page may get: count its time so far, and send everything now.
    const { path, visibleMs, scroll } = page;
    queueEvent("page_leave", { seconds: Math.round(visibleMs / 1000), scroll }, path);
    page.visibleMs = 0;
    flush();
  } else page.visibleSince = Date.now();
}

/* -------------------------------------------------------- clicks -------------------------------------------------------- */

const CLICKABLE = "a[href],button,summary,[role=button],[role=tab],[role=menuitem],[data-track]";

/** The part of the page an element sits in: its data-track-area, else the landmark around it. */
export function areaOf(el: Element): string {
  const named = el.closest("[data-track-area]")?.getAttribute("data-track-area");
  if (named) return named.slice(0, 30);
  if (el.closest("dialog,[role=dialog]")) return "dialog";
  if (el.closest("nav,header")) return "nav";
  if (el.closest("footer")) return "footer";
  return "main";
}

/** A control's label as sent: its aria-label or text, whitespace folded, numbers as #, at most 40 characters. */
export function labelOf(el: Element): string | null {
  const raw = el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.textContent || "";
  const label = raw.replace(/\s+/g, " ").trim().replace(/\d+(?:[.,]\d+)?/g, "#").slice(0, LABEL_MAX);
  return label || null;
}

/** data-track-foo="x" on a control becomes the prop foo: "x" (data-track itself is the event's name). */
function trackProps(el: Element): Props {
  const out: Props = {};
  for (const { name, value } of Array.from(el.attributes)) {
    if (!name.startsWith("data-track-") || name === "data-track-area") continue;
    const key = name.slice("data-track-".length).replace(/-/g, "_");
    out[key] = value === "true" ? true : value === "false" ? false : value.slice(0, 60);
  }
  return out;
}

/** The event a click makes, or null for a click on nothing we count. Pure but for the element: tested on its own. */
export function clickEvent(target: Element, origin: string, afterDark: boolean): { name: string; props: Props } | null {
  if (target.closest("[data-private],input,textarea,select,[contenteditable=true]")) return null;
  const el = target.closest(CLICKABLE);
  if (!el) return null;
  const area = areaOf(el);
  const named = el.closest("[data-track]");
  if (named) return { name: named.getAttribute("data-track")!.slice(0, 40), props: { ...trackProps(named), area } };
  if (el.tagName === "A") {
    const href = el.getAttribute("href") ?? "";
    if (href.startsWith("#") || href.startsWith("javascript:")) return null;
    let url: URL;
    try {
      url = new URL(href, origin);
    } catch {
      return null;
    }
    if (url.protocol === "mailto:" || url.protocol === "tel:") return { name: "outbound_click", props: { host: url.protocol.replace(":", ""), area } };
    const ours = url.origin === origin || /(^|\.)botchelor\.com$/.test(url.hostname);
    return ours ? { name: "link_click", props: { to: beaconPath(url.pathname, url.search), area } } : { name: "outbound_click", props: { host: url.hostname.replace(/^www\./, ""), area } };
  }
  const label = afterDark ? null : labelOf(el);
  return { name: "button_click", props: label ? { label, area } : { area } };
}

function onClick(e: MouseEvent): void {
  try {
    if (!(e.target instanceof Element)) return;
    const afterDark = afterDarkHost || location.pathname.startsWith("/after-dark") || location.pathname.startsWith("/studio");
    const ev = clickEvent(e.target, location.origin, afterDark);
    if (ev) queueEvent(ev.name, ev.props);
  } catch {
    /* ignore */
  }
}

function onSubmit(e: SubmitEvent): void {
  try {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || form.closest("[data-private]")) return;
    const name = form.getAttribute("data-track") ?? form.getAttribute("name") ?? form.getAttribute("aria-label") ?? form.id ?? "";
    queueEvent("form_submit", { form: name.slice(0, 40) || "form", area: areaOf(form) });
  } catch {
    /* ignore */
  }
}

let started = false;

/** Start listening (once per page load). <Engagement> calls it after the funnel is configured. */
export function startEngagement(opts: { afterDarkHost: boolean }): void {
  afterDarkHost = opts.afterDarkHost;
  if (started) return;
  started = true;
  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("submit", onSubmit, { capture: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", () => {
    leavePage();
    flush();
  });
}

export function resetEngagementForTests(): void {
  queue = [];
  page = null;
  started = false;
  memorySession = null;
  memoryVisitor = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
