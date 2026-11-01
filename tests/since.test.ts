import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listMyCharacters } from "@/lib/game";
import { notify } from "@/lib/notifications";
import { ENDING_LABELS } from "@/lib/rules";
import { sinceYouWereHere } from "@/lib/since";
import { api, HOUSE_PARTNER_ID, newUserCookie, setupEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

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

const since = async (cookie: string) => {
  const userId = userIdOf(cookie);
  return sinceYouWereHere(t.db, userId, await listMyCharacters(t.db, userId));
};
const partnerName = async () => (await t.db.query<{ name: string }>(`select name from characters where id = $1`, [HOUSE_PARTNER_ID])).rows[0].name;

describe("Since you were here (J4)", () => {
  it("is empty without characters", async () => {
    expect(await since(newUserCookie())).toEqual([]);
  });

  it("a character with no dates yet: send them on one", async () => {
    const cookie = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), cookie)).json();
    expect(await since(cookie)).toEqual([
      { character: expect.objectContaining({ id: character.id }), news: "No dates yet", action: "Send on a date", href: `/create?character=${character.id}`, at: null },
    ]);
  });

  it("follows the newest date: being filmed, ready to watch, then how it ended", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const partner = await partnerName();
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [episode.id]);
    expect((await since(creator))[0]).toMatchObject({ news: `On a date with ${partner} right now`, action: "Watch", href: `/episodes/${episode.id}?play=1` });

    await t.db.query(`update episodes set status = 'ready', revealed_at = null where id = $1`, [episode.id]);
    expect((await since(creator))[0]).toMatchObject({ news: `Their date with ${partner} is ready`, href: `/episodes/${episode.id}` });

    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
    const [row] = await since(creator);
    expect(row.news).toBe(`Last date, with ${partner}: ${ENDING_LABELS.friends}`);
    expect(row.action).toBe("Another date");
    expect(row.at).toEqual(expect.any(String));
  });

  it("unread texts come first, and the character with the newest news leads", async () => {
    const { creator, character } = await setupEpisode("friends");
    const other = await (await api.createCharacter(validCharacter({ name: "Wren Halloway" }), creator)).json();
    await notify(t.db, userIdOf(creator), { kind: "texted", title: "💬 They texted", link: `/messages/${character.id}/${HOUSE_PARTNER_ID}` });
    await notify(t.db, userIdOf(creator), { kind: "texted", title: "💬 They texted again", link: `/messages/${character.id}/${HOUSE_PARTNER_ID}` });
    const rows = await since(creator);
    expect(rows.map((r) => r.character.id)).toEqual([character.id, other.id]);
    expect(rows[0]).toMatchObject({ news: "2 new texts", action: "Read", href: `/matches?character=${character.id}` });

    // Read: back to the date itself.
    await t.db.query(`update notifications set read_at = now()`);
    expect((await since(creator))[0].news).toMatch(/is ready|Last date/);
  });

  it("a new match reads as one", async () => {
    const { creator, character } = await setupEpisode("friends");
    await notify(t.db, userIdOf(creator), { kind: "matched", title: "💘 A match", link: `/messages/${character.id}/${HOUSE_PARTNER_ID}` });
    expect((await since(creator))[0]).toMatchObject({ news: "1 new match", action: "See who" });
  });
});
