// Shows and seasons as rows, and a date that knows its season (lib/show-seasons.ts; the connected-model plan, stages 1
// and 2). The registry has a row for every season from the first aired date to the one after now; a started season's
// format is frozen; a date is stamped when it airs and older ones are filled a batch at a time; and the stored key is
// always the season its air time falls in (lib/season-window.ts decides what that is).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as healthRoute } from "@/app/api/admin/model-health/route";
import { airEpisode } from "@/lib/air";
import { seasonFormatSlug, setSeasonFormat } from "@/lib/season-format-store";
import { seasonNumber } from "@/lib/season-ref";
import { SEASON_VOTE_MIN, voteSeasonFormat } from "@/lib/season-vote";
import { MONTHLY_FROM, nextSeasonStart, seasonIdOf } from "@/lib/season-window";
import { backfillEpisodeSeasons, ensureShowSeasons, freezeFormat, frozenFormat, seasonKeyHealth, seasonKeysUpkeep, seasonSpans, SHOW_ID } from "@/lib/show-seasons";
import { BASE_URL, setupEpisode, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const at = (iso: string) => new Date(iso);
const seasons = async () => (await t.db.query<{ id: string; number: number | null; format: string | null; format_source: string | null; show_id: string }>(`select id, number, format, format_source, show_id from show_seasons order by starts_at`)).rows;
const aired = async (id: string, when: string) => t.db.query(`update episodes set revealed_at = $2, season_id = null where id = $1`, [id, when]);
const seasonOf = async (id: string) => (await t.db.query<{ season_id: string | null; show_id: string }>(`select season_id, show_id from episodes where id = $1`, [id])).rows[0];

describe("the spans", () => {
  it("walk weeks before the monthly seasons, the first monthly one from Oct 19, then calendar months", () => {
    const spans = seasonSpans(at("2026-10-07T12:00:00Z"), at("2026-12-15T00:00:00Z"));
    expect(spans.map((s) => s.id)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-11-01", "2026-12-01"]);
    expect(spans.map((s) => s.number)).toEqual([null, null, 1, 2, 3]);
    expect(spans[2]).toMatchObject({ starts_at: new Date(MONTHLY_FROM).toISOString(), ends_at: "2026-11-01T00:00:00.000Z" });
    // Each ends where the next starts: no moment belongs to two seasons or to none.
    for (let i = 1; i < spans.length; i++) expect(spans[i].starts_at).toBe(spans[i - 1].ends_at);
  });
});

describe("the registry", () => {
  it("has one show, and a row for every season from the first aired date to the season after now", async () => {
    expect((await t.db.query<{ id: string }>(`select id from shows`)).rows).toEqual([{ id: SHOW_ID }]);
    const ep = (await setupEpisode()).episode;
    await aired(ep.id, "2026-10-14T20:00:00Z");
    const now = at("2026-11-16T12:00:00Z");
    expect(await ensureShowSeasons(t.db, now)).toMatchObject({ added: 4 });
    const rows = await seasons();
    expect(rows.map((r) => r.id)).toEqual(["2026-10-12", "2026-10-19", "2026-11-01", "2026-12-01"]);
    expect(rows.every((r) => r.show_id === SHOW_ID)).toBe(true);
    expect(rows.map((r) => r.number)).toEqual([null, seasonNumber("2026-10-19"), 2, 3]);
    // Nothing more to do on the next pass.
    expect(await ensureShowSeasons(t.db, now)).toEqual({ added: 0, frozen: 0 });
  });

  it("freezes a started season's format and leaves the coming one open", async () => {
    const now = at("2026-11-16T12:00:00Z");
    await ensureShowSeasons(t.db, now);
    const rows = await seasons();
    expect(rows.find((r) => r.id === "2026-11-01")).toMatchObject({ format: "classic", format_source: "default" });
    expect(rows.find((r) => r.id === "2026-12-01")).toMatchObject({ format: null, format_source: null });
    expect(await frozenFormat(t.db, "2026-12-01")).toBeNull();
  });

  it("a past season's format no longer moves when its votes are deleted", async () => {
    const october = at("2026-10-25T12:00:00Z");
    for (let i = 0; i < SEASON_VOTE_MIN; i++) expect((await voteSeasonFormat(t.db, `voter-${i}`, "island", october)).ok).toBe(true);
    const november = at("2026-11-16T12:00:00Z");
    await ensureShowSeasons(t.db, november);
    expect(await frozenFormat(t.db, "2026-11-01")).toBe("island");
    expect((await seasons()).find((r) => r.id === "2026-11-01")?.format_source).toBe("ballot");
    // An account goes, and its vote with it: the ballot alone would now say classic.
    await t.db.query(`delete from season_format_votes`);
    expect(await seasonFormatSlug(t.db, "2026-11-01")).toBe("island");
  });

  it("an admin's change refreezes a started season, and wins before and after", async () => {
    const now = new Date();
    await ensureShowSeasons(t.db, now);
    const current = seasonIdOf(now);
    expect(await frozenFormat(t.db, current)).toBe("classic");
    await setSeasonFormat(t.db, current, "botchelor");
    expect(await seasonFormatSlug(t.db, current)).toBe("botchelor");
    expect((await seasons()).find((r) => r.id === current)).toMatchObject({ format: "botchelor", format_source: "admin" });
    await setSeasonFormat(t.db, current, "classic");
    expect((await seasons()).find((r) => r.id === current)).toMatchObject({ format: "classic", format_source: "default" });
    // A season that hasn't started is never frozen, whatever is asked.
    expect(await freezeFormat(t.db, seasonIdOf(nextSeasonStart(now)), now, { again: true })).toBeNull();
  });
});

describe("a date knows its season", () => {
  it("is stamped the moment it airs, with the show", async () => {
    await ensureShowSeasons(t.db);
    const ep = (await setupEpisode()).episode;
    expect(await seasonOf(ep.id)).toEqual({ season_id: null, show_id: SHOW_ID });
    const creator = (await t.db.query<{ creator_id: string }>(`select creator_id from episodes where id = $1`, [ep.id])).rows[0].creator_id;
    await t.db.query(`update episodes set revealed_at = null, status = 'ready', visibility = 'public' where id = $1`, [ep.id]);
    expect(await airEpisode(t.db, ep.id, creator)).not.toBeNull();
    expect((await seasonOf(ep.id)).season_id).toBe(seasonIdOf(new Date()));
  });

  it("older dates are filled a batch at a time, each from the season its air time falls in, and unaired ones never", async () => {
    const stamps = ["2026-10-07T23:59:59Z", "2026-10-18T23:59:59Z", "2026-10-19T00:00:00Z", "2026-10-31T23:59:59Z", "2026-11-01T00:00:00Z", "2026-11-16T05:00:00Z"];
    const ids: string[] = [];
    for (const when of stamps) {
      const ep = (await setupEpisode()).episode;
      await aired(ep.id, when);
      ids.push(ep.id);
    }
    const unaired = (await setupEpisode()).episode;
    await t.db.query(`update episodes set revealed_at = null, season_id = null where id = $1`, [unaired.id]);
    await ensureShowSeasons(t.db, at("2026-11-16T12:00:00Z"));
    expect(await backfillEpisodeSeasons(t.db, 4)).toBe(4);
    expect(await backfillEpisodeSeasons(t.db, 4)).toBe(2);
    expect(await backfillEpisodeSeasons(t.db, 4)).toBe(0);
    // The stored key is the one lib/season-window.ts gives for the same moment: the two can never disagree.
    for (let i = 0; i < ids.length; i++) expect((await seasonOf(ids[i])).season_id, stamps[i]).toBe(seasonIdOf(at(stamps[i])));
    expect((await seasonOf(unaired.id)).season_id).toBeNull();
    expect(await seasonKeyHealth(t.db)).toMatchObject({ aired: 6, stamped: 6, unstamped: 0, mismatched: 0 });
  });

  it("SEASON_KEYS=0 keeps the registry and stops the stamping", async () => {
    const ep = (await setupEpisode()).episode;
    await aired(ep.id, new Date().toISOString());
    expect(await seasonKeysUpkeep(t.db, new Date(), { SEASON_KEYS: "0" })).toMatchObject({ stamped: 0 });
    expect((await seasonOf(ep.id)).season_id).toBeNull();
    expect(await seasonKeysUpkeep(t.db, new Date(), {})).toMatchObject({ stamped: 1 });
  });

  it("the health route needs an admin and reports counts only", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "open-sesame-test");
    expect((await healthRoute(new Request(`${BASE_URL}/api/admin/model-health`))).status).toBe(403);
    const ep = (await setupEpisode()).episode;
    await aired(ep.id, new Date().toISOString());
    await seasonKeysUpkeep(t.db);
    const body = await (await healthRoute(new Request(`${BASE_URL}/api/admin/model-health`, { headers: { "x-frontier-key": "open-sesame-test" } }))).json();
    expect(body.season_keys).toMatchObject({ on: true, aired: 1, stamped: 1, unstamped: 0, mismatched: 0 });
    expect(body.season_keys.seasons).toBeGreaterThanOrEqual(2);
  });
});

describe("a show's seasons, read from the registry (stage 8)", () => {
  it("lists a show's numbered seasons newest first and finds the one on air without asking the calendar", async () => {
    const { currentSeason, getShow, showSeasons } = await import("@/lib/show-seasons");
    const now = at("2026-11-16T12:00:00Z");
    const ep = (await setupEpisode()).episode;
    await aired(ep.id, "2026-10-14T20:00:00Z");
    await ensureShowSeasons(t.db, now);
    expect((await showSeasons(t.db, SHOW_ID, { numbered: true })).map((s) => s.id)).toEqual(["2026-12-01", "2026-11-01", "2026-10-19"]);
    expect((await showSeasons(t.db)).length).toBe(4);
    expect((await currentSeason(t.db, SHOW_ID, now))?.id).toBe("2026-11-01");
    expect(await currentSeason(t.db, "another-show", now)).toBeNull();
    expect(await getShow(t.db, SHOW_ID)).toMatchObject({ id: SHOW_ID, title: "Botchelor", house: true });
    expect(await getShow(t.db, "nope")).toBeNull();
  });

  it("a pair's story is computed from this show's dates only: another show's date cannot change it", async () => {
    const { loadRelationship, refreshRelationship } = await import("@/lib/relationships");
    const made = await setupEpisode("second_date");
    await t.db.query(`update episodes set revealed_at = now(), status = 'ready', visibility = 'public' where id = $1`, [made.episode.id]);
    const pair = (await t.db.query<{ character_a: string; character_b: string }>(`select character_a, character_b from episodes where id = $1`, [made.episode.id])).rows[0];
    await refreshRelationship(t.db, pair.character_a, pair.character_b);
    expect((await loadRelationship(t.db, pair.character_a, pair.character_b))?.all.dates).toBe(1);
    // The same date, as if it had happened on another show: this show's edge no longer counts it.
    await t.db.query(`insert into shows (id, title) values ('another-show', 'Another show')`);
    await t.db.query(`update episodes set show_id = 'another-show' where id = $1`, [made.episode.id]);
    await refreshRelationship(t.db, pair.character_a, pair.character_b);
    expect((await loadRelationship(t.db, pair.character_a, pair.character_b))?.all.dates ?? 0).toBe(0);
    await t.db.query(`delete from shows where id = 'another-show'`).catch(() => {});
  });
});
