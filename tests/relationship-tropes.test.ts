/**
 * The relationship trope generator (lib/relationship-tropes.ts, app/tools/relationship-trope-generator, 2026-11-23):
 * six hand-written tropes a page in five moods, deterministic, filtered, two optional names in the first scenes, and
 * wired into the tools hub and the sitemap.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MoodPage, { generateMetadata as moodMetadata, generateStaticParams } from "@/app/tools/relationship-trope-generator/[mood]/page";
import TropesPage, { generateMetadata as tropesMetadata } from "@/app/tools/relationship-trope-generator/page";
import ToolPreview from "@/app/tools/ToolPreview";
import { checkFields } from "@/lib/safety";
import { DESCRIPTION_MAX, staticSitemap } from "@/lib/seo";
import { PUBLIC_PATHS } from "@/lib/site";
import { FREE_TOOLS } from "@/lib/tools";
import {
  firstScene,
  POPULAR_TROPES,
  readTropeBatch,
  readTropeMood,
  readTropeNames,
  shipHrefFor,
  TROPE_FAQ,
  TROPE_MOODS,
  TROPES,
  TROPES_MAX_BATCH,
  TROPES_PATH,
  TROPES_SHOWN,
  tropes,
  tropesHref,
} from "@/lib/relationship-tropes";

const sp = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const ANON = { a: "A", b: "B", typedA: "", typedB: "" };

describe("the tropes (lib/relationship-tropes.ts)", () => {
  it("has about sixty, twelve a mood, each with a line, a first scene for both, and nothing the filter refuses", () => {
    expect(TROPES.length).toBe(60);
    expect(new Set(TROPES.map((tr) => tr.id)).size).toBe(TROPES.length);
    expect(new Set(TROPES.map((tr) => tr.name.toLowerCase())).size).toBe(TROPES.length);
    for (const m of TROPE_MOODS) expect(TROPES.filter((tr) => tr.mood === m), m).toHaveLength(12);
    for (const tr of TROPES) {
      expect(tr.id, tr.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(tr.how.length, tr.name).toBeGreaterThan(20);
      expect(tr.how, tr.name).toMatch(/[.!?]$/);
      expect(tr.scene, tr.name).toMatch(/\{A\}/);
      expect(tr.scene, tr.name).toMatch(/\{B\}/);
      expect(tr.scene.replace(/\{[AB]\}/g, ""), tr.name).not.toMatch(/[{}]/);
      expect(checkFields({ name: tr.name, how: tr.how, scene: firstScene(tr, { a: "Juniper", b: "Dex" }) }).ok, tr.name).toBe(true);
    }
  });

  it("names in the FAQ's popular list are all in the pool, and the FAQ counts the pool", () => {
    const names = new Set(TROPES.map((tr) => tr.name));
    for (const n of POPULAR_TROPES) expect(names, n).toContain(n);
    expect(TROPE_FAQ.map((f) => f.q)).toEqual(["What is a relationship trope?", "What are the most popular romance tropes?", "How do I pick a trope for my ship?"]);
    expect(TROPE_FAQ[1].a).toContain(`has ${TROPES.length} of them, in 5 moods: sweet, slow burn, angsty, funny and flirty.`);
  });

  it("gives six different tropes for every mood and batch, the same every time", () => {
    for (const mood of [null, ...TROPE_MOODS]) {
      for (const batch of [1, 2, 3, 57, TROPES_MAX_BATCH]) {
        const page = tropes({ mood, batch });
        const label = `${mood} ${batch}`;
        expect(page, label).toHaveLength(TROPES_SHOWN);
        expect(new Set(page.map((tr) => tr.id)).size, label).toBe(TROPES_SHOWN);
        if (mood) for (const tr of page) expect(tr.mood, label).toBe(mood);
        expect(tropes({ mood, batch }), label).toEqual(page);
      }
    }
  });

  it("walks through the pool before repeating, and mixes the moods on the plain page", () => {
    const first = new Set([1, 2].flatMap((batch) => tropes({ mood: "angsty", batch }).map((tr) => tr.id)));
    expect(first.size).toBe(12);
    const all = new Set(Array.from({ length: 10 }, (_, i) => tropes({ batch: i + 1 }).map((tr) => tr.id)).flat());
    expect(all.size).toBe(TROPES.length);
    expect(new Set(tropes({}).map((tr) => tr.mood)).size).toBe(TROPE_MOODS.length);
    expect(tropes({ batch: 11 }).map((tr) => tr.id)).not.toEqual(tropes({}).map((tr) => tr.id));
  });

  it("puts two names in the first scenes, and falls back to A and B for anything that isn't a fine name", () => {
    const fine = readTropeNames(" Juniper ", "Dex");
    expect(fine).toEqual({ a: "Juniper", b: "Dex", typedA: "Juniper", typedB: "Dex" });
    const tr = TROPES.find((x) => x.id === "fake-dating")!;
    expect(firstScene(tr, fine)).toBe("Juniper needs a date for their sister's wedding, and Dex owes them a favour.");
    expect(firstScene(tr, ANON)).toBe("A needs a date for their sister's wedding, and B owes them a favour.");
    // Too long, not a name, missing: that side is A or B, never shown back.
    expect(readTropeNames("x".repeat(25), "Dex")).toEqual({ a: "A", b: "Dex", typedA: "", typedB: "Dex" });
    expect(readTropeNames("<script>", undefined)).toEqual(ANON);
    expect(readTropeNames(["Juniper"], "")).toEqual(ANON);
    // A word the filter keeps out, or a real person read as a pair.
    expect(readTropeNames("porn", "Dex")).toEqual({ a: "A", b: "Dex", typedA: "", typedB: "Dex" });
    expect(readTropeNames("Taylor", "Swift")).toEqual(ANON);
    expect(shipHrefFor(fine)).toBe("/ship/juniper/dex");
    expect(shipHrefFor(readTropeNames("Juniper", ""))).toBeNull();
  });

  it("reads addresses forgivingly and writes them short", () => {
    expect(readTropeMood("slow-burn")).toBe("slow-burn");
    expect(readTropeMood("Slow Burn")).toBe("slow-burn");
    expect(readTropeMood("slowburn")).toBe("slow-burn");
    expect(readTropeMood("spicy")).toBeNull();
    expect(readTropeBatch("3")).toBe(3);
    expect(readTropeBatch("0")).toBe(1);
    expect(readTropeBatch("abc")).toBe(1);
    expect(readTropeBatch(String(TROPES_MAX_BATCH + 1))).toBe(1);
    expect(tropesHref(null)).toBe(TROPES_PATH);
    expect(tropesHref("funny")).toBe(`${TROPES_PATH}/funny`);
    expect(tropesHref("funny", 4, { typedA: "Juniper", typedB: "Dex" })).toBe(`${TROPES_PATH}/funny?a=Juniper&b=Dex&batch=4`);
  });
});

describe("trope generator pages (app/tools/relationship-trope-generator)", () => {
  it("shows six tropes, the mood links, the name form, more tropes, the FAQ with its data, and one loud button", async () => {
    const html = text(renderToStaticMarkup(await TropesPage(sp())));
    expect(html).toContain("<h1>Relationship trope generator</h1>");
    for (const tr of tropes({})) {
      expect(html).toContain(`<strong>${tr.name}</strong>`);
      expect(html).toContain(firstScene(tr, ANON));
    }
    for (const m of TROPE_MOODS) expect(html).toContain(`href="${tropesHref(m)}"`);
    expect(html).toContain(`<form class="ship-form trope-names" action="${TROPES_PATH}" method="get">`);
    expect(html).toContain(`rel="nofollow" href="${tropesHref(null, 2)}"`);
    // No names, no ship name links.
    expect(html).not.toContain("Ship name for them");
    for (const { q, a } of TROPE_FAQ) {
      expect(html).toContain(`<h3>${q}</h3>`);
      expect(html).toContain(a);
    }
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"@type":"WebApplication"');
    expect(html).toContain('href="/tools/ship-name-generator"');
    expect(html).toContain('href="/tools/random-ship-generator"');
    expect(html).toContain('href="/tools/oc-chemistry-test"');
    // One filled (gradient) button: the way to /create. The form's and "Six more" are outlined.
    expect(html.match(/class="button"/g)).toHaveLength(1);
    expect(html).toContain('<a class="button" href="/create">');
    expect(html).not.toMatch(/<button type="submit">/);
  });

  it("with two names: the scenes star them, every trope links their ship names, and the names carry over", async () => {
    const html = text(renderToStaticMarkup(await TropesPage(sp({ a: "Juniper", b: "Dex", batch: "2" }))));
    const names = readTropeNames("Juniper", "Dex");
    for (const tr of tropes({ batch: 2 })) expect(html).toContain(firstScene(tr, names));
    expect(html.match(/Ship name for them/g)).toHaveLength(TROPES_SHOWN);
    expect(html.match(/rel="nofollow" href="\/ship\/juniper\/dex"/g)).toHaveLength(TROPES_SHOWN + 1);
    expect(html).toContain(`rel="nofollow" href="${tropesHref(null, 3, names)}"`);
    expect(html).toContain(`href="${tropesHref("sweet", 1, names)}"`);
    expect(html).toContain('value="Juniper"');
    expect(html).toContain('<input type="hidden" name="batch" value="2"/>');
    // A refused name is never shown back.
    const refused = text(renderToStaticMarkup(await TropesPage(sp({ a: "porn", b: "Dex" }))));
    expect(refused).not.toMatch(/porn/i);
    expect(refused).not.toContain("Ship name for them");
  });

  it("has a page per mood, indexed once, with batches and names followed but not indexed", async () => {
    expect(generateStaticParams()).toEqual(TROPE_MOODS.map((mood) => ({ mood })));
    const html = text(renderToStaticMarkup(await MoodPage({ params: Promise.resolve({ mood: "angsty" }), ...sp({ batch: "2" }) })));
    expect(html).toContain("<h1>Angst trope generator</h1>");
    for (const tr of tropes({ mood: "angsty", batch: 2 })) expect(html).toContain(`<strong>${tr.name}</strong>`);
    // The FAQ's data is the main page's alone.
    expect(html).not.toContain('"@type":"FAQPage"');
    for (const m of TROPE_MOODS) {
      const plain = await moodMetadata({ params: Promise.resolve({ mood: m }), ...sp() });
      expect(plain.alternates?.canonical).toBe(`${TROPES_PATH}/${m}`);
      expect(plain.robots).toBeUndefined();
      expect(String(plain.description).length, m).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(String(plain.title).length, m).toBeLessThanOrEqual(65);
    }
    for (const q of [{ batch: "2" }, { a: "Juniper" }] as Record<string, string>[]) {
      const variant = await moodMetadata({ params: Promise.resolve({ mood: "angsty" }), ...sp(q) });
      expect(variant.robots).toEqual({ index: false, follow: true });
      expect((await tropesMetadata(sp(q))).robots).toEqual({ index: false, follow: true });
    }
    const main = await tropesMetadata(sp());
    expect(main.alternates?.canonical).toBe(TROPES_PATH);
    expect(main.robots).toBeUndefined();
    expect(String(main.title)).toBe("Relationship trope generator: random romance tropes · Botchelor");
    expect(String(main.title).length).toBeLessThanOrEqual(65);
  });

  it("is on the tools hub with a preview, in PUBLIC_PATHS and the sitemap with its mood pages", () => {
    expect(FREE_TOOLS.map((t) => t.path)).toContain(TROPES_PATH);
    expect(PUBLIC_PATHS).toContain(TROPES_PATH);
    const sitemap = staticSitemap("https://botchelor.com").map((e) => new URL(e.url).pathname);
    for (const path of [TROPES_PATH, ...TROPE_MOODS.map((m) => tropesHref(m))]) expect(sitemap, path).toContain(path);
    const preview = text(renderToStaticMarkup(createElement(ToolPreview, { path: TROPES_PATH })));
    for (const tr of tropes({}).slice(0, 3)) expect(preview).toContain(tr.name);
  });
});
