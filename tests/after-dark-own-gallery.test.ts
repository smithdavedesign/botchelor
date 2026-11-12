import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownMedia } from "@/lib/adult/media";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// After Dark's Gallery (app/after-dark/gallery): everything one person made, from every pair and shoot, with names.
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

const [A, B] = [HOUSE_CHARACTERS[0], HOUSE_CHARACTERS[1]];

describe("ownMedia", () => {
  it("lists only this person's own pictures and videos, newest first, with who's in each, and no keyframes or voices", async () => {
    const me = userIdOf(newUserCookie());
    const other = userIdOf(newUserCookie());
    const add = (id: string, owner: string, kind: string, b: string | null, at: string) =>
      t.db.query(
        `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, created_at) values ($1, $2, $3, $4, $5, 'x', 'image/png', 'ready', $6)`,
        [id, owner, A.id, b, kind, at],
      );
    await add("pair-old", me, "scene", B.id, "2026-11-01T00:00:00Z");
    await add("solo-new", me, "baseline", null, "2026-11-02T00:00:00Z");
    await add("a-keyframe", me, "frame", B.id, "2026-11-03T00:00:00Z");
    await add("a-voice", me, "audio", B.id, "2026-11-03T00:00:00Z");
    await add("not-mine", other, "scene", B.id, "2026-11-04T00:00:00Z");

    const items = await ownMedia(t.db, me);
    expect(items.map((m) => m.id)).toEqual(["solo-new", "pair-old"]);
    expect(items[1]).toMatchObject({ character_id: A.id, character_b: B.id, a_name: A.name, b_name: B.name });
    expect(items[0]).toMatchObject({ character_b: null, a_name: A.name, b_name: null });
  });

  it("leaves out a version another was kept over", async () => {
    const me = userIdOf(newUserCookie());
    await t.db.query(
      `insert into adult_images (id, owner_id, character_id, kind, prompt, mime, status) values ('kept', $1, $2, 'scene', 'x', 'image/png', 'ready'), ('old', $1, $2, 'scene', 'x', 'image/png', 'ready')`,
      [me, A.id],
    );
    await t.db.query(`update adult_images set superseded_by = 'kept' where id = 'old'`);
    expect((await ownMedia(t.db, me)).map((m) => m.id)).toEqual(["kept"]);
  });
});
