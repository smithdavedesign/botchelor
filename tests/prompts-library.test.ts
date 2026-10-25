import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The page asks who's looking only when the seed has an NSFW tag; a test visitor is a stranger either way.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));

import PromptsPage, { metadata } from "@/app/prompts/page";
import { STUDIO_GROUPS } from "@/lib/adult/studio-catalog";
import { FACET_RULES, IMAGE_REF, imageReference, SENSITIVE, STUDIO_TAG_RULES, tagPrompt, YOUNG } from "@/lib/prompt-library-rules";
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
  parseTag,
  PROMPT_TAGS,
  sourceOf,
  tagById,
  tagCounts,
  visibleTags,
  type LibraryPrompt,
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
  it("is 2,000 distinct prompts from the openly licensed sets only, each with its source and licence", () => {
    expect(ALL_PROMPTS).toHaveLength(2000);
    expect(new Set(ALL_PROMPTS.map((p) => p.prompt.toLowerCase())).size).toBe(2000);
    for (const p of ALL_PROMPTS) {
      expect(Object.keys(LICENSE)).toContain(p.source);
      expect(p.license).toBe(LICENSE[p.source]);
    }
    expect(ALL_PROMPTS.some((p) => p.source === "civitai")).toBe(false);
  });

  it("keeps every dataset in the mix, not only DiffusionDB", () => {
    for (const s of PROMPT_SOURCES) expect(findPrompts({ source: s.id }).length).toBeGreaterThan(50);
  });

  it("is one clean line, 40–400 characters, with no weights or flags", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(prompt.length).toBeGreaterThanOrEqual(40);
      expect(prompt.length).toBeLessThanOrEqual(400);
      expect(prompt).toBe(prompt.replace(/\s+/g, " ").trim());
      expect(prompt).not.toMatch(/:\s*\d+(?:\.\d+)?\s*\)|\s--[a-z]+\b|::|[()[\]{}<>]/);
    }
  });

  it("passes the show's safety bar, After Dark's hard lines and the library's own, every prompt", () => {
    for (const { prompt } of ALL_PROMPTS) {
      expect(checkShowText({ prompt }), prompt).toEqual({ ok: true });
      expect(checkAdultText({ prompt }), prompt).toEqual({ ok: true });
      expect(prompt).not.toMatch(SENSITIVE);
      expect(prompt).not.toMatch(YOUNG);
    }
  });

  it("asks for a picture, never describes one that exists", () => {
    for (const { prompt } of ALL_PROMPTS) expect(imageReference(prompt), prompt).toBeNull();
  });

  it("names no one on the real-people list", () => {
    const people = readFileSync(new URL("../scripts/data/prompt-people.txt", import.meta.url), "utf8")
      .split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#"));
    for (const { prompt } of ALL_PROMPTS) {
      const text = prompt.toLowerCase();
      for (const name of people) expect(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text), `${name}: ${prompt}`).toBe(false);
    }
  });

  it("stores exactly the tags the rules give, today", () => {
    for (const p of ALL_PROMPTS) expect(p.tags, p.prompt).toEqual(tagPrompt(p.prompt));
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
    const found = findPrompts({ query: "WOMAN portrait" });
    expect(found.length).toBeGreaterThan(0);
    // In the words, or in a tag the prompt shows ("women" carries the Woman tag).
    for (const p of found) expect(`${p.prompt} ${visibleTags(p, false).map((t) => t.label).join(" ")}`.toLowerCase()).toMatch(/(?=.*woman)(?=.*portrait)/);
  });

  it("filters to one dataset, with DiffusionDB's two dumps as one", () => {
    expect(findPrompts({ source: "diffusiondb" }).every((p) => p.source.startsWith("diffusiondb"))).toBe(true);
    expect(findPrompts({ source: "pickapic" }).every((p) => sourceOf(p).id === "pickapic")).toBe(true);
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

describe("the rules (lib/prompt-library-rules.ts)", () => {
  it("drops text about a picture that exists, and keeps a prompt that asks for one", () => {
    for (const text of [
      "the photo of a man with a very expressive face of remorse",
      "a woman's face is shown in profile, oil painting",
      "his features can be seen in soft light",
      "make her hair red and add a hat",
      "what would a viking queen look like?",
      "a man with a beard, a portrait by John E. Berninger, dribble, studio portrait",
      "headshot on a white backdrop, a stock photo, associated press",
      "there is a woman sitting by the window",
    ]) {
      expect(imageReference(text), text).not.toBeNull();
    }
    for (const text of [
      "a photograph depicting a proud woman in her 60s, golden hour",
      "close-up portrait of a man by the fire, by caravaggio",
      "a man has an idea so large there is a nuclear explosion above his head",
      "portrait of a woman in a red coat, oil on canvas",
    ]) {
      expect(imageReference(text), text).toBeNull();
    }
    expect(IMAGE_REF.length).toBeGreaterThan(0);
  });

  it("catches the innuendo, violence and suggestive wear the safety lists let through", () => {
    for (const text of [
      "a mature woman with a whitish, sticky liquid dripping off of her face",
      "spurting from her mouth a white viscous fluid",
      "a man licking strawberry ice cream",
      "death blonde woman strangled with rope",
      "military bra revealing outfit",
      "a woman on her knees in an alley",
      "a naughty smile, lips slightly parted",
      "satin nightgown laying in bed",
      "woman's skin gripped tightly, female bodies, dripping wet",
    ]) {
      expect(text, text).toMatch(SENSITIVE);
    }
    for (const text of ["wet plate portrait of a man", "curvy horns and a yellow dress", "a woman in a red coat, golden hour"]) {
      expect(text).not.toMatch(SENSITIVE);
    }
  });

  it("tags with the Studio's own options, and only real ones", () => {
    for (const { id, nsfw } of STUDIO_TAG_RULES) {
      const [groupId, optionId] = id.split(".");
      const option = STUDIO_GROUPS.find((g) => g.id === groupId)?.options.find((o) => o.id === optionId);
      expect(option, id).toBeDefined();
      // An NSFW tag is exactly an option above the Studio's dressed level (or a Filthy one).
      expect(Boolean(nsfw), id).toBe(option!.level > 0 || Boolean(option!.filthy));
      expect(tagById(id)?.label).toBe(option!.label);
    }
    expect(PROMPT_TAGS.filter((t) => t.studio)).toHaveLength(STUDIO_TAG_RULES.length);
    for (const f of FACET_RULES) expect(f.id).toMatch(/^(style|subject):/);
  });

  it("reads a prompt's framing, light, wardrobe, accessories and facets", () => {
    expect(tagPrompt("close-up portrait photo of a smiling woman in glasses and a blazer, neon light, 85mm")).toEqual([
      "framing.close",
      "wardrobe.smart",
      "accessories.glasses",
      "light.neon",
      "expression.smiling",
      "style:photo",
      "subject:woman",
    ]);
    expect(tagPrompt("full body oil painting of a man in sunglasses at golden hour on a beach")).toEqual([
      "framing.full",
      "accessories.sunglasses",
      "place.beach",
      "light.golden",
      "style:painting",
      "subject:man",
    ]);
    // A mirror selfie is the Studio's mirror, not its plain selfie too.
    expect(tagPrompt("a mirror selfie of a woman")).toContain("pov.mirror");
    expect(tagPrompt("a mirror selfie of a woman")).not.toContain("pov.selfie");
  });

  it("never puts an NSFW tag on anything youth-coded", () => {
    expect(tagPrompt("a woman in a bikini on a beach")).toContain("wardrobe.swim");
    expect(tagPrompt("a young woman in a bikini on a beach")).not.toContain("wardrobe.swim");
    expect(tagPrompt("a young woman in a bikini on a beach")).toContain("place.beach");
  });
});

describe("tags on the page: who sees what", () => {
  const swim: LibraryPrompt = { prompt: "a woman in a bikini at a swimming pool, photo", source: "pickapic", license: "MIT", tags: ["wardrobe.swim", "place.pool", "style:photo", "subject:woman"] };

  it("hides an NSFW tag from everyone but an After Dark viewer, in chips, filters, counts and search", () => {
    expect(visibleTags(swim, false).map((t) => t.id)).toEqual(["place.pool", "style:photo", "subject:woman"]);
    expect(visibleTags(swim, true).map((t) => t.id)).toContain("wardrobe.swim");
    expect(parseTag("wardrobe.swim", false)).toBeNull();
    expect(parseTag("wardrobe.swim", true)).toBe("wardrobe.swim");
    expect(tagCounts(false, [swim]).map((t) => t.id)).not.toContain("wardrobe.swim");
    expect(tagCounts(true, [swim]).map((t) => t.id)).toContain("wardrobe.swim");
    expect(findPrompts({ query: "swimwear" }, [swim])).toHaveLength(0);
    expect(findPrompts({ query: "swimwear", showNsfw: true }, [swim])).toHaveLength(1);
  });

  it("filters by a tag and searches tag names", () => {
    const close = findPrompts({ tag: "framing.close" });
    expect(close.length).toBeGreaterThan(50);
    expect(close.every((p) => p.tags.includes("framing.close"))).toBe(true);
    expect(parseTag("nonsense", true)).toBeNull();
    // "Full body" is the Studio's label: searching it finds prompts the words "full-length" tagged.
    expect(findPrompts({ query: "full body" }).length).toBeGreaterThanOrEqual(findPrompts({ tag: "framing.full" }).length);
  });

  it("shows each card's tags as links that filter, and the tag filter in the form", async () => {
    const html = await render();
    expect(html).toContain('name="tag"');
    expect(html).toMatch(/<optgroup label="Framing">/);
    expect(html).toMatch(/class="prompt-tag[^"]*" href="\/prompts\?tag=[a-z]+[.:][a-z0-9_]+#prompts"/);
    const filtered = await render({ tag: "framing.close" });
    expect(filtered).toContain('aria-current="true"');
    expect(items(filtered)).toBe(PROMPTS_PER_PAGE);
  });
});
