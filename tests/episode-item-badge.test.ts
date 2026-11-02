import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EpisodeItem from "@/app/EpisodeItem";
import type { EpisodeView } from "@/lib/game";

// David, 2026-11-01: "Group night" read as a date of several people. Each card is one pairing: a mixer's, or one
// couple's table at a double date.
const person = (id: string, name: string) => ({ id, name, hue: 10, house: false, portrait: null, agent: false });
const episode = (extra: Partial<EpisodeView>) =>
  ({ id: "e1", characters: [person("a", "Ada Lumen"), person("b", "Bo Quill")], revealed: true, share_path: "/episodes/e1", setting: "A dive bar.", ...extra }) as unknown as EpisodeView;
const html = (extra: Partial<EpisodeView>) => renderToStaticMarkup(createElement(EpisodeItem, { episode: episode(extra) }));

describe("a group night's card", () => {
  it("says Mixer for a mixer's pairing, Double date for a double date's table, and nothing for a date of two", () => {
    expect(html({ double: true, group_kind: "mixer" })).toContain("💞 Mixer");
    expect(html({ double: true, group_kind: "double" })).toContain("💞💞 Double date");
    const plain = html({});
    expect(plain).not.toContain("Mixer");
    expect(plain).not.toContain("Group night");
  });
});
