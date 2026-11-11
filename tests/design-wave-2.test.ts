// The design system's second wave (2026-11-11; docs/design-system-rollout.md): the season's arc in the chrome, live
// facts under the tonight band, the envelope on Sunday's reveal, and drawn icons where emoji were chrome.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Reveal from "@/app/Reveal";
import SeasonBanner from "@/app/SeasonBanner";
import TonightBand from "@/app/TonightBand";
import WeeklyReveal from "@/app/WeeklyReveal";
import type { LobbyEntry } from "@/lib/watch";
import type { RevealBoard, RevealResult } from "@/lib/weekly-reveal";

vi.mock("next/navigation", () => ({ usePathname: () => "/watch", useRouter: () => ({ refresh: () => {} }) }));

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("the season's arc", () => {
  it("in a month's first week is last season's finale, with the clapper icon", () => {
    const out = html(createElement(SeasonBanner, { now: new Date("2026-11-03T12:00:00Z") }));
    expect(out).toContain("is over");
    expect(out).toContain('class="icon"');
    expect(out).not.toContain("🎬");
  });

  it("the rest of the month is the arc: season, month, night of the month, days to the finale, the format", () => {
    const out = html(createElement(SeasonBanner, { now: new Date("2026-11-15T12:00:00Z"), format: "Speed dating" }));
    expect(out).toContain('class="season-arc"');
    expect(out).toContain("November 2026");
    expect(out).toContain("Night 15");
    expect(out).toContain("15 days to the finale");
    expect(out).toContain("Speed dating");
    expect(out).toMatch(/width:50%/);
    expect(out).toContain('href="/reunion"');
  });

  it("says Finale tonight on the last night", () => {
    const out = html(createElement(SeasonBanner, { now: new Date("2026-11-30T12:00:00Z") }));
    expect(out).toContain("Night 30");
    expect(out).toContain("Finale tonight");
  });
});

describe("live now, under the tonight band", () => {
  const NOW = Date.parse("2026-11-15T20:00:00Z");
  const iso = (mins: number) => new Date(NOW + mins * 60_000).toISOString();
  const pair = [
    { id: "ana", name: "Ana", hue: null, house: true, portrait: null },
    { id: "bo", name: "Bo", hue: null, house: true, portrait: null },
  ] as unknown as LobbyEntry["characters"];
  const room = (watching: number): LobbyEntry =>
    ({ id: `room-${watching}`, kind: "template", room_path: "/watch/x", title: "", characters: pair, phase_label: "", started: true, ended: false, watching, status: "live", starts_at: iso(-5) }) as unknown as LobbyEntry;
  const board = (over: Partial<RevealBoard>): RevealBoard =>
    ({ week_id: "2026-11-14", state: "closed", opens_at: iso(-1500), closes_at: iso(-60), airs_at: iso(20), choices: [], my_pick: null, total: 9, last: null, ...over }) as RevealBoard;

  it("counts the rooms filming and the people watching, and knows when Sunday's secret comes out", () => {
    const out = html(createElement(TonightBand, { rooms: [room(3), room(4)], airing: [], situation: null, reveal: board({}), latest: null, now: NOW }));
    expect(out).toContain('aria-label="Live now"');
    expect(out).toContain("2 dates filming · 7 watching");
    expect(out).toContain("Sunday&#x27;s secret comes out in 20 min");
  });

  it("says nothing when there's nothing live", () => {
    const out = html(createElement(TonightBand, { rooms: [], airing: [], situation: null, reveal: board({ state: "soon" }), latest: null, now: NOW }));
    expect(out).toBe("");
  });
});

describe("the envelope", () => {
  const last: RevealResult = {
    week_id: "2026-11-14",
    character_id: "sable",
    name: "Sable Quist",
    secret: "Day-shift ghostwriter.",
    votes: 1204,
    total: 2477,
    producers_pick: false,
    partner: "Nell",
    room_path: "/watch/room-1",
    at: "2026-11-15T19:20:00Z",
  };
  const board = (over: Partial<RevealBoard>): RevealBoard =>
    ({ week_id: "2026-11-14", state: "soon", opens_at: "2026-11-21T19:00:00Z", closes_at: "2026-11-22T19:00:00Z", airs_at: "2026-11-22T19:20:00Z", choices: [], my_pick: null, total: 0, last: null, ...over }) as RevealBoard;

  it("is sealed while the vote is in and the secret is minutes away", () => {
    const out = html(createElement(Reveal, { id: "w", sealed: true, kicker: "This week's envelope", sealedTitle: "Sealed until Sunday, 7:20 pm UTC" }));
    expect(out).toContain('data-state="sealed"');
    expect(out).toContain("Sealed until Sunday, 7:20 pm UTC");
    expect(out).not.toContain("reveal-card");
  });

  it("opens on the card inside, with what follows", () => {
    const out = html(createElement(Reveal, { id: "w", kicker: "This week's envelope", line: "Sable's secret is out", detail: "“Day-shift ghostwriter.”" }, createElement("a", { href: "/watch/room-1" }, "Watch their date")));
    expect(out).toContain('data-state="open"');
    expect(out).toContain("Sable&#x27;s secret is out");
    expect(out).toContain("Watch their date");
  });

  it("Sunday's reveal seals the envelope once the vote closes, and opens it once the secret is out", () => {
    const closed = html(createElement(WeeklyReveal, { board: board({ state: "closed", total: 9 }), now: Date.parse("2026-11-22T19:05:00Z") }));
    expect(closed).toContain('data-state="sealed"');
    expect(closed).toContain("Sealed until Sunday, 7:20 pm UTC");
    const out = html(createElement(WeeklyReveal, { board: board({ state: "soon", last }), now: Date.parse("2026-11-16T12:00:00Z") }));
    expect(out).toContain('data-state="open"');
    expect(text(out)).toContain("Sable's secret is out");
    expect(out).toContain("Nell has heard it: watch their date");
  });
});
