import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata as adminAfterDarkMetadata } from "@/app/admin/after-dark/layout";
import { metadata as afterDarkMetadata } from "@/app/after-dark/layout";
import { trackConversion } from "@/app/conversion";
import { ADULT_RATING_META } from "@/lib/adult/rating";
import { GA_OFF_FLAG, gaGuardScript, gaOff, gaOffPath } from "@/lib/ga-guard";

// After Dark's pages (terms review, 2026-10-22): labelled adult, and never seen by Google Analytics.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GA_ID = "G-VHL1LZTPHL";
const DISABLE = `ga-disable-${GA_ID}`;

type FakeWindow = Record<string, unknown> & {
  location: { href: string; pathname: string };
  history: { pushState: (...a: unknown[]) => void; replaceState: (...a: unknown[]) => void };
};

/** As much of a browser tab as the head script touches, with that script run in it the way <head> runs it. */
function tab(path: string, referrer = "", gaId: string | null = GA_ID) {
  const visited: string[] = [];
  const popstate: (() => void)[] = [];
  const w = { document: { referrer }, addEventListener: (type: string, fn: () => void) => type === "popstate" && popstate.push(fn) } as unknown as FakeWindow;
  const go = (u: unknown) => {
    const url = new URL(String(u), w.location.href);
    w.location = { href: url.href, pathname: url.pathname };
    visited.push(url.pathname);
  };
  w.location = { href: new URL(path, "https://botchelor.com").href, pathname: new URL(path, "https://botchelor.com").pathname };
  // The browser's own methods, which refuse to run on anything but the history object.
  function native(this: unknown, _state: unknown, _title: unknown, url?: unknown) {
    if (this !== w.history) throw new TypeError("Illegal invocation");
    if (url != null) go(url);
  }
  w.history = { pushState: native, replaceState: native };
  new Function("window", gaGuardScript(gaId))(w);
  /** Back or forward to an address: the browser changes it, then fires popstate. */
  const traverse = (to: string) => {
    go(to);
    popstate.forEach((fn) => fn());
  };
  return { w, visited, traverse, off: () => w[DISABLE] === true };
}

describe("After Dark's pages are labelled adult", () => {
  it("the After Dark layouts (the pages and their admin pages) set the rating and RTA meta tags", () => {
    const labels = { rating: "adult", RATING: "RTA-5042-1996-1400-1577-RTA" };
    expect(ADULT_RATING_META).toEqual(labels);
    expect(afterDarkMetadata.other).toEqual(labels);
    expect(adminAfterDarkMetadata.other).toEqual(labels);
  });
});

describe("Google Analytics never sees After Dark", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const AFTER_DARK = ["/after-dark", "/after-dark/", "/after-dark/house-a/house-b?play=1", "/after-dark/subscribe", "/admin/after-dark", "/admin/after-dark/graph?a=x", "/After-Dark"];
  const ELSEWHERE = ["/", "/admin", "/admin/season", "/after-darkness", "/characters/after-dark", "/watch/after-dark-1", "/shop?after-dark=1"];

  it("knows After Dark's pages by their path", () => {
    for (const p of AFTER_DARK) expect(gaOffPath(new URL(p, "https://x.test").pathname), p).toBe(true);
    for (const p of ELSEWHERE) expect(gaOffPath(new URL(p, "https://x.test").pathname), p).toBe(false);
  });

  it("turns gtag.js's own opt-out on for a page load of an After Dark page, and nowhere else", () => {
    for (const p of AFTER_DARK) {
      const { w, off } = tab(p);
      expect(off(), p).toBe(true);
      expect(gaOff(w), p).toBe(true);
    }
    for (const p of ELSEWHERE) {
      const { w, off } = tab(p);
      expect(off(), p).toBe(false);
      expect(gaOff(w), p).toBe(false);
    }
  });

  it("and for a page load that came from an After Dark page, whose address would go to GA as the referrer", () => {
    expect(tab("/", "https://botchelor.com/after-dark/house-a/house-b").off()).toBe(true);
    expect(tab("/characters", "https://botchelor.com/admin/after-dark/settings").off()).toBe(true);
    expect(tab("/", "https://www.google.com/").off()).toBe(false);
    expect(tab("/", "https://botchelor.com/characters").off()).toBe(false);
    expect(tab("/", "").off()).toBe(false);
  });

  it("turns it on before a client-side navigation reaches After Dark, and keeps it on in that tab", () => {
    const t = tab("/characters");
    t.w.history.pushState({}, "", "/watch/abc");
    expect(t.off()).toBe(false);
    t.w.history.pushState({}, "", "/after-dark/house-a/house-b");
    expect(t.off()).toBe(true);
    // Leaving After Dark in the app would send its address as the next page_view's page_referrer: GA stays off.
    t.w.history.pushState({}, "", "/");
    expect(t.off()).toBe(true);
    // Every navigation still happened, in order.
    expect(t.visited).toEqual(["/watch/abc", "/after-dark/house-a/house-b", "/"]);
  });

  it("covers replaceState, URL objects, a bound or detached call (Next's router binds it), and back/forward", () => {
    const replaced = tab("/");
    replaced.w.history.replaceState(null, "", "/admin/after-dark/graph");
    expect(replaced.off()).toBe(true);
    const bound = tab("/");
    const push = bound.w.history.pushState.bind(bound.w.history);
    push(null, "", new URL("https://botchelor.com/after-dark?x=1"));
    expect(bound.off()).toBe(true);
    const detached = tab("/");
    const { pushState } = detached.w.history;
    pushState({}, "", "/after-dark");
    expect(detached.off()).toBe(true);
    expect(detached.visited).toEqual(["/after-dark"]);
    const back = tab("/");
    back.traverse("/after-dark/house-a/house-b");
    expect(back.off()).toBe(true);
    // A state-only update (no address) changes nothing.
    const stateOnly = tab("/");
    stateOnly.w.history.replaceState({ k: 1 }, "");
    expect(stateOnly.off()).toBe(false);
  });

  it("without a measurement id it still sets the switch the site's own events read", () => {
    const t = tab("/after-dark", "", null);
    expect(gaOff(t.w)).toBe(true);
    expect(Object.keys(t.w).some((k) => k.startsWith("ga-disable-"))).toBe(false);
  });

  it("the site's own events skip Google once the tab has turned it off", () => {
    const gtag = vi.fn();
    const dataLayer: unknown[] = [];
    vi.stubGlobal("window", { [GA_OFF_FLAG]: true, gtag, dataLayer });
    trackConversion("character_created", { open_to_dates: true });
    expect(gtag).not.toHaveBeenCalled();
    expect(dataLayer).toEqual([]);
    vi.stubGlobal("window", { gtag, dataLayer });
    trackConversion("character_created", { open_to_dates: true });
    expect(gtag).toHaveBeenCalledWith("event", "character_created", { open_to_dates: true });
    expect(dataLayer).toEqual([{ event: "character_created", open_to_dates: true }]);
  });

  it("nothing on the site sends Google a page title or address of its own", () => {
    const files = ["app", "lib"].flatMap((dir) =>
      readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
        .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
        .map((f) => join(dir, f)),
    );
    expect(files.length).toBeGreaterThan(50);
    const sending = files.filter((f) => f !== join("lib", "ga-guard.ts") && /\bpage_(title|location|path|referrer)\b/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(sending).toEqual([]);
  });
});
