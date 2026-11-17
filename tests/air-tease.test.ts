// The tease on air (lib/air.ts airEpisode -> lib/after-date-text.ts teaseAfterAir, the 2026-11-14 core plan PR5): when a
// date airs, an opted-in owner's own character texts them it's back, without the ending. Once, and never to a muted thread.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendAfterDateText } from "@/lib/after-date-text";
import { airEpisode } from "@/lib/air";
import { openThread, setCompanionModelForTests, threadIdFor } from "@/lib/companion";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, episodeJson, scriptedModel, scriptOutcome, setupEpisode, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  setCompanionModelForTests({
    async complete() {
      throw new Error("the model must not be called for a tease");
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
});

// Its words: the date's photo that rides with it (lib/date-photo.ts) is a message of its own, tests/date-photo.test.ts.
const teases = async (episodeId: string) =>
  (await t.db.query<{ thread_id: string; text: string }>(`select thread_id, text from companion_messages where action = $1 and via <> 'photo' order by created_at, id`, [`tease:${episodeId}`])).rows;
/** airEpisode fires the tease and moves on: wait for it to land (or not) before looking. */
const settled = async (episodeId: string, expected: number) => {
  for (let i = 0; i < 50 && (await teases(episodeId)).length < expected; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 40));
  return teases(episodeId);
};

/** A person's first date, heard about (the Hear-from tap opts the thread in), then another date for the same character. */
async function optedInWithNextDate(ending: "second_date" | "friends" | "disaster" = "friends") {
  const { creator, character, episode } = await setupEpisode("second_date");
  await t.db.query(`update characters set name = 'Lexi Marlowe' where id = $1`, [character.id]);
  const heard = await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId: episode.id });
  if (!heard.ok) throw new Error(heard.error);
  await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [heard.thread_id]);
  scriptOutcome({ ending });
  scriptedModel([episodeJson()]);
  const next = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_CHARACTERS[1].id }, creator)).json();
  if (!next.id) throw new Error(`next date failed: ${JSON.stringify(next)}`);
  await t.db.query(`update episodes set revealed_at = null, air_after = null where id = $1`, [next.id]);
  return { creator, character, thread: heard.thread_id, next };
}

describe("the tease on air", () => {
  it("fires once when the date airs, to the opted-in thread, without the ending", async () => {
    const { creator, thread, next } = await optedInWithNextDate("disaster");
    expect(await airEpisode(t.db, next.id, userIdOf(creator))).not.toBeNull();
    const rows = await settled(next.id, 2);
    expect(rows.map((r) => r.text)).toEqual([`Back from the date with ${HOUSE_CHARACTERS[1].name.split(" ")[0]}.`, "Come see how it went."]);
    expect(rows.every((r) => r.thread_id === thread)).toBe(true);
    expect(rows.map((r) => r.text).join(" ")).not.toMatch(/disaster|badly|friends|second date/i);
    // Aired once: a second air is refused, and the tag keeps the text to one.
    expect(await airEpisode(t.db, next.id, userIdOf(creator))).toBeNull();
    expect((await settled(next.id, 2)).length).toBe(2);
    // The owner was told once about the tease (plus once for the Hear-from text).
    const kinds = (await t.db.query<{ kind: string }>(`select kind from notifications where user_id = $1 and kind = 'character_texted_you'`, [userIdOf(creator)])).rows;
    expect(kinds).toHaveLength(2);
  });

  it("a life date the house booked (lib/character-life.ts) tells what happened in the tease's place", async () => {
    const { creator, thread, next } = await optedInWithNextDate("friends");
    await t.db.query(`update episodes set setup = jsonb_set(setup, '{met_via}', '"life"') where id = $1`, [next.id]);
    expect(await airEpisode(t.db, next.id, userIdOf(creator))).not.toBeNull();
    // Its words (the photo that rides with it, lib/date-photo.ts, is a message of its own: tests/character-life.test.ts).
    const life = async () => (await t.db.query<{ thread_id: string; text: string }>(`select thread_id, text from companion_messages where action = $1 and via <> 'photo' order by created_at, id`, [`life:${next.id}`])).rows;
    for (let i = 0; i < 50 && (await life()).length < 3; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 40));
    const rows = await life();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.thread_id === thread)).toBe(true);
    expect(rows[0].text).toMatch(/^I went out with .* while you were gone\. The house set it up\.$/);
    expect(rows[1].text).toMatch(/[Ff]riends is where it lands/);
    expect(await teases(next.id)).toEqual([]);
  });

  it("stays quiet for whoever aired it, and for a thread that never opted in", async () => {
    const { creator, next } = await optedInWithNextDate("friends");
    expect(await airEpisode(t.db, next.id, userIdOf(creator), { airedBy: userIdOf(creator) })).not.toBeNull();
    expect(await settled(next.id, 1)).toEqual([]);

    // Another person whose thread was opened from Talk (muted by default): their date airs, their character says nothing.
    const { creator: other, character: theirs, episode } = await setupEpisode("second_date");
    await t.db.query(`update characters set name = 'Teo Varga' where id = $1`, [theirs.id]);
    await openThread(t.db, userIdOf(other), theirs.id, new Date(), { opener: false });
    expect(await threadIdFor(t.db, userIdOf(other), theirs.id)).not.toBeNull();
    await t.db.query(`update episodes set revealed_at = null, air_after = null where id = $1`, [episode.id]);
    expect(await airEpisode(t.db, episode.id, userIdOf(other))).not.toBeNull();
    expect(await settled(episode.id, 1)).toEqual([]);
  });
});
