import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NamesStylePage, { generateMetadata as styleMetadata, generateStaticParams } from "@/app/tools/oc-name-generator/[style]/page";
import NamesPage, { generateMetadata as namesMetadata } from "@/app/tools/oc-name-generator/page";
import QuestionsPage, { generateMetadata as questionsMetadata } from "@/app/tools/oc-questions/page";
import { staticSitemap } from "@/lib/seo";
import { checkFields } from "@/lib/safety";
import {
  createWithName,
  OC_NAME_KINDS,
  OC_NAME_STYLES,
  OC_NAMES_MAX_BATCH,
  OC_NAMES_SHOWN,
  ocNames,
  ocNamesHref,
  readBatch,
  readKind,
  readStyle,
} from "@/lib/oc-names";
import { nextQuestion, OC_QUESTION_THEMES, OC_QUESTIONS, readQuestion } from "@/lib/oc-questions";

const sp = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("OC name generator (lib/oc-names.ts)", () => {
  it("gives twelve different, allowed names for every style and kind, the same every time", () => {
    for (const style of [null, ...OC_NAME_STYLES]) {
      for (const kind of OC_NAME_KINDS) {
        for (const batch of [1, 2, 57]) {
          const names = ocNames({ style, kind, batch });
          expect(names, `${style} ${kind} ${batch}`).toHaveLength(OC_NAMES_SHOWN);
          expect(new Set(names.map((n) => n.name)).size).toBe(OC_NAMES_SHOWN);
          for (const n of names) {
            expect(n.name).toMatch(/^[A-Z][a-z]+ [A-Z][A-Za-z]+(-[A-Z0-9][a-z]*)?$/);
            expect(checkFields({ name: n.name }).ok).toBe(true);
            expect(n.name).not.toMatch(/(\w)\1\1/i);
            if (style) expect(n.style).toBe(style);
            if (kind !== "any") expect(n.kind).toBe(kind);
          }
          expect(ocNames({ style, kind, batch })).toEqual(names);
        }
      }
    }
  });

  it("mixes every style on the plain page, and a new batch gives new names", () => {
    expect(new Set(ocNames({}).map((n) => n.style))).toEqual(new Set(OC_NAME_STYLES));
    const one = ocNames({ style: "fantasy" }).map((n) => n.name);
    const two = ocNames({ style: "fantasy", batch: 2 }).map((n) => n.name);
    expect(two.filter((n) => one.includes(n)).length).toBeLessThan(3);
  });

  it("reads addresses safely", () => {
    expect(readStyle("sci-fi")).toBe("scifi");
    expect(readStyle("../etc")).toBeNull();
    expect(readKind("feminine")).toBe("feminine");
    expect(readKind("<b>")).toBe("any");
    expect(readBatch("3")).toBe(3);
    expect(readBatch("0")).toBe(1);
    expect(readBatch("-2")).toBe(1);
    expect(readBatch(String(OC_NAMES_MAX_BATCH + 1))).toBe(1);
    expect(ocNamesHref("gothic")).toBe("/tools/oc-name-generator/gothic");
    expect(ocNamesHref(null, "neutral", 2)).toBe("/tools/oc-name-generator?kind=neutral&batch=2");
    expect(createWithName("Ela Ashvale")).toBe("/create?name=Ela%20Ashvale");
  });

  it("renders the page with its names, the style links and Make this character", async () => {
    const html = text(renderToStaticMarkup(await NamesStylePage({ params: Promise.resolve({ style: "cozy" }), ...sp({ kind: "masculine" }) })));
    expect(html).toContain("<h1>Cozy OC name generator</h1>");
    for (const n of ocNames({ style: "cozy", kind: "masculine" })) {
      expect(html).toContain(n.name);
      expect(html).toContain(`href="${createWithName(n.name)}"`);
    }
    expect(html).toContain('href="/tools/oc-name-generator/cozy?kind=masculine&batch=2"');
    expect(html).toContain('href="/create"');
    const mixed = text(renderToStaticMarkup(await NamesPage(sp())));
    expect(mixed).toContain("<h1>OC name generator</h1>");
    for (const s of OC_NAME_STYLES) expect(mixed).toContain(`href="/tools/oc-name-generator/${s}"`);
  });

  it("indexes the plain pages only, each with its own title", async () => {
    const plain = await namesMetadata(sp());
    expect(plain.robots).toBeUndefined();
    expect(plain.alternates?.canonical).toBe("/tools/oc-name-generator");
    expect((await namesMetadata(sp({ batch: "4" }))).robots).toEqual({ index: false, follow: true });
    expect(generateStaticParams().map((p) => p.style)).toEqual([...OC_NAME_STYLES]);
    const fantasy = await styleMetadata({ params: Promise.resolve({ style: "fantasy" }), ...sp() });
    expect(String(fantasy.title)).toContain("Fantasy OC name generator");
    expect(fantasy.alternates?.canonical).toBe("/tools/oc-name-generator/fantasy");
    expect(fantasy.robots).toBeUndefined();
    // A style that doesn't exist is the site's 404, metadata and all (2026-11-22: a browser showed the home page's title
    // and its index, follow over the not-found page).
    await expect(styleMetadata({ params: Promise.resolve({ style: "not-a-style" }), ...sp() })).rejects.toThrow();
  });

  it("puts the tools and every style page in the sitemap", async () => {
    const urls = (await staticSitemap()).map((e) => new URL(e.url).pathname);
    for (const path of ["/tools/oc-name-generator", "/tools/oc-questions", ...OC_NAME_STYLES.map((s) => ocNamesHref(s))]) expect(urls).toContain(path);
  });
});

describe("Questions to ask your OC (lib/oc-questions.ts)", () => {
  it("has unique questions and ids, and Ask me another walks through all of them", () => {
    expect(OC_QUESTIONS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(OC_QUESTIONS.map((q) => q.text)).size).toBe(OC_QUESTIONS.length);
    expect(new Set(OC_QUESTIONS.map((q) => q.id)).size).toBe(OC_QUESTIONS.length);
    const seen = new Set<string>();
    let q = nextQuestion(null);
    for (let i = 0; i < OC_QUESTIONS.length; i++) {
      seen.add(q.id);
      const n = nextQuestion(q);
      expect(n).not.toBe(q);
      q = n;
    }
    expect(seen.size).toBe(OC_QUESTIONS.length);
    expect(readQuestion("love-1")?.text).toContain("first date");
    expect(readQuestion("nope")).toBeNull();
  });

  it("renders every theme and question with anchors, and a picked question at the top", async () => {
    const html = text(renderToStaticMarkup(await QuestionsPage(sp())));
    expect(html).toContain(`<h1>${OC_QUESTIONS.length} questions to ask your OC</h1>`);
    for (const t of OC_QUESTION_THEMES) expect(html).toContain(`id="${t.id}"`);
    for (const q of OC_QUESTIONS) {
      expect(html).toContain(q.text);
      expect(html).toContain(`id="${q.id}"`);
    }
    const picked = readQuestion("deep-1")!;
    const asked = text(renderToStaticMarkup(await QuestionsPage(sp({ q: "deep-1" }))));
    expect(asked).toContain(`<p class="questions-asked">${picked.text}</p>`);
    expect(asked).toContain(`href="/tools/oc-questions?q=${nextQuestion(picked).id}#ask"`);
  });

  it("indexes the page, not one picked question", async () => {
    const plain = await questionsMetadata(sp());
    expect(plain.robots).toBeUndefined();
    expect(plain.alternates?.canonical).toBe("/tools/oc-questions");
    const one = await questionsMetadata(sp({ q: "fun-1" }));
    expect(one.robots).toEqual({ index: false, follow: true });
    expect(one.alternates?.canonical).toBe("/tools/oc-questions");
  });
});
