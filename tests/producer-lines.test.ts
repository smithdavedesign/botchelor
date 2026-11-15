/**
 * Where the producer's daily lines show (lib/producer.ts storyToday): the tonight band's facts, the season line on
 * /watch, "Since you were here", the vote card's headline; and what the clip pipeline does with the day's story (the
 * picker's preference, the caption, the post kit's hook). Rendering and pure functions only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ShowSince from "@/app/ShowSince";
import TonightBand from "@/app/TonightBand";
import SeasonLine from "@/app/watch/SeasonLine";
import type { EpisodeView } from "@/lib/game";
import type { ShowSince as ShowSinceData } from "@/lib/show-since";
import type { SituationBoard } from "@/lib/situations";
import { captionFor, fetchStory, pickClip } from "../scripts/clips/daily-clip.mjs";
import { hookFor, postCaption } from "../scripts/clips/post-kit.mjs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
const { default: SituationVote } = await import("@/app/SituationVote");

const NOW = Date.parse("2026-11-12T20:00:00Z");
const story = { previously: "Previously: Dex found out what Sable has been saying.", tonight: "Tonight: Dex wants an answer, and you pick where Dex gets to ask.", vote: true };
const board = (over: Partial<SituationBoard> = {}): SituationBoard => ({
  day: "2026-11-12",
  closes_at: new Date(NOW + 4 * 60 * 60_000).toISOString(),
  cast: [{ id: "dex", name: "Dex", hue: null, portrait: null }, { id: "sable", name: "Sable", hue: null, portrait: null }],
  headline: null,
  choices: [
    { id: "twist-1", title: "At the rooftop bar", icon: "🎬", premise: "Dex sits down with Sable at the rooftop bar and asks about what was said.", votes: 2 },
    { id: "twist-2", title: "At the old cinema", icon: "🎬", premise: "Dex sits down with Sable at the old cinema and asks about what was said.", votes: 1 },
  ],
  my_pick: null,
  total: 3,
  last: null,
  ...over,
});
const aired = { id: "ep-aired", share_path: "/episodes/ep-aired", characters: [{ id: "a", name: "Gus" }, { id: "b", name: "Hal" }], setting: "A cold beach at night.", revealed: true } as unknown as EpisodeView;

describe("the daily lines on the pages", () => {
  it("the tonight band adds the day's line to its facts, and the vote slot says what the vote decides", () => {
    const html = renderToStaticMarkup(createElement(TonightBand, { rooms: [], airing: [], situation: board({ headline: "You pick where they have it out." }), latest: aired, now: NOW, story }));
    expect(html).toContain("Tonight: Dex wants an answer, and you pick where Dex gets to ask.");
    expect(html).toContain("You pick where they have it out.");
    expect(html).toContain("Vote — closes in 4h");
    // The vote's slot already says tonight's sentence (the headline is that line without its label): the fact under it
    // is what led to it, not the same words again.
    const twice = renderToStaticMarkup(createElement(TonightBand, { rooms: [], airing: [], situation: board({ headline: "Dex wants an answer, and you pick where Dex gets to ask." }), latest: aired, now: NOW, story }));
    expect(twice).toContain("Previously: Dex found out what Sable has been saying.");
    expect(twice).not.toContain("Tonight: Dex wants an answer");
    // No story, no line; a dealt ballot keeps the pair and its own words.
    const plain = renderToStaticMarkup(createElement(TonightBand, { rooms: [], airing: [], situation: board(), latest: aired, now: NOW }));
    expect(plain).not.toContain("Tonight: ");
    expect(plain).toContain("Dex × Sable");
    expect(plain).toContain("You pick their date");
  });

  it("the season line carries tonight's line, and its fold the line before it", () => {
    const html = renderToStaticMarkup(createElement(SeasonLine, { def: null, card: null, picked: null, recoupling: null, now: NOW, story }));
    expect(html).toContain("Tonight: Dex wants an answer");
    expect(html).toContain("Previously: Dex found out what Sable has been saying.");
    expect(renderToStaticMarkup(createElement(SeasonLine, { def: null, card: null, picked: null, recoupling: null, now: NOW }))).not.toContain("Previously");
  });

  it("Since you were here lists the story with the vote a tap away", () => {
    const card = { since: new Date(NOW - 86_400_000).toISOString(), aired: 2, moves: [], calls: null, followed: 0, situation: null, diary: null, shift: null, secret: null, backing: null, season: null, twist: null, chat: null, overnights: [], house: null, story } as ShowSinceData;
    const html = renderToStaticMarkup(createElement(ShowSince, { card, inside: true }));
    expect(html).toContain("Previously: Dex found out what Sable has been saying.");
    expect(html).toContain('href="/vote"');
    expect(renderToStaticMarkup(createElement(ShowSince, { card: { ...card, story: null }, inside: true }))).not.toContain("Previously");
  });

  it("the vote card leads with what the vote decides on a day with twists, and with the pair otherwise", () => {
    const twists = renderToStaticMarkup(createElement(SituationVote, { board: board({ headline: "You pick where they have it out." }), now: NOW }));
    expect(twists).toContain("You pick where they have it out.");
    expect(twists).toContain("At the old cinema");
    expect(twists).not.toContain("what happens on their date?");
    expect(renderToStaticMarkup(createElement(SituationVote, { board: board(), now: NOW }))).toContain("Dex × Sable: what happens on their date?");
  });
});

describe("the clip pipeline and the day's story", () => {
  const ep = (id: string, over: Record<string, unknown> = {}) => ({ id, revealed: true, ending: "friends", best_line: null, transcript: Array.from({ length: 10 }, () => ({})), characters: [{ name: "Dex Marlow" }, { name: "Sable Quinn" }], ...over });

  it("the picker prefers the episode the story is about over a stronger date, and still never an unaired or clipped one", () => {
    const feed = [ep("strong", { ending: "second_date", best_line: "A line." }), ep("about")];
    expect(pickClip(feed)?.id).toBe("strong");
    expect(pickClip(feed, { prefer: new Set(["about"]) })?.id).toBe("about");
    expect(pickClip(feed, { prefer: new Set(["about"]), clipped: new Set(["about"]) })?.id).toBe("strong");
    expect(pickClip([ep("strong"), ep("about", { revealed: false })], { prefer: new Set(["about"]) })?.id).toBe("strong");
  });

  it("the caption leads with the logline when the clip is the story's date", () => {
    const with_ = captionFor(ep("about"), "https://botchelor.com", "Dex has one question for Sable.");
    expect(with_.split("\n")[0]).toBe("Dex has one question for Sable.");
    expect(with_).toContain("Dex Marlow × Sable Quinn");
    expect(captionFor(ep("about"), "https://botchelor.com").split("\n")[0]).toBe("Dex Marlow × Sable Quinn");
  });

  it("the post kit's hook is the logline unless a hook was written for the post", () => {
    expect(hookFor(ep("about"), "Dex has one question for Sable.")).toBe("Dex has one question for Sable.");
    expect(postCaption(ep("about"), { hook: "Dex has one question for Sable." }).split("\n")[0]).toBe("Dex has one question for Sable.");
    expect(hookFor(ep("about"), null)).toContain("Dex and Sable meet");
  });

  it("fetchStory reads the show's story by episode, and is empty when the show has none or can't be reached", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ day: "2026-11-12", episodes: [{ id: "about", day: "2026-11-12", logline: "Dex has one question for Sable." }] })));
    expect([...(await fetchStory("https://botchelor.com"))]).toEqual([["about", "Dex has one question for Sable."]]);
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    expect((await fetchStory("https://botchelor.com")).size).toBe(0);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await fetchStory("https://botchelor.com")).size).toBe(0);
    fetchMock.mockRestore();
  });
});
