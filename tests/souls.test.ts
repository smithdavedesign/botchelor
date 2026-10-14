import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEpisodeView } from "@/lib/game";
import { loadSoul } from "@/lib/souls";
import {
  api,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
  startTestDb,
  userIdOf,
  validCharacter,
  episodeJson,
} from "./helpers";

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

const SOUL = {
  values: "Loyalty above all, and never lying.",
  insecurities: "Afraid of being boring.",
  humor: "Dry and deadpan.",
  boundaries: "No cruelty, ever.",
  romantic: "Slow burn; wants to be chosen on purpose.",
  communication: "Warm but guarded at first.",
};

describe("the private soul", () => {
  it("is stored with a character and reported as present, without being echoed back", async () => {
    const user = newUserCookie();
    const res = await api.createCharacter(validCharacter({ soul: SOUL }), user);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.has_soul).toBe(true);
    expect(body).not.toHaveProperty("soul");
    expect(await loadSoul(t.db, body.id)).toMatchObject(SOUL);
  });

  it("is owner-only: the owner can read it, a stranger cannot", async () => {
    const owner = newUserCookie();
    const { id } = await (await api.createCharacter(validCharacter({ soul: SOUL }), owner)).json();
    expect((await (await api.getSoul(id, owner)).json()).soul).toMatchObject(SOUL);
    expect((await api.getSoul(id, newUserCookie())).status).toBe(404);
  });

  it("can be edited and deleted by its owner", async () => {
    const owner = newUserCookie();
    const { id } = await (await api.createCharacter(validCharacter(), owner)).json();
    expect((await (await api.getSoul(id, owner)).json()).soul).toBeNull();
    expect((await api.putSoul(id, SOUL, owner)).status).toBe(200);
    expect((await (await api.getSoul(id, owner)).json()).soul).toMatchObject(SOUL);
    expect((await (await api.deleteSoul(id, owner)).json()).has_soul).toBe(false);
    expect(await loadSoul(t.db, id)).toBeNull();
    // A stranger can neither edit nor delete.
    expect((await api.putSoul(id, SOUL, newUserCookie())).status).toBe(404);
  });

  it("goes through the content filter, and a rejected soul stores no character", async () => {
    const user = newUserCookie();
    const before = await t.count("characters", "not is_house");
    const res = await api.createCharacter(validCharacter({ soul: { ...SOUL, romantic: "wants to date Taylor Swift" } }), user);
    expect(res.status).toBe(422);
    expect((await res.json()).field).toBe("soul.romantic");
    expect(await t.count("characters", "not is_house")).toBe(before);
  });

  it("never leaks into what a spectator or a stranger can see of an episode", async () => {
    const creator = newUserCookie();
    const { id: characterId } = await (await api.createCharacter(validCharacter({ soul: SOUL }), creator)).json();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const episode = await (await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator)).json();

    const spectator = newUserCookie();
    const view = await getEpisodeView(t.db, episode.id, userIdOf(spectator));
    expect(JSON.stringify(view)).not.toContain("deadpan");
    expect(JSON.stringify(view)).not.toContain("Loyalty above all");
    expect(view).not.toHaveProperty("soul");
  });
});
