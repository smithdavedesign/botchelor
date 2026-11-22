import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { setTwinsCacheForTests, twinsOfCharacter, TWINS_TTL_MS } from "@/lib/twins";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

// The swipe page and the agents' swipe_deck and swipe compared a character with every public sheet on each call
// (2026-11-22 audit: about 1.2 MB read and a database connection held for seconds per /swipe view). The twins are kept
// per character and sheet for TWINS_TTL_MS (lib/twins.ts); the deck's own logic doesn't change.
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
afterEach(() => setTwinsCacheForTests(null));

const BIO = "Runs a 24-hour library for insomniac poets. Knows which books are sleeping.";

async function make(name: string, cookie: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await api.createCharacter(validCharacter({ name, ...extra }), cookie);
  return (await res.json()).id as string;
}

/** The test database, counting the comparisons (the read of every public sheet, lib/originality.ts), failing the first `fail`. */
function counting(fail = 0): { db: Db; compared: () => number } {
  let n = 0;
  const db: Db = {
    async query<T>(sql: string, params?: unknown[]) {
      if (/limit 500/.test(sql) && /select id, name, bio, traits, want, voice, extras/.test(sql)) {
        n++;
        if (n <= fail) throw new Error("connection refused");
      }
      return t.db.query<T>(sql, params);
    },
    exec: (sql: string) => t.db.exec(sql),
  };
  return { db, compared: () => n };
}

async function pair(): Promise<{ owner: string; mine: string; twin: string }> {
  const owner = newUserCookie();
  const mine = await make("Ambrose Fenn", owner, { bio: BIO });
  // Someone else's character made from the same words.
  const twin = await make("Seraphina Fenn", newUserCookie(), { bio: BIO });
  return { owner, mine, twin };
}

describe("a character's twins, kept for a while", () => {
  it("compares once for everyone asking at once, keeps it ten minutes, then compares again", async () => {
    setTwinsCacheForTests(true);
    const { mine, twin } = await pair();
    const { db, compared } = counting();
    const t0 = 1_000_000;
    const [a, b] = await Promise.all([twinsOfCharacter(db, mine, t0), twinsOfCharacter(db, mine, t0 + 5)]);
    expect(compared()).toBe(1);
    expect(a.has(twin)).toBe(true);
    expect(b).toEqual(a);
    a.clear(); // each caller has its own copy
    expect((await twinsOfCharacter(db, mine, t0 + TWINS_TTL_MS - 1)).has(twin)).toBe(true);
    expect(compared()).toBe(1);
    expect((await twinsOfCharacter(db, mine, t0 + TWINS_TTL_MS)).has(twin)).toBe(true);
    expect(compared()).toBe(2);
  });

  it("compares again at once when the sheet changes, and keeps each character's apart", async () => {
    setTwinsCacheForTests(true);
    const { owner, mine, twin } = await pair();
    const { db, compared } = counting();
    expect((await twinsOfCharacter(db, mine, 1)).has(twin)).toBe(true);
    expect((await twinsOfCharacter(db, twin, 1)).has(mine)).toBe(true); // its own comparison
    expect(compared()).toBe(2);
    expect((await api.editCharacter(mine, { bio: "Keeps a lighthouse on a lake that has no ships, and knits its keeper's scarves." }, owner)).status).toBe(200);
    await twinsOfCharacter(db, mine, 2);
    expect(compared()).toBe(3);
    await twinsOfCharacter(db, twin, 2); // still kept: its own sheet didn't change
    expect(compared()).toBe(3);
  });

  it("never keeps a failed comparison: it reads as no twins, and the next asks again", async () => {
    setTwinsCacheForTests(true);
    const { mine, twin } = await pair();
    const { db, compared } = counting(1);
    expect((await twinsOfCharacter(db, mine, 1)).size).toBe(0);
    expect((await twinsOfCharacter(db, mine, 2)).has(twin)).toBe(true);
    expect(compared()).toBe(2);
  });

  it("compares every time outside production, so tests and scripts see what they just wrote", async () => {
    const { mine } = await pair();
    const { db, compared } = counting();
    await twinsOfCharacter(db, mine);
    await twinsOfCharacter(db, mine);
    expect(compared()).toBe(2);
  });
});
