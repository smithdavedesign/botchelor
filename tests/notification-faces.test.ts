import { describe, expect, it } from "vitest";
import { idsFromLink } from "@/lib/notification-faces";

describe("a notification's faces come from its link (lib/notification-faces.ts)", () => {
  it("reads a couple, a thread, a character and a date", () => {
    expect(idsFromLink("/couples/a1/b2?x=1#texts")).toEqual({ characters: ["a1", "b2"], episode: null });
    expect(idsFromLink("/messages/a1/b2?as=a1")).toEqual({ characters: ["a1", "b2"], episode: null });
    expect(idsFromLink("/characters/a1/relationships")).toEqual({ characters: ["a1"], episode: null });
    expect(idsFromLink("/episodes/e9")).toEqual({ characters: [], episode: "e9" });
  });
  it("finds nobody in other links", () => {
    expect(idsFromLink("/shop")).toEqual({ characters: [], episode: null });
    expect(idsFromLink(null)).toEqual({ characters: [], episode: null });
    expect(idsFromLink("/after-dark")).toEqual({ characters: [], episode: null });
  });
});
