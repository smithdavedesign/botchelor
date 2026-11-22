import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import type { Model } from "@/lib/model";
import { countingModel } from "@/lib/pipeline";
import { inSpan, timedDb, timeRequest } from "@/lib/request-timing";

/** A clock the test moves by hand, and a call that takes `ms` of it. */
function clock() {
  let t = 1000;
  return { now: () => t, wait: async (ms: number) => void (t += ms) };
}

describe("a timed request", () => {
  it("says how long it took, and how much of it waited on the database and on the model", async () => {
    const c = clock();
    const { result, timing } = await timeRequest(async () => {
      await inSpan("db", () => c.wait(30));
      await inSpan("db", () => c.wait(20));
      await c.wait(5);
      await inSpan("model", () => c.wait(4000));
      return "said";
    }, c.now);
    expect(result).toBe("said");
    expect(timing).toEqual({ ms: 4055, db_queries: 2, db_ms: 50, model_calls: 1, model_ms: 4000, other_ms: 5 });
  });

  it("counts calls in flight together once, by the wall clock", async () => {
    const c = clock();
    const { timing } = await timeRequest(async () => {
      // Two queries at once: both counted, the time they overlap counted once.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const first = inSpan("db", () => gate);
      const second = inSpan("db", async () => {
        await c.wait(40);
        release();
      });
      await Promise.all([first, second]);
    }, c.now);
    expect(timing).toMatchObject({ ms: 40, db_queries: 2, db_ms: 40, model_calls: 0, model_ms: 0, other_ms: 0 });
  });

  it("runs a call as it is outside a timed request", async () => {
    expect(await inSpan("db", async () => 7)).toBe(7);
    // A failed call still ends its span, and the error comes through.
    const c = clock();
    const out = await timeRequest(async () => {
      await inSpan("model", async () => {
        await c.wait(10);
        throw new Error("down");
      }).catch(() => null);
      return "after";
    }, c.now);
    expect(out.timing).toMatchObject({ model_calls: 1, model_ms: 10 });
  });

  it("counts the queries of a timed database and the calls of a counting model, and changes nothing they return", async () => {
    const c = clock();
    const db: Db = {
      async query<T>(sql: string, params?: unknown[]) {
        await c.wait(25);
        return { rows: [{ sql, params }] as T[] };
      },
      async exec() {
        await c.wait(25);
      },
    };
    const model: Model = {
      async complete() {
        await c.wait(3000);
        return '{"dialogue":"hi"}';
      },
    };
    const counted = countingModel(model);
    const { result, timing } = await timeRequest(async () => {
      const rows = (await timedDb(db).query<{ sql: string; params: unknown[] }>("select $1", [1])).rows;
      await timedDb(db).exec("select 1");
      return { rows, said: await counted.model.complete([{ role: "user", content: "hi" }]) };
    }, c.now);
    expect(result).toEqual({ rows: [{ sql: "select $1", params: [1] }], said: '{"dialogue":"hi"}' });
    expect(counted.calls()).toBe(1);
    expect(timing).toEqual({ ms: 3050, db_queries: 2, db_ms: 50, model_calls: 1, model_ms: 3000, other_ms: 0 });
  });
});
