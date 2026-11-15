import { describe, expect, it } from "vitest";
import { latestMade } from "@/lib/adult/latest";
import { postHref } from "@/app/showcase/PublishButton";

// After Dark's home shows what they made last (2026-11-15), and a post says where it is on the showcase.
describe("latestMade", () => {
  const m = (id: string, over: Partial<{ kind: "baseline" | "scene" | "video"; status: string; rating: 1 | -1 | null; archived: boolean }> = {}) => ({
    id,
    kind: "scene" as const,
    status: "ready",
    rating: null,
    archived: false,
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
});

describe("postHref", () => {
  it("opens an explicit post on After Dark's side, else the safe side, on their own posts", () => {
    expect(postHref("nsfw", "darood")).toBe("/showcase?side=after_dark&creator=darood");
    expect(postHref("pg", "darood")).toBe("/showcase?side=pg&creator=darood");
    expect(postHref("suggestive", null)).toBe("/showcase?side=pg");
  });
});
