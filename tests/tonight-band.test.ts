import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TonightBand from "@/app/TonightBand";
import type { AiringSoon, EpisodeView } from "@/lib/game";
import type { SituationBoard } from "@/lib/situations";
import type { LobbyEntry } from "@/lib/watch";

const NOW = Date.parse("2026-11-02T20:00:00Z");
const iso = (minsAhead: number) => new Date(NOW + minsAhead * 60_000).toISOString();
const pair = (a: string, b: string) =>
  [
    { id: a.toLowerCase(), name: a, hue: null, house: true, portrait: null },
    { id: b.toLowerCase(), name: b, hue: null, house: true, portrait: null },
  ] as [LobbyEntry["characters"][0], LobbyEntry["characters"][1]];

const room = (status: LobbyEntry["status"], over: Partial<LobbyEntry> = {}): LobbyEntry =>
  ({ id: `room-${status}`, kind: "template", room_path: `/watch/${status}`, title: "", characters: pair("Ana", "Bo"), phase_label: "", started: false, ended: false, watching: 3, status, starts_at: iso(45), followup_of: null, date_number: null, ...over }) as LobbyEntry;

const airing = (over: Partial<AiringSoon> = {}): AiringSoon =>
  ({ id: "ep-soon", share_path: "/episodes/ep-soon", characters: pair("Cy", "Dee"), airs_at: iso(12), my_pick: null, revealed: false, setting: "A rooftop bar.", ...over }) as unknown as AiringSoon;

const vote = (over: Partial<SituationBoard> = {}): SituationBoard =>
  ({ day: "2026-11-02", closes_at: iso(300), cast: [{ id: "e", name: "Em", hue: null }, { id: "f", name: "Fi", hue: null }], choices: [], my_pick: null, total: 4, last: null, ...over }) as SituationBoard;

const aired = (over: Partial<EpisodeView> = {}): EpisodeView =>
  ({ id: "ep-aired", share_path: "/episodes/ep-aired", characters: pair("Gus", "Hal"), setting: "A cold beach at night.", revealed: true, ...over }) as unknown as EpisodeView;

const band = (props: Partial<Parameters<typeof TonightBand>[0]>) =>
  renderToStaticMarkup(createElement(TonightBand, { rooms: [], airing: [], situation: null, latest: null, now: NOW, ...props }));

describe("the tonight band", () => {
  it("renders nothing when nothing is on", () => {
    expect(band({})).toBe("");
  });

  it("leads with live, keeps at most three slots, and the vote knows its close", () => {
    const html = band({ rooms: [room("live")], airing: [airing()], situation: vote(), latest: aired() });
    expect(html).toContain("Tonight on Botchelor");
    const order = ["Live now", "Airing soon", "Tonight&#x27;s vote"].map((s) => html.indexOf(s));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).not.toContain("Just aired"); // the fourth slot gives way
    expect(html).toContain("3 watching");
    expect(html).toContain("Airs in 12 min");
    expect(html).toContain("closes in 5h");
    expect(html).toContain("tonight-live-dot");
  });

  it("offers the premiere only when nothing is live, and quotes a written title", () => {
    const html = band({ rooms: [room("upcoming", { starts_at: iso(90) })], latest: aired({ title: "The Fountain Incident" }) });
    expect(html).toContain("Tonight&#x27;s premiere");
    expect(html).toContain("Starts in 1h 30m");
    expect(html).toContain("“The Fountain Incident”");
    const withLive = band({ rooms: [room("live"), room("upcoming")] });
    expect(withLive).not.toContain("premiere");
  });

  it("tells a viewer whose call is in, and one who hasn't called yet", () => {
    expect(band({ airing: [airing({ my_pick: "friends" } as Partial<AiringSoon>)] })).toContain("your call is in");
    expect(band({ airing: [airing()] })).toContain("call the ending first");
  });
});
