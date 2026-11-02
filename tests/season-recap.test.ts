import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, setupEpisode, startTestDb } from "./helpers";
import { getReunion } from "@/lib/reunion";
import { coupleLine, getSeasonRecap, recapTeasers, setSeasonRecapVoiceEnabledForTests, templateNarrative } from "@/lib/season-recap";
import { closedSeasons, seasonBanner, seasonClosedSince, seasonIdFromSlug, seasonNumber, seasonPath, seasonSlug } from "@/lib/season-ref";
import { showSince } from "@/lib/show-since";
import type { Model } from "@/lib/model";
import { shortName } from "@/lib/names";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  setSeasonRecapVoiceEnabledForTests(false);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setSeasonRecapVoiceEnabledForTests(false);
});

const OCTOBER = "2026-10-19";
const AFTER = new Date("2026-11-02T12:00:00Z");
const model = (out: string): Model & { calls: number } => {
  const m = { calls: 0, complete: async () => (m.calls++, out) };
  return m;
};
/** Puts an aired date at a moment of the season (its revealed_at), so it counts in that window. */
const airedAt = (id: string, iso: string, venue?: string) =>
  t.db.query(`update episodes set revealed_at = $2, setup = coalesce(setup, '{}'::jsonb) || $3::jsonb where id = $1`, [id, iso, JSON.stringify(venue ? { venue } : {})]);

describe("season names (lib/season-ref.ts)", () => {
  it("numbers the monthly seasons from October 2026 and slugs them by month", () => {
    expect(seasonNumber(OCTOBER)).toBe(1);
    expect(seasonNumber("2026-11-01")).toBe(2);
    expect(seasonNumber("2027-01-01")).toBe(4);
    expect(seasonNumber("2026-10-12")).toBeNull(); // a weekly one
    expect(seasonSlug(OCTOBER)).toBe("october-2026");
    expect(seasonIdFromSlug("october-2026")).toBe(OCTOBER);
    expect(seasonIdFromSlug("november-2026")).toBe("2026-11-01");
    expect(seasonIdFromSlug("september-2026")).toBeNull();
    expect(seasonIdFromSlug("smarch-2026")).toBeNull();
    expect(seasonPath(OCTOBER)).toBe("/seasons/october-2026");
  });

  it("lists the closed seasons, shows the banner for a month's first week, and says when one closed since a visit", () => {
    expect(closedSeasons(new Date("2026-10-25T00:00:00Z"))).toEqual([]);
    expect(closedSeasons(new Date("2026-12-03T00:00:00Z")).map((s) => s.id)).toEqual(["2026-11-01", OCTOBER]);
    expect(seasonBanner(new Date("2026-11-01T18:00:00Z"))).toMatchObject({ number: 1, label: "October 2026", path: "/seasons/october-2026" });
    expect(seasonBanner(new Date("2026-11-07T23:59:00Z"))?.number).toBe(1);
    expect(seasonBanner(new Date("2026-11-08T00:00:00Z"))).toBeNull();
    expect(seasonBanner(new Date("2026-10-20T00:00:00Z"))).toBeNull(); // the week before was a weekly season
    expect(seasonClosedSince(new Date("2026-10-30T00:00:00Z"), AFTER)?.id).toBe(OCTOBER);
    expect(seasonClosedSince(new Date("2026-11-01T06:00:00Z"), AFTER)).toBeNull();
  });
});

describe("a couple's season in one line", () => {
  const start = new Date(`${OCTOBER}T00:00:00Z`);
  const at = (day: number) => new Date(start.getTime() + (day - 1) * 86_400_000 + 3_600_000);
  it("says when they met, how many dates, where the second was and how it ended", () => {
    expect(
      coupleLine(
        [
          { at: at(2), venue: "jazz_bar", ending: "second_date" },
          { at: at(4), venue: "pottery_class", ending: "second_date" },
          { at: at(9), venue: "night_market", ending: "friends" },
        ],
        start,
        false,
      ),
    ).toMatch(/^Met on day 2 at .*jazz.*, three dates, second date at .*pottery.*, ended as friends at .*night market.*\.$/i);
    expect(coupleLine([{ at: at(5), venue: "home@Chud's place", ending: "disaster" }], start, false)).toBe("Met on day 5 at Chud's place, and it was a disaster.");
    expect(coupleLine([{ at: at(1), venue: null, ending: "second_date" }, { at: at(3), venue: null, ending: "second_date" }], start, true)).toBe(
      "Back on day 1, two dates, last seen, still going.",
    );
  });
});

describe("a season's finale (lib/season-recap.ts)", () => {
  it("isn't there for a weekly season, and a running one is the Reunion's", async () => {
    expect((await getSeasonRecap(t.db, "2026-10-12", { now: AFTER })).status).toBe("not_a_season");
    expect((await getSeasonRecap(t.db, "2026-11-01", { now: AFTER })).status).toBe("running");
    expect((await getSeasonRecap(t.db, OCTOBER, { now: new Date("2026-10-31T23:59:00Z") })).status).toBe("running");
    expect((await t.db.query(`select * from season_recaps`)).rows).toHaveLength(0);
  });

  it("freezes on the first read after the season closes: written once by the model, never again", async () => {
    // Two dates for one couple and a disaster for another, all in October.
    const one = await setupEpisode("second_date");
    await api.reveal(one.episode.id, one.creator);
    await airedAt(one.episode.id, "2026-10-21T20:00:00Z", "jazz_bar");
    const two = await setupEpisode("disaster");
    await api.reveal(two.episode.id, two.creator);
    await airedAt(two.episode.id, "2026-10-25T20:00:00Z", "goat_yoga");
    // The house cast: two of October's, one of whom stays on for November.
    const stays = one.episode.characters[1].id;
    const leaves = (await t.db.query<{ id: string }>(`select id from characters where is_house and id <> $1 order by id limit 1`, [stays])).rows[0].id;
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'dealt'), ($1, $3, 1, 'dealt'), ('2026-11-01', $2, 0, 'survivor')`, [OCTOBER, stays, leaves]);

    const a = shortName(one.episode.characters[0].name);
    const b = shortName(one.episode.characters[1].name);
    const writer = model(JSON.stringify({ text: `Previously on Botchelor: October was the month ${a} and ${b} found each other on day three, and the rest of the house had a rougher time of it.` }));
    setSeasonRecapVoiceEnabledForTests(true);
    const first = await getSeasonRecap(t.db, OCTOBER, { now: AFTER, model: writer });
    expect(first.status).toBe("closed");
    if (first.status !== "closed") return;
    const d = first.recap.data;
    expect(first.recap.narrative_by).toBe("model");
    expect(first.recap.narrative).toContain(a);
    expect(writer.calls).toBe(1);
    expect(d.season).toMatchObject({ number: 1, label: "October 2026", path: "/seasons/october-2026" });
    expect(d.numbers).toMatchObject({ aired: 2, couples: 2, second_dates: 1, disasters: 1 });
    expect(d.golden?.a.id === one.episode.characters[0].id || d.golden?.b.id === one.episode.characters[0].id).toBe(true);
    expect(d.couples[0].line).toMatch(/^Met on day 3 at .*jazz/i);
    expect(d.rewatch.map((e) => e.id).sort()).toEqual([one.episode.id, two.episode.id].sort());
    expect(d.awards.map((x) => x.title)).toEqual(expect.arrayContaining(["🏆 The golden couple", "💥 Biggest disaster"]));
    expect(d.cast.map((c) => [c.character.id, c.stayed])).toEqual([
      [stays, true],
      [leaves, false],
    ]);

    // Another October date turns up later, and another model would write something else: the finale doesn't move.
    const late = await setupEpisode("friends");
    await api.reveal(late.episode.id, late.creator);
    await airedAt(late.episode.id, "2026-10-28T20:00:00Z");
    const other = model(JSON.stringify({ text: "Something else entirely, and long enough to pass the length check for a recap paragraph here." }));
    const again = await getSeasonRecap(t.db, OCTOBER, { now: AFTER, model: other });
    expect(other.calls).toBe(0);
    expect(again.status === "closed" && again.recap.narrative).toBe(first.recap.narrative);
    expect(again.status === "closed" && again.recap.data.numbers.aired).toBe(2);
    expect((await recapTeasers(t.db, [OCTOBER])).get(OCTOBER)).toMatch(/^Previously on Botchelor/);
  });

  it("falls back to the template, stored the same way, when the model's text doesn't pass", async () => {
    const one = await setupEpisode("second_date");
    await api.reveal(one.episode.id, one.creator);
    await airedAt(one.episode.id, "2026-10-21T20:00:00Z");
    setSeasonRecapVoiceEnabledForTests(true);
    // Leaves out the golden couple's names: refused.
    const r = await getSeasonRecap(t.db, OCTOBER, { now: AFTER, model: model(JSON.stringify({ text: "A month of dates happened and some of them went well and some of them did not, as months do." })) });
    expect(r.status === "closed" && r.recap.narrative_by).toBe("template");
    if (r.status !== "closed") return;
    expect(r.recap.narrative).toBe(templateNarrative(r.recap.data));
    expect(r.recap.narrative).toContain("The golden couple was");
    expect((await t.db.query(`select narrative_by from season_recaps where season_id = $1`, [OCTOBER])).rows[0]).toEqual({ narrative_by: "template" });
  });

  it("takes over a claim that died half-way", async () => {
    await t.db.query(`insert into season_recaps (season_id, claimed_at) values ($1, now() - interval '1 hour')`, [OCTOBER]);
    const r = await getSeasonRecap(t.db, OCTOBER, { now: AFTER });
    expect(r.status === "closed" && r.recap.frozen_at).toBeTruthy();
    // A recap stored by an older version (RECAP_VERSION) is frozen again on its next read, and only then.
    await t.db.query(`update season_recaps set data = jsonb_set(data, '{v}', '0'), narrative = 'old' where season_id = $1`, [OCTOBER]);
    const again = await getSeasonRecap(t.db, OCTOBER, { now: AFTER });
    expect(again.status === "closed" && again.recap.narrative).not.toBe("old");
    expect((await t.db.query(`select narrative from season_recaps where season_id = $1`, [OCTOBER])).rows[0].narrative).not.toBe("old");
  });

  it("a fresh claim someone else holds: shows a recap of its own without storing it", async () => {
    await t.db.query(`insert into season_recaps (season_id, claimed_at) values ($1, now())`, [OCTOBER]);
    const r = await getSeasonRecap(t.db, OCTOBER, { now: AFTER });
    expect(r.status === "closed" && r.recap.frozen_at).toBeNull();
    expect((await t.db.query(`select data from season_recaps where season_id = $1`, [OCTOBER])).rows[0]).toEqual({ data: null });
  });
});

describe("the Reunion is this season's", () => {
  it("counts only the dates that aired in the season's window", async () => {
    const one = await setupEpisode("second_date");
    await api.reveal(one.episode.id, one.creator);
    expect((await getReunion(t.db)).stats.aired).toBe(1);
    await airedAt(one.episode.id, "2026-10-21T20:00:00Z");
    expect((await getReunion(t.db, new Date("2026-10-30T00:00:00Z"))).stats.aired).toBe(1);
    const november = await getReunion(t.db, new Date("2026-11-03T00:00:00Z"));
    expect(november.stats).toEqual({ couples: 0, second_dates: 0, aired: 0 });
    expect(november.awards).toEqual([]);
  });
});

describe("Since you were here: a season closed", () => {
  it("names the season that closed since your last visit, and nothing else when nothing else happened", async () => {
    await t.db.query(`insert into owner_activity (user_id, last_seen) values ('away', '2026-10-30T12:00:00Z'), ('recent', '2026-11-01T06:00:00Z')`);
    expect((await showSince(t.db, "away", AFTER))?.season).toMatchObject({ number: 1, path: "/seasons/october-2026" });
    expect(await showSince(t.db, "recent", AFTER)).toBeNull();
  });
});
