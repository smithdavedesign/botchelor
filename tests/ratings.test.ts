import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";
import { getCharacterRatings, topRatedCharacters } from "@/lib/ratings";
import { getPoints } from "@/lib/game";
import { POINTS_PER_RATING_RECEIVED } from "@/lib/rules";

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

async function makeOC(cookie = newUserCookie()) {
  const character = await (await api.createCharacter(validCharacter(), cookie)).json();
  return { cookie, id: character.id as string };
}

describe("ratings — toggling", () => {
  it("a viewer can rate a character, and rating again removes it", async () => {
    const { id } = await makeOC();
    const rater = newUserCookie();

    const on = await (await api.rateCharacter(id, "likable", rater)).json();
    expect(on.rated).toBe(true);
    expect(on.counts.likable).toBe(1);

    const off = await (await api.rateCharacter(id, "likable", rater)).json();
    expect(off.rated).toBe(false);
    expect(off.counts.likable).toBe(0);
  });

  it("two viewers each count once; categories are independent", async () => {
    const { id } = await makeOC();
    await api.rateCharacter(id, "likable", newUserCookie());
    await api.rateCharacter(id, "likable", newUserCookie());
    const surprising = await (await api.rateCharacter(id, "surprising", newUserCookie())).json();
    expect(surprising.counts.likable).toBe(2);
    expect(surprising.counts.surprising).toBe(1);
  });
});

describe("ratings — guards", () => {
  it("you can't rate your own character (403)", async () => {
    const { cookie, id } = await makeOC();
    const res = await api.rateCharacter(id, "likable", cookie);
    expect(res.status).toBe(403);
    expect(await t.count("character_ratings")).toBe(0);
  });

  it("an unknown character is 404 and an unknown category is 422", async () => {
    const { id } = await makeOC();
    expect((await api.rateCharacter("no-such-character", "likable", newUserCookie())).status).toBe(404);
    expect((await api.rateCharacter(id, "charming", newUserCookie())).status).toBe(422);
  });
});

describe("ratings — leaderboard and points", () => {
  it("the leaderboard orders characters by rating count", async () => {
    const popular = await makeOC();
    const quiet = await makeOC();
    await api.rateCharacter(popular.id, "likable", newUserCookie());
    await api.rateCharacter(popular.id, "likable", newUserCookie());
    await api.rateCharacter(quiet.id, "likable", newUserCookie());

    const board = await topRatedCharacters(t.db, "likable");
    expect(board.map((b) => b.id)).toEqual([popular.id, quiet.id]);
    expect(board[0].count).toBe(2);
  });

  it("an owner earns points when others rate their character; never themselves", async () => {
    const { cookie, id } = await makeOC();
    expect(await getPoints(t.db, userIdOf(cookie))).toBe(0);

    await api.rateCharacter(id, "likable", newUserCookie());
    await api.rateCharacter(id, "surprising", newUserCookie());
    expect(await getPoints(t.db, userIdOf(cookie))).toBe(2 * POINTS_PER_RATING_RECEIVED);

    // The rater earns nothing from rating, and the owner can't inflate their own.
    const rater = newUserCookie();
    await api.rateCharacter(id, "likable", rater); // (owner already has this category from another rater)
    expect(await getPoints(t.db, userIdOf(rater))).toBe(0);
  });

  it("getCharacterRatings reports counts, the viewer's own votes, and ownership", async () => {
    const { cookie, id } = await makeOC();
    const rater = newUserCookie();
    await api.rateCharacter(id, "likable", rater);

    const forRater = await getCharacterRatings(t.db, id, userIdOf(rater));
    expect(forRater.counts.likable).toBe(1);
    expect(forRater.mine.likable).toBe(true);
    expect(forRater.is_owner).toBe(false);

    const forOwner = await getCharacterRatings(t.db, id, userIdOf(cookie));
    expect(forOwner.is_owner).toBe(true);
    expect(forOwner.mine.likable).toBe(false);
  });
});
