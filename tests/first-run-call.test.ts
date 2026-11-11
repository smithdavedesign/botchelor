import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DateExcerpt from "@/app/DateExcerpt";
import type { CharacterRef, EpisodeView } from "@/lib/game";
import { pickFeaturedDate, type FeaturedDate } from "@/lib/featured-date";

// The first-run track on the hero's sample card (the design system's proposal; the 2026-11-11 audit, 2.1): read the
// opening lines, call the ending, see it, "Now send yours".

const face = (id: string, name: string): CharacterRef => ({ id, name, house: true, hue: 200, portrait: null }) as unknown as CharacterRef;
const date: FeaturedDate = {
  episode_id: "e1",
  share_path: "/episodes/e1",
  title: "The Coin Problem",
  code: "S2 · Night 7",
  characters: [face("a", "Ada Lumen"), face("b", "Bo Quill")],
  venue: null,
  setting: "A fountain at dusk.",
  lines: [
    { side: "a", text: "You came." },
    { side: "b", text: "I said I would." },
  ],
  ending: "friends",
  date_number: null,
};

describe("the call on the card", () => {
  it("asks how it ends with the three endings, and keeps a plain way to watch", () => {
    const html = renderToStaticMarkup(createElement(DateExcerpt, { date, call: true }));
    expect(html).toContain("How does it end? Call it.");
    for (const label of ["A second date", "Just friends", "A disaster"]) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain('href="/episodes/e1?play=1"');
    expect(html).toContain("Or just watch how it ends");
    expect(html).not.toContain(">Watch how it ends<");
    expect(html).toContain("A real date from the show: nobody wrote it in advance.");
  });

  it("without the call, or without a known ending, the card keeps its one button", () => {
    const plain = renderToStaticMarkup(createElement(DateExcerpt, { date }));
    expect(plain).toContain("Watch how it ends");
    expect(plain).not.toContain("How does it end?");
    const unknown = renderToStaticMarkup(createElement(DateExcerpt, { date: { ...date, ending: null }, call: true }));
    expect(unknown).toContain("Watch how it ends");
    expect(unknown).not.toContain("How does it end?");
  });

  it("the featured date carries how it ended, and which date it was", () => {
    const ep = {
      id: "x",
      share_path: "/episodes/x",
      revealed: true,
      visibility: "public",
      hidden: false,
      characters: [face("a", "Ada"), face("b", "Bo")],
      transcript: [1, 2, 3, 4].map((i) => ({ side: i % 2 ? "a" : "b", act: 0, dialogue: `line ${i} of the date`, action: "", emotion: "", interest: 0.5 })),
      setting: "A roof.",
      title: null,
      aired_at: "2026-11-05T20:00:00.000Z",
      ending: "disaster",
      date_number: 3,
    } as unknown as EpisodeView;
    const pick = pickFeaturedDate([ep]);
    expect(pick?.ending).toBe("disaster");
    expect(pick?.date_number).toBe(3);
  });
});
