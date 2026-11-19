/**
 * The branded clip (scripts/clips/branded-clip.mjs): which lines it shows and how it trims them (every word the date's
 * own, nothing between kept sentences dropped), where the scenes and voices go, what each cut says, and which dates it
 * refuses. The Remotion side (video/) is rendered on the Mac; this keeps the props it's given honest.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script
import { CPS, FPS, HOLD, MAX_CHARS, MAX_LINE, MAX_LINES, SCENE, TYPING, backdropPath, bubbleText, captionOf, faceUrl, layout, pickLines, propsFor, refusal, tagOf } from "../scripts/clips/branded-clip.mjs";

const LONG = "You're a beat ahead of me. My channel has a foghorn in it. Yours sounds like someone counting down a lighthouse. Still, you came up the roof stairs. Storm coat's on, for the record.";
const BEST = "Is your foghorn on a schedule, or does it go off whenever it feels like being heard?";
const date = (over: Record<string, unknown> = {}) => ({
  id: "ep1",
  revealed: true,
  visibility: "public",
  ending: "disaster",
  why: "A disaster: the gull won.",
  venue: "silent_disco",
  goals: [{ character_id: "house-juniper", goal: "A co-host who believes in at least one ghost" }],
  characters: [
    { id: "house-juniper", name: "Juniper Vale", house: true, hue: 200, portrait: null },
    { id: "c2", name: "Mira Okon", house: false, hue: 10, portrait: "/api/assets/abc", credit: { handle: "mo", name: "Mo" } },
  ],
  best_line: BEST,
  transcript: [
    { side: "a", dialogue: LONG },
    { side: "b", dialogue: "*She laughs.*" },
    { side: "a", dialogue: "Same gull. It came back this morning." },
    { side: "b", dialogue: `Gulls don't come with name tags. ${BEST} Anyway.` },
    { side: "a", dialogue: "Every forty seconds." },
  ],
  ...over,
});

describe("bubbleText", () => {
  it("keeps whole sentences from the start, up to the limit", () => {
    const t = bubbleText(LONG)!;
    expect(t.length).toBeLessThanOrEqual(MAX_LINE);
    expect(LONG.startsWith(t)).toBe(true);
    expect(t.endsWith(".")).toBe(true);
  });
  it("ends on the best line's sentence, with the sentences right before it", () => {
    expect(bubbleText(`Gulls don't come with name tags. ${BEST} Anyway.`, BEST)).toBe(`Gulls don't come with name tags. ${BEST}`);
  });
  it("shows nothing for an action-only line", () => {
    expect(bubbleText("*She laughs.*")).toBeNull();
  });
});

describe("pickLines", () => {
  it("starts a line before the best line and stops at an action-only line rather than skipping it", () => {
    const lines = pickLines(date());
    expect(lines.map((l: { text: string }) => l.text)).toEqual(["Same gull. It came back this morning.", `Gulls don't come with name tags. ${BEST}`, "Every forty seconds."]);
    expect(lines.map((l: { side: string }) => l.side)).toEqual(["a", "b", "a"]);
  });
  it("falls back to the start, and keeps to the line and character limits", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ side: i % 2 ? "b" : "a", dialogue: `Line number ${i} is here and it says quite a lot of things, really.` }));
    const lines = pickLines(date({ best_line: null, transcript: many }));
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
    expect(lines.reduce((n: number, l: { text: string }) => n + l.text.length, 0)).toBeLessThanOrEqual(MAX_CHARS);
    expect(lines[0].text).toContain("Line number 0");
  });
});

describe("layout", () => {
  const lines = [{ side: "a", text: "x".repeat(60) }, { side: "b", text: "y".repeat(30) }];
  it("gives a silent line time to type and be read", () => {
    const p = layout(lines, [0, 0], "full");
    expect(p.ats[0]).toBe(SCENE.lead);
    expect(p.ats[1] - p.ats[0]).toBe(TYPING + Math.ceil(60 / CPS) + HOLD);
    expect(p.t.end - p.t.verdict).toBe(SCENE.verdict.full);
    expect(p.t.total - p.t.end).toBe(SCENE.end);
  });
  it("gives a voiced line its whole voice, and starts the voice as its bubble types", () => {
    const p = layout(lines, [6, 0], "teaser");
    expect(p.ats[1] - p.ats[0]).toBe(TYPING + Math.ceil(6.35 * FPS));
    expect(p.marks[0]).toBeCloseTo((p.t.date + p.ats[0] + TYPING) / FPS);
    expect(p.t.end - p.t.verdict).toBe(SCENE.verdict.teaser);
  });
});

describe("propsFor and captionOf", () => {
  const e = date();
  const lines = pickLines(e);
  const plan = layout(lines, lines.map(() => 0), "full");
  it("stamps the real ending only on the full cut", () => {
    const full = propsFor(e, lines, plan, "full", "https://botchelor.com");
    const teaser = propsFor(e, lines, plan, "teaser", "https://botchelor.com");
    expect(full.ending).toBe("disaster");
    expect(full.endingLabel).toBe("A disaster");
    expect(teaser.ending).toBeNull();
    expect(teaser.endingLabel).toBeNull();
  });
  it("draws faces from the house cast and the site, and says who made each", () => {
    const p = propsFor(e, lines, plan, "full", "https://botchelor.com");
    expect(p.faces[0].portrait).toBe("cast/house-juniper-v5.webp");
    expect(p.faces[1].portrait).toBe("https://botchelor.com/api/assets/abc");
    expect(p.faces[0].about).toBe("Tonight: A co-host who believes in at least one ghost");
    expect(p.backdrop).toBe("cast/venue-silent_disco-v2.webp");
  });
  it("never says how it ended in the teaser's caption", () => {
    const teaser = captionOf(e, "teaser", "https://botchelor.com");
    expect(teaser).not.toMatch(/disaster:|A disaster/);
    expect(teaser).toContain("https://botchelor.com/episodes/ep1");
    expect(teaser).toContain("Mira is by Mo");
    expect(captionOf(e, "full", "https://botchelor.com")).toContain("A disaster");
  });
});

describe("helpers", () => {
  it("names who made a character", () => {
    expect(tagOf({ house: true })).toBe("House cast");
    expect(tagOf({ credit: { name: "Mo" } })).toBe("By Mo");
    expect(tagOf({ agent: true })).toBe("Made by an AI agent");
    expect(tagOf({})).toBe("An original character");
  });
  it("finds backdrops and faces, or none", () => {
    expect(backdropPath("gothic_manor@x")).toBe("cast/venue-gothic_manor-v3.webp");
    expect(backdropPath("elsewhere")).toBeNull();
    expect(faceUrl({ id: "c", house: false, portrait: null }, "https://botchelor.com")).toBeNull();
  });
  it("refuses a date that hasn't aired publicly, isn't featurable, or hasn't ended", () => {
    expect(refusal(date())).toBeNull();
    expect(refusal(date({ visibility: "unlisted" }))).toMatch(/public/);
    expect(refusal(date({ revealed: false }))).toMatch(/aired/);
    expect(refusal(date({ featurable: false }))).toMatch(/featurable/);
    expect(refusal(date({ ending: undefined }))).toMatch(/ending/);
  });
});

describe("the template the script renders", () => {
  const show = readFileSync("video/src/Show.tsx", "utf8");
  it("types bubbles at the pace the script lays out", () => {
    expect(show).toContain(`const TYPING = ${TYPING};`);
    expect(show).toContain(`const CPS = ${CPS};`);
  });
  it("is checked by the app's typecheck only in video/ itself", () => {
    expect(JSON.parse(readFileSync("tsconfig.json", "utf8")).exclude).toContain("video");
  });
});
