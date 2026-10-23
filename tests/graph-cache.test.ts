import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "@/lib/db";
import { cachedConstellation, cachedPairTimeline, GRAPH_TAG, GRAPH_TTL_SECONDS } from "@/lib/graph-cache";
import { reviewReports } from "@/lib/moderation";
import { REPORT_HIDE_THRESHOLD } from "@/lib/rules";
import { POST as removeCharacters } from "@/app/api/admin/characters/route";
import { api, jsonRequest, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The Constellation's payload is cached for a minute (lib/graph-cache.ts, Next's data cache), and anything that takes
// something off the public sky drops it at once. Next's cache doesn't exist under vitest, so this file stands in a
// faithful little one: entries keyed like unstable_cache's, dropped by revalidateTag.

const cache = vi.hoisted(() => ({ entries: new Map<string, unknown>(), dropped: [] as string[] }));
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>, keys: string[], opts: { tags?: string[] }) =>
    async (...args: unknown[]) => {
      // Like Next's: the fixed key parts plus the call's arguments.
      const key = `${(opts.tags ?? []).join(",")}|${keys.join(",")}-${JSON.stringify(args)}`;
      if (!cache.entries.has(key)) cache.entries.set(key, await fn(...args));
      return cache.entries.get(key);
    },
  revalidateTag: (tag: string) => {
    cache.dropped.push(tag);
    for (const key of [...cache.entries.keys()]) if (key.split("|")[0].split(",").includes(tag)) cache.entries.delete(key);
  },
}));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
  setDbForTests(null);
});
beforeEach(async () => {
  await t.reset();
  setDbForTests(t.db);
  cache.entries.clear();
  cache.dropped.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const TWO_DAYS_AGO = "2026-10-20T12:00:00Z";

/** Two people's characters with one aired public date between them, and its relationship row. */
async function pair() {
  const [ownerA, ownerB] = [newUserCookie(), newUserCookie()];
  const mk = (id: string, name: string, cookie: string) =>
    t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, extras)
       values ($1, $2, false, $3, 30, 'bio', '["kind"]'::jsonb, 'love', 'rudeness', 'public', '{"kind":"vampire"}'::jsonb)`,
      [id, userIdOf(cookie), name],
    );
  await mk("cache-a-ana", "Ana Vale", ownerA);
  await mk("cache-b-bob", "Bob Rook", ownerB);
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript,
                           drama_question, drama_answer, visibility, revealed_at)
     values ('cache-ep', $1, 'cache-a-ana', 'cache-b-bob', 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'ready',
             '[{"wants_another":false},{"wants_another":false}]'::jsonb, '[]'::jsonb,
             'rejected', 'a', 'public', $2)`,
    [userIdOf(ownerA), TWO_DAYS_AGO],
  );
  await t.db.query(
    `insert into relationships (character_a, character_b, dates, public_dates, public_last_ending, public_stage, public_last_at, computed_at)
     values ('cache-a-ana', 'cache-b-bob', 1, 1, 'friends', 'just_met', $1, now())`,
    [TWO_DAYS_AGO],
  );
  return { ownerA, ownerB };
}
const ana = async () => (await cachedConstellation()).nodes.find((n) => n.id === "cache-a-ana");

describe("lib/graph-cache: a minute's cache that a privacy change drops at once", () => {
  it("serves the cached sky until it's dropped: a change made behind its back waits", async () => {
    await pair();
    expect(await ana()).toMatchObject({ private: false, kind: "vampire" });
    await t.db.query(`update characters set visibility = 'private' where id = 'cache-a-ana'`); // no route, no invalidation
    expect(await ana()).toMatchObject({ private: false }); // still the cached build
    expect(cache.dropped).toEqual([]);
  });

  it("never serves an entry older than the window, even once", async () => {
    await pair();
    const start = Date.now();
    await ana();
    await t.db.query(`update characters set visibility = 'private' where id = 'cache-a-ana'`);
    vi.spyOn(Date, "now").mockReturnValue(start + (GRAPH_TTL_SECONDS + 1) * 1000);
    expect(await ana()).toMatchObject({ private: true, kind: null });
  });

  it("a character made private by its owner (the API, and MCP update_character through it) leaves at once", async () => {
    const { ownerA } = await pair();
    await ana();
    const res = await api.editCharacter("cache-a-ana", { visibility: "private" }, ownerA);
    expect(res.status).toBe(200);
    expect(cache.dropped).toContain(GRAPH_TAG);
    expect(await ana()).toMatchObject({ private: true, kind: null, portrait: null });
  });

  it("an admin removal, a deleted character and a deleted account leave at once", async () => {
    const { ownerA } = await pair();
    const bob = async () => (await cachedConstellation()).nodes.find((n) => n.id === "cache-b-bob");
    expect(await bob()).toBeDefined();
    vi.stubEnv("FRONTIER_PASSWORD", "admin-test-key");
    const req = new Request("http://localhost:3000/api/admin/characters", {
      method: "POST",
      headers: { "content-type": "application/json", "x-frontier-key": "admin-test-key" },
      body: JSON.stringify({ remove: ["cache-b-bob"] }),
    });
    expect((await removeCharacters(req)).status).toBe(200);
    expect(cache.dropped).toEqual([GRAPH_TAG]);
    expect(await bob()).toBeUndefined();

    expect(await ana()).toBeDefined();
    expect((await api.deleteCharacter("cache-a-ana", ownerA)).status).toBe(200);
    expect(cache.dropped).toEqual([GRAPH_TAG, GRAPH_TAG]);
    expect(await ana()).toBeUndefined();

    const { DELETE: deleteAccount } = await import("@/app/api/me/route");
    expect((await deleteAccount(jsonRequest("/api/me", { confirm: true }, { cookie: ownerA, method: "DELETE" }))).status).toBe(200);
    expect(cache.dropped).toEqual([GRAPH_TAG, GRAPH_TAG, GRAPH_TAG]);
  });

  it("a pair's timeline is cached per pair too, but a pair that went private is a 404 at once", async () => {
    await pair();
    const story = await cachedPairTimeline("cache-b-bob", "cache-a-ana");
    expect(story).toMatchObject({ total: 1, truncated: false, timeline: [{ ending: "friends" }] });
    expect(cache.entries.size).toBe(1);
    // Ids that aren't a public pair never make an entry.
    expect(await cachedPairTimeline("cache-a-ana", "nobody")).toBeNull();
    expect(cache.entries.size).toBe(1);
    // Behind the cache's back: the cached timeline is still there, but the live check comes first.
    await t.db.query(`update characters set visibility = 'private' where id = 'cache-b-bob'`);
    expect(await cachedPairTimeline("cache-a-ana", "cache-b-bob")).toBeNull();
  });

  it("a date made private, enough reports, and a moderator's decision each drop it", async () => {
    const { ownerA } = await pair();
    const edge = async () => (await cachedConstellation()).edges.find((e) => e.a_id === "cache-a-ana");
    expect((await edge())!.turned_down).toEqual({ a: 0, b: 1 });

    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) expect((await api.report({ episode_id: "cache-ep" }, newUserCookie())).status).toBe(201);
    expect(cache.dropped).toHaveLength(REPORT_HIDE_THRESHOLD);
    // Hidden by reports: its drama answer no longer counts, and the relationship's public layer lost the date.
    expect(await edge()).toBeUndefined();

    expect(await reviewReports(t.db, "cache-ep", "cleared")).toBe(REPORT_HIDE_THRESHOLD);
    expect(cache.dropped).toHaveLength(REPORT_HIDE_THRESHOLD + 1);
    expect((await edge())!.turned_down).toEqual({ a: 0, b: 1 });

    expect((await api.setVisibility("cache-ep", "private", ownerA)).status).toBe(200);
    expect(cache.dropped).toHaveLength(REPORT_HIDE_THRESHOLD + 2);
    expect(await edge()).toBeUndefined();
  });
});
