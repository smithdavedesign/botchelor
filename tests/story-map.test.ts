/**
 * This week's story map (lib/story-map.ts, app/StoryMap.tsx, app/Circle.tsx): the privacy rules first (a private or
 * deleted character, an unaired or non-public date, a hidden line, the words of a claim), then the kinds and their
 * words, the drawing's fixed places, the circle, the one read, and /house and /graph with the switch on and off.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Circle from "@/app/Circle";
import StoryMapView, { layout } from "@/app/StoryMap";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { seasonIdOf } from "@/lib/season-window";
import {
  cachedStoryMap,
  circleOf,
  CIRCLE_MAX,
  loadCircle,
  MAP_PEOPLE_MAX,
  mapView,
  shapeStoryMap,
  storyMap,
  storyMapOn,
  type RawPerson,
  type RawScene,
  type StoryFacts,
} from "@/lib/story-map";
import { startTestDb } from "./helpers";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
// The character page reads the viewer from cookies; here everyone is a stranger.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/app/AfterDarkTeaser", () => ({ default: () => null }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

// A Sunday afternoon; the week runs back to the Sunday before.
const NOW = new Date("2026-11-15T15:00:00.000Z");
const person = (id: string, name: string, over: Partial<RawPerson> = {}): RawPerson => ({ id, name, hue: 200, portrait: null, house: id.startsWith("house-"), visibility: "public", owner_id: null, ...over });
const CAST = ["house-nell", "house-juniper", "house-barnaby", "house-sable"];
const PEOPLE = [person("house-nell", "Nell Abiodun"), person("house-juniper", "Juniper Vale"), person("house-barnaby", "Barnaby Thorne"), person("house-sable", "Sable Quist"), person("oc-1", "Wren Marlow", { owner_id: "u1" })];
const facts = (over: Partial<StoryFacts> = {}): StoryFacts => ({ now: NOW, season_id: "2026-11-01", cast: CAST, lead: null, people: PEOPLE, beats: [], pairs: [], rooms: [], scenes: [], ...over });
const rivalsBeat = { day: "2026-11-15", tension: "rivals", who: ["house-nell", "house-sable", "house-juniper"], about: "house-juniper", previously: "Previously: Nell and Sable both set their sights on Juniper." };
const gossip = (over: Partial<RawScene> = {}): RawScene => ({
  id: "2026-11-15-gossip",
  day: "2026-11-15",
  kind: "gossip",
  lines: [{ character_id: "house-barnaby", tell: { about: "house-nell", about_b: "house-sable" } }, { character_id: "house-juniper", tell: null }],
  result: null,
  shown: [1, 2],
  result_shown: false,
  ...over,
});
const texts = (f: StoryFacts) => shapeStoryMap(f).ties.map((t) => `${t.text}, ${t.when}`);

describe("the story map's privacy rules", () => {
  it("leaves out every tie that touches a private character, and the character", () => {
    const hidden = PEOPLE.map((p) => (p.id === "house-sable" ? { ...p, visibility: "private" } : p));
    const map = shapeStoryMap(
      facts({
        people: hidden,
        beats: [rivalsBeat, { ...rivalsBeat, day: "2026-11-14", who: ["house-nell", "house-barnaby", "house-sable"], about: "house-sable" }],
        pairs: [{ a: "house-nell", b: "house-sable", stage: "dating", dates: 4, second_dates: 3, last_at: "2026-11-15T09:00:00Z" }],
        rooms: [{ id: "r1", a: "house-sable", b: "house-barnaby", starts_at: null, created_at: "2026-11-15T01:00:00Z", public: true, ended: false }],
        scenes: [gossip(), gossip({ id: "c", kind: "confrontation", lines: [], result: { kind: "confrontation", a: "house-nell", b: "house-sable", outcome: "worse_than_before" }, result_shown: true })],
      }),
    );
    expect(map.ties).toEqual([]);
    expect(map.people.map((p) => p.id)).toEqual(["house-nell", "house-juniper", "house-barnaby"]);
    expect(JSON.stringify(map)).not.toContain("Sable");
  });

  it("leaves out an unlisted character and one whose owner is gone", () => {
    for (const over of [{ visibility: "unlisted" }, { owner_id: "deleted" }]) {
      const people = PEOPLE.map((p) => (p.id === "oc-1" ? { ...p, ...over } : p));
      const map = shapeStoryMap(facts({ people, pairs: [{ a: "house-barnaby", b: "oc-1", stage: "dating", dates: 2, second_dates: 2, last_at: "2026-11-15T09:00:00Z" }] }));
      expect(map.ties).toEqual([]);
      expect(map.people.some((p) => p.id === "oc-1")).toBe(false);
    }
  });

  it("makes nothing of a room whose date isn't public, one that ended, or an open room that is old furniture", () => {
    const room = { id: "r1", a: "house-nell", b: "house-juniper", starts_at: null, created_at: "2026-11-15T01:00:00Z", public: true, ended: false };
    expect(texts(facts({ rooms: [room] }))).toEqual(["Nell and Juniper: a date, coming up"]);
    expect(texts(facts({ rooms: [{ ...room, public: false }] }))).toEqual([]);
    expect(texts(facts({ rooms: [{ ...room, starts_at: "2026-11-15T10:00:00Z", ended: true }] }))).toEqual([]);
    expect(texts(facts({ rooms: [{ ...room, created_at: "2026-11-10T01:00:00Z" }] }))).toEqual([]);
    // Playing now: a link to the room, and no word of how it goes.
    const live = shapeStoryMap(facts({ rooms: [{ ...room, starts_at: "2026-11-15T14:58:00Z" }] })).ties[0];
    expect(live).toMatchObject({ kind: "date_now", href: "/watch/r1", text: "Nell and Juniper: on a date right now", when: "now" });
  });

  it("reads a pair's public layer only for a date that aired this week, never one ahead", () => {
    const pair = { a: "house-barnaby", b: "house-sable", stage: "going_steady", dates: 6, second_dates: 6, last_at: "2026-11-15T02:15:00Z" };
    expect(texts(facts({ pairs: [pair] }))).toEqual(["Barnaby and Sable: going steady, last date today"]);
    expect(texts(facts({ pairs: [{ ...pair, last_at: "2026-11-01T02:15:00Z" }] }))).toEqual([]);
    expect(texts(facts({ pairs: [{ ...pair, last_at: "2026-11-16T02:15:00Z" }] }))).toEqual([]);
    expect(texts(facts({ pairs: [{ ...pair, last_at: null }] }))).toEqual([]);
    expect(texts(facts({ pairs: [{ ...pair, dates: 0 }] }))).toEqual([]);
  });

  it("uses a producer's beat only once its line is public: not tomorrow's, not one without a line", () => {
    expect(texts(facts({ beats: [rivalsBeat] }))).toEqual(["Nell and Sable: rivals for Juniper, today"]);
    expect(texts(facts({ beats: [{ ...rivalsBeat, day: "2026-11-16" }] }))).toEqual([]);
    expect(texts(facts({ beats: [{ ...rivalsBeat, previously: "" }] }))).toEqual([]);
    expect(texts(facts({ beats: [{ ...rivalsBeat, previously: null }] }))).toEqual([]);
    expect(texts(facts({ beats: [{ ...rivalsBeat, day: "2026-11-01" }] }))).toEqual([]);
  });

  it("never lets the stored order of two opposing stories show who holds the true one", () => {
    const beat = { day: "2026-11-14", tension: "opposing_claims", about: "house-juniper", previously: "Previously: Nell and Sable heard two different stories about Juniper." };
    const one = shapeStoryMap(facts({ beats: [{ ...beat, who: ["house-sable", "house-nell", "house-juniper"] }] })).ties;
    const other = shapeStoryMap(facts({ beats: [{ ...beat, who: ["house-nell", "house-sable", "house-juniper"] }] })).ties;
    expect(one).toEqual(other);
    expect(one[0]).toMatchObject({ kind: "stories", a: "house-nell", b: "house-sable", text: "Nell and Sable: heard two different stories about Juniper", when: "since yesterday" });
  });

  it("takes from a house scene only the lines and the result /house shows", () => {
    expect(texts(facts({ scenes: [gossip()] }))).toEqual(["Barnaby talked about Nell in the house, today", "Barnaby talked about Sable in the house, today"]);
    // The retelling was reported away (or its date left the air): /house no longer shows line 1.
    expect(texts(facts({ scenes: [gossip({ shown: [2] })] }))).toEqual([]);
    // A scene /house doesn't list at all.
    expect(texts(facts({ scenes: [gossip({ shown: [] })] }))).toEqual([]);
    const fight = gossip({ id: "2026-11-13-confrontation", day: "2026-11-13", kind: "confrontation", lines: [], result: { kind: "confrontation", a: "house-sable", b: "house-nell", outcome: "worse_than_before" } });
    expect(texts(facts({ scenes: [{ ...fight, result_shown: false }] }))).toEqual([]);
    const shown = shapeStoryMap(facts({ scenes: [{ ...fight, result_shown: true }] })).ties[0];
    expect(shown).toMatchObject({ kind: "feuding", text: "Nell and Sable had it out, and it ended worse than it started", when: "on Friday", href: "/house?scene=2026-11-13-confrontation#scene-2026-11-13-confrontation" });
    // A retelling by the one it is about is not gossip about them.
    expect(texts(facts({ scenes: [gossip({ lines: [{ character_id: "house-nell", tell: { about: "house-nell", about_b: "house-sable" } }, { character_id: "house-juniper" }] })] }))).toEqual(["Nell talked about Sable in the house, today"]);
  });

  it("only tells stories with one of this season's cast in them", () => {
    const people = [...PEOPLE, person("oc-2", "Ash Reyes", { owner_id: "u2" })];
    expect(texts(facts({ people, pairs: [{ a: "oc-1", b: "oc-2", stage: "dating", dates: 2, second_dates: 2, last_at: "2026-11-15T09:00:00Z" }] }))).toEqual([]);
  });
});

describe("the story map's kinds and words", () => {
  it("names each kind in plain words, with when", () => {
    const map = shapeStoryMap(
      facts({
        lead: { id: "house-nell", billing: "December's Botchelor" },
        beats: [{ ...rivalsBeat, day: "2026-11-09" }, rivalsBeat, { day: "2026-11-12", tension: "knows_said", who: ["house-juniper", "house-barnaby"], about: null, previously: "Previously: Juniper found out what Barnaby has been saying." }],
        pairs: [
          { a: "house-nell", b: "house-sable", stage: "dating", dates: 4, second_dates: 3, last_at: "2026-11-15T09:16:00Z" },
          { a: "house-sable", b: "oc-1", stage: "sparks", dates: 1, second_dates: 1, last_at: "2026-11-14T17:44:00Z" },
          { a: "house-juniper", b: "oc-1", stage: "bad_blood", dates: 1, second_dates: 0, last_at: "2026-11-11T17:36:00Z" },
          { a: "house-barnaby", b: "house-nell", stage: "just_met", dates: 1, second_dates: 0, last_at: "2026-11-15T10:00:00Z" },
        ],
        scenes: [gossip({ id: "2026-11-15-confrontation", kind: "confrontation", lines: [], result: { kind: "confrontation", a: "house-nell", b: "house-sable", outcome: "cleared_the_air" }, result_shown: true })],
      }),
    );
    expect(map.ties.map((t) => `${t.kind}: ${t.text}, ${t.when}`)).toEqual([
      // A state keeps the day it began: the beat ran on the 9th and again today.
      "rivals: Nell and Sable: rivals for Juniper, since Monday",
      "feuding: Juniper found out what Barnaby has been saying, since Thursday",
      "cleared: Nell and Sable had it out and cleared the air, today",
      "together: Nell and Sable: dating, last date today",
      "second_date: Sable and Wren: agreed to a second date, yesterday",
      "bad_blood: Juniper and Wren: bad blood after their date, since Wednesday",
    ]);
    expect(map.ties[0]).toMatchObject({ label: "rivals for Juniper", about: "house-juniper", href: "/watch" });
    expect(map.ties.find((t) => t.kind === "together")?.href).toBe("/couples/house-nell/house-sable");
    // The lead first and marked, then the cast in billing order, then whoever a tie brings.
    expect(map.people.map((p) => p.id)).toEqual(["house-nell", "house-juniper", "house-barnaby", "house-sable", "oc-1"]);
    expect(map.people.filter((p) => p.lead).map((p) => p.name)).toEqual(["Nell"]);
    expect(map.people.find((p) => p.id === "oc-1")).toMatchObject({ cast: false, name: "Wren" });
    expect(map.lead?.billing).toBe("December's Botchelor");
  });

  it("marks no lead who isn't on this season's cast, and is honest about an empty week", () => {
    const map = shapeStoryMap(facts({ lead: { id: "house-dex", billing: "December's Botchelor" } }));
    expect(map.lead).toBeNull();
    expect(map.ties).toEqual([]);
    const html = renderToStaticMarkup(createElement(StoryMapView, { map }));
    expect(html).toContain("A quiet week so far");
    expect(html).not.toContain("story-map-svg");
    // The cast is still named, each a link.
    expect(html).toContain('href="/characters/house-nell"');
  });

  it("a challenge's prize is a date coming up until its day has passed", () => {
    const won = gossip({ id: "2026-11-11-challenge", day: "2026-11-11", kind: "challenge", lines: [], result: { kind: "challenge", winner: "house-sable", prize: { day: "2026-11-16", with: "house-nell" } }, result_shown: true });
    expect(texts(facts({ scenes: [won] }))).toEqual(["Sable won a date with Nell, on Monday"]);
    expect(texts(facts({ scenes: [{ ...won, result: { kind: "challenge", winner: "house-sable", prize: { day: "2026-11-12", with: "house-nell" } } }] }))).toEqual([]);
  });
});

describe("the drawing, the list and the circle", () => {
  const full = () => {
    const extras = Array.from({ length: 14 }, (_, i) => person(`oc-x${i}`, `Guest${i} Person`, { owner_id: "u" }));
    return shapeStoryMap(
      facts({
        lead: { id: "house-nell", billing: "this season's Botchelor" },
        people: [...PEOPLE, ...extras],
        beats: [rivalsBeat],
        pairs: [
          { a: "house-nell", b: "house-sable", stage: "dating", dates: 4, second_dates: 3, last_at: "2026-11-15T09:16:00Z" },
          ...extras.map((e, i) => ({ a: "house-nell", b: e.id, stage: "sparks", dates: 1, second_dates: 1, last_at: `2026-11-14T10:${String(10 + i)}:00Z` })),
        ],
      }),
    );
  };

  it("draws the cast and whoever the strongest ties bring, one line a pair, and says what it left out", () => {
    const map = full();
    const view = mapView(map);
    expect(view.people).toHaveLength(MAP_PEOPLE_MAX);
    expect(view.people.slice(0, 4).map((p) => p.id)).toEqual(CAST);
    expect(view.left_out).toBe(map.ties.length - view.ties.length);
    expect(view.left_out).toBe(8);
    // Nell and Sable are rivals and dating: one line (the rivalry), the other tie still in the list.
    const pair = view.lines.filter((t) => [t.a, t.b].sort().join() === "house-nell,house-sable");
    expect(pair).toHaveLength(1);
    expect(pair[0]).toMatchObject({ kind: "rivals", more: 1 });
  });

  it("puts everyone in a fixed place: the lead in the middle, nobody on top of anybody, the same every time", () => {
    const view = mapView(full());
    const placed = layout(view.people, view.lines);
    expect(placed).toEqual(layout(view.people, view.lines));
    expect(placed.find((p) => p.person.lead)).toMatchObject({ x: 360, y: 264 });
    for (const p of placed) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(0);
      expect(p.x + p.r).toBeLessThanOrEqual(720);
      expect(p.y - p.r).toBeGreaterThanOrEqual(0);
      expect(p.y + p.r + 24).toBeLessThanOrEqual(540);
    }
    for (const p of placed) for (const q of placed) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y), `${p.person.name} and ${q.person.name}`).toBeGreaterThan(p.r + q.r);
    // A cast too big for the inner ring (fifteen, with no room for anyone else) still stands apart, inside the frame.
    const many = Array.from({ length: 15 }, (_, i) => person(`house-m${i}`, `Member${i} X`));
    const crowd = mapView(shapeStoryMap(facts({ cast: many.map((m) => m.id), people: [...many, ...PEOPLE], pairs: [{ a: "house-m0", b: "oc-1", stage: "dating", dates: 2, second_dates: 2, last_at: "2026-11-15T09:00:00Z" }] })));
    expect(crowd.people).toHaveLength(15);
    const ring = layout(crowd.people, crowd.lines);
    for (const p of ring) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(0);
      expect(p.x + p.r).toBeLessThanOrEqual(720);
      expect(p.y + p.r + 24).toBeLessThanOrEqual(540);
      for (const q of ring) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.r + q.r);
    }
    // Without a lead nobody takes the middle.
    const flat = mapView(shapeStoryMap(facts({ beats: [rivalsBeat] })));
    expect(layout(flat.people, flat.lines).some((p) => p.x === 360 && p.y === 264)).toBe(false);
  });

  it("renders the list before the drawing, every tie and person a link, with no script", () => {
    const html = renderToStaticMarkup(createElement(StoryMapView, { map: full() }));
    expect(html.indexOf("story-ties")).toBeLessThan(html.indexOf("story-map-svg"));
    expect(html).toContain('<a data-track="story-map" data-track-where="rivals" href="/watch">Nell and Sable: rivals for Juniper</a>');
    expect(html).toContain(", today");
    expect(html).toContain('class="story-tie story-tie-rivals"');
    expect(html).toContain('class="story-face is-lead is-cast"');
    expect(html).toContain("this season&#x27;s Botchelor");
    expect(html).toContain("And 8 more ties with people outside the cast this week.");
    // Eight sentences in view, the rest folded under them; only a line between two of the cast carries its words.
    expect(html).not.toContain("story-map-rest");
    const pairs = CAST.flatMap((x, i) => CAST.slice(i + 1).map((y) => ({ a: x, b: y, stage: "dating", dates: 2, second_dates: 2, last_at: "2026-11-14T10:00:00Z" })));
    expect(renderToStaticMarkup(createElement(StoryMapView, { map: shapeStoryMap(facts({ beats: [rivalsBeat], scenes: [gossip()], pairs })) }))).toContain("<summary>1 more this week</summary>");
    expect(html.match(/class="story-tie-label"/g)).toHaveLength(1);
    expect(html).not.toContain("<script");
    // The drawing repeats the list for the eye: hidden from a screen reader, its links out of the tab order.
    expect(html).toMatch(/<svg class="story-map-svg"[^>]*aria-hidden="true"/);
    expect(html.match(/<a href="[^"]*" class="story-(tie|face)[^>]*>/g)!.every((a) => a.includes('tabindex="-1"'))).toBe(true);
  });

  it("a circle is one character and up to six people, or nothing", () => {
    const map = full();
    const nell = circleOf(map, "house-nell")!;
    expect(nell.center.name).toBe("Nell");
    expect(nell.around).toHaveLength(CIRCLE_MAX);
    expect(nell.around[0]).toMatchObject({ person: { id: "house-sable" }, tie: { kind: "rivals" } });
    expect(new Set(nell.around.map((a) => a.person.id)).size).toBe(CIRCLE_MAX);
    expect(nell.more).toBe(map.ties.filter((t) => t.a === "house-nell" || t.b === "house-nell").length - CIRCLE_MAX);
    // On the map with no tie of their own, off the map, or no map at all: nothing.
    expect(circleOf(map, "house-barnaby")).toBeNull();
    expect(circleOf(map, "nobody")).toBeNull();
    expect(circleOf(null, "house-nell")).toBeNull();
    const html = renderToStaticMarkup(createElement(Circle, { circle: nell }));
    expect(html).toContain("Nell&#x27;s circle this week");
    expect(html).toContain("Nell and Sable: rivals for Juniper");
    expect(html.match(/class="story-face[ "]/g)).toHaveLength(CIRCLE_MAX + 1);
    expect(html).toContain(`And ${nell.more} more this week.`);
    // Someone outside the cast gets theirs from the same map.
    expect(circleOf(map, "oc-x13")?.around.map((a) => a.person.id)).toEqual(["house-nell"]);
  });
});

describe("the read, the switch and the pages", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let now: Date;
  let today: string;
  const SECRET = "Sable keeps a second phone";
  beforeAll(async () => {
    t = await startTestDb();
    setSeasonCastForTests(["house-nell", "house-juniper", "house-teo", "house-sable"]);
    now = new Date();
    today = now.toISOString().slice(0, 10);
    const season = seasonIdOf(now);
    const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
    await t.db.query(`insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility) values ('oc-pub', 'u1', false, 'Wren Marlow', 30, 'b', '[]'::jsonb, 'x', 'x', 'public'), ('oc-priv', 'u2', false, 'Hidden Harlow', 30, 'b', '[]'::jsonb, 'x', 'x', 'private')`);
    await t.db.query(
      `insert into story_beats (day, season_id, kind, status, tension, who, about, why, evidence, logline, previously, tonight)
       values ($1, $2, 'rival_date', 'staged', 'rivals', '["house-nell","house-sable","house-juniper"]', 'house-juniper', $3, '{"heard":["h1"]}', 'l', 'Previously: Nell and Sable both set their sights on Juniper.', 'Tonight: x.'),
              ($4, $2, 'same_room', 'staged', 'knows_said', '["house-teo","house-nell"]', null, 'w', '{}', 'l', 'Previously: tomorrow.', 'Tonight: y.'),
              ('2020-01-01', $2, 'same_room', 'skipped', 'mutual_distrust', '["house-teo","house-juniper"]', null, 'w', '{}', 'l', 'Previously: skipped.', 'Tonight: z.')`,
      [today, season, `the untrue claim: ${SECRET}`, new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)],
    );
    const pair = (a: string, b: string, stage: string, dates: number, seconds: number) =>
      t.db.query(
        `insert into relationships (character_a, character_b, dates, second_dates, stage, public_dates, public_second_dates, public_stage, public_last_at)
         values ($1, $2, $3, $4, 'bad_blood', $3, $4, $5, $6)`,
        [...[a, b].sort(), dates, seconds, stage, hourAgo],
      );
    await pair("house-teo", "house-sable", "going_steady", 6, 6);
    await pair("house-juniper", "oc-pub", "sparks", 1, 1);
    await pair("house-nell", "oc-priv", "dating", 2, 2);
    // A pair with only private dates: the public layer is empty, whatever the owners' layer says.
    await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage, public_dates) values ('house-juniper', 'house-nell', 3, 3, 'going_steady', 0)`);
    const lines = [
      { character_id: "house-teo", text: `I heard that ${SECRET}.`, tell: { episode_id: "ep-gone", about: "house-nell", about_b: "house-sable", claim: SECRET, is_true: false } },
      { character_id: "house-juniper", text: "Who told you that?" },
      { character_id: "house-teo", text: "People talk." },
    ];
    await t.db.query(
      `insert into house_scenes (id, day, season_id, kind, place, cast_ids, lines, told, result, source, written_at) values
        ($1, $2, $3, 'gossip', 'kitchen', '["house-teo","house-juniper"]', $4, '[]', null, 'template', now()),
        ($5, $2, $3, 'confrontation', 'stairs', '["house-nell","house-sable"]', $6, '[]', $7, 'template', now())`,
      [
        `${today}-gossip`,
        today,
        season,
        JSON.stringify(lines),
        `${today}-confrontation`,
        JSON.stringify([{ character_id: "house-nell", text: "Say it to me." }, { character_id: "house-sable", text: "Fine. I will." }]),
        JSON.stringify({ kind: "confrontation", outcome: "agreed_to_disagree", over: "rivals", a: "house-nell", b: "house-sable", witness: null, moved: [], settled: 0 }),
      ],
    );
  }, 120_000);
  afterEach(() => {
    delete process.env.STORY_MAP;
  });
  afterAll(async () => {
    setSeasonCastForTests(null);
    await t.close();
  });

  it("builds the map from the public record and nothing else", async () => {
    const map = await storyMap(t.db, now);
    expect(map.ties.map((x) => `${x.kind}: ${x.text}`)).toEqual([
      "rivals: Nell and Sable: rivals for Juniper",
      "feuding: Nell and Sable had it out and agreed to disagree",
      "together: Sable and Teo: going steady",
      "second_date: Juniper and Wren: agreed to a second date",
    ]);
    // The retelling's date is not on the air (no such public episode), so /house drops the line and so does the map;
    // the private character, tomorrow's beat, the skipped one and the private-only pair make nothing.
    const out = JSON.stringify(map);
    for (const never of [SECRET, "Hidden", "oc-priv", "talked about", "tomorrow", "skipped", "untrue", "is_true", "h1"]) expect(out, never).not.toContain(never);
    expect(map.people.map((p) => p.name)).toEqual(["Nell", "Juniper", "Teo", "Sable", "Wren"]);
    expect(map.season_id).toBe(seasonIdOf(now));
  });

  it("reads the same map for a page, a circle, or nothing with the switch off", async () => {
    expect(storyMapOn({})).toBe(true);
    expect(storyMapOn({ STORY_MAP: "0" })).toBe(false);
    expect((await cachedStoryMap(t.db))?.ties).toHaveLength(4);
    expect((await loadCircle(t.db, "house-sable"))?.around.map((a) => a.person.name)).toEqual(["Nell", "Teo"]);
    expect(await loadCircle(t.db, "oc-priv")).toBeNull();
    expect(await cachedStoryMap(t.db, { STORY_MAP: "0" })).toBeNull();
    expect(await loadCircle(t.db, "house-sable", { STORY_MAP: "0" })).toBeNull();
    // With the producer or the house off, their ties go and the rest stands.
    expect((await storyMap(t.db, now, { PRODUCER: "0" })).ties.map((x) => x.kind)).toEqual(["feuding", "together", "second_date"]);
    expect((await storyMap(t.db, now, { HOUSE_SCENES: "0" })).ties.map((x) => x.kind)).toEqual(["rivals", "together", "second_date"]);
  });

  it("/house draws the week's map under today's scene, linking everyone on /graph, and not with the switch off", async () => {
    const { default: HousePage } = await import("@/app/house/page");
    const html = renderToStaticMarkup(await HousePage());
    // One home for the drawing (D-11), the house since 2026-11-21: /graph opens on the all-time sky instead.
    expect(html).toContain("story-map-svg");
    expect(html).toContain("Who&#x27;s with whom this week");
    expect(html).toContain('id="story-map"');
    expect(html).toContain('href="/graph"');
    expect(html.indexOf("house-scene-lead")).toBeLessThan(html.indexOf('id="story-map"'));
    expect(html).not.toContain(SECRET);
    // Older pages of the house are scenes only.
    expect(renderToStaticMarkup(await HousePage({ searchParams: Promise.resolve({ page: "2" }) }))).not.toContain('id="story-map"');
    process.env.STORY_MAP = "0";
    const off = renderToStaticMarkup(await HousePage());
    expect(off).not.toContain("story-map");
    expect(off).toContain("house-scene-lead");
  });

  it("a character's page carries their circle at the top of Talk, and not with the switch off", async () => {
    const { default: CharacterPage } = await import("@/app/characters/[id]/page");
    const page = async () => renderToStaticMarkup(await CharacterPage({ params: Promise.resolve({ id: "house-sable" }) }));
    const html = await page();
    expect(html).toContain('id="circle"');
    expect(html).toContain("circle this week");
    // Above the talk, inside the Talk panel.
    expect(html.indexOf('id="panel-talk"')).toBeLessThan(html.indexOf('id="circle"'));
    expect(html).not.toContain(SECRET);
    process.env.STORY_MAP = "0";
    expect(await page()).not.toContain("story-circle");
  });

  it("/graph opens on the sky: the title line and the Cards | Map switch, the sky, then the tables folded; no story map, switch on or off", async () => {
    const { default: GraphPage } = await import("@/app/graph/page");
    const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("<h1>The Constellation</h1>");
    // The week's map is the house's now: a line to it, never the drawing.
    expect(html).not.toContain("story-map-svg");
    expect(html).not.toContain('id="story-map"');
    expect(html).toContain('href="/house#story-map"');
    const order = ["<h1>", 'aria-label="Show characters as"', 'id="all-time"', "<details", 'id="ledger"', "Who dates whom, by kind", "What the network doesn&#x27;t know yet"].map((s) => html.indexOf(s));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/<details class="constellation-fold ux-fold" id="tables">/);
    expect(html).toContain("application/ld+json");
    // A ledger page's link lands in the fold, so the fold is open for it.
    const paged = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ ledger: "1" }) }));
    expect(paged).toMatch(/<details class="constellation-fold ux-fold" id="tables" open="">/);

    process.env.STORY_MAP = "0";
    const off = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({}) }));
    expect(off).toContain("<h1>The Constellation</h1>");
    expect(off).not.toContain('id="story-map"');
    expect(off.indexOf("<h1>")).toBeLessThan(off.indexOf('id="all-time"'));
  });
});
