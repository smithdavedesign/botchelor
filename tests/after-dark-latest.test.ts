import { describe, expect, it } from "vitest";
import { latestMade } from "@/lib/adult/latest";
import { postHref } from "@/lib/showcase-paths";

// After Dark's home shows what they made last (2026-11-15), and a post says where it is on the showcase.
describe("latestMade", () => {
  const m = (id: string, over: Partial<{ kind: "baseline" | "scene" | "video"; status: string; rating: 1 | -1 | null; archived: boolean; in_reel: boolean }> = {}) => ({
    id,
    kind: "scene" as const,
    status: "ready",
    rating: null,
    archived: false,
    in_reel: false,
    ...over,
  });

  it("keeps the newest four that came through, leaving out faces, the Archive and a 👎", () => {
    const items = [
      m("face", { kind: "baseline" }),
      m("v1", { kind: "video" }),
      m("making", { kind: "video", status: "making" }),
      m("out", { archived: true }),
      m("down", { rating: -1 }),
      m("p1"),
      m("p2", { rating: 1 }),
      m("p3"),
      m("p4"),
    ];
    expect(latestMade(items).map((x) => x.id)).toEqual(["v1", "p1", "p2", "p3"]);
    expect(latestMade([m("face", { kind: "baseline" })])).toEqual([]);
  });

  it("lets one shot stand for a night's video, not four shots of it", () => {
    const shots = ["s1", "s2", "s3", "s4"].map((id) => m(id, { kind: "video", in_reel: true }));
    expect(latestMade([...shots, m("clip", { kind: "video" }), m("p1")]).map((x) => x.id)).toEqual(["s1", "clip", "p1"]);
  });
});

describe("postHref", () => {
  it("opens an explicit post on After Dark's own showcase, else the show's Gallery, on their own posts", () => {
    // 2026-11-18 (lib/showcase-paths.ts): After Dark's side is After Dark's page, so the After Dark Studio's link stays there.
    expect(postHref("nsfw", "darood")).toBe("/after-dark/showcase?creator=darood");
    expect(postHref("nsfw", null)).toBe("/after-dark/showcase");
    expect(postHref("pg", "darood")).toBe("/showcase?creator=darood");
    expect(postHref("suggestive", null)).toBe("/showcase");
  });
});
