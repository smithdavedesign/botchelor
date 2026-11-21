// The pool watch (lib/db-watch.ts, #1948): when a wait for a connection or a hold runs long, a line names who waited,
// who held the connections and the longest hold, so the next burst of connect timeouts names its cause.
import { describe, expect, it } from "vitest";
import { pgPoolDb } from "@/lib/db";
import { dbLabel, LINE_EVERY_MS, requestLabel, routeOfPath, sqlFingerprint, withDbLabel } from "@/lib/db-watch";
import { handle } from "@/lib/http";
import { deferred, fakeClient, fakePool, poolOf } from "./fake-pool";

/** Lets every settled promise run what waits on it. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function watched() {
  const clock = { t: 0 };
  const lines: string[] = [];
  const timers: (() => void)[] = [];
  const { pool, asks } = fakePool();
  const db = pgPoolDb(pool, { log: (line) => lines.push(line), now: () => clock.t, later: (fn) => void timers.push(fn) });
  return { clock, lines, timers, asks, db };
}

/** Asset reads holding every one of the ten connections until their answers come. */
async function holdAll(w: ReturnType<typeof watched>) {
  const answers = Array.from({ length: 10 }, () => deferred<{ rows: unknown[] }>());
  const reads = answers.map((_, i) => withDbLabel("GET /api/assets/[id]", () => w.db.query("select data from assets where id = $1", [`asset-${i}`])));
  await settle();
  w.asks.splice(0, 10).forEach((ask, i) => ask.resolve(fakeClient(() => answers[i].promise)));
  await settle();
  return { answers, reads };
}

describe("the pool watch", () => {
  it("names who waited, who held the connections and the longest hold when a wait runs long", async () => {
    const w = watched();
    const { answers, reads } = await holdAll(w);
    w.clock.t = 100;
    const page = withDbLabel("/couples/[a]/[b]", () => w.db.query("select * from characters where id = $1", ["house-nell"]));
    await settle();
    w.clock.t = 2_600;
    answers[0].resolve({ rows: [] }); // held 2.6 s: under a long hold
    await settle();
    w.asks.shift()!.resolve(fakeClient(async () => ({ rows: [{ id: "house-nell" }] })));
    expect(await page).toEqual({ rows: [{ id: "house-nell" }] });
    expect(w.lines).toEqual([
      "[db] /couples/[a]/[b] waited 2.5 s for a connection (10 busy, 0 waiting; holding: GET /api/assets/[id] ×9 (longest 2.6 s); longest hold: 2.6 s in GET /api/assets/[id]: select data from assets where id = $1)",
    ]);
    answers.slice(1).forEach((answer) => answer.resolve({ rows: [] }));
    await Promise.all(reads);
  });

  it("says who held every connection when a request gives up waiting, and still fails that request", async () => {
    const w = watched();
    const { answers, reads } = await holdAll(w);
    const more = [1, 2].map(() => withDbLabel("GET /api/assets/[id]", () => w.db.query("select data from assets where id = $1", ["x"])));
    const page = withDbLabel("/couples/[a]/[b]", () => w.db.query("select 1"));
    await settle();
    w.clock.t = 10_000;
    const timeout = new Error("timeout exceeded when trying to connect");
    w.asks[2].reject(timeout); // the page asked third, after the two asset reads
    await expect(page).rejects.toBe(timeout);
    expect(w.lines).toEqual([
      "[db] /couples/[a]/[b] gave up after 10 s waiting for a connection (10 busy, 0 waiting; holding: GET /api/assets/[id] ×10 (longest 10 s); waiting: GET /api/assets/[id] ×2; longest hold: 10 s in GET /api/assets/[id]: select data from assets where id = $1)",
    ]);
    w.asks.splice(0, 2).forEach((ask) => ask.resolve(fakeClient(async () => ({ rows: [] }))));
    answers.forEach((answer) => answer.resolve({ rows: [] }));
    await Promise.all([...reads, ...more]);
  });

  it("counts the rest of a burst by label in one line after, instead of a line each", async () => {
    const w = watched();
    const timeout = () => new Error("timeout exceeded when trying to connect");
    const labels = ["/couples/[a]/[b]", "GET /api/assets/[id]", "GET /api/assets/[id]", "/graph", "GET /api/assets/[id]"];
    const queries = labels.map((label) => withDbLabel(label, () => w.db.query("select 1").catch(() => "failed")));
    await settle();
    w.clock.t = 10_000;
    w.asks.splice(0).forEach((ask) => ask.reject(timeout()));
    expect(await Promise.all(queries)).toEqual(labels.map(() => "failed"));
    expect(w.lines).toHaveLength(1);
    expect(w.lines[0]).toMatch(/^\[db\] \/couples\/\[a\]\/\[b\] gave up after 10 s waiting/);
    w.timers.splice(0).forEach((fn) => fn());
    expect(w.lines[1]).toBe("[db] 4 more gave up waiting for a connection in the 5 s after: GET /api/assets/[id] ×3, /graph ×1");
    // Once that window is over, the next one gets a line of its own.
    w.clock.t = 10_000 + LINE_EVERY_MS;
    const late = withDbLabel("/graph", () => w.db.query("select 1").catch(() => "failed"));
    await settle();
    w.asks.shift()!.reject(timeout());
    await late;
    expect(w.lines).toHaveLength(3);
    expect(w.lines[2]).toMatch(/^\[db\] \/graph gave up after 0 s waiting/);
  });

  it("logs a query that holds its connection long, with its string literals hidden and never its parameters", async () => {
    const w = watched();
    const answer = deferred<{ rows: unknown[] }>();
    const read = withDbLabel("/graph", () => w.db.query("select *\n  from characters\n  where name = 'Nell O''Brien' and id = $1", ["secret-id"]));
    await settle();
    w.asks.shift()!.resolve(fakeClient(() => answer.promise));
    await settle();
    w.clock.t = 4_000;
    answer.resolve({ rows: [] });
    await read;
    expect(w.lines).toEqual(["[db] /graph held a connection 4 s (0 waiting): select * from characters where name = '…' and id = $1"]);
  });

  it("hands each connection back as pool.query does: kept after a good query, dropped after a failed one or a dying connection", async () => {
    const good = fakeClient(async () => ({ rows: [] }));
    const bad = new Error("syntax error at or near \"oops\"");
    const failing = fakeClient(async () => {
      throw bad;
    });
    const answer = deferred<never>();
    const dying = fakeClient(() => answer.promise);
    const fresh = fakeClient(async () => ({ rows: [{ n: 2 }] }));
    const db = pgPoolDb(poolOf(good, failing, dying, fresh).pool, { log: () => {} });

    await db.query("select 1");
    expect(good.release).toHaveBeenCalledWith(undefined);
    await expect(db.query("select oops")).rejects.toBe(bad);
    expect(failing.release).toHaveBeenCalledWith(bad);

    // The connection dies mid-query: the client's "error" is heard (unheard, it would crash the instance), the dead
    // connection is dropped, and the query runs again on a fresh one.
    const query = db.query("select 2 as n");
    await settle();
    expect(dying.listening).toBe(1);
    const lost = new Error("Connection terminated unexpectedly");
    dying.fail(lost);
    answer.reject(lost);
    expect(await query).toEqual({ rows: [{ n: 2 }] });
    expect(dying.release).toHaveBeenCalledWith(lost);
    expect([good, failing, dying, fresh].map((c) => c.listening)).toEqual([0, 0, 0, 0]);
  });

  it("labels an API request's queries with its method and route", async () => {
    let seen = "";
    const GET = handle(async () => {
      seen = dbLabel();
      return new Response("ok");
    });
    await GET(new Request("https://botchelor.com/api/assets/a1b2c3?w=64"));
    expect(seen).toBe("GET /api/assets/:id");
    expect(dbLabel()).toBe("outside a request");
    expect(requestLabel(new Request("https://botchelor.com/api/dates/42", { method: "POST" }))).toBe("POST /api/dates/:id");
  });

  it("turns a path into a route when Next's isn't known, and a query into one short line", () => {
    expect(routeOfPath("/api/assets/a1b2c3")).toBe("/api/assets/:id");
    expect(routeOfPath("/couples/house-nell/house-sable")).toBe("/couples/house-nell/house-sable");
    expect(sqlFingerprint("select 'a'' b'  ,\n  x from t")).toBe("select '…' , x from t");
    const long = sqlFingerprint(`select ${"x, ".repeat(60)}y from t`);
    expect(long).toHaveLength(100);
    expect(long.endsWith("…")).toBe(true);
  });
});
