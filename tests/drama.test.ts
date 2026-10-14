import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEpisodeView } from "@/lib/game";
import { POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK } from "@/lib/rules";
import { api, newUserCookie, setupEpisode, startTestDb, userIdOf } from "./helpers";

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

const pointsOf = async (cookie: string) => (await (await api.me(cookie)).json()).points;

// The engine (not the model) now decides the drama question and answer; tests force it with scriptOutcome,
// which setupEpisode's second argument wires up. The schema/invariant for drama lives in tests/engine.test.ts.
describe("POST /api/predictions with a drama pick", () => {
  it("stores an optional drama pick next to the ending pick", async () => {
    const { episode } = await setupEpisode();
    const spectator = newUserCookie();
    const res = await api.predict({ episode_id: episode.id, pick: "friends", drama_pick: "a" }, spectator);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ episode_id: episode.id, pick: "friends", drama_pick: "a" });
    expect(await getEpisodeView(t.db, episode.id, userIdOf(spectator))).toMatchObject({
      my_pick: "friends",
      my_drama_pick: "a",
    });
  });

  it("keeps the earlier drama pick when a later pick leaves it out", async () => {
    const { episode } = await setupEpisode();
    const spectator = newUserCookie();
    await api.predict({ episode_id: episode.id, pick: "friends", drama_pick: "neither" }, spectator);
    const res = await api.predict({ episode_id: episode.id, pick: "disaster" }, spectator);
    expect(await res.json()).toEqual({ episode_id: episode.id, pick: "disaster", drama_pick: "neither" });
  });

  it("returns 422 for a drama pick outside a, b and neither", async () => {
    const { episode } = await setupEpisode();
    const res = await api.predict({ episode_id: episode.id, pick: "friends", drama_pick: "Mira" }, newUserCookie());
    expect(res.status).toBe(422);
    expect(await t.count("predictions")).toBe(0);
  });

  it.each([
    ["the ending and the drama answer", "friends", "b", POINTS_PER_CORRECT_PICK + POINTS_PER_DRAMA_PICK],
    ["only the ending", "friends", "a", POINTS_PER_CORRECT_PICK],
    ["only the drama answer", "disaster", "b", POINTS_PER_DRAMA_PICK],
    ["neither", "disaster", "neither", 0],
  ])("scores a spectator who got %s right", async (_label, pick, drama_pick, points) => {
    expect([POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK]).toEqual([10, 5]);
    const { creator, episode } = await setupEpisode("friends", { drama_question: "leaves_first", drama_answer: "b" });
    const spectator = newUserCookie();
    await api.predict({ episode_id: episode.id, pick, drama_pick }, spectator);
    expect(await pointsOf(spectator)).toBe(0); // nothing before the finale airs
    await api.reveal(episode.id, creator);
    expect(await pointsOf(spectator)).toBe(points);
    expect(await getEpisodeView(t.db, episode.id, userIdOf(spectator))).toMatchObject({ my_points: points });
  });

  it("ignores a drama pick on an episode that has no drama question", async () => {
    const { creator, episode } = await setupEpisode("friends");
    await t.db.query("update episodes set drama_question = null, drama_answer = null where id = $1", [episode.id]);
    const spectator = newUserCookie();
    const res = await api.predict({ episode_id: episode.id, pick: "friends", drama_pick: "b" }, spectator);
    expect(await res.json()).toEqual({ episode_id: episode.id, pick: "friends" }); // no drama pick was stored
    await api.reveal(episode.id, creator);
    expect(await pointsOf(spectator)).toBe(10);
    const view = await getEpisodeView(t.db, episode.id, userIdOf(spectator));
    expect(view).toMatchObject({ drama_question: null, drama_answer: null, my_points: 10 });
  });
});
