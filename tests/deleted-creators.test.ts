import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteAccount } from "@/lib/account";
import { listCast } from "@/lib/mechanics";
import { DELETED_OWNER } from "@/lib/rules";
import {
  api,
  episodeJson,
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

/** A creator whose character went on a date (so it's kept after deletion) and was open to dates, then deleted. */
async function deletedCreatorsCharacter(): Promise<string> {
  const { creator, character } = await setupEpisode("friends");
  await t.db.query("update characters set open_to_dates = true where id = $1", [character.id]);
  await deleteAccount(t.db, userIdOf(creator));
  return character.id as string;
}

describe("a deleted creator's character, kept only because a shared episode shows it", () => {
  it("is closed to dates and left out of the cast", async () => {
    const id = await deletedCreatorsCharacter();
    const { rows } = await t.db.query<{ owner_id: string; open_to_dates: boolean }>(
      "select owner_id, open_to_dates from characters where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ owner_id: DELETED_OWNER, open_to_dates: false });
    expect((await listCast(t.db)).map((c) => c.id)).not.toContain(id);
  });

  it("is never blind-matched (with nobody else around, a blind date gets a house character)", async () => {
    const id = await deletedCreatorsCharacter();
    const cookie = newUserCookie();
    const mine = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), cookie)).json();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: mine.id, blind: true }, cookie);
    expect(res.status).toBe(200);
    const episode = await res.json();
    const partner = episode.characters.find((c: { id: string }) => c.id !== mine.id);
    expect(partner.id).not.toBe(id);
    expect(partner.house).toBe(true);
  });
});
