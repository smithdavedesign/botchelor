import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PromptsPage, { metadata } from "@/app/prompts/page";
import { PUBLIC_PATHS } from "@/lib/site";
import { checkAdultText, checkShowText } from "@/lib/safety";
import {
  ALL_PROMPTS,
  PROMPT_QUERY_MAX,
  PROMPT_SOURCES,
  PROMPTS_PER_PAGE,
  findPrompts,
  parseQuery,
  parseSource,
  sourceOf,
} from "@/lib/prompts-library";

const LICENSE: Record<string, string> = {
  diffusiondb: "CC0-1.0",
  "diffusiondb-large": "CC0-1.0",
  midjourney: "Apache-2.0",
  "open-image-preferences": "Apache-2.0",
  pickapic: "MIT",
};

const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await PromptsPage({ searchParams: Promise.resolve(sp) }));
const items = (html: string) => html.match(/class="prompt-item"/g)?.length ?? 0;

describe("the seed (lib/prompts-library.json, scripts/build-prompts-library.mjs)", () => {
  it("is nearly 2,000 distinct prompts from the openly licensed sets only, each with its source and licence", () => {
    // 2,000 less the hotfix's removals (below); the next seed refills it.
    expect(ALL_PROMPTS.length).toBeGreaterThan(1900);
    expect(ALL_PROMPTS.length).toBeLessThanOrEqual(2000);
    expect(new Set(ALL_PROMPTS.map((p) => p.prompt.toLowerCase())).size).toBe(ALL_PROMPTS.length);
    for (const p of ALL_PROMPTS) {
      expect(Object.keys(LICENSE)).toContain(p.source);
      expect(p.license).toBe(LICENSE[p.source]);
    }
    expect(ALL_PROMPTS.some((p) => p.source === "civitai")).toBe(false);
  });

  it("keeps every dataset in the mix, not only DiffusionDB", () => {
    for (const s of PROMPT_SOURCES) expect(findPrompts("", s.id).length).toBeGreaterThan(50);
  });

  it("is one clean line, 40–400 characters, with no weights or flags", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt.length).toBeGreaterThanOrEqual(40);
      expect(prompt.length).toBeLessThanOrEqual(400);
      expect(prompt).toBe(prompt.replace(/\s+/g, " ").trim());
      expect(prompt).not.toMatch(/:\s*\d+(?:\.\d+)?\s*\)|\s--[a-z]+\b|::|[()[\]{}<>]/);
    }
  });

  it("passes the show's safety bar and After Dark's hard lines, every prompt", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(checkShowText({ prompt }), prompt).toEqual({ ok: true });
      expect(checkAdultText({ prompt }), prompt).toEqual({ ok: true });
    }
  });
});

describe("the 2026-10-25 hotfix: what the word lists let through is gone", () => {
  // Innuendo and body fluids, violence and death, suggestive wear and poses: the first seed carried some of each.
  const UNSAFE =
    /\b(goo|gooey|slime|jelly|sticky|viscous|whitish|spurt\w*|semen|cum|drool\w*|saliva|lick\w*|suck\w*|lust\w*|blood|bleeding|dead|death|corpse|strangl\w*|decapitat\w*|bra|latex|revealing|see[- ]through|voluptuous|kneel\w*|on (?:her|his) knees|bent over)\b/i;
  // Real people the seed named (scripts/data/prompt-people.txt on the next seed holds the full list).
  const PEOPLE =
    /\b(gal gadot|danny devito|pierce brosnan|jennifer connelly|john f\.? kennedy|mila kunis|marlon brando|martin sheen|andy lau|ju jingyi|kamenashi kazuya|morena baccarin|eliza dushku|sherilyn fenn|colleen moore|louise brooks|kristen mcmenamy|mark wahlberg|donal gleeson|bob ross|bjork|sia|todd solondz|peter jackson|josh holloway|viktor orban|eva green|tzuyu|terry richardson)\b/i;

  it("carries no innuendo, violence or suggestive wear, and names none of those people", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt, prompt).not.toMatch(UNSAFE);
      expect(prompt, prompt).not.toMatch(PEOPLE);
    }
  });

  it("no longer has the prompts that were reported", () => {
    for (const gone of [
      "a whitish sticky liquid",
      "spurting from her mouth a white viscous fluid",
      "white goo dripping face",
      "licking a tab of lsd",
      "strangled with rope",
      "looks like gal gadot",
      "arguing with danny devito",
      "portrait of pierce brosnan",
      "rugged viktor orban",
      "squirting fluorescent liquid",
    ]) {
      expect(ALL_PROMPTS.some((p) => p.prompt.toLowerCase().includes(gone)), gone).toBe(false);
    }
  });
});

describe("search and filter (lib/prompts-library.ts)", () => {
  it("matches every word, in any order and any case", () => {
    const found = findPrompts("WOMAN portrait", null);
    expect(found.length).toBeGreaterThan(0);
    for (const p of found) expect(p.prompt.toLowerCase()).toMatch(/(?=.*woman)(?=.*portrait)/);
  });

  it("filters to one dataset, with DiffusionDB's two dumps as one", () => {
    expect(findPrompts("", "diffusiondb").every((p) => p.source.startsWith("diffusiondb"))).toBe(true);
    expect(findPrompts("", "pickapic").every((p) => sourceOf(p).id === "pickapic")).toBe(true);
  });

  it("reads junk params safely", () => {
    expect(parseSource("civitai")).toBeNull();
    expect(parseSource(["midjourney", "pickapic"])).toBe("midjourney");
    expect(parseQuery("  red   hair ")).toBe("red hair");
    expect(parseQuery("x".repeat(500))).toHaveLength(PROMPT_QUERY_MAX);
  });
});

describe("the page: /prompts", () => {
  it("renders one page of prompts, each with a copy button, and a pager", async () => {
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>Prompts library<\/h1>/);
    expect(items(html)).toBe(PROMPTS_PER_PAGE);
    expect(html.match(/class="secondary prompt-copy"/g)).toHaveLength(PROMPTS_PER_PAGE);
    expect(html).toContain('aria-label="Prompt pages"');
    expect(html).toMatch(/<form[^>]*action="\/prompts"[^>]*method="get"/);
    expect(html).toContain('name="q"');
    expect(html).toContain('name="source"');
  });

  it("searches, filters and pages through the URL, keeping the other params", async () => {
    const html = await render({ q: "woman", source: "midjourney", page: "2" });
    expect(items(html)).toBeGreaterThan(0);
    expect(html).toContain("/prompts?q=woman&amp;source=midjourney#prompts");
  });

  it("says so when nothing matches", async () => {
    const html = await render({ q: "zzzzqqqq" });
    expect(items(html)).toBe(0);
    expect(html).toContain("No prompts match that.");
  });

  it("credits every dataset with its licence, with links", async () => {
    const html = await render();
    for (const name of ["DiffusionDB", "succinctly/midjourney-prompts", "data-is-better-together/open-image-preferences-v1", "Pick-a-Pic"]) {
      expect(html).toContain(name);
    }
    for (const s of PROMPT_SOURCES) expect(html).toContain(`href="${s.href}"`);
    expect(html).toMatch(/CC0 1\.0[\s\S]*Apache 2\.0[\s\S]*MIT/);
  });

  it("is indexable and listed for search engines", () => {
    expect(metadata.alternates?.canonical).toBe("/prompts");
    expect(metadata.robots).toBeUndefined();
    expect(PUBLIC_PATHS).toContain("/prompts");
  });
});
