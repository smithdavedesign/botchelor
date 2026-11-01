import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AfterDarkTheater, { sceneCuts, stageLabel } from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import type { MoveLog } from "@/lib/adult/continuity";
import type { CharacterRef } from "@/lib/game";

const chars: [CharacterRef, CharacterRef] = [
  { id: "a", name: "Ada Vale", house: false, hue: 300, portrait: null },
  { id: "b", name: "Bo Reyes", house: false, hue: 200, portrait: null },
];
const scene = { lines: [{ who: "a" as const, text: "*smiles* Hi." }], place: null, stage: 0, dateVenue: null };
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(AfterDarkTheater, { scene, characters: chars, onExit: () => {}, ...props }));

describe("After Dark theater steer (David, 2026-10-21: no direct way to steer from the theater)", () => {
  it("has the page's Nudge/Direct choice beside the steer, showing the one in use", () => {
    const html = render({ onWrite: async () => {}, steerMode: "direct", onSteerMode: () => {} });
    expect(html).toContain('aria-label="How strongly"');
    expect(html).toMatch(/<input type="radio" name="theater-steer-mode" checked=""[^>]*\/> Direct/);
    expect(html).toMatch(/<input type="radio" name="theater-steer-mode"(?! checked)[^>]*\/> Nudge/);
  });

  it("a saved night's playback has no steer at all", () => {
    expect(render({})).not.toContain("theater-steer-mode");
  });
});

describe("the label over the stage: the roleplay and what they're doing, in the writer's words", () => {
  const rp = { id: "blind-date", swap: false };
  it("never a stock phrase for how far it's gone (David, 2026-10-25: 'we can't hard code this')", () => {
    const old = [
      { who: "a" as const, text: "Hi.", stage: 0 },
      { who: "b" as const, text: "*kisses her*", stage: 2 },
    ];
    expect(stageLabel({ lines: old, stage: 2 }, 2)).toBeNull();
    expect(stageLabel({ lines: old, stage: 2, roleplay: rp }, 1)).toBe("🙈 Blind date");
  });
  it("names a new chapter that has no lines yet, and claims nothing before the night's first line", () => {
    expect(stageLabel({ lines: [], stage: 4, chapter: 3 }, 0)).toBe("Chapter 3");
    expect(stageLabel({ lines: [], stage: 0, chapter: 1 }, 0)).toBeNull();
    expect(stageLabel({ lines: [], stage: 0, chapter: 1, roleplay: rp }, 0)).toBe("🙈 Blind date");
  });
  it("says what they're doing at the line on screen, and changes when they do", () => {
    const doing = [
      { who: "a" as const, text: "*slides into the booth* Hi.", stage: 0, doing: "sizing up the smug couple" },
      { who: "b" as const, text: "Hello.", stage: 0, doing: "sizing up the smug couple" },
      { who: "a" as const, text: "*grabs her hand* Run.", stage: 1, doing: "escaping out the back" },
    ];
    expect(stageLabel({ lines: doing, stage: 1, roleplay: rp }, 2)).toBe("🙈 Blind date · sizing up the smug couple");
    expect(stageLabel({ lines: doing, stage: 1, roleplay: rp }, 3)).toBe("🙈 Blind date · escaping out the back");
    expect(stageLabel({ lines: doing, stage: 1 }, 3)).toBe("escaping out the back");
  });
});

describe("#1030: a paid scene change starts a new place, not more of the old one", () => {
  const cutTo = (at: number, to: string, chapter = 1): MoveLog => ({ chapter, at, from: "the diner", to, taken: true, reason: "set_scene" });
  const old = [
    { who: "a" as const, text: "\"Accurate.\" That's high praise." },
    { who: "b" as const, text: "From me? The highest." },
  ];

  it("finds this chapter's cuts, the last pick at a line winning, and drops the rest", () => {
    const moves: MoveLog[] = [
      cutTo(1, "the old pier", 0),
      { chapter: 1, at: 1, from: null, to: "her place", taken: true, reason: "agreed" },
      { chapter: 1, at: 2, from: null, to: "a rooftop", taken: false, reason: "cap" },
      cutTo(2, "a hotel bar"),
      cutTo(2, "the hotel corridor"),
      cutTo(5, "past a rewind"),
    ];
    expect(sceneCuts({ lines: old, chapter: 1, moves })).toEqual([{ at: 2, place: "the hotel corridor" }]);
    expect(sceneCuts({ lines: old })).toEqual([]);
  });

  it("the thread says where the new scene starts, and the stage drops the old place's bubbles", () => {
    const html = render({ scene: { ...scene, lines: old, chapter: 1, moves: [cutTo(2, "the hotel corridor")] } });
    expect(html).toContain('class="chat-divider"');
    expect(html).toContain("📍 Now: the hotel corridor");
    expect(html).toContain('class="ad-scene-cut"');
    expect(html).not.toContain('<p class="scene-bubble">');
    // The thread still has the diner, above the divider.
    expect(html.indexOf("From me? The highest.")).toBeLessThan(html.indexOf('class="chat-divider"'));
  });

  it("live, the divider carries the Next hint until their first line there", () => {
    const html = render({ onWrite: async () => {}, scene: { ...scene, lines: [], chapter: 2, moves: [cutTo(0, "the hotel corridor", 2)] } });
    expect(html).toContain("Press Next to see them arrive.");
    expect(html).toContain("📍 Now: the hotel corridor");
  });

  it("lines after the cut are on the stage, with no arrival card", () => {
    const lines = [...old, { who: "a" as const, text: "*steps out of the lift* Room 412." }];
    const html = render({ scene: { ...scene, lines, chapter: 1, moves: [cutTo(2, "the hotel corridor")] } });
    expect(html).toContain('<p class="scene-bubble">Room 412.</p>');
    // Only Ada's new line: Bo's diner line isn't left standing beside it.
    expect(html.match(/<p class="scene-bubble">/g)).toHaveLength(1);
    expect(html).not.toContain('class="ad-scene-cut"');
  });
});

describe("#1029: discreet mode says why the pictures are blurred", () => {
  it("renders the hint hidden (it shows once, client-side, only while blur is on), pointing at Privacy", () => {
    const html = render({});
    expect(html).toMatch(/<p class="ad-blur-hint" role="status" hidden="">/);
    expect(html).toContain('href="/after-dark#privacy"');
  });
});

describe("the first evening (the 2026-11-01 After Dark review: tabs hidden in ⋯, nothing said what to press)", () => {
  const tabs = [
    { id: "gallery", label: "🖼 Gallery (2)" },
    { id: "setup", label: "⚙️ Set up" },
  ];
  const writer = { models: [{ id: "deepseek/deepseek-chat-v3.1:nitro", label: "DeepSeek V3.1", note: "" }], chosen: "deepseek/deepseek-chat-v3.1:nitro", default: "deepseek/deepseek-chat-v3.1:nitro", picked: false };

  it("the page's tabs are a strip along the theater's bottom, the scene first, and no longer in ⋯", () => {
    const html = render({ onWrite: async () => {}, pageTabs: tabs, onPageTab: () => {}, steps: { canRewind: false, canReset: false, onRewind() {}, onRedo() {}, onReset() {} } });
    expect(html).toMatch(/<nav class="ad-theater-tabs" aria-label="Their night"><span class="ad-theater-tab on" aria-current="page">🎬 Scene<\/span><button[^>]*>🖼 Gallery \(2\)<\/button><button[^>]*>⚙️ Set up<\/button><\/nav>/);
    expect(html).not.toContain("ad-tools-page-tab");
  });

  it("without the page (a saved night played back) there's no strip", () => {
    expect(render({})).not.toContain("ad-theater-tabs");
  });

  it("before the first line: how it goes and who writes it, and no video or picture buttons yet", () => {
    const html = render({ scene: { ...scene, lines: [] }, onWrite: async () => {}, writer, onMakeVideo: () => {}, onPlanVideo: () => {} });
    expect(html).toContain('class="ad-start-card"');
    expect(html).toMatch(/ad-start-how[^>]*>▶ Start, then <strong>Next<\/strong> for each step, or tick Autoplay\. Type in the box below to steer them\. ✍️ DeepSeek V3\.1 writes it: switch at the top\./);
    expect(html).not.toContain("Video of the night");
    expect(html).not.toContain("ad-capture");
  });

  it("once it's going, the video and picture buttons are back", () => {
    const html = render({ onWrite: async () => {}, writer, onMakeVideo: () => {}, onPlanVideo: () => {} });
    expect(html).toContain("Video of the night");
    expect(html).toContain("ad-capture");
    expect(html).not.toContain("ad-start-how");
  });
});

describe("a night that's over (David, 2026-11-01: \"once the night is over you can't go back and make a video of the night\")", () => {
  const steps = { canRewind: false, redoTitle: "", canReset: true, onRewind() {}, onRedo() {}, onReset() {} };

  it("the new night's start card says where the last one went, to watch it or make its video", () => {
    const html = render({ scene: { ...scene, lines: [] }, onWrite: async () => {}, lastNight: { label: "3 chapters", videoTokens: 7, canVideo: true, onWatch() {}, onVideo() {} } });
    expect(html).toMatch(/data-last-night[^>]*>🌙 Your last night \(3 chapters\) is kept under 🖼 Gallery → Nights\./);
    expect(html).toMatch(/<button type="button" class="linklike">▶ Watch it<\/button> · <button type="button" class="linklike">🎬 Make its video · 7 tokens<\/button>/);
  });

  it("a night too short to film says so with the button off; with no ended night there's no line", () => {
    const short = render({ scene: { ...scene, lines: [] }, onWrite: async () => {}, lastNight: { label: "4 lines", videoTokens: 7, canVideo: false, onWatch() {}, onVideo() {} } });
    expect(short).toMatch(/<button type="button" class="linklike" disabled="">🎬 Make its video · 7 tokens<\/button>/);
    expect(render({ scene: { ...scene, lines: [] }, onWrite: async () => {} })).not.toContain("data-last-night");
  });

  it("⋯ says End the night, not Start over, and where its chapters go", () => {
    const html = render({ onWrite: async () => {}, steps });
    expect(html).toMatch(/title="Files tonight&#x27;s chapters under Gallery → Nights[^"]*"[^>]*>🌙 End the night<\/button>/);
    expect(html).not.toMatch(/>Start over</);
  });
});

describe("#1204: a steer typed while a step is being written", () => {
  it("the box stays open mid-write and says the steer goes when these lines land; Next waits", () => {
    const html = render({ onWrite: async () => {}, busy: true });
    expect(html).toMatch(/<input aria-label="Steer it \(optional\)"(?![^>]*disabled)[^>]*placeholder="Type the next steer: it goes when these lines land…"/);
    expect(html).toMatch(/<button type="submit" class="primary" disabled=""[^>]*>Writing…<\/button>/);
  });

  it("not writing, the box and Next are as they were", () => {
    const html = render({ onWrite: async () => {} });
    expect(html).toContain('placeholder="Steer it (optional)…"');
    expect(html).not.toContain("ad-steer-queued");
  });
});

describe("#1214: a night still going opens where it is", () => {
  it("shows every line already written, so the first Next writes the next step instead of skipping a replay", () => {
    // The 2026-11-01 After Dark visitor: "the next Next reveals lines that were already written; the home list (24 lines)
    // ran ahead of the theater (20)". It replayed the last six on opening.
    const lines = Array.from({ length: 10 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `Line number ${i + 1}.` }));
    const html = render({ scene: { ...scene, lines }, onWrite: async () => {} });
    for (let i = 1; i <= 10; i++) expect(html).toContain(`Line number ${i}.`);
  });
});
