// /about as the system it is (the 2026-11-13 lift): six layer cards top to bottom, every item a chip that links as it did,
// what each does in a fold under the chips, the list at the top and the closing line kept.
import { readFileSync } from "node:fs";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import AboutPage from "@/app/about/page";

const LAYERS = ["integrations", "app", "models", "safety", "infra", "built"];
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

async function render(): Promise<string> {
  const { prelude } = await prerender(AboutPage());
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}

describe("/about, the stack as layers", () => {
  it("draws six layers in order, from where you come in to who builds it, each linked from the list at the top", async () => {
    const html = await render();
    expect(html).toContain('class="about-page"');
    expect([...html.matchAll(/<li id="([a-z]+)" class="card about-layer"/g)].map((m) => m[1])).toEqual(LAYERS);
    for (const id of LAYERS) expect(html).toContain(`href="#${id}"`);
    expect(html.match(/Layer \d · /g)).toHaveLength(LAYERS.length);
    expect(html).toContain("Layer 1 · Where you come in");
    expect(html).toContain("Layer 6 · Who builds it");
    // The headings other pages link to kept their words.
    for (const title of ["Integrations", "The app", "AI models", "Safety checks", "Hosting and infrastructure", "How it&#x27;s made"]) {
      expect(html).toContain(`<h2>${title}</h2>`);
    }
  });

  it("keeps every item: a chip for each, a link where it had one, and what each does in the fold", async () => {
    const source = readFileSync(new URL("../app/about/page.tsx", import.meta.url), "utf8");
    const names = [...source.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);
    const linked = (source.match(/href: "/g) ?? []).length;
    expect(names.length).toBeGreaterThanOrEqual(40);
    const html = await render();
    for (const name of names) expect(html, name).toContain(`>${escapeHtml(name)}</`);
    expect(html.match(/class="chip about-chip( is-plain)?"/g)).toHaveLength(names.length);
    // Link writes its attributes in another order than a plain <a>; either way each linked item is one <a> chip with a title.
    expect(html.match(/<a class="chip about-chip" [^>]*title="[^"]+"[^>]*>/g)).toHaveLength(linked);
    expect(html.match(/class="chip about-chip is-plain"/g)).toHaveLength(names.length - linked);
    // The site's own pages and the outside ones both still link.
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="https://nextjs.org"');
    expect(html).toContain('href="https://thehive.ai"');
    // What each does, once per layer, with a line for every item.
    expect(html.match(/What each does/g)).toHaveLength(LAYERS.length);
    expect(html.match(/<dd>/g)).toHaveLength(names.length);
    expect(html).toContain("Checks every picture and video after it&#x27;s made");
  });

  it("closes with the costs and the way to write in", async () => {
    const html = await render();
    expect(html).toContain('href="/costs"');
    expect(html).toContain('href="/report"');
  });
});
