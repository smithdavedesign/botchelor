import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EpisodeItem from "@/app/EpisodeItem";
import type { EpisodeView } from "@/lib/game";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ep = (over: Record<string, unknown>) =>
  ({
    id: "e1",
    share_path: "/episodes/e1",
    setting: "A bar",
    characters: [
      { id: "a", name: "Ada Lumen", hue: 10, house: false },
      { id: "b", name: "Bo Quill", hue: 200, house: false },
    ],
    revealed: true,
    ending: "second_date",
    is_creator: false,
    ...over,
  }) as Any as EpisodeView;

describe("an aired episode in a list doesn't give its ending away (2026-10-21)", () => {
  it("says only 'Aired' on Watch, and the ending on its creators' own list", () => {
    const watch = renderToStaticMarkup(createElement(EpisodeItem, { episode: ep({}) }));
    expect(watch).toContain(">Aired<");
    expect(watch).not.toMatch(/second date/i);
    const mine = renderToStaticMarkup(createElement(EpisodeItem, { episode: ep({ is_creator: true }) }));
    expect(mine).toMatch(/Aired: /);
  });
});
