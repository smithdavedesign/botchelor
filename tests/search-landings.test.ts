// Search landings (the 2026-11-11 growth plan): one /alternatives template for several chat apps, and the prompt
// library's big PG tags as pages of their own.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AlternativePage from "@/app/alternatives/AlternativePage";
import { ALTERNATIVES, alternativeFaq, alternativePath } from "@/lib/alternatives";
import { indexablePromptTags, promptTagPath, TAG_PAGE_MIN, tagCounts } from "@/lib/prompts-library";
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
    expect(String(meta.title)).toContain(`${first.count.toLocaleString("en-US")} ${first.label.toLowerCase()} portrait prompts`);
    const html = text(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: first.id }) })));
    expect(html).toContain(`<h1>${first.label} portrait prompts</h1>`);
    expect(html.match(/class="prompt-item"/g)!.length).toBeLessThanOrEqual(60);
    expect(html).toContain('href="/prompts"');
    // A small or NSFW tag has no page.
    const nsfwMeta = await generateMetadata({ params: Promise.resolve({ id: small.id }) });
    expect(nsfwMeta.robots).toEqual({ index: false, follow: false });
    await expect(Page({ params: Promise.resolve({ id: small.id }) })).rejects.toThrow();
    // All in the sitemap.
    expect(landingPaths()).toEqual(expect.arrayContaining(tags.map((t) => promptTagPath(t.id))));
  });
});
