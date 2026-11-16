// A character someone made is credited to them by their opt-in creator name on an aired public date, so the clips made
// from it can keep the casting invite's promise of credit on Botchelor's socials (#1699): lib/game.ts CharacterRef.credit,
// scripts/clips/post-kit.mjs creditLines (the daily clip) and episode-cut.mjs cutCaption (the hand-edited cuts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEpisodeView } from "@/lib/game";
import { cutCaption } from "../scripts/clips/episode-cut.mjs";
import { creditLines, postCaption } from "../scripts/clips/post-kit.mjs";
import { setupEpisode, startTestDb, userIdOf } from "./helpers";

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

async function airedWithCredit() {
  const { creator, character, episode } = await setupEpisode("friends");
  const owner = userIdOf(creator);
  await t.db.query(`insert into creator_profiles (user_id, handle, display_name) values ($1, 'wren_writes', 'Wren Writes')`, [owner]);
  await t.db.query(`update episodes set revealed_at = now(), visibility = 'public' where id = $1`, [episode.id]);
  return { owner, character, episode };
}

const mine = (view: Awaited<ReturnType<typeof getEpisodeView>>, id: string) => view?.characters.find((c) => c.id === id);

describe("the episode view credits a person's character to its creator name", () => {
  it("on an aired public date, for anyone reading it, and never the house character", async () => {
    const { character, episode } = await airedWithCredit();
    const view = await getEpisodeView(t.db, episode.id, null);
    expect(mine(view, character.id)?.credit).toEqual({ handle: "wren_writes", name: "Wren Writes" });
    const house = view?.characters.find((c) => c.id !== character.id);
    expect(house?.house).toBe(true);
    expect(house && "credit" in house).toBe(false);
  });

  it("not before the date airs, not on a private date, not for a private character, not when the profile is hidden", async () => {
    const { owner, character, episode } = await airedWithCredit();
    const credited = async () => mine(await getEpisodeView(t.db, episode.id, null), character.id)?.credit ?? null;

    await t.db.query(`update creator_profiles set hidden = true where user_id = $1`, [owner]);
    expect(await credited()).toBeNull();
    await t.db.query(`update creator_profiles set hidden = false where user_id = $1`, [owner]);

    await t.db.query(`update characters set visibility = 'private' where id = $1`, [character.id]);
    // The owner still reads their own date: no credit for a private character all the same.
    expect(mine(await getEpisodeView(t.db, episode.id, owner), character.id)?.credit ?? null).toBeNull();
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [character.id]);

    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [episode.id]);
    expect(mine(await getEpisodeView(t.db, episode.id, owner), character.id)?.credit ?? null).toBeNull();
    await t.db.query(`update episodes set visibility = 'public', revealed_at = null where id = $1`, [episode.id]);
    expect(mine(await getEpisodeView(t.db, episode.id, owner), character.id)?.credit ?? null).toBeNull();

    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
    expect(await credited()).toEqual({ handle: "wren_writes", name: "Wren Writes" });
  });

  it("a creator with no creator name is credited nowhere (the key is left off, so other views are unchanged)", async () => {
    const { character, episode } = await setupEpisode("friends");
    await t.db.query(`update episodes set revealed_at = now(), visibility = 'public' where id = $1`, [episode.id]);
    const c = mine(await getEpisodeView(t.db, episode.id, null), character.id);
    expect(c && "credit" in c).toBe(false);
  });
});

describe("the clips' captions carry the credit", () => {
  const wren = { id: "c1", name: "Zdeslava Hunt", credit: { handle: "wren_writes", name: "Wren Writes" } };
  const house = { id: "house-nell", name: "Nell Abiodun" };

  it("creditLines: one line per credited character, by first name, deduplicated across dates", () => {
    expect(creditLines([wren, house])).toEqual(["Zdeslava is by Wren Writes: botchelor.com/creators/wren_writes"]);
    expect(creditLines([wren, house, wren])).toHaveLength(1);
    expect(creditLines([house])).toEqual([]);
    expect(creditLines(undefined)).toEqual([]);
  });

  it("the daily clip's caption credits after the disclosure, and is unchanged without a credit", () => {
    const e = { id: "e1", characters: [wren, house], transcript: [] };
    const lines = postCaption(e, { hook: "Zdeslava meets Nell." }).split("\n");
    const at = lines.indexOf("Zdeslava is by Wren Writes: botchelor.com/creators/wren_writes");
    expect(at).toBeGreaterThan(lines.findIndex((l) => l.startsWith("Watch the whole date")));
    const plain = postCaption({ id: "e1", characters: [{ ...wren, credit: undefined }, house], transcript: [] }, { hook: "Zdeslava meets Nell." });
    expect(plain).not.toContain("creators/");
  });

  it("an episode cut credits every credited character across its dates, once each", () => {
    const edl = { n: 7, name: "Test", episodes: ["e1", "e2"], hook: "Hook.", question: "Q?", segments: [] };
    const eps = [
      { id: "e1", characters: [wren, house] },
      { id: "e2", characters: [house, wren] },
    ];
    const caption = cutCaption(edl, eps);
    expect(caption.match(/creators\/wren_writes/g)).toHaveLength(1);
    expect(caption.indexOf("Zdeslava is by Wren Writes")).toBeGreaterThan(caption.indexOf("AI-generated fiction"));
  });
});
