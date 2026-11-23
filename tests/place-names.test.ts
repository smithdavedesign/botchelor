/**
 * The place name generator (lib/place-names.ts, app/tools/place-name-generator, 2026-11-23): twelve places a page in
 * the OC name generator's five styles and four kinds, deterministic, filtered, and wired into the tools hub, the
 * sitemap and /create?hometown=.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StylePage, { generateMetadata as styleMetadata, generateStaticParams } from "@/app/tools/place-name-generator/[style]/page";
import PlacesPage, { generateMetadata as placesMetadata } from "@/app/tools/place-name-generator/page";
import { checkFields } from "@/lib/safety";
import { staticSitemap } from "@/lib/seo";
import { FREE_TOOLS } from "@/lib/tools";
import { readFileSync } from "node:fs";
import {
  createFromPlace,
  isHometown,
  PLACE_KINDS,
  PLACE_NAMES_MAX_BATCH,
  PLACE_NAMES_PATH,
  PLACE_NAMES_SHOWN,
  PLACE_STYLES,
  placeNames,
  placeNamesHref,
  readPlaceBatch,
  readPlaceKind,
  readPlaceStyle,
} from "@/lib/place-names";

const sp = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("place name generator (lib/place-names.ts)", () => {
  it("gives twelve different, allowed places for every style and kind, the same every time", () => {
    for (const style of [null, ...PLACE_STYLES]) {
      for (const kind of PLACE_KINDS) {
        for (const batch of [1, 2, 57, PLACE_NAMES_MAX_BATCH]) {
          const places = placeNames({ style, kind, batch });
          const label = `${style} ${kind} ${batch}`;
          expect(places, label).toHaveLength(PLACE_NAMES_SHOWN);
          expect(new Set(places.map((p) => p.name)).size, label).toBe(PLACE_NAMES_SHOWN);
          for (const p of places) {
            // Starts with a capital, no braces left over, no doubled word ("the Owl and Owl"), no "s's".
            expect(p.name, label).toMatch(/^[A-Z][\p{L}0-9 '&.-]+$/u);
            expect(p.name).not.toMatch(/[{}]|s's\b|\b(\w+) and \1\b|\b(\w+) & \2\b/);
            // No three of a letter in a row in a word (Roman numerals like III are fine).
            expect(p.name).not.toMatch(/([a-z])\1\1/);
            expect(p.what.length).toBeGreaterThan(2);
            expect(checkFields({ name: p.name }).ok).toBe(true);
            if (style) expect(p.style).toBe(style);
            if (kind !== "any") expect(p.kind).toBe(kind);
          }
          expect(placeNames({ style, kind, batch }), label).toEqual(places);
        }
      }
    }
  });

  it("mixes styles and kinds on the plain page, and changes from batch to batch", () => {
    const mixed = placeNames({});
    expect(new Set(mixed.map((p) => p.style)).size).toBe(PLACE_STYLES.length);
    expect(new Set(mixed.map((p) => p.kind)).size).toBe(4);
    expect(placeNames({ batch: 2 }).map((p) => p.name)).not.toEqual(mixed.map((p) => p.name));
  });

  it("reads addresses forgivingly and writes them short", () => {
    expect(readPlaceStyle("sci-fi")).toBe("scifi");
    expect(readPlaceStyle("Gothic")).toBe("gothic");
    expect(readPlaceStyle("steampunk")).toBeNull();
    expect(readPlaceKind("venue")).toBe("venue");
    expect(readPlaceKind("castle")).toBe("any");
    expect(readPlaceBatch("3")).toBe(3);
    expect(readPlaceBatch("0")).toBe(1);
    expect(readPlaceBatch("abc")).toBe(1);
    expect(readPlaceBatch(String(PLACE_NAMES_MAX_BATCH + 1))).toBe(1);
    expect(placeNamesHref(null)).toBe(PLACE_NAMES_PATH);
    expect(placeNamesHref("cozy")).toBe(`${PLACE_NAMES_PATH}/cozy`);
    expect(placeNamesHref("fantasy", "venue", 4)).toBe(`${PLACE_NAMES_PATH}/fantasy?kind=venue&batch=4`);
    expect(createFromPlace("Honey St. Giles")).toBe("/create?hometown=Honey%20St.%20Giles");
  });
});

describe("place name generator pages (app/tools/place-name-generator)", () => {
  it("shows twelve places, the style and kind links, more places, and a hometown link on towns and realms only", async () => {
    const html = text(renderToStaticMarkup(await PlacesPage(sp())));
    const places = placeNames({});
    expect(html).toContain("<h1>Place name generator</h1>");
    for (const p of places) expect(html).toContain(`<strong>${p.name}</strong>`);
    const hometowns = places.filter(isHometown);
    expect(hometowns.length).toBeGreaterThan(0);
    expect(hometowns.length).toBeLessThan(places.length);
    expect(html.match(/Make a character from here/g)).toHaveLength(hometowns.length);
    for (const p of hometowns) expect(html).toContain(`href="${createFromPlace(p.name).replace(/&/g, "&")}"`);
    for (const s of PLACE_STYLES) expect(html).toContain(`href="${placeNamesHref(s)}"`);
    expect(html).toContain(`href="${placeNamesHref(null, "any", 2)}"`);
    expect(html).toContain('"@type":"WebApplication"');
  });

  it("has a page per style, indexed once, with variants followed but not indexed", async () => {
    expect(generateStaticParams()).toEqual(PLACE_STYLES.map((style) => ({ style })));
    const html = text(renderToStaticMarkup(await StylePage({ params: Promise.resolve({ style: "gothic" }), ...sp({ kind: "venue" }) })));
    expect(html).toContain("<h1>Gothic place name generator</h1>");
    for (const p of placeNames({ style: "gothic", kind: "venue" })) expect(html).toContain(`<strong>${p.name}</strong>`);
    const plain = await styleMetadata({ params: Promise.resolve({ style: "gothic" }), ...sp() });
    expect(plain.alternates?.canonical).toBe(`${PLACE_NAMES_PATH}/gothic`);
    expect(plain.robots).toBeUndefined();
    const variant = await styleMetadata({ params: Promise.resolve({ style: "gothic" }), ...sp({ batch: "2" }) });
    expect(variant.robots).toEqual({ index: false, follow: true });
    expect((await placesMetadata(sp())).alternates?.canonical).toBe(PLACE_NAMES_PATH);
  });

  it("is on the tools hub, in the sitemap with its style pages, and its hometown reaches the builder", () => {
    expect(FREE_TOOLS.map((t) => t.path)).toContain(PLACE_NAMES_PATH);
    const sitemap = staticSitemap("https://botchelor.com").map((e) => new URL(e.url).pathname);
    for (const path of [PLACE_NAMES_PATH, ...PLACE_STYLES.map((s) => placeNamesHref(s))]) expect(sitemap, path).toContain(path);
    const page = readFileSync("app/create/page.tsx", "utf8");
    expect(page).toContain("startHometown={typeof sp.hometown");
    const wizard = readFileSync("app/create/CreateWizard.tsx", "utf8");
    expect(wizard).toContain("startHometown ? { hometown: startHometown } : {}");
    expect(wizard).toContain("if (startName || startHometown || startPair) return;");
  });
});
