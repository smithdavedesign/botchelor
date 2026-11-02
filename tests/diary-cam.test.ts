import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forgetTouchesForTests } from "@/lib/activity";
import { getEpisodeView } from "@/lib/game";
import { showSince } from "@/lib/show-since";
import { api, HOUSE_PARTNER_ID, newUserCookie, setupEpisode, startTestDb, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  forgetTouchesForTests();
});

const HOUSE_LINE = "She insulted my cake and I have never felt more seen.";
const OC_LINE = "I came for a map-reader and left thinking about the candlelight.";

/** The line each character said to camera, as a viewer sees the episode. */
const diaryOf = async (id: string, viewer: string | null) =>
  Object.fromEntries(((await getEpisodeView(t.db, id, viewer))?.diary ?? []).map((d) => [d.character_id, d.line]));

describe("the diary cam", () => {
  it("is nothing before the ending airs, then the house character's take for everyone, and a person's only once the host shares", async () => {
    const { creator, character, episode } = await setupEpisode("friends");
    const spectator = userIdOf(newUserCookie());
    // Before the finale airs: no take for anyone, the creator included.
    expect(await diaryOf(episode.id, spectator)).toEqual({});
    expect(await diaryOf(episode.id, userIdOf(creator))).toEqual({});

    expect((await api.reveal(episode.id, creator)).status).toBe(200);
    const sides = (await getEpisodeView(t.db, episode.id, spectator))!.characters.map((c) => c.id);
    const lineOf = (id: string) => (id === sides[0] ? OC_LINE : HOUSE_LINE);
    // The house character's take is the show's own; the person's character's stays theirs.
    expect(await diaryOf(episode.id, spectator)).toEqual({ [HOUSE_PARTNER_ID]: lineOf(HOUSE_PARTNER_ID) });

    expect((await api.shareConfessionals(episode.id, true, creator)).status).toBe(200);
    expect(await diaryOf(episode.id, spectator)).toEqual({ [HOUSE_PARTNER_ID]: lineOf(HOUSE_PARTNER_ID), [character.id]: lineOf(character.id) });
  });

  it("puts the newest take from a date that aired since your last visit in what happened on the show", async () => {
    await t.db.query(`insert into owner_activity (user_id, last_seen) values ('fan', now() - interval '2 days')`);
    const { creator, episode } = await setupEpisode("friends");
    expect((await showSince(t.db, "fan"))?.diary ?? null).toBeNull();
    expect((await api.reveal(episode.id, creator)).status).toBe(200);
    const diary = (await showSince(t.db, "fan"))!.diary!;
    expect(diary.episode_path).toBe(`/episodes/${episode.id}`);
    expect([OC_LINE, HOUSE_LINE]).toContain(diary.line);
    // Only the house side, as on the episode page.
    const house = (await t.db.query<{ name: string }>(`select name from characters where id = $1`, [HOUSE_PARTNER_ID])).rows[0].name;
    expect(diary.name).toBe(house);
  });
});
