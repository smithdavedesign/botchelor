import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as postSecondDate } from "@/app/api/episodes/[id]/second-date/route";
import { setAfterglowEnabledForTests } from "@/lib/afterglow";
import type { SideOutcome } from "@/lib/engine";
import { dateLabel } from "@/lib/rules";
import { talkFor } from "@/lib/talk";
import { ensureSchema } from "@/lib/db";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const text = (t: string) => JSON.stringify({ text: t });
/** One date in the harness (conversation off): the recap, then `texts` morning-after texts. */
// Varied texts: identical openers would trip the text critic (lib/text-critic.ts) and spend scripted outputs on revisions.
const MORNING_TEXTS = [
  "Still laughing about the goose.", "Okay but who brings soup to a picnic?", "My shoes have recovered. Mostly.",
  "You never told me how the lighthouse story ends.", "Found a pebble in my pocket. Yours?", "Sleep well? I didn't, in a good way.",
  "That waiter deserves a medal.", "Be honest: did you plan the rain?", "My cat is judging me for smiling at my phone.",
  "Ten out of ten, would get soaked again.", "Is it weird that I miss the umbrella?", "Coffee tasted better than usual today.",
  "I told my sister about you. She has questions.", "Still thinking about your accordion theory.", "Morning, troublemaker.", "Last one, I promise.",
];
const scriptDate = (texts = 4) => scriptedModel([episodeJson(), ...Array.from({ length: texts }, (_, i) => text(MORNING_TEXTS[i % MORNING_TEXTS.length]))]);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const planNext = async (id: string, cookie: string) => {
  const res = await postSecondDate(
    new Request(`${BASE_URL}/api/episodes/${id}/second-date`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" }),
    params(id),
  );
  return { status: res.status, body: (await res.json()) as Any };
};

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  setAfterglowEnabledForTests(true);
});
afterAll(async () => {
  setAfterglowEnabledForTests(false);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

describe("which date it is", () => {
  it("labels: second, third ... tenth, then 11th, 12th, 21st, 22nd, 23rd", () => {
    expect([2, 3, 4, 10].map(dateLabel)).toEqual(["Second date", "Third date", "Fourth date", "Tenth date"]);
    expect([11, 12, 13, 21, 22, 23, 101].map(dateLabel)).toEqual(["11th date", "12th date", "13th date", "21st date", "22nd date", "23rd date", "101st date"]);
  });

  it("a date that follows a second date is their third, in the episode, the feed and the next plan", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), creator)).json();
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptDate();
    const first = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();

    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptDate();
    const second = await planNext(first.id, creator);
    expect(second.status).toBe(200);
    expect((await (await api.getEpisode(second.body.id, creator)).json()).date_number).toBe(2);

    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptDate();
    const third = await planNext(second.body.id, creator);
    expect(third.status).toBe(200);
    const view = await (await api.getEpisode(third.body.id, creator)).json();
    expect(view.followup_of).toBe(second.body.id);
    expect(view.date_number).toBe(3);
  });

  it("the schema backfills follow-ups booked before the number was stored", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
      scriptDate();
      const res = i === 0
        ? await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json()
        : (await planNext(ids[i - 1], creator)).body;
      ids.push(res.id);
    }
    await t.db.query(`update episodes set setup = setup - 'date_number'`);
    await ensureSchema(t.db);
    const { rows } = await t.db.query<{ id: string; n: number | null }>(`select id, (setup->>'date_number')::int as n from episodes`);
    const n = new Map(rows.map((r) => [r.id, r.n]));
    expect(ids.map((id) => n.get(id))).toEqual([null, 2, 3]);
  });
});

describe("how much they talk", () => {
  it("the longer setting wins, never below standard; a format's own length stays; marathon only on both keys", () => {
    expect(talkFor([null, null], false)).toEqual({ level: "standard", date: 12, texts: 4 });
    expect(talkFor(["longer", null], false)).toMatchObject({ level: "longer", date: 16, texts: 6 });
    expect(talkFor(["longer", "long"], false)).toMatchObject({ level: "long", date: 20, texts: 8 });
    expect(talkFor(["marathon", null], false)).toMatchObject({ level: "long" });
    expect(talkFor(["marathon", null], true)).toMatchObject({ level: "marathon", date: 28, texts: 16 });
    expect(talkFor(["long", null], false, 6)).toMatchObject({ date: 6, texts: 8 }); // the speed date stays short
  });

  it("an owner's setting lengthens the texts after the date; marathon needs their own key", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    expect((await api.editCharacter(character.id, { talk: "longer" }, creator)).status).toBe(200);

    scriptOutcome({ ending: "friends", sides: [side(true), side(false)] });
    scriptDate(6);
    const date = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    const row = (await t.db.query<{ afterglow: unknown[] }>(`select afterglow from episodes where id = $1`, [date.id])).rows[0];
    expect(row.afterglow).toHaveLength(6);

    const refused = await api.editCharacter(character.id, { talk: "marathon" }, creator);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("needs_own_key");
    const owner = (await t.db.query<{ owner_id: string }>(`select owner_id from characters where id = $1`, [character.id])).rows[0].owner_id;
    await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, $2, $3)`, [owner, `sub-${owner}`, "owner@example.test"]);
    await t.db.query(`insert into user_keys (user_id, provider, kind, ciphertext, nonce, last4) values ($1, 'openai', 'text', 'x', 'y', 'abcd')`, [owner]);
    expect((await api.editCharacter(character.id, { talk: "marathon" }, creator)).status).toBe(200);
    expect((await api.editCharacter(character.id, { talk: "standard" }, creator)).status).toBe(200);
    expect((await t.db.query(`select talk from characters where id = $1`, [character.id])).rows[0].talk).toBeNull();
  });
});
