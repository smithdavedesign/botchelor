// Search landings (the 2026-11-11 growth plan): one /alternatives template for several chat apps, and the prompt
// library's big PG tags as pages of their own.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AlternativePage from "@/app/alternatives/AlternativePage";
import { ALTERNATIVES, alternativeFaq, alternativePath } from "@/lib/alternatives";
import { indexablePromptTags, promptTagHeading, promptTagPath, TAG_PAGE_MIN, tagCounts } from "@/lib/prompts-library";
import { landingPaths, staticSitemap } from "@/lib/seo";

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("the /alternatives pages", () => {
  it("one per app, each with its FAQ in the page and in its structured data, word for word", () => {
    expect(ALTERNATIVES.map((a) => a.slug)).toEqual(["character-ai", "janitor-ai", "spicychat", "chai"]);
    for (const alt of ALTERNATIVES) {
      const html = text(renderToStaticMarkup(createElement(AlternativePage, { alt })));
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1].replace(/\\u0026/g, "&")) as { "@type": string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] }[];
      const faq = ld.find((d) => d["@type"] === "FAQPage")!;
      expect(faq.mainEntity!.map((e) => e.name)).toEqual(alternativeFaq(alt).map((f) => f.q));
      for (const { q, a } of alternativeFaq(alt)) {
        expect(html).toContain(`<dt>${q}</dt>`);
        expect(html).toContain(text(a).replace(/'/g, "'"));
        expect(faq.mainEntity!.find((e) => e.name === q)!.acceptedAnswer.text).toBe(a);
      }
      expect(html).toContain(`Moving from ${alt.name}`);
      expect(html).toContain('href="/import"');
      // Nominative only: nothing compared, nothing claimed, no marks.
      expect(html).not.toMatch(/better than|worse than|official|™|®|partner/i);
      expect(alt.bring.a).toContain(`isn't connected to ${alt.name}`);
    }
  });

  it("the Character.AI page keeps its words and address; the others are in the sitemap", async () => {
    const { default: Page, metadata } = await import("@/app/alternatives/character-ai/page");
    const html = text(renderToStaticMarkup(createElement(Page)));
    expect(html).toContain("<dt>Can I bring a character I made on Character.AI?</dt>");
    expect(html).toContain("Copy its creator fields (Name, Tagline, Description, Greeting, Definition)");
    expect(metadata.alternates?.canonical).toBe("/alternatives/character-ai");
    const { generateStaticParams } = await import("@/app/alternatives/[slug]/page");
    expect(generateStaticParams().map((p) => p.slug)).toEqual(["janitor-ai", "spicychat", "chai"]);
    const urls = staticSitemap("https://botchelor.com").map((e) => e.url);
    for (const slug of ["character-ai", "janitor-ai", "spicychat", "chai"]) expect(urls).toContain(`https://botchelor.com${alternativePath(slug)}`);
    expect(urls.filter((u) => u.endsWith("/alternatives/character-ai"))).toHaveLength(1);
  });
});

describe("prompt tag pages", () => {
  it("read as plain headings, never \"Close portrait prompts\" or \"Man portrait prompts\"", () => {
    const heading = (id: string) => promptTagHeading(indexablePromptTags().find((t) => t.id === id)!);
    expect(heading("framing.close")).toBe("Close-up portrait prompts");
    expect(heading("subject:man")).toBe("Portrait prompts of men");
    expect(heading("subject:woman")).toBe("Portrait prompts of women");
    expect(heading("expression.smiling")).toBe("Smiling portrait prompts");
    for (const t of indexablePromptTags()) expect(promptTagHeading(t)).toMatch(/portrait prompts/i);
  });

  it("exist for PG tags with enough prompts, and for nothing else", async () => {
    const tags = indexablePromptTags();
    expect(tags.length).toBeGreaterThan(5);
    for (const t of tags) {
      expect(t.nsfw).toBe(false);
      expect(t.count).toBeGreaterThanOrEqual(TAG_PAGE_MIN);
    }
    const small = tagCounts(false).find((t) => t.count < TAG_PAGE_MIN)!;
    expect(small).toBeDefined();
    expect(tags.some((t) => t.id === small.id)).toBe(false);
    expect(tagCounts(true).filter((t) => t.nsfw).some((t) => tags.some((x) => x.id === t.id))).toBe(false);
    const { generateStaticParams, generateMetadata, default: Page } = await import("@/app/prompts/tag/[id]/page");
    expect(generateStaticParams().map((p) => p.id)).toEqual(tags.map((t) => t.id));
    const first = tags[0];
    const meta = await generateMetadata({ params: Promise.resolve({ id: first.id }) });
    expect(meta.alternates?.canonical).toBe(promptTagPath(first.id));
    // Behind the 18+ gate like the library: out of search, links followed.
    expect(meta.robots).toEqual({ index: false, follow: true });
    const heading = promptTagHeading(first);
    expect(String(meta.title)).toContain(`${first.count.toLocaleString("en-US")} ${heading[0].toLowerCase()}${heading.slice(1)}`);
    const html = text(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: first.id }) })));
    expect(html).toContain(`<h1>${heading}</h1>`);
    expect(html.match(/class="prompt-item"/g)!.length).toBeLessThanOrEqual(24);
    expect(html).toContain('href="/prompts"');
    // A small or NSFW tag has no page, and its metadata is the not-found page's too (not a title of its own).
    await expect(generateMetadata({ params: Promise.resolve({ id: small.id }) })).rejects.toThrow();
    await expect(Page({ params: Promise.resolve({ id: small.id }) })).rejects.toThrow();
    // None in the sitemap (2026-11-22: the library sits behind the 18+ gate).
    for (const t of tags) expect(landingPaths()).not.toContain(promptTagPath(t.id));
  });
});
