import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEpisodeView, listMyEpisodes } from "@/lib/game";
import { setModelForTests } from "@/lib/model";
import { listBlocks } from "@/lib/people";
import { REPORT_HIDE_THRESHOLD, REPORT_REASONS } from "@/lib/rules";
import {
  api,
  episodeJson,
  named,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
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

type FeedItem = { id: string; revealed: boolean; ending?: string; ai_generated: boolean };

async function feedIds(viewer?: string): Promise<string[]> {
  const res = await api.feed(viewer);
  expect(res.status).toBe(200);
  return ((await res.json()).episodes as FeedItem[]).map((e) => e.id);
}

describe("POST /api/reports (exit criterion)", () => {
  it("returns 201 and hides the episode from the feed after 3 distinct reporters", async () => {
    expect(REPORT_HIDE_THRESHOLD).toBe(3);
    const { episode } = await setupEpisode();
    const other = await setupEpisode();
    const [first, second, third] = [newUserCookie(), newUserCookie(), newUserCookie()];
    expect(await feedIds()).toContain(episode.id);

    const res = await api.report({ episode_id: episode.id, reason: "sexual" }, first);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ episode_id: episode.id, reported: true });
    expect(await feedIds()).toContain(episode.id);

    expect((await api.report({ episode_id: episode.id }, second)).status).toBe(201);
    expect(await feedIds()).toContain(episode.id);

    // The same reporter again does not count toward the threshold.
    const repeat = await api.report({ episode_id: episode.id, reason: "other" }, first);
    expect(repeat.status).toBe(200);
    expect(await feedIds(newUserCookie())).toContain(episode.id);

    expect((await api.report({ episode_id: episode.id, reason: "minor" }, third)).status).toBe(201);
    expect(await feedIds()).not.toContain(episode.id);
    expect(await feedIds(first)).not.toContain(episode.id);
    expect(await feedIds(newUserCookie())).not.toContain(episode.id);

    expect(await feedIds()).toContain(other.episode.id); // only the reported episode is hidden
    expect(await t.count("reports")).toBe(3);
  });

  it("hides a reported episode from spectators but not from its creator, who is told why", async () => {
    const { creator, episode } = await setupEpisode();
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) await api.report({ episode_id: episode.id }, newUserCookie());

    const spectatorGet = await api.getEpisode(episode.id, newUserCookie());
    expect(spectatorGet.status).toBe(404);
    expect((await spectatorGet.json()).error).toBe("episode_hidden");
    expect((await api.getEpisode(episode.id)).status).toBe(404);

    const creatorGet = await api.getEpisode(episode.id, creator);
    expect(creatorGet.status).toBe(200);
    expect(await creatorGet.json()).toMatchObject({ id: episode.id, hidden: true, is_creator: true });

    const mine = await listMyEpisodes(t.db, userIdOf(creator));
    expect(mine.map((e) => [e.id, e.hidden])).toEqual([[episode.id, true]]);
  });

  it("does not let a hidden episode air, so its points can't give the hidden ending away", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const spectator = newUserCookie();
    await api.predict({ episode_id: episode.id, pick: "friends", drama_pick: "b" }, spectator);
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) await api.report({ episode_id: episode.id }, newUserCookie());

    const res = await api.reveal(episode.id, creator);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("episode_hidden");
    expect((await (await api.me(spectator)).json()).points).toBe(0);
    expect(await t.count("episodes", "revealed_at is not null")).toBe(0);
  });

  it("refuses predictions on a hidden episode (404) and stores none", async () => {
    const { episode } = await setupEpisode();
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) await api.report({ episode_id: episode.id }, newUserCookie());
    const res = await api.predict({ episode_id: episode.id, pick: "friends" }, newUserCookie());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("episode_hidden");
    expect(await t.count("predictions")).toBe(0);
  });

  it("accepts every report reason, and returns 422 for an unknown one", async () => {
    const { episode } = await setupEpisode();
    for (const reason of REPORT_REASONS) {
      expect((await api.report({ episode_id: episode.id, reason }, newUserCookie())).status).toBe(201);
    }
    const bad = await api.report({ episode_id: episode.id, reason: "boring" }, newUserCookie());
    expect(bad.status).toBe(422);
    expect(await t.count("reports")).toBe(REPORT_REASONS.length);
  });

  it("returns 404 for an unknown episode and stores nothing", async () => {
    const res = await api.report({ episode_id: "missing" }, newUserCookie());
    expect(res.status).toBe(404);
    expect(await t.count("reports")).toBe(0);
  });

  it("does not tell the reporter how many others reported", async () => {
    const { episode } = await setupEpisode();
    await api.report({ episode_id: episode.id }, newUserCookie());
    const body = await (await api.report({ episode_id: episode.id }, newUserCookie())).json();
    expect(Object.keys(body).sort()).toEqual(["episode_id", "reported"]);
  });
});

describe("GET /api/episodes (the feed)", () => {
  it("lists episodes newest first, as teasers until the finale airs", async () => {
    const older = await setupEpisode("friends");
    const newer = await setupEpisode("disaster");
    await t.db.query("update episodes set created_at = now() - interval '1 hour' where id = $1", [older.episode.id]);
    await api.reveal(older.episode.id, older.creator);

    const res = await api.feed(newUserCookie());
    const items = (await res.json()).episodes as FeedItem[];
    expect(items.map((e) => e.id)).toEqual([newer.episode.id, older.episode.id]);
    expect(items[0]).not.toHaveProperty("ending");
    expect(items[1]).toMatchObject({ revealed: true, ending: "friends" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("works for a visitor without a session and sets no cookie", async () => {
    const { episode } = await setupEpisode();
    const res = await api.feed();
    expect(res.status).toBe(200);
    expect(((await res.json()).episodes as FeedItem[]).map((e) => e.id)).toEqual([episode.id]);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("block list", () => {
  it("hides a blocked creator's episodes from the blocker's feed only, until unblocked", async () => {
    const { creator, episode } = await setupEpisode();
    const spectator = newUserCookie();
    const bystander = newUserCookie();

    const res = await api.block(episode.id, spectator);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ episode_id: episode.id, blocked: true });
    expect(await feedIds(spectator)).not.toContain(episode.id);
    expect(await feedIds(bystander)).toContain(episode.id);
    expect(await getEpisodeView(t.db, episode.id, userIdOf(spectator))).toMatchObject({ blocked: true });

    const list = await listBlocks(t.db, userIdOf(spectator));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ episode_id: episode.id, title: "Mira Quell × Rafe Calloway" });
    expect(JSON.stringify(list)).not.toContain(userIdOf(creator));

    const unblock = await api.unblock(episode.id, spectator);
    expect(unblock.status).toBe(200);
    expect(await unblock.json()).toEqual({ episode_id: episode.id, blocked: false });
    expect(await feedIds(spectator)).toContain(episode.id);
    expect(await listBlocks(t.db, userIdOf(spectator))).toEqual([]);
  });

  it("also hides that character's other episodes, without revealing who made them", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      scriptedModel([episodeJson()]);
      ids.push((await (await api.createEpisode({ character_id: character.id, partner_id: "house-dex" }, creator)).json()).id);
    }
    const spectator = newUserCookie();
    const body = await (await api.block(ids[0], spectator)).json();
    expect(JSON.stringify(body)).not.toContain(userIdOf(creator));
    expect(await feedIds(spectator)).toEqual([]);
  });

  it("is idempotent: a repeat block is 200 and keeps one row", async () => {
    const { episode } = await setupEpisode();
    const spectator = newUserCookie();
    expect((await api.block(episode.id, spectator)).status).toBe(201);
    expect((await api.block(episode.id, spectator)).status).toBe(200);
    expect(await t.count("blocks")).toBe(1);
  });

  it("returns 422 when there is nobody to block (your own date with a house character)", async () => {
    const { creator, episode } = await setupEpisode();
    const res = await api.block(episode.id, creator);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("nothing_to_block");
    expect(await t.count("blocks")).toBe(0);
  });

  it("returns 404 for an unknown episode, on block and on unblock", async () => {
    expect((await api.block("missing", newUserCookie())).status).toBe(404);
    expect((await api.unblock("missing", newUserCookie())).status).toBe(404);
  });

  it("lets a creator block the other creator of a blind date, and they are never paired again either way", async () => {
    const { host, partner, episode, hostCharacter, partnerCharacter } = await setupPairedEpisode();
    expect((await api.block(episode.id, partner)).status).toBe(201);
    expect(await t.count("blocks")).toBe(1);

    // The host asks for another blind date: the only other OC belongs to someone who blocked them.
    scriptedModel([episodeJson()]);
    const again = await (await api.createEpisode({ character_id: hostCharacter.id, blind: true }, host)).json();
    expect(again.characters[1].house).toBe(true);

    // And the blocker's own blind dates skip the host too.
    scriptedModel([episodeJson()]);
    const theirs = await (await api.createEpisode({ character_id: partnerCharacter.id, blind: true }, partner)).json();
    expect(theirs.characters[1].house).toBe(true);

    // Once unblocked, they can be matched again.
    expect((await api.unblock(episode.id, partner)).status).toBe(200);
    scriptedModel([episodeJson()]);
    const matched = await (await api.createEpisode({ character_id: hostCharacter.id, blind: true }, host)).json();
    expect(matched.characters[1]).toEqual({ id: partnerCharacter.id, name: "Otto Fenn", house: false, hue: null });
  });

  it("keeps the blocked character out of the blocker's feed, and the blocked creator isn't told", async () => {
    const { host, partner, episode, hostCharacter, partnerCharacter } = await setupPairedEpisode();
    const stranger = await setupEpisode(); // an unrelated creator's house date
    await api.block(episode.id, partner);

    const houseDate = async (characterId: string, cookie: string) => {
      scriptedModel([episodeJson()]);
      const res = await api.createEpisode({ character_id: characterId, partner_id: "house-juniper" }, cookie);
      return (await res.json()).id as string;
    };
    const hostDate = await houseDate(hostCharacter.id, host); // the blocked host's character, again
    const partnerDate = await houseDate(partnerCharacter.id, partner); // the blocker's own character

    expect(await feedIds(partner)).not.toContain(hostDate); // the blocker no longer sees that character
    expect(await feedIds(partner)).toEqual(expect.arrayContaining([partnerDate, stranger.episode.id]));
    // The blocked host's feed is unchanged: nothing disappears that would tell them they were blocked.
    expect(await feedIds(host)).toEqual(expect.arrayContaining([episode.id, partnerDate, hostDate, stranger.episode.id]));
    const bystander = await feedIds(newUserCookie());
    expect(bystander).toEqual(expect.arrayContaining([hostDate, partnerDate, episode.id]));
  });

  it("never links a creator's other characters, so a block can't unmask an anonymous episode", async () => {
    // Alice makes two characters. X (Ivo) stays anonymous; on Y (Mira) she reveals her name.
    const alice = await named(newUserCookie(), "Alice Fern");
    const ivo = await (await api.createCharacter(validCharacter({ name: "Ivo Lark" }), alice)).json();
    const mira = await (await api.createCharacter(validCharacter(), alice)).json();
    const houseDate = async (characterId: string) => {
      scriptedModel([episodeJson()]);
      return (await (await api.createEpisode({ character_id: characterId, partner_id: "house-dex" }, alice)).json()).id;
    };
    const x = await houseDate(ivo.id);
    const y = await houseDate(mira.id);
    await api.consent(y, alice);
    expect((await (await api.getEpisode(y)).json()).creators).toEqual([{ character_id: mira.id, name: "Alice Fern" }]);

    // A spectator blocks X. Nothing they can see about Y may change.
    const spectator = newUserCookie();
    const yBefore = await (await api.getEpisode(y, spectator)).json();
    expect((await api.block(x, spectator)).status).toBe(201);
    const yAfter = await (await api.getEpisode(y, spectator)).json();
    expect(yAfter).toEqual(yBefore);
    expect(yAfter.blocked).toBe(false);
    expect(await feedIds(spectator)).toContain(y);
    expect(await feedIds(spectator)).not.toContain(x);
    // Blocking Y next is a fresh block (201), not "already blocked" (200), which would link Y to X.
    expect((await api.block(y, spectator)).status).toBe(201);
    expect((await api.block(y, spectator)).status).toBe(200);
  });

  it("never matches a blocked creator on a blind date (blocks are respected at match time)", async () => {
    // With async generation the match is settled before any model runs, so the guard is at match time:
    // a blocked creator is simply never picked. The partner blocks the host, then the host blinds again.
    const { host, partner, episode, hostCharacter, partnerCharacter } = await setupPairedEpisode();
    expect((await api.block(episode.id, partner)).status).toBe(201);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: hostCharacter.id, blind: true }, host);
    expect(res.status).toBe(200); // matched to a house character, never the blocked partner
    const ids = ((await res.json()).characters as { id: string }[]).map((c) => c.id);
    expect(ids).not.toContain(partnerCharacter.id);
  });
});
