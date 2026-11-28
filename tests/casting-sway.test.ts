/**
 * The producer's casting sway (lib/casting-sway.ts; docs/seasons.md "The casting sway"): after a streak of house
 * disasters the lobby's plainly dealt house date goes to a pair whose previewed ending isn't one, when there is such a
 * pair; the preview is the ending the date is then decided with; PRODUCER_SWAY=0 deals exactly as before; a pair or a
 * venue someone named is never changed; the venue heuristic skips the latest disasters' backdrops. No model calls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeness, disasterVenues, lopsidedEnding, producerSwayOn, swayPick } from "@/lib/casting-sway";
import { fixedEngine, marks, setEngineForTests, type Engine } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setModelForTests } from "@/lib/model";
import type { Ending } from "@/lib/rules";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { buildTemplateDate, createTemplateParty, lobbyDeal, previewTemplateDate } from "@/lib/watch";
import { startTestDb } from "./helpers";
import { promptModel } from "./prompt-model";

const CAST = HOUSE_CHARACTERS.slice(0, 4);
const NAME = new Map(CAST.map((c) => [c.id, c.name]));
const NOW = new Date("2026-11-13T09:20:00Z");
const DAY = "2026-11-13";

describe("the rules (pure)", () => {
  it("PRODUCER_SWAY is on unless it is 0", () => {
    expect(producerSwayOn({})).toBe(true);
    expect(producerSwayOn({ PRODUCER_SWAY: "0" })).toBe(false);
  });

  it("the mix is lopsided after two alike in a row, or one ending in two thirds", () => {
    expect(lopsidedEnding([])).toBeNull();
    expect(lopsidedEnding(["disaster"])).toBeNull();
    expect(lopsidedEnding(["disaster", "disaster"])).toBe("disaster");
    expect(lopsidedEnding(["friends", "disaster", "friends", "second_date"])).toBeNull();
    expect(lopsidedEnding(["friends", "disaster", "disaster", "second_date", "disaster", "disaster"])).toBe("disaster");
  });

  it("after a streak, a candidate previewed as something else wins, the closest call first; a varied mix keeps the dealt one", () => {
    const { friendsAt } = marks(5);
    const streak: Ending[] = ["disaster", "disaster", "disaster"];
    const previewed = [
      { ending: "disaster" as Ending, margin: friendsAt - 0.1, version: 5 },
      { ending: "second_date" as Ending, margin: 40, version: 5 },
      { ending: "friends" as Ending, margin: friendsAt + 0.5, version: 5 },
    ];
    expect(swayPick(previewed, streak)).toBe(2);
    expect(swayPick(previewed, ["disaster", "friends", "second_date"])).toBe(0);
    expect(swayPick(previewed, [])).toBe(0);
    // Every candidate a disaster: the closest call of them.
    expect(swayPick([{ ending: "disaster", margin: -30, version: 5 }, { ending: "disaster", margin: friendsAt - 1, version: 5 }], streak)).toBe(1);
    expect(closeness({ margin: friendsAt }, 5)).toBe(0);
  });

  it("the venue heuristic names the latest disasters' venues, at most two", () => {
    expect(
      disasterVenues([
        { ending: "disaster", venue: "rooftop_bar" },
        { ending: "friends", venue: "museum_night" },
        { ending: "disaster", venue: "rooftop_bar" },
        { ending: "disaster", venue: "bowling_alley" },
        { ending: "disaster", venue: "dive_bar" },
      ]),
    ).toEqual(["rooftop_bar", "bowling_alley"]);
  });
});

describe("with a database", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from watch_parties");
    setSeasonCastForTests(CAST.map((c) => c.id));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setSeasonCastForTests(null);
    setEngineForTests(null);
    setModelForTests(null);
  });

  /** House dates the show already made, newest last, the day before. */
  async function pastHouseDates(endings: Ending[], venue = "rooftop_bar") {
    const [a, b] = CAST.map((c) => c.id);
    for (const [k, ending] of endings.entries()) {
      const id = `past-${k}`;
      const at = new Date(Date.parse(`${DAY}T00:00:00Z`) - (endings.length - k) * 60 * 60 * 1000).toISOString();
      await t.db.query(
        `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, setup, created_at)
         values ($1, 'system', $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', $4, $5::jsonb, $6)`,
        [id, a, b, ending, JSON.stringify({ venue }), at],
      );
      await t.db.query(`insert into watch_parties (id, episode_id, kind, host_id, starts_at, created_at) values ($1, $2, 'template', null, null, $3)`, [`wp-${k}`, id, at]);
    }
  }

  /** An engine where only the given pair (either order) ends in disaster; everyone else is friends, near the mark. */
  function engineDisasterFor(pair: [string, string]): Engine {
    const names = new Set(pair.map((id) => NAME.get(id)));
    const { friendsAt } = marks(5);
    return {
      decide: (input, seed, version) => {
        const doomed = names.has(input.a.sheet.name) && names.has(input.b.sheet.name);
        return fixedEngine({ ending: doomed ? "disaster" : "friends", margin: doomed ? -20 : friendsAt + 1 }).decide(input, seed, version);
      },
    };
  }

  it("after a streak of house disasters, the dealt pair previewed as a disaster gives way to one that isn't, and the preview is the date's ending", async () => {
    await pastHouseDates(["disaster", "disaster", "disaster"]);
    const dealt = (await lobbyDeal(t.db, NOW, 0))!;
    setEngineForTests(engineDisasterFor([dealt.a, dealt.b]));
    const episodeId = "sway-episode-1";
    const swayed = (await lobbyDeal(t.db, NOW, 0, { episodeId }))!;
    expect([swayed.a, swayed.b].sort()).not.toEqual([dealt.a, dealt.b].sort());
    const preview = (await previewTemplateDate(t.db, episodeId, swayed.a, swayed.b, swayed.thumbs))!;
    expect(preview.decided.ending).not.toBe("disaster");
    // Deterministic: the same deal again.
    expect(await lobbyDeal(t.db, NOW, 0, { episodeId })).toEqual(swayed);
    // The real date under that id is decided exactly as previewed: the engine still decides it.
    const real = (await buildTemplateDate(t.db, episodeId, swayed.a, swayed.b, swayed.thumbs))!;
    expect(real.decided).toEqual(preview.decided);
    setModelForTests(promptModel());
    const made = await createTemplateParty(t.db, swayed.a, swayed.b, { ...swayed.thumbs, episodeId });
    if (!made?.ok) throw new Error("no room");
    const row = (await t.db.query<{ id: string; ending: string }>(`select e.id, e.ending from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`, [made.id])).rows[0];
    expect(row).toEqual({ id: episodeId, ending: preview.decided.ending });
  });

  it("the real engine: the swayed date's stored ending is its preview, and never a seed other than its own id's", async () => {
    await pastHouseDates(["disaster", "disaster"]);
    const episodeId = "sway-episode-real";
    const swayed = (await lobbyDeal(t.db, NOW, 0, { episodeId }))!;
    const preview = (await previewTemplateDate(t.db, episodeId, swayed.a, swayed.b, swayed.thumbs))!;
    const real = (await buildTemplateDate(t.db, episodeId, swayed.a, swayed.b, swayed.thumbs))!;
    expect(real.decided).toEqual(preview.decided);
    expect(real.trace).toEqual(preview.trace);
  });

  it("PRODUCER_SWAY=0, a varied mix, or no episode id: the dealt pair, exactly as before", async () => {
    await pastHouseDates(["disaster", "disaster", "disaster"]);
    vi.stubEnv("PRODUCER_SWAY", "0");
    const dealt = (await lobbyDeal(t.db, NOW, 0))!;
    setEngineForTests(engineDisasterFor([dealt.a, dealt.b]));
    expect(await lobbyDeal(t.db, NOW, 0, { episodeId: "x" })).toEqual(dealt);
    expect(dealt.thumbs.avoidVenues).toBeUndefined();
    vi.unstubAllEnvs();
    await t.db.query("delete from watch_parties");
    await t.db.query("delete from episodes where id like 'past-%'");
    await pastHouseDates(["friends", "second_date", "disaster"]);
    const varied = (await lobbyDeal(t.db, NOW, 0, { episodeId: "x" }))!;
    expect([varied.a, varied.b]).toEqual([dealt.a, dealt.b]);
  });

  it("the venue heuristic: a show-dealt venue skips the latest disasters'; a one-venue pool (a vote's place, a chosen one) is never changed", async () => {
    await pastHouseDates(["disaster", "disaster"], "rooftop_bar");
    const deal = (await lobbyDeal(t.db, NOW, 0))!;
    expect(deal.thumbs.avoidVenues).toEqual(["rooftop_bar"]);
    const dealtVenue = (await buildTemplateDate(t.db, "venue-1", deal.a, deal.b, deal.thumbs))!.built.setup.venue;
    expect(dealtVenue).not.toBe("rooftop_bar");
    // Somebody named the place (a twist's venue rides a one-venue pool): it holds, disasters or not.
    const named = (await buildTemplateDate(t.db, "venue-2", deal.a, deal.b, { venuePool: ["rooftop_bar"], avoidVenues: ["rooftop_bar"] }))!.built.setup.venue;
    expect(named).toBe("rooftop_bar");
  });

  it("a pair someone named is never changed, whatever the streak", async () => {
    await pastHouseDates(["disaster", "disaster", "disaster"]);
    const [a, b] = [CAST[2].id, CAST[3].id];
    setEngineForTests(engineDisasterFor([a, b]));
    setModelForTests(promptModel());
    const made = await createTemplateParty(t.db, a, b);
    if (!made?.ok) throw new Error("no room");
    const row = (await t.db.query<{ a: string; b: string; ending: string }>(`select e.character_a as a, e.character_b as b, e.ending from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`, [made.id])).rows[0];
    // The pair stands, and so does the ending the engine gave it: the sway never touches either.
    expect(row).toEqual({ a, b, ending: "disaster" });
  });
});
