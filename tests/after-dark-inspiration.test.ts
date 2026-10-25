import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOM_MAX } from "@/lib/adult/studio-catalog";

// The optional "Inspiration" prompts on the shoot's custom field (app/after-dark/studio/[id]/inspiration.json): openly
// licensed, hard-filtered. This guards that no young-looking or non-person prompt ever slips into the bundled set.
const YOUNG = /\b(teen\w*|young\w*|girl\w*|boy\w*|school\w*|student\w*|petite|little|tiny|loli\w*|child\w*|kid\w*|under.?age|minor\w*|babysit\w*|cheerlead\w*|braces|pigtail\w*|barely|daughter|niece|son|nephew|baby|toddler|infant|youth|juvenile|adolescent|preteen|highschool)\b/i;
const NOT_PORTRAIT = /\b(anime|manga|cartoon|hentai|waifu|chibi|horse|dog|cat|pokemon|dragon|furry|loli)\b/i;
const PERSON = /\b(woman|man|lady|person|portrait|female|male|guy|gentleman|model)\b/i;

describe("the shoot's inspiration prompts", () => {
  const data = JSON.parse(readFileSync(join(process.cwd(), "app/after-dark/studio/[id]/inspiration.json"), "utf8")) as { note: string; prompts: string[] };

  it("are many, unique, within length, and each a clean adult portrait", () => {
    expect(data.prompts.length).toBeGreaterThan(100);
    expect(new Set(data.prompts.map((p) => p.toLowerCase())).size).toBe(data.prompts.length);
    for (const p of data.prompts) {
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(8);
      expect(p.length).toBeLessThanOrEqual(CUSTOM_MAX);
      expect(YOUNG.test(p), `young words in: ${p}`).toBe(false);
      expect(NOT_PORTRAIT.test(p), `not a portrait: ${p}`).toBe(false);
      expect(PERSON.test(p), `no person in: ${p}`).toBe(true);
    }
  });
});
