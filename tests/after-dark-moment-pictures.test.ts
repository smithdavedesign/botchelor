import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stagePicture } from "@/app/after-dark/[a]/[b]/useMomentPictures";
import { setAdultSwitch } from "@/lib/adult/characters";
import { momentPictures } from "@/lib/adult/scene-match";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// Pictures that feel instant (docs/PRDs/theater-immersion.md #5): a moment being drawn is on the stage at once, as the
// closest picture the pair already has, and its own when it lands. No live calls.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  setSeasonCastForTests([]);
});

async function pair() {
  const cookie = newUserCookie();
  const owner = userIdOf(cookie);
  const a = ((await (await api.createCharacter(validCharacter({ name: "Mara Quell", pronouns: "she/her", age: 29 }), cookie)).json()) as { id: string }).id;
  const b = ((await (await api.createCharacter(validCharacter({ name: "Dex Orin", pronouns: "he/him", age: 31 }), cookie)).json()) as { id: string }).id;
  await setAdultSwitch(t.db, owner, a, true);
  await setAdultSwitch(t.db, owner, b, true);
  const [lo, hi] = [a, b].sort();
  await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, lines, stage, place) values ($1, $2, $3, $4, '[]'::jsonb, 4, 'her bedroom')`, [`sc-${lo}`, owner, lo, hi]);
  return { owner, lo, hi };
}
/** A pair shoot picture of `act`, in `place`, in the pair's gallery. */
async function pairPicture(owner: string, lo: string, hi: string, act: string, place: string, id: string) {
  await t.db.query(`insert into adult_studio_shoots (id, owner_id, character_id, partner_id, kind, choices, status) values ($1, $2, $3, $4, 'pair', $5::jsonb, 'ready')`, [`sh-${id}`, owner, lo, hi, JSON.stringify({ act })]);
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, shoot_id, scene_place) values ($1, $2, $3, $4, 'scene', 'p', 'image/png', $5, 'ready', $6, $7)`,
    [id, owner, lo, hi, Buffer.from([137, 80, 78, 71]), `sh-${id}`, place],
  );
}
async function beat(owner: string, lo: string, hi: string, id: string, line: number, act: string, status: string, pictureId: string | null = null) {
  await t.db.query(
    `insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, place, status, picture_id) values ($1, $2, $9, $3, $4, 1, $5, $6, 'position', 4, 'her bedroom', $7, $8)`,
    [id, owner, lo, hi, line, act, status, pictureId, `sc-${lo}`],
  );
}

describe("a moment's picture on the stage", () => {
  it("is the closest picture they have of that moment while it's drawn, and its own once it's drawn", async () => {
    const { owner, lo, hi } = await pair();
    await pairPicture(owner, lo, hi, "on_top", "her bedroom", "old-on-top");
    await pairPicture(owner, lo, hi, "kiss", "her bedroom", "old-kiss");
    await beat(owner, lo, hi, "b1", 3, "on_top", "drawing");
    await beat(owner, lo, hi, "b0", 1, "kiss", "drawn", "new-kiss");
    await beat(owner, lo, hi, "b2", 5, "behind", "offered");
    const moments = await momentPictures(t.db, owner, lo, hi);
    // Offered ones aren't being pictured: left out. The drawing one stands in with the same act's picture.
    expect(moments).toEqual([
      { id: "b0", line: 1, status: "drawn", picture_id: "new-kiss", stand_in: null },
      { id: "b1", line: 3, status: "drawing", picture_id: null, stand_in: "old-on-top" },
    ]);
    // On the stage: from its line, for a while; the latest one at or before the line wins.
    expect(stagePicture(moments, 0)).toBeNull();
    expect(stagePicture(moments, 1)).toEqual({ id: "new-kiss", drawing: false });
    expect(stagePicture(moments, 4)).toEqual({ id: "old-on-top", drawing: true });
    expect(stagePicture(moments, 3 + 9)).toBeNull();
  });

  it("is nothing for a pair that isn't theirs, or a scene with no moments", async () => {
    const { owner, lo, hi } = await pair();
    expect(await momentPictures(t.db, owner, lo, hi)).toEqual([]);
    expect(await momentPictures(t.db, userIdOf(newUserCookie()), lo, hi)).toEqual([]);
  });
});
