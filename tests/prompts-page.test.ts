// /prompts as a grid of compact cards (the 2026-11-13 lift): 24 a page, each a swatch in its tags' tone, four lines of
// text with "more", its tags, one Copy · Save row; the tag pages share the cards without the buttons or the clamp.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));

import { prerender } from "react-dom/static";
import { CLAMP_GUESS } from "@/app/prompts/PromptText";
import { promptTone } from "@/app/prompts/PromptCard";
import { pageCount } from "@/lib/paging";
import { ALL_PROMPTS, findPrompts, indexablePromptTags, PROMPTS_PER_PAGE, type PromptTag } from "@/lib/prompts-library";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

async function render(sp: Record<string, string> = {}): Promise<string> {
  const { default: PromptsPage } = await import("@/app/prompts/page");
  const { prelude } = await prerender(await PromptsPage({ searchParams: Promise.resolve(sp) }));
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}
const items = (html: string) => html.match(/class="prompt-item"/g)?.length ?? 0;
const tag = (id: string, studio: boolean): PromptTag => ({ id, label: id, group: "x", studio, nsfw: false });

describe("a card's tone (app/prompts/PromptCard.tsx promptTone)", () => {
  it("comes from the first Studio tag's group, else the style, else who's in it", () => {
    expect(promptTone([tag("style:photo", false), tag("light.neon", true), tag("subject:woman", false)])).toBe("light");
    expect(promptTone([tag("style:painting", false), tag("subject:man", false)])).toBe("painting");
    expect(promptTone([tag("subject:couple", false)])).toBe("subject");
    expect(promptTone([])).toBe("plain");
  });
});

describe("/prompts", () => {
  it("is a wide page of 24 cards, each with a swatch, four clamped lines and a Copy · Save row", async () => {
    const html = await render();
    expect(html).toContain('class="page-wide prompts-page"');
    expect(html).toContain('<ul class="prompts-grid">');
    expect(items(html)).toBe(PROMPTS_PER_PAGE);
    expect(html.match(/<li class="prompt-item" data-tone="[a-z0-9]+">/g)).toHaveLength(PROMPTS_PER_PAGE);
    expect(html.match(/class="prompt-swatch"/g)).toHaveLength(PROMPTS_PER_PAGE);
    expect(html.match(/class="prompt-text is-clamped"/g)).toHaveLength(PROMPTS_PER_PAGE);
    // "more" on the prompts the server guesses run past four lines; the browser corrects the rest once it has measured.
    const shown = findPrompts({}).slice(0, PROMPTS_PER_PAGE);
    expect(html.match(/class="link-button prompt-more"/g)?.length ?? 0).toBe(shown.filter((p) => p.prompt.length >= CLAMP_GUESS).length);
    // One row, Copy then Save, both quiet small buttons.
    expect(html.match(/<div class="prompt-actions"><button type="button" class="button-ghost small prompt-copy"[\s\S]*?<\/button><button type="button" class="button-ghost small prompt-save"/g)).toHaveLength(PROMPTS_PER_PAGE);
    // The dataset picker still offers every set, "All datasets" first.
    expect(html).toMatch(/<option value=""[^>]*>All datasets<\/option>/);
  });

  it("pages every prompt, 24 at a time, with the one pager", async () => {
    const pages = pageCount(findPrompts({}).length, PROMPTS_PER_PAGE);
    expect(pages).toBe(Math.ceil(findPrompts({}).length / PROMPTS_PER_PAGE));
    expect(findPrompts({}).length).toBe(ALL_PROMPTS.length);
    const first = await render();
    expect(first).toContain('aria-label="Prompt pages"');
    expect(first).toContain('href="/prompts?page=2#prompts"');
    expect(first).toContain(`href="/prompts?page=${pages}#prompts"`);
    const last = await render({ page: String(pages) });
    expect(items(last)).toBe(ALL_PROMPTS.length - (pages - 1) * PROMPTS_PER_PAGE);
    // A page past the end shows the last one.
    expect(items(await render({ page: "9999" }))).toBe(items(last));
  });

  it("a tag's own page uses the same grid, whole texts and no buttons", async () => {
    const first = indexablePromptTags()[0];
    const { default: TagPage } = await import("@/app/prompts/tag/[id]/page");
    const { prelude } = await prerender(await TagPage({ params: Promise.resolve({ id: first.id }) }));
    const html = (await new Response(prelude).text()).replace(/<!-- -->/g, "");
    expect(html).toContain('class="page-wide prompts-page"');
    expect(html).toContain('<ul class="prompts-grid">');
    expect(items(html)).toBeGreaterThan(0);
    expect(items(html)).toBeLessThanOrEqual(60);
    expect(html).not.toContain("is-clamped");
    expect(html).not.toContain("prompt-actions");
    expect(html).toContain('aria-current="true"');
  });
});
