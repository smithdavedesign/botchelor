import { describe, expect, it } from "vitest";
import { cardHtml, hookFor, placeOf, postCaption, revealFor } from "../scripts/clips/post-kit.mjs";

const date = {
  id: "ep1",
  venue: "elsewhere@A night ferry crossing the bay",
  setting: "A night ferry crossing the bay.",
  ending: "second_date",
  best_line: "Bring the juniper, dear, it can have the good glass.",
  transcript: [
    { side: "a", dialogue: "There you are, dear." },
    { side: "b", dialogue: "Tea, actually." },
    { side: "a", dialogue: "Bring the juniper, dear, it can have the good glass. That's my landing." },
  ],
  characters: [
    { name: "Kaede Hoshimura", portrait: "/api/assets/k" },
    { name: "Malachar Vey", portrait: "/api/assets/m" },
  ],
};

describe("the post kit (TikTok / Reels / Shorts)", () => {
  it("names the place from a named venue or the dealt set's sentence", () => {
    expect(placeOf(date)).toBe("a night ferry crossing the bay");
    expect(placeOf({ id: "x", venue: "laundromat", setting: "A 24-hour laundromat at midnight." })).toBe("a 24-hour laundromat at midnight");
    expect(placeOf({ id: "x" })).toBeNull();
  });

  it("hooks with the line written for the post, else the pair and the place", () => {
    expect(hookFor(date, "  A demon lord meets a jazz bar owner.  ")).toBe("A demon lord meets a jazz bar owner.");
    expect(hookFor(date)).toBe("Kaede and Malachar meet for the first time, on a night ferry crossing the bay.");
  });

  it("reveals the ending and who said the best line (from the line's side)", () => {
    expect(revealFor(date)).toEqual({ mark: "💘", label: "They want a second date", line: date.best_line, by: "Kaede" });
    expect(revealFor({ ...date, ending: "disaster", best_line: "Tea, actually." }).by).toBe("Malachar");
    const unknown = revealFor({ id: "x", ending: "something_new", best_line: null });
    expect(unknown).toMatchObject({ label: "something new", line: null, by: null });
  });

  it("captions with the hook, the AI disclosure, the link and the tags", () => {
    const caption = postCaption(date, { hook: "A demon lord meets a jazz bar owner.", tags: "#anime" });
    expect(caption.split("\n")[0]).toBe("A demon lord meets a jazz bar owner.");
    expect(caption).toContain("Would you have said yes to Malachar?");
    expect(caption).toContain("AI characters; the date is AI-generated fiction");
    expect(caption).toContain("botchelor.com");
    expect(caption).toContain("botchelor.com/vote?s=tiktok");
    // The vote's couple rotates daily and is rarely this clip's (2026-11-11 bounce review): never promise "their" date.
    expect(caption).not.toMatch(/tomorrow's date/i);
    expect(caption).toContain("one of the show's dates");
    expect(cardHtml("end", { e: date, base: "https://botchelor.com", hook: "", reveal: revealFor(date) })).not.toMatch(/tomorrow's date/i);
    expect(caption.trim().split("\n").at(-1)).toMatch(/^#botchelor .* #anime$/);
  });

  it("draws the cards with absolute portrait links, escaped text and the 18+ / AI note at the end", () => {
    const reveal = revealFor(date);
    const hook = cardHtml("hook", { e: date, base: "https://botchelor.com", hook: 'Fish & "chips" <b>', reveal });
    expect(hook).toContain('src="https://botchelor.com/api/assets/k"');
    expect(hook).toContain("Fish &amp; &quot;chips&quot; &lt;b&gt;");
    expect(cardHtml("reveal", { e: date, base: "https://botchelor.com", hook: "", reveal })).toContain("They want a second date");
    expect(cardHtml("end", { e: date, base: "https://botchelor.com", hook: "", reveal })).toContain("AI-generated fiction · 18+");
  });
});
