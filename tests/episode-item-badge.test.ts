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
    // Drawn icons, not emoji (2026-11-08 UI audit, item 8): a glass for a mixer, two people for a double date.
    const badge = (words: string) => new RegExp(`<span class="badge" title="[^"]*"><svg class="icon"[^>]*aria-hidden="true">.*?</svg> ${words}</span>`);
    expect(html({ double: true, group_kind: "mixer" })).toMatch(badge("Speed dating"));
    expect(html({ double: true, group_kind: "double" })).toMatch(badge("Double date"));
    const plain = html({});
    expect(plain).not.toContain("Mixer");
    expect(plain).not.toContain("Group night");
  });

  it("doesn't say speed dating twice on a mixer's table (2026-11-08 UI audit, item 2)", () => {
    // Every table at a mixer is a speed date: the format badge only repeated the group one.
    const table = html({ double: true, group_kind: "mixer", format: "speed_date" } as Partial<EpisodeView>);
    expect(table).not.toContain("badge-format");
    expect(table.match(/Speed dat/g)).toHaveLength(1);
    // A date of two in that format still says so.
    expect(html({ format: "speed_date" } as Partial<EpisodeView>)).toContain('class="badge badge-format"');
  });
});
