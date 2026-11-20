import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ML_CONSENT_VERSION } from "@/lib/ml-consent";
import { DELETED_OWNER } from "@/lib/rules";
import { ALL_LAYERS } from "@/lib/social/analytics";
import { licensableTies, mostCentral, networkHistory, suggestionHits } from "@/lib/social/metrics-admin";
import { computeSocialMetrics, resumeSocialMetrics, socialMetricsOn } from "@/lib/social/metrics-job";
import { startTestDb } from "./helpers";

// The social network's daily numbers (lib/social/metrics-job.ts, docs/PRDs/social-network.md sections 5.5 and 10) and
// what /admin/social reads from them (lib/social/metrics-admin.ts): only the public record goes in, a day is measured
// once, a run that runs out of time is finished by the hourly passes, and the dataset counts go through the consent gate.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const [A, B, C, D, E] = HOUSE_CHARACTERS.map((c) => c.id);
const NOW = new Date("2026-11-20T16:20:00Z");
const DAY = "2026-11-20";
/** People's characters: one whose owner opted in to training, one whose owner didn't, a private one, a deleted account's. */
const YES = "zz-yes";
const NO = "zz-no";
const HIDDEN = "zz-private";
const GONE = "zz-gone";

async function character(id: string, owner: string, visibility = "public") {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
     values ($1, $2, false, $3, 30, 'x', '["dry"]'::jsonb, 'x', 'x', $4)`,
    [id, owner, `Name ${id}`, visibility],
  );
}

type TieOptions = { valence?: number; closeness?: number; directed?: boolean; status?: string; visibility?: string; source?: string; model?: string | null; toPerson?: string };
let serial = 0;
async function tie(from: string, to: string | null, kind: string, layer: string, o: TieOptions = {}) {
  await t.db.query(
    `insert into social_ties (id, from_id, to_id, to_person_id, kind, layer, directed, valence, closeness, status, visibility, source, origin_model)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      `tie-${String(++serial).padStart(3, "0")}`,
      from,
      to,
      o.toPerson ?? null,
      kind,
      layer,
      o.directed ?? false,
      o.valence ?? 1,
      o.closeness ?? 0.5,
      o.status ?? "active",
      o.visibility ?? "public",
      o.source ?? "house",
      o.model ?? null,
    ],
  );
}

/**
 * Seven characters on the public record: the house's A–E, YES and NO. A and B are friends, B and C best friends, A and C
 * rivals and C has a crush on A; D works with YES; E is friends with NO. A also has a mum (an off-screen person). Left
 * out: a tie to a private character, one to a deleted account's, a proposal not yet answered, one only the owners see.
 */
async function world() {
  await character(YES, "u-yes");
  await character(NO, "u-no");
  await character(HIDDEN, "u-hidden", "private");
  await character(GONE, DELETED_OWNER);
  await t.db.query(`insert into ml_consents (user_id, granted, version, decided_at) values ('u-yes', true, $1, '2026-11-01')`, [ML_CONSENT_VERSION]);
  await t.db.query(`insert into social_people (id, holder_id, name, source) values ('mum', $1, 'Mum', 'owner')`, [A]);
  await tie(A, B, "friend", "friendship", { model: "glm-4.6" });
  await tie(B, C, "best_friend", "friendship", { valence: 2, closeness: 0.9 });
  await tie(A, C, "rival", "conflict", { valence: -1 });
  await tie(C, A, "crush", "romance", { directed: true, closeness: 0.3 });
  await tie(D, YES, "coworker", "work", { source: "owner", closeness: 0.7 });
  await tie(E, NO, "friend", "friendship", { source: "derived" });
  await tie(A, null, "parent", "kin", { directed: true, toPerson: "mum", source: "owner" });
  await tie(A, HIDDEN, "friend", "friendship");
  await tie(A, GONE, "friend", "friendship");
  await tie(B, D, "friend", "friendship", { status: "proposed" });
  await tie(C, D, "friend", "friendship", { visibility: "owner" });
}

const metricRows = async () =>
  (
    await t.db.query<{ character_id: string; layer: string; degree: number; pagerank: number; community: number | null }>(
      `select character_id, layer, degree, pagerank, community from social_metrics where day = $1::date order by character_id, layer`,
      [DAY],
    )
  ).rows;
const dayRow = async () =>
  (await t.db.query<{ nodes: number; ties: Record<string, number>; complete: boolean; progress: Record<string, string> }>(`select nodes, ties, complete, progress from social_network_daily where day = $1::date`, [DAY]))
    .rows[0];

describe("computeSocialMetrics", () => {
  it("is off with SOCIAL_METRICS=0, and whenever SOCIAL_TIES is", async () => {
    expect(socialMetricsOn({})).toBe(true);
    expect(socialMetricsOn({ SOCIAL_METRICS: "0" })).toBe(false);
    expect(socialMetricsOn({ SOCIAL_TIES: "0" })).toBe(false);
    await world();
    expect(await computeSocialMetrics(t.db, { now: NOW, env: { SOCIAL_METRICS: "0" } })).toMatchObject({ stopped: "off", rows: 0 });
    expect(await dayRow()).toBeUndefined();
  });

  it("measures the public ties between public characters, a row per character and layer, once a day", async () => {
    await world();
    const run = await computeSocialMetrics(t.db, { now: NOW, env: {} });
    expect(run).toMatchObject({ day: DAY, stopped: null, ties: 6, nodes: 7, rows: 18, complete: true });
    const rows = await metricRows();
    const on = (layer: string) => rows.filter((r) => r.layer === layer).map((r) => r.character_id).sort();
    expect(on(ALL_LAYERS)).toEqual([A, B, C, D, E, NO, YES].sort());
    expect(on("friendship")).toEqual([A, B, C, E, NO].sort());
    expect(on("conflict")).toEqual([A, C].sort());
    expect(on("romance")).toEqual([A, C].sort());
    expect(on("work")).toEqual([D, YES].sort());
    // Nothing private, nothing of a deleted account, no proposal, nothing only the owners see, no off-screen person.
    for (const left of [HIDDEN, GONE, "mum"]) expect(rows.some((r) => r.character_id === left)).toBe(false);
    expect(rows.find((r) => r.character_id === A && r.layer === ALL_LAYERS)?.degree).toBe(2);
    expect(rows.find((r) => r.character_id === D && r.layer === ALL_LAYERS)?.degree).toBe(1);
    expect(await dayRow()).toMatchObject({ nodes: 7, ties: { [ALL_LAYERS]: 6, friendship: 3, conflict: 1, romance: 1, work: 1 }, complete: true });

    // The second run that day does nothing.
    expect(await computeSocialMetrics(t.db, { now: NOW, env: {} })).toMatchObject({ stopped: "done", complete: true, rows: 0 });
    expect(await metricRows()).toEqual(rows);
  });

  it("gives the same numbers when the day is measured again", async () => {
    await world();
    await computeSocialMetrics(t.db, { now: NOW, env: {} });
    const first = await metricRows();
    await t.db.query(`delete from social_metrics`);
    await t.db.query(`delete from social_network_daily`);
    await computeSocialMetrics(t.db, { now: NOW, env: {} });
    expect(await metricRows()).toEqual(first);
  });

  it("leaves a day it ran out of time on started, and the hourly passes finish it; they never start one", async () => {
    await world();
    expect(await resumeSocialMetrics(t.db, { now: NOW, env: {} })).toMatchObject({ stopped: "not_started" });
    expect(await dayRow()).toBeUndefined();
    expect(await computeSocialMetrics(t.db, { now: NOW, budgetMs: -1, env: {} })).toMatchObject({ stopped: "budget", rows: 0, complete: false });
    expect(await dayRow()).toMatchObject({ nodes: 0, complete: false });
    expect(await metricRows()).toEqual([]);
    expect(await resumeSocialMetrics(t.db, { now: NOW, env: {} })).toMatchObject({ stopped: null, rows: 18, complete: true });
    expect(await dayRow()).toMatchObject({ nodes: 7, complete: true });
  });

  it("picks up after the last character an earlier run wrote", async () => {
    await world();
    const ids = [A, B, C, D, E, NO, YES].sort();
    const through = ids[2];
    await t.db.query(`insert into social_network_daily (day, progress) values ($1::date, $2::jsonb)`, [DAY, JSON.stringify({ written_through: through })]);
    const run = await resumeSocialMetrics(t.db, { now: NOW, env: {} });
    expect(run).toMatchObject({ stopped: null, complete: true });
    const written = [...new Set((await metricRows()).map((r) => r.character_id))].sort();
    expect(written).toEqual(ids.slice(3));
    expect((await dayRow()).progress).toEqual({ written_through: ids[ids.length - 1] });
  });
});

describe("what /admin/social reads", () => {
  it("the network day by day, and the most central characters of the latest day", async () => {
    await world();
    expect(await networkHistory(t.db)).toEqual([]);
    expect(await mostCentral(t.db)).toEqual({ day: null, characters: [] });
    await computeSocialMetrics(t.db, { now: NOW, env: {} });
    const [day] = await networkHistory(t.db);
    expect(day).toMatchObject({ day: DAY, nodes: 7, complete: true, communities: expect.any(Number) });
    const central = await mostCentral(t.db, 3);
    expect(central.day).toBe(DAY);
    expect(central.characters).toHaveLength(3);
    const pageranks = central.characters.map((c) => c.pagerank);
    expect(pageranks).toEqual([...pageranks].sort((x, y) => y - x));
    // A character whose account was deleted since drops out of the list.
    await t.db.query(`update characters set owner_id = $2 where id = $1`, [YES, DELETED_OWNER]);
    expect((await mostCentral(t.db, 12)).characters.map((c) => c.id)).not.toContain(YES);
  });

  it("counts the public ties a dataset could license, by source and by model", async () => {
    await world();
    const counts = await licensableTies(t.db);
    // The six public ties between characters and the one to A's mum. E and NO's isn't licensable: NO's owner never opted in.
    expect(counts.total).toEqual({ key: "all", ties: 7, licensable: 6 });
    expect(counts.by_source).toEqual([
      { key: "house", ties: 4, licensable: 4 },
      { key: "owner", ties: 2, licensable: 2 },
      { key: "derived", ties: 1, licensable: 0 },
    ]);
    expect(counts.by_model).toEqual([
      { key: "none", ties: 6, licensable: 5 },
      { key: "glm-4.6", ties: 1, licensable: 1 },
    ]);
    // An owner who takes their yes back takes their character's ties out with it.
    await t.db.query(`update ml_consents set granted = false where user_id = 'u-yes'`);
    expect((await licensableTies(t.db)).total).toEqual({ key: "all", ties: 7, licensable: 5 });
  });

  it("how often a suggestion became a tie, by reason, over the window", async () => {
    const log = (reason: string, outcome: string | null, daysAgo = 1) =>
      t.db.query(
        `insert into social_suggestion_log (viewer, character_id, suggested_id, reason, score, shown_at, outcome)
         values ('u-1', $1, $2, $3, 1, now() - make_interval(days => $4), $5)`,
        [A, B, reason, daysAgo, outcome],
      );
    expect(await suggestionHits(t.db)).toMatchObject({ shown: 0, hit_rate: null, by_reason: [] });
    await log("common_friends", "accepted");
    await log("common_friends", "dismissed");
    await log("shared_place", null);
    await log("shared_place", "accepted", 40); // before the window
    expect(await suggestionHits(t.db, 30)).toEqual({
      days: 30,
      shown: 3,
      accepted: 1,
      dismissed: 1,
      ignored: 0,
      open: 1,
      hit_rate: 1 / 3,
      by_reason: [
        { reason: "common_friends", shown: 2, accepted: 1, hit_rate: 0.5 },
        { reason: "shared_place", shown: 1, accepted: 0, hit_rate: 0 },
      ],
    });
  });
});

describe("the jobs", () => {
  it("the daily job's growth part measures the network before the lessons, and the hourly job finishes a short day", () => {
    const daily = readFileSync(new URL("../app/api/jobs/daily/route.ts", import.meta.url), "utf8");
    const growth = daily.slice(daily.indexOf("async function growth("));
    expect(growth.indexOf(`step("social_metrics"`)).toBeGreaterThan(0);
    expect(growth.indexOf(`step("social_metrics"`)).toBeLessThan(growth.indexOf(`step("character_lessons"`));
    const lobby = readFileSync(new URL("../app/api/jobs/lobby/route.ts", import.meta.url), "utf8");
    expect(lobby).toContain("resumeSocialMetrics(db)");
  });
});
