/**
 * One tag vocabulary (lib/tags.ts, lib/adult/tags.ts, docs/tags.md): every tag inside the lines on its side, every
 * house roleplay tagged with tags its side knows, and the social-structure pieces (stage → setups, public status).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RoleplayPicker, { forStage, shelfTags } from "@/app/RoleplayPicker";
import { ROLEPLAYS } from "@/lib/adult/roleplays";
import { HARD_NO_IDS } from "@/lib/adult/limits";
import { ADULT_ONLY_TAGS, ADULT_TAGS, adultTagById, isAdultTagId, roleplayGroups, roleplayShelves, tagHardNos } from "@/lib/adult/tags";
import { STAGES } from "@/lib/relationship-stages";
import { DATE_ROLEPLAYS } from "@/lib/roleplays";
import { checkShowText, excludedTheme } from "@/lib/safety";
import { byDemand, isTagId, SETUPS_FOR_STAGE, statusOf, statusOfStage, TAG_FACETS, tagById, tagScore, TAGS } from "@/lib/tags";

/** What is never a tag on either side (docs/tags.md "Never"): school, family, anyone young, captors, non-consent,
 *  incest, mind control, sex work, obsession, bullies, restraints, real or famous people. */
const NEVER =
  /\b(school\w*|students?|teachers?|class(room)?|step-?(sis|bro|mom|mum|dad|mother|father|son|daughter|parent|family)\w*|sisters?|brothers?|daughters?|sons?|moms?|mums?|dads?|mothers?|fathers?|family|teen\w*|young\w*|kids?|child\w*|minors?|little girl|little boy|captors?|captives?|kidnap\w*|abduct\w*|non-?con\w*|cnc|rape\w*|incest\w*|hypno\w*|mind control|brainwash\w*|sex work\w*|escorts?|sugar \w+|prostitut\w*|yandere|obsess\w*|stalk\w*|bull(y|ies|ied)|celebrit\w*|famous|real people|tied|bound|restrain\w*|cuff\w*|breed\w*|pregnan\w*|drunk|asleep)\b/i;
const words = (t: { id: string; label: string; about: string }) => [t.id.replaceAll("_", " "), t.label, t.about].join(" · ");

describe("the vocabulary", () => {
  it("has unique ids across both sides and only known facets", () => {
    const ids = ADULT_TAGS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const facets = new Set<string>(TAG_FACETS.map((f) => f.id));
    for (const t of TAGS) expect(facets.has(t.facet), t.id).toBe(true);
    for (const t of ADULT_ONLY_TAGS) expect(["theme", "heat"]).toContain(t.facet);
  });

  it("keeps heat off the show's vocabulary", () => {
    expect(TAGS.some((t) => (t.facet as string) === "heat")).toBe(false);
    for (const t of ADULT_ONLY_TAGS) expect(isTagId(t.id), t.id).toBe(false);
    for (const t of TAGS) expect(isAdultTagId(t.id), t.id).toBe(true);
  });

  it("never names anything on the never-list, on either side", () => {
    for (const t of ADULT_TAGS) expect(NEVER.exec(words(t))?.[0] ?? null, t.id).toBeNull();
  });

  it("keeps every shared tag inside the show's lines", () => {
    for (const t of TAGS) {
      expect(checkShowText({ label: t.label, about: t.about }).ok, t.id).toBe(true);
      expect(excludedTheme(words(t)), t.id).toBeNull();
    }
  });

  it("ties each heat that touches a hard no to a real one", () => {
    for (const t of ADULT_ONLY_TAGS) if ("hardNo" in t) expect(HARD_NO_IDS, t.id).toContain(t.hardNo);
    expect(tagHardNos(["dom_sub", "praise", "dirty_talk"], ["dominance"])).toEqual(["dominance"]);
    expect(tagHardNos(["dom_sub", "gentle_dom"], ["dominance", "dirty_talk"])).toEqual(["dominance"]);
    expect(tagHardNos(["tender"], ["dominance"])).toEqual([]);
  });

  it("keeps census demand a plausible ratio, and orders by it", () => {
    for (const t of ADULT_TAGS)
      for (const v of [t.census.sfw, t.census.nsfw]) if (v !== null) expect(v > 0.5 && v < 1.6, t.id).toBe(true);
    expect(tagScore(tagById("comedy")!, "sfw")).toBeCloseTo(0.81);
    expect(tagScore(tagById("sunshine")!, "sfw")).toBe(1);
    // Our own demand overrides the census once there is some.
    expect(tagScore(tagById("comedy")!, "sfw", 1.4)).toBe(1.4);
    const order = byDemand([tagById("comedy")!, tagById("rivals")!, tagById("strangers")!], "sfw").map((t) => t.id);
    expect(order).toEqual(["rivals", "strangers", "comedy"]);
    expect(byDemand([tagById("comedy")!, tagById("rivals")!], "sfw", { comedy: 2 }).map((t) => t.id)).toEqual(["comedy", "rivals"]);
  });
});

describe("the roleplays' tags", () => {
  it("tags every show roleplay with shared setup and theme tags, setup first", () => {
    for (const r of DATE_ROLEPLAYS) {
      expect(r.tags.length, r.id).toBeGreaterThanOrEqual(2);
      expect(r.tags.length, r.id).toBeLessThanOrEqual(4);
      expect(new Set(r.tags).size, r.id).toBe(r.tags.length);
      for (const t of r.tags) {
        expect(isTagId(t), `${r.id}: ${t}`).toBe(true);
        expect(["setup", "theme"], `${r.id}: ${t}`).toContain(tagById(t)!.facet);
      }
      expect(tagById(r.tags[0])!.facet, r.id).toBe("setup");
      expect(r.tags.some((t) => tagById(t)!.facet === "theme"), r.id).toBe(true);
    }
  });

  it("tags every After Dark house roleplay with tags After Dark knows", () => {
    for (const r of ROLEPLAYS) {
      expect(r.tags.length, r.id).toBeGreaterThanOrEqual(1);
      expect(r.tags.length, r.id).toBeLessThanOrEqual(4);
      expect(new Set(r.tags).size, r.id).toBe(r.tags.length);
      for (const t of r.tags) {
        expect(isAdultTagId(t), `${r.id}: ${t}`).toBe(true);
        expect(["setup", "theme", "heat"], `${r.id}: ${t}`).toContain(adultTagById(t)!.facet);
      }
    }
  });

  it("gives the show's picker shelves only for tags some roleplay has, most wanted first", () => {
    const setups = shelfTags("setup");
    for (const t of setups) expect(DATE_ROLEPLAYS.some((r) => r.tags.includes(t.id as never)), t.id).toBe(true);
    const scores = setups.map((t) => tagScore(t, "sfw"));
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(shelfTags("theme").map((t) => t.id)).toContain("drama");
  });

  it("builds After Dark's shelves: Yours, setups, then themes and heat", () => {
    const [first, second] = roleplayShelves([{ id: "u:1", tags: [] }, ...ROLEPLAYS]);
    expect(first[0]).toMatchObject({ id: "yours", count: 1 });
    expect(first.slice(1).every((s) => adultTagById(s.id)!.facet === "setup")).toBe(true);
    expect(second.some((s) => s.id === "dark_romance")).toBe(true);
    expect(second.some((s) => s.id === "tender")).toBe(true);
    const rivals = first.find((s) => s.id === "rivals")!;
    expect(rivals.count).toBe(ROLEPLAYS.filter((r) => r.tags.includes("rivals")).length);
    expect(rivals.has(ROLEPLAYS.find((r) => r.id === "dons-truce")!)).toBe(true);
    const [noYours] = roleplayShelves(ROLEPLAYS);
    expect(noYours.some((s) => s.id === "yours")).toBe(false);
  });

  it("groups Step in's dropdown by first setup, nothing lost", () => {
    const groups = roleplayGroups(ROLEPLAYS);
    expect(groups.flatMap((g) => g.roleplays).length).toBe(ROLEPLAYS.length);
    expect(groups.find((g) => g.id === "more")?.roleplays.map((r) => r.id)).toContain("your-rules");
  });
});

describe("the social structure", () => {
  it("suggests setups for every stage, each with show roleplays behind it", () => {
    for (const s of STAGES) {
      const fits = SETUPS_FOR_STAGE[s];
      expect(fits?.length, s).toBeGreaterThan(0);
      for (const t of fits!) expect(DATE_ROLEPLAYS.some((r) => r.tags.includes(t)), `${s}: ${t}`).toBe(true);
      expect(forStage(s).length, s).toBeGreaterThanOrEqual(1);
    }
    expect(forStage("exes").map((r) => r.id)).toContain("old-friends-bench");
    expect(forStage("married").map((r) => r.id)).toContain("second-first-date");
    expect(forStage("bad_blood").map((r) => r.id)).toContain("truce-dinner");
    expect(forStage(null)).toEqual([]);
  });

  it("reads a status from public stages: the most committed pair wins, an ending leaves them single", () => {
    expect(statusOf([])).toBe("single");
    expect(statusOf(["exes", "bad_blood", "friends"])).toBe("single");
    expect(statusOf(["just_met", "sparks"])).toBe("seeing");
    expect(statusOf(["dating", "going_steady"])).toBe("taken");
    expect(statusOf(["sparks", "married", "exes"])).toBe("married");
    expect(statusOfStage("back_together")).toBe("taken");
    expect(statusOfStage(null)).toBe("single");
  });

  it("opens the couple page's picker on what fits the pair, and everything otherwise", () => {
    const render = (stage: (typeof STAGES)[number] | null) =>
      renderToStaticMarkup(createElement(RoleplayPicker, { me: "Dex Hale", them: "Mara Quinn", value: null, onChange: () => {}, signedIn: false, stage }));
    const exes = render("exes");
    expect(exes).toContain("For these two");
    expect(exes).toContain("Ten years, one bench");
    expect(exes).not.toContain("Rival chefs");
    const none = render(null);
    expect(none).not.toContain("For these two");
    expect(none).toContain("Rival chefs");
    expect(none).toContain("Kind of story");
  });
});
