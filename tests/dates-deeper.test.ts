import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { airDueDates, airIfDue } from "@/lib/air";
import { closingMove, depthFor } from "@/lib/beats";
import { bestLine, type Turn } from "@/lib/conversation";
import { isLogistics, pairMemory } from "@/lib/memory";
import { CONVERSATION_TURNS } from "@/lib/rules";
import { HOUSE_PARTNER_ID, setupEpisode, startTestDb, userIdOf } from "./helpers";

// David, 2026-10-18, after reading Cass and Dex's fifteen dates: vary the endings, let goals deepen, more lines,
// memory from everything between the two of them, and air every date by default.
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const turn = (dialogue: string, interest: number): Turn => ({ side: "a", act: 2, dialogue, action: "", emotion: "warm", interest });

describe("endings vary, and plans never pin a day", () => {
  it("a couple's goodbye changes from one date to the next, and no move names a day or a time", () => {
    const moves = [0, 1, 2, 3].map((n) => closingMove({ ending: "second_date" }, n).actor);
    expect(new Set(moves).size).toBe(4);
    for (const ending of ["second_date", "friends", "disaster"] as const) {
      for (let n = 0; n < 6; n++) expect(isLogistics(closingMove({ ending }, n).director)).toBe(false);
    }
  });

  it("a scheduling line never sticks as the best line", () => {
    expect(isLogistics("Tuesday at seven, then. I'll pick you up.")).toBe(true);
    expect(isLogistics("Same time next week?")).toBe(true);
    expect(isLogistics("Getting set on fire is a poor way to test a suit.")).toBe(false);
    expect(bestLine([turn("Same time next Tuesday?", 0.9), turn("You defused bombs before breakfast?", 0.7)])).toBe("You defused bombs before breakfast?");
  });
});

describe("goals deepen", () => {
  it("small talk is for strangers: each date asks more of them", () => {
    expect(depthFor(0)).toBeNull();
    const levels = [1, 2, 5].map((n) => depthFor(n)!.actor);
    expect(new Set(levels).size).toBe(3);
    expect(levels[2]).toMatch(/where this is going/);
  });

  it("a date is longer by default", () => {
    expect(CONVERSATION_TURNS).toBe(16);
  });
});

describe("they remember everything between the two of them", () => {
  it("a private, unaired date counts in what each remembers about the other, for the creator who booked it", async () => {
    const { creator, character, episode } = await setupEpisode("second_date");
    await t.db.query(`update episodes set visibility = 'private', revealed_at = null where id = $1`, [episode.id]);
    const mine = await pairMemory(t.db, character.id, HOUSE_PARTNER_ID, userIdOf(creator));
    expect(mine).toMatchObject({ id: HOUSE_PARTNER_ID, dates: 1, last_ending: "second_date" });
    // Someone else's date doesn't come into theirs.
    expect(await pairMemory(t.db, character.id, HOUSE_PARTNER_ID, "someone-else")).toBeNull();
  });
});

describe("every date airs by default", () => {
  it("a public date airs on its own once its prediction window closes; one inside it doesn't, nor an offline one", async () => {
    const { episode } = await setupEpisode("friends");
    expect(await airIfDue(t.db, episode.id)).toBeNull(); // just booked: predictions are still open
    await t.db.query(`update episodes set created_at = now() - interval '11 minutes' where id = $1`, [episode.id]);
    expect(await airIfDue(t.db, episode.id)).toMatchObject({ ending: "friends" });
    expect((await t.db.query<{ aired: boolean }>(`select revealed_at is not null as aired from episodes where id = $1`, [episode.id])).rows[0].aired).toBe(true);

    const offline = (await setupEpisode("friends")).episode;
    await t.db.query(`update episodes set visibility = 'private', created_at = now() - interval '1 day' where id = $1`, [offline.id]);
    expect(await airDueDates(t.db)).toEqual([]);
  });

  it("opening a due date airs it", async () => {
    const { episode } = await setupEpisode("second_date");
    await t.db.query(`update episodes set created_at = now() - interval '1 hour' where id = $1`, [episode.id]);
    const { GET } = await import("@/app/api/episodes/[id]/route");
    const res = await GET(new Request(`http://localhost/api/episodes/${episode.id}`), { params: Promise.resolve({ id: episode.id }) });
    expect((await res.json()).revealed).toBe(true);
  });
});
