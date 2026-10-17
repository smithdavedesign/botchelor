// Both visitor runs' remaining suggestions (docs/agent-visitor-test.md, after run 2), the pure parts.
import { describe, expect, it } from "vitest";
import { llmsText } from "@/lib/agents";
import { checkFields } from "@/lib/safety";
import { venueForPlan } from "@/lib/relationships";
import { endingWhy } from "@/lib/why";

const box = (chemistry: number, attraction: number, trust: number, awkwardness: number) => ({
  chemistry: { final: chemistry }, attraction: { final: attraction }, trust: { final: trust }, awkwardness: { final: awkwardness },
});
const side = (dealbreaker: string | null = null) => ({ wants_another: false, agenda_met: false, satisfied: false, dealbreaker_hit: dealbreaker, want_met: null, note_followed: null });

describe("every ending says why", () => {
  it("names what finished low, the strategy's lean, and that endings read where numbers finished", () => {
    const why = endingWhy("disaster", box(58, 55, 39, 62), [side("smoking"), side()], "long_term")!;
    expect(why).toMatch(/^A disaster: a dealbreaker tripped, trust 39 finished low, awkwardness finished at 62\./);
    expect(why).toMatch(/long-term compatibility, which leans on trust/);
    expect(why).toMatch(/where the numbers finished, not how far they moved/);
    expect(endingWhy("second_date", box(72, 60, 61, 30), null, "genuine_chemistry")).toMatch(/^A second date: chemistry 72 and trust 61 carried it\./);
    expect(endingWhy("friends", box(49, 52, 63, 40), null, null)).toMatch(/^Just friends: warm enough \(trust 63\), but chemistry 49 never got there\./);
    expect(endingWhy("friends", null, null, null)).toBeNull();
  });
  it("never says whose dealbreaker it was", () => {
    expect(endingWhy("disaster", box(40, 40, 40, 70), [side("smoking"), side()], null)).not.toMatch(/smoking/);
  });
});

describe("second dates go where they planned", () => {
  it("sends a food-truck plan to the café, not the rooftop bar", () => {
    expect(venueForPlan([{ text: "Chilli from the food truck, then drinks?" }])).toBe("corner_cafe");
    expect(venueForPlan([{ text: "Drinks on the roof Thursday" }])).toBe("rooftop_bar");
  });
});

describe("the guide's full example character", () => {
  it("is valid JSON that passes the content rules, with lines as an object", () => {
    const text = llmsText("https://b.test");
    const json = /## A full example character[\s\S]*?```json\n([\s\S]*?)\n```/.exec(text)?.[1];
    const c = JSON.parse(json!);
    expect(Object.keys(c.extras.lines)).toEqual(["hello", "dodge", "flirt", "upset"]);
    expect(checkFields({ bio: c.bio, want: c.want, voice: c.voice, lines: Object.values(c.extras.lines) as string[] }).ok).toBe(true);
    expect(c.name.split(" ").length).toBeLessThanOrEqual(5);
    expect(c.voice.length).toBeLessThanOrEqual(200);
  });
});
