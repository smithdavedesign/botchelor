import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getOps } from "@/app/api/admin/ops/route";
import { pgliteDb, prepareDb, type Db } from "@/lib/db";
import { commitSha } from "@/lib/deploy";
import { bootFacts, containerMemoryLimitMb, keepOps, opsDetail, opsHost, opsSummary, pruneOpsLog, recordBoot, trackEpisodeCostKept, trackKept } from "@/lib/ops-log";
import { databaseReachable, forgetDatabaseCheckForTests } from "@/lib/public-health";
import { BASE_URL, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  forgetDatabaseCheckForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const SHA_A = "34dcb2691896750d57a7dda3edc53d8ab0f14b31";
const SHA_B = "fa44ecd0000000000000000000000000000000aa";
type Kept = { host: string; event: string; props: Record<string, unknown> };
const rows = async () => (await t.db.query<Kept>("select host, event, props from ops_log order by id")).rows;
const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});
/** A row written as if at `at` (the summary reads the last day; the prune keeps 30 days). */
const rowAt = (at: Date, host: string, event: string, props: Record<string, unknown>) =>
  t.db.query("insert into ops_log (at, host, event, props) values ($1, $2, $3, $4::jsonb)", [at.toISOString(), host, event, JSON.stringify(props)]);

describe("the public database check (GET /api/health?db=1)", () => {
  it("answers ok or unreachable and nothing else, without the cron secret", async () => {
    const res = await getHealth(new Request(`${BASE_URL}/api/health?db=1`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, db: "ok" });

    // A failed check stays the answer until it's asked again (30 s), here through the route.
    forgetDatabaseCheckForTests();
    expect(await databaseReachable({ ping: () => Promise.reject(new Error("ECONNREFUSED")) })).toBe(false);
    const down = await getHealth(new Request(`${BASE_URL}/api/health?db=1`));
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ ok: false, db: "unreachable" });

    // The plain check DigitalOcean calls every 10 s is unchanged.
    expect(await (await getHealth(new Request(`${BASE_URL}/api/health`))).json()).toEqual({ ok: true });
  });

  it("asks the database at most once every 30 s per instance, and callers in the meantime share one ask", async () => {
    let now = 1_000_000;
    const ping = vi.fn(async () => {});
    const clock = { ping, now: () => now };
    expect(await Promise.all([databaseReachable(clock), databaseReachable(clock), databaseReachable(clock)])).toEqual([true, true, true]);
    expect(ping).toHaveBeenCalledTimes(1);
    now += 29_000;
    expect(await databaseReachable(clock)).toBe(true);
    expect(ping).toHaveBeenCalledTimes(1);
    now += 2_000;
    expect(await databaseReachable(clock)).toBe(true);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("a database that doesn't answer in 5 s is unreachable", async () => {
    vi.useFakeTimers();
    const pending = databaseReachable({ ping: () => new Promise<void>(() => {}) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBe(false);
  });
});

describe("the servers' own log (lib/ops-log.ts)", () => {
  it("keeps a failure with its reason cleaned of anything secret-shaped, and the analytics line as before", async () => {
    const lines = quiet();
    trackKept("generation_failed", { where: "job", reason: "model said no to Bearer abc.def.ghi", episode_id: "e-1", extra: undefined });
    await vi.waitFor(async () => expect(await rows()).toHaveLength(1));
    expect(await rows()).toEqual([{ host: "local", event: "generation_failed", props: { where: "job", reason: "model said no to Bearer …", episode_id: "e-1" } }]);
    expect(lines).toHaveBeenCalledWith(expect.stringContaining('"event":"generation_failed"'));
  });

  it("keeps what a date cost and how long it took", async () => {
    quiet();
    trackEpisodeCostKept({
      episode_id: "e-2",
      where: "job",
      model: "frontier",
      model_calls: 12,
      ms: 58_000,
      transcript_turns: 24,
      usage: { calls: 12, input_tokens: 9000, cached_input_tokens: 0, output_tokens: 1500, thinking_tokens: 0, cost_usd: 0.0123, models: ["m-1", "m-2"] },
    });
    await vi.waitFor(async () => expect(await rows()).toHaveLength(1));
    const [row] = await rows();
    expect(row.event).toBe("episode_generated");
    expect(row.props).toMatchObject({ episode_id: "e-2", where: "job", model: "frontier", model_calls: 12, ms: 58_000, cost_usd: 0.0123, models: "m-1,m-2" });
    expect(opsDetail(row.event, row.props)).toBe("job · frontier · 12 calls · 58 s · $0.0123");
  });

  it("a write that fails is a line in the container's log, never the caller's error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { query: async () => Promise.reject(new Error("connection terminated")) } as unknown as Db;
    await expect(keepOps("conversation_failed", { where: "job" }, broken)).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("[ops] conversation_failed not kept: connection terminated"));
  });

  it("says which host wrote a row", () => {
    expect(opsHost({})).toBe("local");
    expect(opsHost({ DEPLOY_ENV: "production" })).toBe("show");
    expect(opsHost({ DEPLOY_ENV: "production", AFTER_DARK_ONLY: "1", AFTER_DARK_ORIGIN: "https://ad.botchelor.com" })).toBe("after-dark");
  });

  it("knows the commit from COMMIT_SHA (DigitalOcean binds it), and only a hash", () => {
    expect(commitSha({ COMMIT_SHA: SHA_A.toUpperCase() })).toBe(SHA_A);
    expect(commitSha({ VERCEL_GIT_COMMIT_SHA: SHA_B })).toBe(SHA_B);
    expect(commitSha({ COMMIT_SHA: "${_self.COMMIT_HASH}" })).toBeNull();
    expect(commitSha({})).toBeNull();
  });

  it("reads the container's memory limit from either cgroup version, then Node's, and none on a developer's machine", () => {
    const files = (map: Record<string, string>) => (path: string) => {
      if (!(path in map)) throw new Error("ENOENT");
      return map[path];
    };
    const none = () => 0;
    expect(containerMemoryLimitMb(files({ "/sys/fs/cgroup/memory.max": "2147483648\n" }), none)).toBe(2048);
    expect(containerMemoryLimitMb(files({ "/sys/fs/cgroup/memory.max": "max\n", "/sys/fs/cgroup/memory/memory.limit_in_bytes": "1073741824" }), none)).toBe(1024);
    expect(containerMemoryLimitMb(files({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712" }), none)).toBeNull();
    expect(containerMemoryLimitMb(files({}), none)).toBeNull();
    // No cgroup file to read (DigitalOcean's containers, 2026-11-22): what Node says the process is held to, when it is
    // below the machine's memory; equal to it is just the machine.
    const fourGb = () => 4 * 1024 ** 3;
    expect(containerMemoryLimitMb(files({}), () => 2 * 1024 ** 3, fourGb)).toBe(2048);
    expect(containerMemoryLimitMb(files({}), fourGb, fourGb)).toBeNull();
    expect(containerMemoryLimitMb(files({ "/sys/fs/cgroup/memory.max": "max\n" }), () => undefined, fourGb)).toBeNull();
    expect(containerMemoryLimitMb(files({}), () => 2 ** 62, fourGb)).toBeNull(); // "no limit" as a huge number
  });

  it("writes a start's row on the connection that brought the schema up to date", async () => {
    const lines = quiet();
    vi.stubEnv("COMMIT_SHA", SHA_A);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pg = new PGlite();
    try {
      const db = pgliteDb(pg);
      await prepareDb({ connect: async () => ({ db, close: async () => {} }), onReady: (d) => recordBoot(d) });
      const kept = (await db.query<Kept>("select host, event, props from ops_log")).rows;
      expect(kept).toEqual([{ host: "local", event: "boot", props: expect.objectContaining({ sha: SHA_A, heap_limit_mb: expect.any(Number), node: process.version }) }]);
      expect(lines).toHaveBeenCalledWith(expect.stringContaining("[ops] server started: local"));
      // A start that can't write its row still starts.
      const failing = vi.fn(async () => Promise.reject(new Error("no")));
      await expect(prepareDb({ connect: async () => ({ db, close: async () => {} }), onReady: failing })).resolves.toBeUndefined();
      expect(failing).toHaveBeenCalledTimes(1);
    } finally {
      await pg.close();
      (globalThis as { __botchelorStartupApply?: Promise<boolean> }).__botchelorStartupApply = undefined;
    }
  });

  it("bootFacts never carries more than the commit, limits, Node and the instance's name", () => {
    expect(Object.keys(bootFacts({ COMMIT_SHA: SHA_A })).sort()).toEqual(["heap_limit_mb", "instance", "malloc_arena_max", "memory_limit_mb", "node", "sha", "total_memory_mb"]);
    expect(bootFacts({}).total_memory_mb).toBeGreaterThan(0);
    // A start's row on /admin: the limit when there is one, else the memory the container sees (DigitalOcean's size).
    expect(opsDetail("boot", { sha: SHA_A, memory_limit_mb: 1024, total_memory_mb: 2048, heap_limit_mb: 560 })).toBe(`commit ${SHA_A.slice(0, 7)}, 1024 MB, heap 560 MB`);
    expect(opsDetail("boot", { sha: SHA_A, memory_limit_mb: null, total_memory_mb: 2048, heap_limit_mb: 1120 })).toBe(`commit ${SHA_A.slice(0, 7)}, 2048 MB, heap 1120 MB`);
  });

  it("the summary says what each host runs, tells a restart from a deploy, and adds up the day's dates", async () => {
    const now = new Date("2026-11-22T18:00:00Z");
    const h = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
    await rowAt(h(30), "show", "boot", { sha: SHA_A, memory_limit_mb: 2048 }); // before the day: the first comparison
    await rowAt(h(10), "show", "boot", { sha: SHA_A, memory_limit_mb: 2048 }); // same commit: a restart
    await rowAt(h(2), "show", "boot", { sha: SHA_B, memory_limit_mb: 2048 }); // a deploy
    await rowAt(h(5), "after-dark", "boot", { sha: null, memory_limit_mb: 1024 }); // no commit known
    await rowAt(h(3), "show", "episode_generated", { where: "job", model: "free", model_calls: 10, ms: 50_000, cost_usd: 0.01 });
    await rowAt(h(1), "show", "episode_generated", { where: "template", model: "free", model_calls: 12, ms: 70_000, cost_usd: 0.02 });
    await rowAt(h(1), "show", "generation_failed", { where: "job", reason: "model_error" });
    await rowAt(h(26), "show", "generation_failed", { where: "job", reason: "yesterday" });
    const s = await opsSummary(t.db, now);
    expect(s.live).toEqual([
      { host: "after-dark", since: h(5).toISOString(), sha: null, memory_limit_mb: 1024, heap_limit_mb: null },
      { host: "show", since: h(2).toISOString(), sha: SHA_B, memory_limit_mb: 2048, heap_limit_mb: null },
    ]);
    expect(s.starts).toEqual([
      { host: "after-dark", starts: 1, restarts: 0, unknown: 1 },
      { host: "show", starts: 2, restarts: 1, unknown: 0 },
    ]);
    expect(s.dates).toEqual({ written: 2, failed: 1, conversation_failed: 0, cost_usd: 0.03, median_s: 60 });
    expect(s.recent[0]).toMatchObject({ host: "show", event: expect.any(String) });
    expect(s.recent.find((r) => r.event === "boot" && r.host === "show")?.detail).toBe("commit fa44ecd, 2048 MB");
  });

  it("keeps 30 days", async () => {
    const now = new Date("2026-11-22T18:00:00Z");
    await rowAt(new Date("2026-10-20T00:00:00Z"), "show", "boot", { sha: SHA_A });
    await rowAt(new Date("2026-11-01T00:00:00Z"), "show", "boot", { sha: SHA_B });
    await pruneOpsLog(t.db, now);
    expect((await rows()).map((r) => r.props.sha)).toEqual([SHA_B]);
  });

  it("is for admins only (GET /api/admin/ops)", async () => {
    expect((await getOps(new Request(`${BASE_URL}/api/admin/ops`))).status).toBe(403);
    vi.stubEnv("FRONTIER_PASSWORD", "admin-password-for-tests");
    await rowAt(new Date(), "show", "boot", { sha: SHA_A });
    const res = await getOps(new Request(`${BASE_URL}/api/admin/ops`, { headers: { "x-frontier-key": "admin-password-for-tests" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).live).toEqual([expect.objectContaining({ host: "show", sha: SHA_A })]);
  });
});
