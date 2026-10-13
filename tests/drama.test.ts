import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEpisodeView } from "@/lib/game";
import { DRAMA_ANSWERS, DRAMA_QUESTIONS, ENDINGS, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK } from "@/lib/rules";
import { buildMessages, parseEpisode } from "@/lib/showrunner";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, episodeJson, newUserCookie, setupEpisode, startTestDb, userIdOf, validEpisodeDraft } from "./helpers";

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

describe("showrunner output: the drama question", () => {
  it("accepts every question with every answer it allows", () => {
    for (const drama_question of DRAMA_QUESTIONS) {
      for (const drama_answer of DRAMA_ANSWERS) {
        const result = parseEpisode(episodeJson({ ending: "friends", drama_question, drama_answer }));
        expect(result.ok, `${drama_question}/${drama_answer}`).toBe(true);
      }
    }
  });

  it.each([
    ["a missing drama question", { drama_question: undefined }],
    ["a missing drama answer", { drama_answer: undefined }],
    ["an unknown question", { drama_question: "who_cries" }],
    ["an unknown answer", { drama_answer: "c" }],
    ["a name instead of a/b", { drama_answer: "Mira Quell" }],
    ["a rejection on a second-date ending", { ending: "second_date", drama_question: "rejected", drama_answer: "a" }],
  ])("rejects %s as a schema failure", (_label, overrides) => {
    const raw = JSON.stringify({ ...validEpisodeDraft(), ...overrides });
    expect(parseEpisode(raw)).toEqual({ ok: false, reason: "schema" });
  });

  it("allows nobody rejected on a second date, and who leaves first on any ending", () => {
    expect(parseEpisode(episodeJson({ ending: "second_date", drama_question: "rejected", drama_answer: "neither" })).ok).toBe(true);
    for (const ending of ENDINGS) {
      expect(parseEpisode(episodeJson({ ending, drama_question: "leaves_first", drama_answer: "a" })).ok).toBe(true);
    }
  });

  it("asks the model for the drama question with its exact options", () => {
    const sheet = { ...HOUSE_CHARACTERS[0], house: true };
    const [system] = buildMessages(sheet, sheet);
    for (const value of [...DRAMA_QUESTIONS, ...DRAMA_ANSWERS]) expect(system.content).toContain(`"${value}"`);
    expect(system.content).toMatch(/drama_question/);
    expect(system.content).toMatch(/drama_answer/);
  });
});

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

  it("ignores a drama pick on an M1 episode that has no drama question", async () => {
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
