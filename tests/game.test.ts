import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEpisodeView, getPoints, POINTS_PER_CORRECT_PICK } from "@/lib/game";
import { api, newUserCookie, setupEpisode, startTestDb } from "./helpers";

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

const userIdOf = (cookie: string) => cookie.split("=")[1];
const pointsOf = async (cookie: string) => (await (await api.me(cookie)).json()).points;

describe("POST /api/predictions", () => {
  it("stores a pick before the reveal with 201", async () => {
    const { episode } = await setupEpisode("friends");
    const spectator = newUserCookie();
    const res = await api.predict({ episode_id: episode.id, pick: "disaster" }, spectator);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ episode_id: episode.id, pick: "disaster" });
    expect(await t.count("predictions")).toBe(1);
  });

  it("returns 409 for a prediction after the episode is revealed (exit criterion)", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const early = newUserCookie();
    expect((await api.predict({ episode_id: episode.id, pick: "friends" }, early)).status).toBe(201);
    expect((await api.reveal(episode.id, creator)).status).toBe(200);

    const late = newUserCookie();
    const res = await api.predict({ episode_id: episode.id, pick: "friends" }, late);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("episode_revealed");
    // An existing predictor can't change their pick after the reveal either.
    expect((await api.predict({ episode_id: episode.id, pick: "disaster" }, early)).status).toBe(409);
    expect(await t.count("predictions")).toBe(1);
    expect(await pointsOf(early)).toBe(10);
    expect(await pointsOf(late)).toBe(0);
  });

  it("does not let the creator predict their own episode (they already saw the ending)", async () => {
    const { creator, episode } = await setupEpisode();
    const res = await api.predict({ episode_id: episode.id, pick: "friends" }, creator);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("creator_cannot_predict");
    expect(await t.count("predictions")).toBe(0);
  });

  it("returns 404 for an unknown episode", async () => {
    const res = await api.predict({ episode_id: "missing", pick: "friends" }, newUserCookie());
    expect(res.status).toBe(404);
  });

  it("returns 422 for a pick outside second_date, friends and disaster", async () => {
    const { episode } = await setupEpisode();
    const res = await api.predict({ episode_id: episode.id, pick: "married" }, newUserCookie());
    expect(res.status).toBe(422);
    expect(await t.count("predictions")).toBe(0);
  });

  it("lets a spectator change their pick before the reveal, keeping one prediction", async () => {
    const { creator, episode } = await setupEpisode("disaster");
    const spectator = newUserCookie();
    await api.predict({ episode_id: episode.id, pick: "friends" }, spectator);
    const res = await api.predict({ episode_id: episode.id, pick: "disaster" }, spectator);
    expect(res.status).toBe(201);
    expect(await t.count("predictions")).toBe(1);
    await api.reveal(episode.id, creator);
    expect(await pointsOf(spectator)).toBe(10);
  });
});

describe("reveal and scoring", () => {
  it("gives exactly 10 points for a pick that matches the ending and 0 for a mismatch (exit criterion)", async () => {
    expect(POINTS_PER_CORRECT_PICK).toBe(10);
    const { creator, episode } = await setupEpisode("second_date");
    const right = newUserCookie();
    const wrong = newUserCookie();
    await api.predict({ episode_id: episode.id, pick: "second_date" }, right);
    await api.predict({ episode_id: episode.id, pick: "disaster" }, wrong);

    expect(await pointsOf(right)).toBe(0); // nothing is scored before the reveal

    const res = await api.reveal(episode.id, creator);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: episode.id,
      ai_generated: true, // M2: every episode response carries the AI flag
      revealed: true,
      ending: "second_date",
      predictions: { total: 2, correct: 1 },
    });

    expect(await pointsOf(right)).toBe(10);
    expect(await pointsOf(wrong)).toBe(0);
    expect(await getPoints(t.db, userIdOf(right))).toBe(10);

    const rightView = await getEpisodeView(t.db, episode.id, userIdOf(right));
    expect(rightView).toMatchObject({ my_pick: "second_date", my_points: 10 });
    const wrongView = await getEpisodeView(t.db, episode.id, userIdOf(wrong));
    expect(wrongView).toMatchObject({ my_pick: "disaster", my_points: 0 });
  });

  it("adds up points across episodes", async () => {
    const a = await setupEpisode("friends");
    const b = await setupEpisode("disaster");
    const spectator = newUserCookie();
    await api.predict({ episode_id: a.episode.id, pick: "friends" }, spectator);
    await api.predict({ episode_id: b.episode.id, pick: "disaster" }, spectator);
    await api.reveal(a.episode.id, a.creator);
    expect(await pointsOf(spectator)).toBe(10);
    await api.reveal(b.episode.id, b.creator);
    expect(await pointsOf(spectator)).toBe(20);
  });

  it("only the creator can reveal; a second reveal is 409 and changes no points", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const spectator = newUserCookie();
    await api.predict({ episode_id: episode.id, pick: "friends" }, spectator);

    const byOther = await api.reveal(episode.id, spectator);
    expect(byOther.status).toBe(403);
    expect(await pointsOf(spectator)).toBe(0);

    expect((await api.reveal(episode.id, creator)).status).toBe(200);
    const again = await api.reveal(episode.id, creator);
    expect(again.status).toBe(409);
    expect(await pointsOf(spectator)).toBe(10);
  });

  it("returns 404 when revealing an unknown episode", async () => {
    expect((await api.reveal("missing", newUserCookie())).status).toBe(404);
  });

  it("GET /api/me returns 0 points for a visitor without a session and sets no cookie", async () => {
    const res = await api.me();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ points: 0 });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("episode view (what the episode page shows)", () => {
  it("hides the scenes, twist, finale and ending from spectators until the reveal", async () => {
    const { creator, episode } = await setupEpisode("disaster");
    const spectator = userIdOf(newUserCookie());

    const before = await getEpisodeView(t.db, episode.id, spectator);
    expect(before).toMatchObject({ id: episode.id, revealed: false, is_creator: false, setting: episode.setting });
    expect(before?.goals).toHaveLength(2);
    for (const hidden of ["scenes", "twist", "finale", "ending"]) expect(before).not.toHaveProperty(hidden);
    expect(await getEpisodeView(t.db, episode.id, null)).not.toHaveProperty("ending");

    await api.reveal(episode.id, creator);
    const after = await getEpisodeView(t.db, episode.id, spectator);
    expect(after).toMatchObject({ revealed: true, ending: "disaster", twist: episode.twist, my_pick: null });
  });

  it("shows the creator the full episode before the reveal", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const view = await getEpisodeView(t.db, episode.id, userIdOf(creator));
    expect(view).toMatchObject({ is_creator: true, revealed: false, ending: "friends", twist: episode.twist });
    expect(view?.scenes).toEqual(episode.scenes);
  });

  it("returns null for an unknown episode", async () => {
    expect(await getEpisodeView(t.db, "missing", null)).toBeNull();
  });
});
