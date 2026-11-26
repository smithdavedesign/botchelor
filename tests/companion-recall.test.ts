import { describe, expect, it } from "vitest";
import { importanceOf, meaningBonus, memoryEmbedOn, rankFacts } from "@/lib/companion-memory";

const fact = (text: string, extra: Record<string, unknown> = {}) => ({
  id: text,
  kind: "other",
  text,
  pinned: false,
  edited_by_user: false,
  uses: 0,
  created_at: "2026-11-01T00:00:00Z",
  ...extra,
});

describe("recall by meaning (docs/PRDs/cross-mode-memory.md, phase 0)", () => {
  it("is on with an embedding key unless MEMORY_EMBED=0", () => {
    expect(memoryEmbedOn({})).toBe(false);
    expect(memoryEmbedOn({ GOOGLE_API_KEY: "k" })).toBe(true);
    expect(memoryEmbedOn({ EMBED_API_KEY: "k" })).toBe(true);
    expect(memoryEmbedOn({ EMBED_API_KEY: "k", MEMORY_EMBED: "0" })).toBe(false);
  });

  it("adds nothing when no fact stands out, and most to the best match", () => {
    expect(meaningBonus([0.5, 0.51, 0.5])).toEqual([0, 0, 0]);
    expect(meaningBonus([null, 0.7])).toEqual([0, 0]);
    const b = meaningBonus([0.3, 0.3, 0.9, 0.6, 0.3, null]);
    expect(b[2]).toBe(6);
    expect(b[3]).toBeGreaterThan(0);
    expect(b[3]).toBeLessThan(6);
    expect(b[0]).toBe(0);
    expect(b[5]).toBe(0);
  });

  it("ranks by meaning only with vectors from the same model, and pins still win", () => {
    const rows = [
      fact("They play the cello.", { pinned: true }),
      fact("Their friend lives nearby.", { embedding: [0, 1], embed_model: "m" }),
      fact("Their cousin lives nearby.", { embedding: [0, 1], embed_model: "m" }),
      fact("They are vegetarian.", { embedding: [1, 0], embed_model: "m" }),
      fact("They hate olives.", { embedding: [1, 0], embed_model: "other-model" }),
    ];
    const ranked = rankFacts(rows, "what don't I eat?", [1, 0], "m").map((r) => r.text);
    expect(ranked[0]).toBe("They play the cello.");
    expect(ranked[1]).toBe("They are vegetarian.");
    // Without a query vector it's the words-only order it always was.
    expect(rankFacts(rows, "what don't I eat?").map((r) => r.text)[1]).not.toBe("They are vegetarian.");
  });

  it("weighs what matters most a little, never past what the message is about", () => {
    const rows = [fact("They like rain.", { importance: 1 }), fact("Their dad died in May.", { importance: 5 })];
    expect(rankFacts(rows, "hello")[0].text).toBe("Their dad died in May.");
    expect(rankFacts(rows, "the rain today, I like rain")[0].text).toBe("They like rain.");
  });

  it("reads an importance as a whole number from 1 to 5", () => {
    expect(importanceOf(3)).toBe(3);
    expect(importanceOf("4")).toBe(4);
    expect(importanceOf(9)).toBe(5);
    expect(importanceOf(0)).toBe(1);
    expect(importanceOf(2.6)).toBe(3);
    expect(importanceOf("high")).toBeNull();
    expect(importanceOf(undefined)).toBeNull();
  });
});
