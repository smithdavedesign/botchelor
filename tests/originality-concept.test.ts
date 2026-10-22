import { describe, expect, it } from "vitest";
import { conceptEnabled, conceptText, cosine } from "@/lib/originality-concept";

describe("originality-concept", () => {
  it("conceptText builds a short, stable string from a sheet", () => {
    const text = conceptText({
      bio: "A lighthouse keeper who reads tide tables aloud to the gulls.",
      traits: ["patient", "watchful", "salty"] as const,
      want: "Someone who can sit through a whole sunset without talking",
    });
    expect(text).toMatch(/lighthouse keeper/);
    expect(text).toMatch(/Wants: Someone/);
    expect(text).toMatch(/Traits: patient, watchful, salty/);
    expect(text.length).toBeLessThanOrEqual(1200);
  });

  it("cosine of identical vectors is ~1 and of orthogonal ones is 0", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
    expect(cosine([2, 0], [1, 0])).toBeCloseTo(1, 5); // same direction, different magnitude
  });

  it("conceptEnabled defaults to off and needs both the flag and a key", () => {
    expect(conceptEnabled({})).toBe(false);
    expect(conceptEnabled({ ORIGINALITY_CONCEPT: "1" })).toBe(false);
    expect(conceptEnabled({ ORIGINALITY_CONCEPT: "1", GOOGLE_API_KEY: "k" })).toBe(true);
    expect(conceptEnabled({ ORIGINALITY_CONCEPT: "0", GOOGLE_API_KEY: "k" })).toBe(false);
    expect(conceptEnabled({ ORIGINALITY_CONCEPT: "1", EMBED_API_KEY: "k" })).toBe(true);
    // The show's own Google key through LLM_API_KEY counts (lib/model.ts), another provider's doesn't.
    expect(conceptEnabled({ ORIGINALITY_CONCEPT: "1", LLM_API_KEY: "k" })).toBe(true);
    expect(conceptEnabled({ ORIGINALITY_CONCEPT: "1", LLM_API_KEY: "k", LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai" })).toBe(true);
    expect(conceptEnabled({ ORIGINALITY_CONCEPT: "1", LLM_API_KEY: "k", LLM_BASE_URL: "https://api.example.com/v1" })).toBe(false);
  });
});
