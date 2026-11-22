import { describe, expect, it } from "vitest";
import { seasonPath } from "@/lib/season-ref";
import { evidenceLink, evidenceLinks } from "@/lib/social/evidence";

// What made a tie, as links to where it happened (lib/social/evidence.ts): "X's world" and the pair panel share it.

const AT = "2026-11-18T20:00:00.000Z";

describe("evidence links", () => {
  it("links each kind of evidence to its page", () => {
    expect(evidenceLink("episode:ep-1", AT)).toEqual({ href: "/episodes/ep-1", label: "the date", at: AT });
    // A told line names its line: the scene is the page.
    expect(evidenceLink("scene:sc-1#3", AT)).toEqual({ href: "/house?scene=sc-1#scene-sc-1", label: "the scene", at: AT });
    expect(evidenceLink("night:mx-1", AT)?.href).toBe("/mixers/mx-1");
    expect(evidenceLink("link:ch-a:ch-b", AT)).toEqual({ href: "/characters/ch-a", label: "their backstory", at: AT });
    // A story beat has no page of its own: words only.
    expect(evidenceLink("beat:2026-11-18", AT)).toEqual({ href: null, label: "the show's story", at: AT });
  });

  it("a season links once it's closed, and is words before then", () => {
    expect(evidenceLink("season:2026-10-01", AT, { closedSeasons: new Set(["2026-10-01"]) })?.href).toBe(seasonPath("2026-10-01"));
    expect(evidenceLink("season:2026-11-01", AT, { closedSeasons: new Set(["2026-10-01"]) })).toEqual({ href: null, label: "the season's cast", at: AT });
  });

  it("is nothing for a ref it doesn't know or an id that isn't safe in a link", () => {
    for (const ref of ["nocolon", ":x", "rumour:x", "episode:../admin", "scene:#2", "night:a b", "link:only-one", "episode:"]) expect(evidenceLink(ref, AT)).toBeNull();
  });

  it("lists the newest first, one a page, at most the limit", () => {
    const links = evidenceLinks([
      { ref: "scene:sc-1#1", at: "2026-11-10T00:00:00Z" },
      { ref: "scene:sc-1#2", at: "2026-11-12T00:00:00Z" },
      { ref: "episode:ep-1", at: "2026-11-11T00:00:00Z" },
      { ref: "rumour:x", at: "2026-11-19T00:00:00Z" },
      { ref: "beat:2026-11-09", at: "2026-11-09T00:00:00Z" },
      { ref: "beat:2026-11-08", at: "2026-11-08T00:00:00Z" },
    ]);
    expect(links.map((l) => l.label)).toEqual(["the scene", "the date", "the show's story"]);
    expect(links[0].at).toBe("2026-11-12T00:00:00Z");
    // Two beats are two mentions, not one page: with room, both show.
    expect(evidenceLinks([{ ref: "beat:2026-11-09", at: AT }, { ref: "beat:2026-11-08", at: AT }], { limit: 5 })).toHaveLength(2);
    expect(evidenceLinks([], { limit: 3 })).toEqual([]);
  });
});
