import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendAfterDateText } from "@/lib/after-date-text";
import { setNudge } from "@/lib/between-dates";
import { sendMessage, setCompanionModelForTests } from "@/lib/companion";
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
afterEach(() => {
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
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

  it("a date the house booked while they were away, aired, says so (lib/character-life.ts)", async () => {
    const { creator, episode } = await setupEpisode("second_date");
    const partner = await partnerName();
    await t.db.query(`update episodes set setup = jsonb_set(setup, '{met_via}', '"life"'), revealed_at = now() where id = $1`, [episode.id]);
    expect((await since(creator))[0]).toMatchObject({ news: `Mira went on a date with ${partner} while you were away`, action: "See how it went", href: `/episodes/${episode.id}` });
    // Not aired yet: it's a date ready to watch, like any other.
    await t.db.query(`update episodes set revealed_at = null where id = $1`, [episode.id]);
    expect((await since(creator))[0].news).toBe(`Their date with ${partner} is ready`);
  });

  it("a new match reads as one", async () => {
    const { creator, character } = await setupEpisode("friends");
    await notify(t.db, userIdOf(creator), { kind: "matched", title: "💘 A match", link: `/messages/${character.id}/${HOUSE_PARTNER_ID}` });
    expect((await since(creator))[0]).toMatchObject({ news: "1 new match", action: "See who" });
  });
});

describe("Since you were here: your own character's texts (the 2026-11-14 core plan, PR5)", () => {
  it("'{name} texted you' while the text is unread, then 'waiting on your advice' until a reply or a nudge, then the date again", async () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-for-since");
    setCompanionModelForTests({
      async complete(messages) {
        if (String(messages[0]?.content ?? "").startsWith("You check one message")) return '{"risk": false}';
        return JSON.stringify({ messages: ["Noted."] });
      },
    });
    const { creator, character, episode } = await setupEpisode("second_date");
    const me = userIdOf(creator);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
    const first = character.name.split(" ")[0];
    // Hear from them: the text lands and its notice is unread.
    const heard = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id });
    if (!heard.ok) throw new Error(heard.error);
    expect((await since(creator))[0]).toMatchObject({ news: `${first} texted you`, action: "Read", href: `/companion/${heard.thread_id}`, at: expect.any(String) });
    // Read (the notice cleared), no answer yet: the character is waiting.
    await t.db.query(`update notifications set read_at = now() where user_id = $1 and kind = 'character_texted_you'`, [me]);
    expect((await since(creator))[0]).toMatchObject({ news: `${first} is waiting on your advice`, action: "Reply", href: `/companion/${heard.thread_id}` });
    // A nudge for the next date answers it: back to the date's news.
    const nudged = await setNudge(t.db, me, character.id, HOUSE_PARTNER_ID, "Ask about the radios.");
    expect(nudged.ok).toBe(true);
    expect((await since(creator))[0].news).toBe(`Last date, with ${await partnerName()}: ${ENDING_LABELS.second_date}`);
  });

  it("a reply in the thread also counts as answering, and a text older than the wait drops the line", async () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-for-since");
    setCompanionModelForTests({
      async complete(messages) {
        if (String(messages[0]?.content ?? "").startsWith("You check one message")) return '{"risk": false}';
        return JSON.stringify({ messages: ["Noted."] });
      },
    });
    const { creator, character, episode } = await setupEpisode("friends");
    const me = userIdOf(creator);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
    const first = character.name.split(" ")[0];
    const heard = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id, now: new Date(Date.now() - 60_000) });
    if (!heard.ok) throw new Error(heard.error);
    await t.db.query(`update notifications set read_at = now() where user_id = $1`, [me]);
    expect((await since(creator))[0].news).toBe(`${first} is waiting on your advice`);
    const replied = await sendMessage(t.db, me, heard.thread_id, "Go for it.");
    expect(replied.ok).toBe(true);
    expect((await since(creator))[0].news).toBe(`Last date, with ${await partnerName()}: ${ENDING_LABELS.friends}`);
    // A text from last week nobody answered is not nagged about.
    await t.db.query(`delete from companion_messages where thread_id = $1 and role = 'user'`, [heard.thread_id]);
    expect((await since(creator))[0].news).toBe(`${first} is waiting on your advice`);
    await t.db.query(`update companion_messages set created_at = now() - interval '8 days' where thread_id = $1`, [heard.thread_id]);
    expect((await since(creator))[0].news).toBe(`Last date, with ${await partnerName()}: ${ENDING_LABELS.friends}`);
  });
});
