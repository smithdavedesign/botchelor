import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, newUserCookie, setupEpisode, startTestDb } from "./helpers";
import { getReunion } from "@/lib/reunion";

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

describe("the reunion special", () => {
  it("is empty and graceful before there is any history", async () => {
    const r = await getReunion(t.db);
    expect(r.stats).toEqual({ couples: 0, second_dates: 0, aired: 0 });
    expect(r.couples).toEqual([]);
    expect(r.confessionals).toEqual([]);
    expect(r.awards).toEqual([]);
  });

  it("assembles couples, shared confessionals and awards from aired data", async () => {
    // A golden couple: a second date, aired, with its confessionals shared.
    const a = await setupEpisode("second_date");
    await api.reveal(a.episode.id, a.creator);
    await api.shareConfessionals(a.episode.id, true, a.creator);

    // A disaster, aired (but confessionals NOT shared).
    const b = await setupEpisode("disaster");
    await api.reveal(b.episode.id, b.creator);

    // A viewer makes a's character the fan favourite.
    await api.rateCharacter(a.character.id, "likable", newUserCookie());

    const r = await getReunion(t.db);

    expect(r.stats.aired).toBe(2);
    expect(r.stats.second_dates).toBe(1);
    expect(r.stats.couples).toBe(2);
    expect(r.couples.length).toBe(2);

    const titles = r.awards.map((x) => x.title);
    expect(titles.some((x) => x.includes("golden couple"))).toBe(true);
    expect(titles.some((x) => x.includes("Biggest disaster"))).toBe(true);
    expect(titles.some((x) => x.includes("Fan favourite"))).toBe(true);

    // Only the shared+aired confessionals make the reel (a's two lines, never b's).
    expect(r.confessionals.length).toBe(2);
    expect(r.confessionals.every((c) => c.episode_id === a.episode.id)).toBe(true);
  });
});
