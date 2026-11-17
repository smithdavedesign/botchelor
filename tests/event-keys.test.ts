// An event knows which character and which date it is about (the connected model, stage 6): the browser reads them off
// the page's address or the control (app/engagement.ts addressKeys, trackKey), the server lifts them into
// web_events.character_id / episode_id and keeps them out of props (lib/engagement.ts eventKeys). Never for After Dark.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as beacon } from "@/app/api/e/route";
import { addressKeys, trackKey } from "@/app/engagement";
import { cleanBeacon, eventKeys, eventKeysOn, recordBeacon, resetBudgetsForTests } from "@/lib/engagement";
import { setPlaceForTests } from "@/lib/place";
import { BASE_URL, startTestDb, TEST_SESSION_SECRET } from "./helpers";

const CHARACTER = "5305594b-ea07-4b56-ad87-a1725c18113f";
const EPISODE = "0b0c7a52-1d1e-4f6a-9a53-3f4de2a1c001";
const V1 = "11111111-1111-4111-8111-111111111111";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("the browser: which character, which date (pure)", () => {
  it("reads the id off a character's page, a date's page, My studio and Chat", () => {
    expect(addressKeys(`/characters/${CHARACTER}`)).toEqual({ character_id: CHARACTER });
    expect(addressKeys(`/characters/${CHARACTER}/relationships`)).toEqual({ character_id: CHARACTER });
    expect(addressKeys("/characters/house-teo")).toEqual({ character_id: "house-teo" });
    expect(addressKeys(`/episodes/${EPISODE}`)).toEqual({ episode_id: EPISODE });
    expect(addressKeys("/studio", `?character=${CHARACTER}`)).toEqual({ character_id: CHARACTER });
    expect(addressKeys("/chat", `?tab=texts&character=${CHARACTER}`)).toEqual({ character_id: CHARACTER });
  });

  it("names nothing anywhere else, for something that is not an id, or on After Dark", () => {
    for (const [path, search] of [
      ["/", ""],
      ["/characters", "?tab=yours"],
      ["/characters/abc", ""],
      ["/episodes", ""],
      ["/studio", ""],
      ["/studio", "?character=not an id"],
      ["/chat", "?character=x"],
      ["/watch", `?character=${CHARACTER}`],
      [`/couples/${CHARACTER}/house-teo`, ""],
      [`/companion/${CHARACTER}`, ""],
      [`/after-dark/${CHARACTER}/house-teo`, ""],
      ["/after-dark/studio", `?character=${CHARACTER}`],
    ] as const) {
      expect(addressKeys(path, search), `${path}${search}`).toEqual({});
    }
  });

  it("a control says which character or date it is about with data-track-character / data-track-episode", () => {
    expect(trackKey("data-track-character")).toBe("character_id");
    expect(trackKey("data-track-episode")).toBe("episode_id");
    expect(trackKey("data-track-kind")).toBe("kind");
    expect(trackKey("data-track-from-page")).toBe("from_page");
  });

  it("every queued event carries the page's keys, a leaving page the ones it opened with, and none on After Dark's host", () => {
    const src = readFileSync(join(process.cwd(), "app/engagement.ts"), "utf8");
    expect(src).toContain("props: withKeys(props, at)");
    expect(src).toContain("if (afterDarkHost) return props;");
    expect(src).toContain('queueEvent("page_leave", { ...page.keys, seconds: Math.round(visible / 1000), scroll: page.scroll }, page.path);');
    expect(src).toContain("const keys = afterDarkHost ? {} : addressKeys(path, location.search);");
    // What the control or the caller says wins over the address.
    expect(src).toContain("{ ...keys, ...props }");
  });
});

describe("the server: lifted into columns, out of props (pure)", () => {
  const ev = (props: Record<string, string | number | boolean>, path = "/characters/:id", event = "page_view") => ({ event, path, props });

  it("lifts both keys when they look like ids, and keeps them out of props either way", () => {
    expect(eventKeys(ev({ character_id: CHARACTER, episode_id: EPISODE, area: "main" }), { afterDark: false })).toEqual({ props: { area: "main" }, character_id: CHARACTER, episode_id: EPISODE });
    expect(eventKeys(ev({ character_id: "house-teo" }), { afterDark: false })).toEqual({ props: {}, character_id: "house-teo", episode_id: null });
    // Not an id: dropped, never stored as a prop.
    expect(eventKeys(ev({ character_id: "x", episode_id: "has space in it", label: "Follow" }), { afterDark: false })).toEqual({ props: { label: "Follow" }, character_id: null, episode_id: null });
    expect(eventKeys(ev({ character_id: 12, episode_id: true }), { afterDark: false })).toEqual({ props: {}, character_id: null, episode_id: null });
    expect(eventKeys(ev({ seconds: 4 }), { afterDark: false })).toEqual({ props: { seconds: 4 }, character_id: null, episode_id: null });
  });

  it("never for After Dark: its host, or one of its pages on the show's", () => {
    const keys = { character_id: CHARACTER, episode_id: EPISODE, area: "main" };
    expect(eventKeys(ev(keys), { afterDark: true })).toEqual({ props: { area: "main" }, character_id: null, episode_id: null });
    expect(eventKeys(ev(keys, "/after-dark/:id/house-teo"), { afterDark: false })).toEqual({ props: { area: "main" }, character_id: null, episode_id: null });
    expect(eventKeys(ev(keys, "/after-dark"), { afterDark: false })).toEqual({ props: { area: "main" }, character_id: null, episode_id: null });
    // A page that merely starts with the same letters is not After Dark's.
    expect(eventKeys(ev(keys, "/after-darkness"), { afterDark: false }).character_id).toBe(CHARACTER);
  });

  it("EVENT_KEYS=0: nothing is lifted; a watched ending keeps its date as a prop, as before", () => {
    expect(eventKeysOn({})).toBe(true);
    expect(eventKeysOn({ EVENT_KEYS: "0" })).toBe(false);
    expect(eventKeys(ev({ character_id: CHARACTER, episode_id: EPISODE, area: "main" }), { afterDark: false, on: false })).toEqual({ props: { area: "main" }, character_id: null, episode_id: null });
    expect(eventKeys(ev({ episode_id: EPISODE, via: "theater" }, "/episodes/:id", "date_watched"), { afterDark: false, on: false })).toEqual({ props: { via: "theater", episode_id: EPISODE }, character_id: null, episode_id: null });
  });
});

describe("stored", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from web_events");
    resetBudgetsForTests();
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    setPlaceForTests({ country: "CA", region: "ON" });
  });
  afterEach(() => {
    setPlaceForTests(null);
    vi.unstubAllEnvs();
  });

  const send = (events: unknown[]) =>
    beacon(new Request(`${BASE_URL}/api/e`, { method: "POST", headers: { "content-type": "text/plain", "user-agent": MAC }, body: JSON.stringify({ v: V1, s: S1, events }) }));
  const stored = async () =>
    (await t.db.query<{ event: string; path: string; props: Record<string, unknown>; character_id: string | null; episode_id: string | null; host: string }>(
      `select event, path, props, character_id, episode_id, host from web_events order by id`,
    )).rows;

  it("the beacon route stores the keys in their columns and nothing of them in props", async () => {
    const res = await send([
      { e: "page_view", path: `/characters/${CHARACTER}`, props: { character_id: CHARACTER }, t: Date.now() },
      { e: "date_watched", path: `/episodes/${EPISODE}`, props: { episode_id: EPISODE, via: "theater" }, t: Date.now() },
      { e: "character-follow", path: "/characters", props: { character_id: "house-teo", area: "main" }, t: Date.now() },
      { e: "page_view", path: "/watch", props: {}, t: Date.now() },
    ]);
    expect(res.status).toBe(204);
    expect(await stored()).toEqual([
      { event: "page_view", path: "/characters/:id", props: {}, character_id: CHARACTER, episode_id: null, host: "show" },
      { event: "date_watched", path: "/episodes/:id", props: { via: "theater" }, character_id: null, episode_id: EPISODE, host: "show" },
      { event: "character_follow", path: "/characters", props: { area: "main" }, character_id: "house-teo", episode_id: null, host: "show" },
      { event: "page_view", path: "/watch", props: {}, character_id: null, episode_id: null, host: "show" },
    ]);
  });

  it("After Dark's host keeps neither, and EVENT_KEYS=0 keeps none", async () => {
    const b = cleanBeacon({ v: V1, s: S1, events: [{ e: "page_view", path: `/characters/${CHARACTER}`, props: { character_id: CHARACTER, episode_id: EPISODE }, t: Date.now() }] })!;
    await recordBeacon(t.db, b, { userId: null, country: null, device: "desktop", host: "after_dark" });
    await recordBeacon(t.db, b, { userId: null, country: null, device: "desktop", host: "show" }, { EVENT_KEYS: "0" });
    await recordBeacon(t.db, b, { userId: null, country: null, device: "desktop", host: "show" }, {});
    expect((await stored()).map((r) => [r.host, r.character_id, r.episode_id, r.props])).toEqual([
      ["after_dark", null, null, {}],
      ["show", null, null, {}],
      ["show", CHARACTER, EPISODE, {}],
    ]);
  });

  it("the schema adds the two columns at the end, with partial indexes", () => {
    const db = readFileSync(join(process.cwd(), "lib/db.ts"), "utf8");
    expect(db).toContain("alter table web_events add column if not exists character_id text;");
    expect(db).toContain("alter table web_events add column if not exists episode_id text;");
    expect(db).toContain("on web_events (character_id, at) where character_id is not null;");
    expect(db).toContain("on web_events (episode_id, at) where episode_id is not null;");
  });
});
