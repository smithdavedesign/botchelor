import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENDINGS } from "@/lib/game";
import { HOUSE_CHARACTERS } from "@/lib/house";
import {
  api,
  countStringWords,
  episodeJson,
  episodeWithWordCount,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
  startTestDb,
  validCharacter,
  validEpisodeDraft,
} from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
let creator: string;
let characterId: string;

beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  creator = newUserCookie();
  const res = await api.createCharacter(validCharacter(), creator);
  characterId = (await res.json()).id;
});

const createEpisode = () => api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator);
const episodes = () => t.count("episodes");

describe("POST /api/episodes: happy path (exit criterion)", () => {
  it("returns 200 with a setting, two goals, a twist and an ending from the enum, from one model call", async () => {
    scriptOutcome({ ending: "second_date" });
    const { calls } = scriptedModel([episodeJson()]);
    const res = await createEpisode();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(typeof body.setting).toBe("string");
    expect(body.setting.length).toBeGreaterThan(0);
    expect(body.goals).toHaveLength(2);
    expect(body.goals.map((g: { character_id: string }) => g.character_id)).toEqual([characterId, HOUSE_PARTNER_ID]);
    for (const goal of body.goals) expect(goal.goal.length).toBeGreaterThan(0);
    expect(typeof body.twist).toBe("string");
    expect(body.twist.length).toBeGreaterThan(0);
    expect(ENDINGS).toContain(body.ending);
    expect(body.ending).toBe("second_date");
    expect(countStringWords(body)).toBeLessThanOrEqual(450);

    expect(calls).toHaveLength(1);
    expect(await episodes()).toBe(1);
  });

  it.each(ENDINGS)("accepts the %s ending", async (ending) => {
    scriptOutcome({ ending });
    scriptedModel([episodeJson()]);
    const res = await createEpisode();
    expect(res.status).toBe(200);
    expect((await res.json()).ending).toBe(ending);
  });

  it("labels the house partner and names both characters", async () => {
    scriptedModel([episodeJson()]);
    const body = await (await createEpisode()).json();
    expect(body.characters).toEqual([
      { id: characterId, name: "Mira Quell", house: false },
      { id: HOUSE_PARTNER_ID, name: HOUSE_CHARACTERS[0].name, house: true },
    ]);
    expect(body.revealed).toBe(false);
    expect(body.share_path).toBe(`/episodes/${body.id}`);
    expect(body).not.toHaveProperty("creator_id");
  });

  it("keeps the shown episode at or under 450 words for a 400-word episode", async () => {
    scriptedModel([JSON.stringify(episodeWithWordCount(400))]);
    const res = await createEpisode();
    expect(res.status).toBe(200);
    const b = await res.json();
    // The 400-word cap is on the shown episode; best_line and confessionals are separate, length-capped extras.
    const shown = { setting: b.setting, goals: b.goals, scenes: b.scenes, twist: b.twist, finale: b.finale };
    expect(countStringWords(shown)).toBeLessThanOrEqual(450);
  });

  it("accepts a JSON answer wrapped in a markdown code fence", async () => {
    scriptedModel(["```json\n" + episodeJson() + "\n```"]);
    expect((await createEpisode()).status).toBe(200);
  });

  it("sends both character sheets to the model as data, with the word limit and the decided outcome", async () => {
    scriptOutcome({ ending: "second_date" });
    const { calls } = scriptedModel([episodeJson()]);
    await createEpisode();
    const prompt = calls[0].map((m) => m.content).join("\n");
    expect(prompt).toContain("Mira Quell");
    expect(prompt).toContain("A cartographer who maps cities that only exist on Tuesdays.");
    expect(prompt).toContain(HOUSE_CHARACTERS[0].name);
    expect(prompt).toContain(HOUSE_CHARACTERS[0].bio);
    expect(prompt).toMatch(/350 words/);
    // The outcome is decided by the engine and handed to the model, not chosen by it.
    expect(prompt).toContain("Decided ending: A second date");
  });
});

describe("POST /api/episodes: fails closed (exit criterion)", () => {
  it("returns 502 and stores no episode when the model returns invalid JSON twice", async () => {
    const { calls } = scriptedModel(["Sure! Here is your episode: it was lovely.", '{"setting": "a cafe",']);
    const res = await createEpisode();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("showrunner_unavailable");
    expect(calls).toHaveLength(2);
    expect(await episodes()).toBe(0);
  });

  it("retries once: invalid JSON then a valid episode returns 200", async () => {
    const { calls } = scriptedModel(["not json", episodeJson()]);
    const res = await createEpisode();
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(await episodes()).toBe(1);
  });

  it.each([
    ["over the 400-word cap", JSON.stringify(episodeWithWordCount(420))],
    ["one confessional instead of two", episodeJson({ confessionals: ["only one"] })],
    ["a missing best line", JSON.stringify({ ...validEpisodeDraft(), best_line: undefined })],
    ["one goal instead of two", episodeJson({ goals: ["Only one goal."] })],
    ["a missing twist", JSON.stringify({ ...validEpisodeDraft(), twist: undefined })],
    ["a JSON array", JSON.stringify([validEpisodeDraft()])],
    ["sexual content", episodeJson({ twist: "Things get explicit and naked on the roof." })],
    ["a real person", episodeJson({ twist: "Taylor Swift walks in and steals the cake." })],
    ["a minor reference", episodeJson({ finale: "They adopt a 12 year old runaway as a sidekick." })],
  ])("returns 502 and stores nothing when the model twice returns %s", async (_label, output) => {
    const { calls } = scriptedModel([output, output]);
    const res = await createEpisode();
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(2);
    expect(await episodes()).toBe(0);
  });

  it("retries once after a failed model call and stores the second, valid episode", async () => {
    const { calls } = scriptedModel([new Error("timeout"), episodeJson()]);
    expect((await createEpisode()).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(await episodes()).toBe(1);
  });

  it("returns 502 and stores nothing when the model call itself fails twice", async () => {
    const { calls } = scriptedModel([new Error("quota exhausted"), new Error("timeout")]);
    const res = await createEpisode();
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(2);
    expect(await episodes()).toBe(0);
  });
});

describe("POST /api/episodes: input handling", () => {
  it("returns 404 for a character the requester does not own, without calling the model", async () => {
    const { calls } = scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, newUserCookie());
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
    expect(await episodes()).toBe(0);
  });

  it("returns 404 for a character that does not exist", async () => {
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: "nope", partner_id: HOUSE_PARTNER_ID }, creator);
    expect(res.status).toBe(404);
  });

  it("does not let a house character be sent on a date as the creator's own", async () => {
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode(
      { character_id: HOUSE_CHARACTERS[1].id, partner_id: HOUSE_PARTNER_ID },
      creator,
    );
    expect(res.status).toBe(404);
  });

  it("returns 422 when the partner is another user's character (M1 dates house characters only)", async () => {
    const other = newUserCookie();
    const otherId = (await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), other)).json()).id;
    const { calls } = scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: characterId, partner_id: otherId }, creator);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("partner_must_be_house_character");
    expect(calls).toHaveLength(0);
  });

  it("returns 422 for a missing partner", async () => {
    const res = await api.createEpisode({ character_id: characterId }, creator);
    expect(res.status).toBe(422);
  });
});
