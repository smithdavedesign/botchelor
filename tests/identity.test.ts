import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as postConsent } from "@/app/api/reveal/route";
import { getEpisodeView } from "@/lib/game";
import {
  api,
  episodeJson,
  HOUSE_PARTNER_ID,
  jsonRequest,
  named,
  newUserCookie,
  scriptedModel,
  setupEpisode,
  setupPairedEpisode,
  startTestDb,
  userIdOf,
  validCharacter,
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

const HOST_NAME = "Wren Alder";
const PARTNER_NAME = "Kestrel Moss";

type Body = Record<string, unknown> & { id?: string };

/** Every episode API response a viewer can get for this episode: GET /api/episodes/:id and its feed item. */
async function episodeResponses(episodeId: string, viewers: (string | undefined)[]): Promise<Body[]> {
  const bodies: Body[] = [];
  for (const viewer of viewers) {
    const res = await api.getEpisode(episodeId, viewer);
    expect(res.status).toBe(200);
    bodies.push(await res.json());
    const feed = (await (await api.feed(viewer)).json()) as { episodes: Body[] };
    const item = feed.episodes.find((e) => e.id === episodeId);
    expect(item, "episode is in the feed").toBeDefined();
    bodies.push(item as Body);
  }
  return bodies;
}

function expectAnonymous(body: unknown, names: string[]) {
  expect(body).not.toHaveProperty("creators");
  const text = JSON.stringify(body);
  for (const name of names) expect(text).not.toContain(name);
}

describe("mutual-consent identity reveal (exit criterion)", () => {
  it("keeps both creators' names out of every episode response until both POST /api/reveal, then shows them", async () => {
    const host = await named(newUserCookie(), HOST_NAME);
    const partner = await named(newUserCookie(), PARTNER_NAME);
    const { episode, hostCharacter, partnerCharacter } = await setupPairedEpisode({ host, partner });
    const viewers = [host, partner, newUserCookie(), undefined];
    const names = [HOST_NAME, PARTNER_NAME];

    expectAnonymous(episode, names); // the POST /api/episodes response
    for (const body of await episodeResponses(episode.id, viewers)) expectAnonymous(body, names);

    const first = await api.consent(episode.id, host);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ episode_id: episode.id, identity_revealed: false, consents: 1, needed: 2 });
    // One consent is not enough: still absent for everyone, the host included.
    for (const body of await episodeResponses(episode.id, viewers)) expectAnonymous(body, names);

    const second = await api.consent(episode.id, partner);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ episode_id: episode.id, identity_revealed: true, consents: 2, needed: 2 });

    for (const body of await episodeResponses(episode.id, viewers)) {
      expect(body.creators).toEqual([
        { character_id: hostCharacter.id, name: HOST_NAME },
        { character_id: partnerCharacter.id, name: PARTNER_NAME },
      ]);
    }
  });

  it("keeps names hidden after the finale airs if only one creator consented", async () => {
    const host = await named(newUserCookie(), HOST_NAME);
    const partner = await named(newUserCookie(), PARTNER_NAME);
    const { episode } = await setupPairedEpisode({ host, partner });
    await api.consent(episode.id, partner);
    const aired = await api.reveal(episode.id, host);
    expect(aired.status).toBe(200);
    expectAnonymous(await aired.json(), [HOST_NAME, PARTNER_NAME]);
    for (const body of await episodeResponses(episode.id, [host, newUserCookie()])) {
      expect(body.revealed).toBe(true);
      expectAnonymous(body, [HOST_NAME, PARTNER_NAME]);
    }
  });

  it("counts a repeated consent once (200) and still waits for the other creator", async () => {
    const host = await named(newUserCookie(), HOST_NAME);
    const partner = await named(newUserCookie(), PARTNER_NAME);
    const { episode } = await setupPairedEpisode({ host, partner });
    expect((await api.consent(episode.id, host)).status).toBe(201);
    const again = await api.consent(episode.id, host);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ identity_revealed: false, consents: 1, needed: 2 });
    expect(await t.count("identity_consents")).toBe(1);
    expectAnonymous(await (await api.getEpisode(episode.id)).json(), [HOST_NAME, PARTNER_NAME]);
  });

  it("does not let a spectator consent for the creators (403)", async () => {
    const host = await named(newUserCookie(), HOST_NAME);
    const partner = await named(newUserCookie(), PARTNER_NAME);
    const { episode } = await setupPairedEpisode({ host, partner });
    const spectator = await named(newUserCookie(), "Nosy Parker");
    await api.consent(episode.id, host);
    const res = await api.consent(episode.id, spectator);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_creator");
    expect(await t.count("identity_consents")).toBe(1);
    expectAnonymous(await (await api.getEpisode(episode.id)).json(), [HOST_NAME, PARTNER_NAME]);
  });

  it("requires a display name before consenting (422) and stores nothing", async () => {
    const { episode, host } = await setupPairedEpisode();
    const res = await api.consent(episode.id, host);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("name_required");
    expect(await t.count("identity_consents")).toBe(0);
  });

  it("returns 404 for an unknown episode and 422 for a missing episode_id", async () => {
    const someone = await named(newUserCookie(), HOST_NAME);
    expect((await api.consent("missing", someone)).status).toBe(404);
    expect((await postConsent(jsonRequest("/api/reveal", {}, { cookie: someone }))).status).toBe(422);
  });

  it("on a house-character date the only creator's consent reveals their name", async () => {
    const { creator, character, episode } = await setupEpisode();
    await named(creator, HOST_NAME);
    expectAnonymous(await (await api.getEpisode(episode.id)).json(), [HOST_NAME]);
    const res = await api.consent(episode.id, creator);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ identity_revealed: true, consents: 1, needed: 1 });
    const body = await (await api.getEpisode(episode.id, newUserCookie())).json();
    expect(body.creators).toEqual([{ character_id: character.id, name: HOST_NAME }]);
  });

  it("never puts a user id in any episode response", async () => {
    const host = await named(newUserCookie(), HOST_NAME);
    const partner = await named(newUserCookie(), PARTNER_NAME);
    const { episode } = await setupPairedEpisode({ host, partner });
    await api.consent(episode.id, host);
    await api.consent(episode.id, partner);
    const texts = [JSON.stringify(episode)];
    for (const body of await episodeResponses(episode.id, [host, partner, newUserCookie()])) texts.push(JSON.stringify(body));
    texts.push(JSON.stringify(await (await api.reveal(episode.id, host)).json()));
    for (const text of texts) {
      expect(text).not.toContain(userIdOf(host));
      expect(text).not.toContain(userIdOf(partner));
    }
  });

  it("shows each creator their own consent status, and spectators none", async () => {
    const host = await named(newUserCookie(), HOST_NAME);
    const partner = await named(newUserCookie(), PARTNER_NAME);
    const { episode } = await setupPairedEpisode({ host, partner });
    await api.consent(episode.id, partner);
    expect(await getEpisodeView(t.db, episode.id, userIdOf(host))).toMatchObject({
      identity: { consented: false, consents: 1, needed: 2 },
    });
    expect(await getEpisodeView(t.db, episode.id, userIdOf(partner))).toMatchObject({
      identity: { consented: true, consents: 1, needed: 2 },
    });
    expect(await getEpisodeView(t.db, episode.id, userIdOf(newUserCookie()))).not.toHaveProperty("identity");
  });
});

describe("blind dates between two creators' OCs", () => {
  it("pairs the OC with another creator's OC, unlabeled as house, and both creators see the whole episode", async () => {
    const { host, partner, episode, hostCharacter, partnerCharacter } = await setupPairedEpisode({ ending: "disaster" });
    expect(episode.characters).toEqual([
      { id: hostCharacter.id, name: "Mira Quell", house: false, hue: null, portrait: null },
      { id: partnerCharacter.id, name: "Otto Fenn", house: false, hue: null, portrait: null },
    ]);
    expect(episode.goals.map((g: { character_id: string }) => g.character_id)).toEqual([
      hostCharacter.id,
      partnerCharacter.id,
    ]);

    const partnerView = await (await api.getEpisode(episode.id, partner)).json();
    expect(partnerView).toMatchObject({ is_creator: true, is_host: false, ending: "disaster", revealed: false });
    const hostView = await (await api.getEpisode(episode.id, host)).json();
    expect(hostView).toMatchObject({ is_creator: true, is_host: true, ending: "disaster" });
    const spectatorView = await (await api.getEpisode(episode.id, newUserCookie())).json();
    expect(spectatorView).toMatchObject({ is_creator: false, is_host: false });
    expect(spectatorView).not.toHaveProperty("ending");
  });

  it("does not let the partner creator predict (403) or air the finale (403)", async () => {
    const { partner, episode } = await setupPairedEpisode();
    const predict = await api.predict({ episode_id: episode.id, pick: "friends" }, partner);
    expect(predict.status).toBe(403);
    expect((await predict.json()).error).toBe("creator_cannot_predict");
    expect(await t.count("predictions")).toBe(0);
    const air = await api.reveal(episode.id, partner);
    expect(air.status).toBe(403);
    expect((await api.getEpisode(episode.id, partner)).status).toBe(200);
  });

  it("falls back to a house character when no other creator has an OC", async () => {
    const creator = newUserCookie();
    const own = await (await api.createCharacter(validCharacter(), creator)).json();
    await api.createCharacter(validCharacter({ name: "Second Self" }), creator); // same creator: never a match
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: own.id, blind: true }, creator);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.characters[1].house).toBe(true);
    expect(body.characters[1].id).toMatch(/^house-/);
  });

  it("sends both character sheets to the showrunner, marking neither as a house character", async () => {
    const partner = newUserCookie();
    await api.createCharacter(validCharacter({ name: "Otto Fenn", bio: "A lock-keeper who whistles in Morse." }), partner);
    const host = newUserCookie();
    const own = await (await api.createCharacter(validCharacter(), host)).json();
    const { calls } = scriptedModel([episodeJson()]);
    expect((await api.createEpisode({ character_id: own.id, blind: true }, host)).status).toBe(200);
    const user = calls[0].find((m) => m.role === "user")?.content ?? "";
    const data = JSON.parse(user.slice(user.indexOf("{")));
    expect(data.character_b).toMatchObject({ name: "Otto Fenn", house_character: false });
    expect(data.character_b.bio).toBe("A lock-keeper who whistles in Morse.");
  });

  it("returns 422 when neither a house partner nor a blind date is asked for, or both are", async () => {
    const creator = newUserCookie();
    const own = await (await api.createCharacter(validCharacter(), creator)).json();
    const { calls } = scriptedModel([episodeJson(), episodeJson()]);
    expect((await api.createEpisode({ character_id: own.id, blind: false }, creator)).status).toBe(422);
    expect(
      (await api.createEpisode({ character_id: own.id, partner_id: HOUSE_PARTNER_ID, blind: true }, creator)).status,
    ).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("returns 404 for a blind date with someone else's character", async () => {
    const owner = newUserCookie();
    const theirs = await (await api.createCharacter(validCharacter(), owner)).json();
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: theirs.id, blind: true }, newUserCookie());
    expect(res.status).toBe(404);
    expect(await t.count("episodes")).toBe(0);
  });
});

describe("POST /api/profile", () => {
  it("stores a display name with the 18+ attestation and lets the user change it", async () => {
    const user = newUserCookie();
    const res = await api.setProfile({ name: "  Wren Alder  ", attest: true }, user);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Wren Alder" });
    expect((await api.setProfile({ name: "Wren", attest: true }, user)).status).toBe(200);
    expect(await t.count("profiles")).toBe(1);
    const { rows } = await t.db.query<{ name: string }>("select name from profiles");
    expect(rows[0].name).toBe("Wren");
  });

  it("issues a session cookie to a first-time visitor and never returns a user id", async () => {
    const res = await api.setProfile({ name: "Wren Alder", attest: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/bz_uid=/);
    expect(Object.keys(await res.json())).toEqual(["name"]);
  });

  it.each([
    ["no attestation", { name: "Wren Alder" }],
    ["a false attestation", { name: "Wren Alder", attest: false }],
    ["an empty name", { name: "   ", attest: true }],
    ["a 31-character name", { name: "W".repeat(31), attest: true }],
    ["a number for a name", { name: 7, attest: true }],
  ])("rejects %s with 422", async (_label, body) => {
    const res = await api.setProfile(body, newUserCookie());
    expect(res.status).toBe(422);
    expect(await t.count("profiles")).toBe(0);
  });

  it.each([
    ["a real person's name", "Taylor Swift", "real_person"],
    ["a sexual term", "Kinky Wren", "sexual"],
    ["a minor-coded term", "Schoolgirl Wren", "minor"],
  ])("rejects %s with 422 content_rejected", async (_label, name, reason) => {
    const res = await api.setProfile({ name, attest: true }, newUserCookie());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "content_rejected", reason, field: "name" });
    expect(await t.count("profiles")).toBe(0);
  });
});
