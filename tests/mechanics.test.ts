import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEpisodeView, getPoints } from "@/lib/game";
import { getDealbreakerQuiz, getSurprise, getSurpriseScore } from "@/lib/mechanics";
import { POINTS_PER_DEALBREAKER_PICK, POINTS_PER_MATCHMAKER } from "@/lib/rules";
import {
  api,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
  setupEpisode,
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

const MIRA_DEALBREAKER = "People who hate surprises"; // validCharacter's dealbreaker = character_a's real one

describe("guess the dealbreaker", () => {
  it("offers four stable options including the real dealbreaker", async () => {
    const { episode } = await setupEpisode();
    const quiz = await getDealbreakerQuiz(t.db, episode.id, userIdOf(newUserCookie()));
    expect(quiz?.options).toHaveLength(4);
    expect(quiz?.options).toContain(MIRA_DEALBREAKER);
    expect(new Set(quiz?.options).size).toBe(4); // distinct
    const again = await getDealbreakerQuiz(t.db, episode.id, null);
    expect(again?.options).toEqual(quiz?.options); // deterministic order
  });

  it("stores a spectator's pick, refuses a creator's, and 422s an off-menu pick", async () => {
    const { creator, episode } = await setupEpisode();
    const spectator = newUserCookie();
    expect((await api.guessDealbreaker({ episode_id: episode.id, pick: MIRA_DEALBREAKER }, spectator)).status).toBe(201);
    expect((await api.guessDealbreaker({ episode_id: episode.id, pick: MIRA_DEALBREAKER }, creator)).status).toBe(403);
    expect((await api.guessDealbreaker({ episode_id: episode.id, pick: "a wrong free-text answer" }, newUserCookie())).status).toBe(422);
  });

  it("scores a correct guess at reveal and nothing for a wrong one", async () => {
    const right = newUserCookie();
    const wrong = newUserCookie();
    const { creator, episode } = await setupEpisode();
    const quiz = await getDealbreakerQuiz(t.db, episode.id, userIdOf(right));
    const decoy = quiz!.options.find((o) => o !== MIRA_DEALBREAKER)!;
    await api.guessDealbreaker({ episode_id: episode.id, pick: MIRA_DEALBREAKER }, right);
    await api.guessDealbreaker({ episode_id: episode.id, pick: decoy }, wrong);
    expect(await getPoints(t.db, userIdOf(right))).toBe(0); // nothing before the finale airs
    await api.reveal(episode.id, creator);
    expect(await getPoints(t.db, userIdOf(right))).toBe(POINTS_PER_DEALBREAKER_PICK);
    expect(await getPoints(t.db, userIdOf(wrong))).toBe(0);
  });

  it("closes to new guesses once the finale airs", async () => {
    const { creator, episode } = await setupEpisode();
    await api.reveal(episode.id, creator);
    expect((await api.guessDealbreaker({ episode_id: episode.id, pick: MIRA_DEALBREAKER }, newUserCookie())).status).toBe(409);
  });
});

describe("know your own AI: the surprise score", () => {
  async function dateWithSelfPick(selfPick: string, ending: "second_date" | "friends" | "disaster") {
    const creator = newUserCookie();
    const ch = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending });
    scriptedModel([episodeJson()]);
    const ep = await (
      await api.createEpisode({ character_id: ch.id, partner_id: HOUSE_PARTNER_ID, self_pick: selfPick }, creator)
    ).json();
    return { creator, ep };
  }

  it("flags a surprise when the AI defies the owner's guess, and not when it matches", async () => {
    const miss = await dateWithSelfPick("second_date", "disaster");
    expect(await getSurprise(t.db, miss.ep.id, userIdOf(miss.creator))).toMatchObject({ surprised: true });
    // Only the owner sees their own surprise.
    expect(await getSurprise(t.db, miss.ep.id, userIdOf(newUserCookie()))).toBeNull();

    const hit = await dateWithSelfPick("friends", "friends");
    expect(await getSurprise(t.db, hit.ep.id, userIdOf(hit.creator))).toMatchObject({ surprised: false });
  });

  it("tallies how often an owner's AI surprised them", async () => {
    const creator = newUserCookie();
    const ch = await (await api.createCharacter(validCharacter(), creator)).json();
    for (const [self, ending] of [["second_date", "disaster"], ["friends", "friends"]] as const) {
      scriptOutcome({ ending });
      scriptedModel([episodeJson()]);
      await api.createEpisode({ character_id: ch.id, partner_id: HOUSE_PARTNER_ID, self_pick: self }, creator);
    }
    expect(await getSurpriseScore(t.db, userIdOf(creator))).toEqual({ dates: 2, surprises: 1 });
  });
});

describe("matchmakers", () => {
  it("earns points when a proposed pair ends in a second date after the proposal", async () => {
    const host = newUserCookie();
    const partner = newUserCookie();
    const pc = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), partner)).json();
    const hc = await (await api.createCharacter(validCharacter(), host)).json();

    const matchmaker = newUserCookie();
    expect((await api.proposeMatch({ character_a: hc.id, character_b: pc.id }, matchmaker)).status).toBe(201);
    expect((await api.proposeMatch({ character_a: pc.id, character_b: hc.id }, matchmaker)).status).toBe(200); // same unordered pair
    // Back-date the proposal so the date clearly comes after it.
    await t.db.query("update matchmaker_proposals set created_at = now() - interval '1 hour' where proposer_id = $1", [userIdOf(matchmaker)]);

    let proposals = (await (await api.myProposals(matchmaker)).json()).proposals;
    expect(proposals).toHaveLength(1);
    expect(proposals[0].paid_off).toBe(false);

    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const ep = await (await api.createEpisode({ character_id: hc.id, blind: true }, host)).json();
    expect(await getPoints(t.db, userIdOf(matchmaker))).toBe(0); // not until the finale airs
    await api.reveal(ep.id, host);

    proposals = (await (await api.myProposals(matchmaker)).json()).proposals;
    expect(proposals[0].paid_off).toBe(true);
    expect(await getPoints(t.db, userIdOf(matchmaker))).toBe(POINTS_PER_MATCHMAKER);
  });

  it("rejects a proposal of a character with itself and an unknown character", async () => {
    const u = newUserCookie();
    const ch = await (await api.createCharacter(validCharacter(), u)).json();
    expect((await api.proposeMatch({ character_a: ch.id, character_b: ch.id }, u)).status).toBe(422);
    expect((await api.proposeMatch({ character_a: ch.id, character_b: "nope" }, u)).status).toBe(404);
  });
});

describe("sliding doors", () => {
  it("replays the owner's date with one input changed, deterministically and owner-only", async () => {
    const creator = newUserCookie();
    const ch = await (await api.createCharacter(validCharacter(), creator)).json();
    // Real engine (no scriptOutcome) so there is a genuine seed-based outcome to replay.
    scriptedModel([episodeJson()]);
    const ep = await (
      await api.createEpisode({ character_id: ch.id, partner_id: HOUSE_PARTNER_ID, autonomy: "guided" }, creator)
    ).json();

    const res = await api.slidingDoors(ep.id, "bolder", creator);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.base.box_score.chemistry.final).toBe(ep.box_score.chemistry.final);
    expect(body.alternate.box_score.chemistry).toBeDefined();
    // Deterministic: the same change replayed gives the same alternate timeline.
    const again = await (await api.slidingDoors(ep.id, "bolder", creator)).json();
    expect(again.alternate).toEqual(body.alternate);
    // Owner-only.
    expect((await api.slidingDoors(ep.id, "bolder", newUserCookie())).status).toBe(404);
  });
});

describe("the box score and confessionals on an episode", () => {
  it("shows the box score to the creator and hides the confessionals until the host shares them", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const spectator = newUserCookie();
    await api.predict({ episode_id: episode.id, pick: "friends" }, spectator);
    await api.reveal(episode.id, creator);

    const creatorView = await getEpisodeView(t.db, episode.id, userIdOf(creator));
    expect(creatorView?.box_score?.chemistry).toBeDefined();
    expect(creatorView?.confessionals).toHaveLength(2); // creators always see their own
    expect(creatorView?.debrief).toBeDefined();

    let view = await getEpisodeView(t.db, episode.id, userIdOf(spectator));
    expect(view?.confessionals).toBeUndefined(); // not shared yet
    expect(view?.box_score?.chemistry).toBeDefined(); // the box score is public once aired

    expect((await api.shareConfessionals(episode.id, true, spectator)).status).toBe(403); // not the host
    expect((await api.shareConfessionals(episode.id, true, creator)).status).toBe(200);

    view = await getEpisodeView(t.db, episode.id, userIdOf(spectator));
    expect(view?.confessionals).toHaveLength(2);
  });
});
