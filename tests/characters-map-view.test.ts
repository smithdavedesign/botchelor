import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ViewSwitch, { cardsHref, mapHref } from "@/app/characters/ViewSwitch";
import { atLink } from "@/app/Nav";

// Characters as cards or as a map (2026-11-21): /characters and /graph are the same people two ways, and the switch
// keeps the place both ways (a tab's group on the map, the group's tab on the cards).

/** Each link as "Label href", with " *" on the current one. */
const links = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>([^<]+)<\/a>/g)].map((m) => `${m[2]} ${/href="([^"]+)"/.exec(m[1])?.[1]}${m[1].includes('aria-current="page"') ? " *" : ""}`);

describe("the Cards | Map switch", () => {
  it("opens the map on the tab's group, and the cards on the group's tab", () => {
    expect(mapHref("people")).toBe("/graph?origin=person");
    expect(mapHref("cast")).toBe("/graph?origin=cast");
    // The originals are drawn with the cast, as their tab's preview is.
    expect(mapHref("originals")).toBe("/graph?origin=cast");
    expect(mapHref("agents")).toBe("/graph?origin=agent");
    expect(mapHref("yours")).toBe("/graph?origin=yours");
    expect(mapHref(null)).toBe("/graph");
    expect(cardsHref("person")).toBe("/characters?tab=people");
    expect(cardsHref("cast")).toBe("/characters");
    expect(cardsHref("agent")).toBe("/characters?tab=agents");
    expect(cardsHref("yours")).toBe("/characters?tab=yours");
    expect(cardsHref(null)).toBe("/characters");
  });

  it("marks where you are and links the other view to the same people", () => {
    const render = (props: Parameters<typeof ViewSwitch>[0]) => links(renderToStaticMarkup(createElement(ViewSwitch, props)));
    expect(render({ current: "cards", spot: "people" })).toEqual(["Cards /characters?tab=people *", "Map /graph?origin=person"]);
    expect(render({ current: "cards", spot: null })).toEqual(["Cards /characters *", "Map /graph"]);
    expect(render({ current: "map", group: "agent" })).toEqual(["Cards /characters?tab=agents", "Map /graph?origin=agent *"]);
    expect(render({ current: "map", group: null })).toEqual(["Cards /characters", "Map /graph *"]);
  });

  it("sits beside the Characters tabs, and the header's Characters door is current on the map", () => {
    expect(readFileSync("app/characters/page.tsx", "utf8")).toMatch(/<div className="characters-strip">\s*<CharactersTabs[^>]*\/>\s*<ViewSwitch current="cards"/);
    const characters = { href: "/characters", label: "Characters", also: ["/graph"] };
    expect(readFileSync("app/Nav.tsx", "utf8")).toContain('{ href: "/characters", label: "Characters", also: ["/graph"] }');
    expect(readFileSync("app/PhoneTabBar.tsx", "utf8")).toContain('{ href: "/characters", label: "Characters", icon: "users", also: ["/graph"] }');
    expect(atLink(characters, "/graph")).toBe(true);
    expect(atLink(characters, "/graph/world/abc")).toBe(true);
  });
});
