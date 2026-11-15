import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, newUserCookie, setupEpisode, startTestDb } from "./helpers";
import { getReunion } from "@/lib/reunion";
import { DELETED_OWNER } from "@/lib/rules";

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

    // The fan favourite's vote count travels beside countless words (the empty-room rule, lib/crowd-threshold.ts: the
    // page shows "1 viewer called them" only to an insider or for a crowd), and every character says who made it.
    const fav = r.awards.find((x) => x.title.includes("Fan favourite"))!;
    expect(fav.detail).toBe("Called the most likable of the season.");
    expect(fav.count).toBe(1);
    expect(fav.count_line).toBe("1 viewer called them the most likable.");
    expect(fav.chars[0].origin).toBe("person");
    expect(r.couples.every((c) => c.a.origin && c.b.origin)).toBe(true);
    expect(r.confessionals.every((c) => c.character.origin === "person" || c.character.origin === "cast")).toBe(true);
  });

  it("a deleted account's character never wins: its disaster is not the Biggest disaster, its dates don't count", async () => {
    // The worst date of the season, by a character whose account has since been deleted (lib/account.ts leaves the
    // character, renamed, under DELETED_OWNER).
    const gone = await setupEpisode("disaster");
    await api.reveal(gone.episode.id, gone.creator);
    await t.db.query(`update characters set owner_id = $2, name = 'A former viewer' where id = $1`, [gone.character.id, DELETED_OWNER]);
    await api.rateCharacter(gone.character.id, "likable", newUserCookie());

    const none = await getReunion(t.db);
    expect(none.awards.map((x) => x.title)).toEqual([]);
    expect(none.stats.aired).toBe(0);
    expect(none.couples).toEqual([]);

    // A live account's disaster, aired later, is the one the special names.
    const live = await setupEpisode("disaster");
    await api.reveal(live.episode.id, live.creator);
    const r = await getReunion(t.db);
    const worst = r.awards.find((x) => x.title.includes("Biggest disaster"))!;
    expect(worst.name).toContain(live.character.name);
    expect(worst.name).not.toContain("A former viewer");
    expect(r.awards.some((x) => x.title.includes("Fan favourite"))).toBe(false);
    expect(r.stats.aired).toBe(1);
  });
});
