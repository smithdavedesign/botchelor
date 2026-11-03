import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { defaultPortraitsEnabled, ensurePortrait, portraitSweep, setDefaultPortraitsForTests } from "@/lib/default-portraits";
import { setInlineGenerationForTests } from "@/lib/jobs";
import { api, newUserCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// Every character has a headshot (lib/default-portraits.ts; David, 2026-11-03): drawn on creation whoever made it, and
// swept up hourly for those who have none. Venice and the PG check faked.

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
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setDefaultPortraitsForTests(null);
  setInlineGenerationForTests(false);
  setMediaFetchForTests(null);
  setModerationFetchForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fakes(clothing = "CLOTHED") {
  let drawn = 0;
  setMediaFetchForTests(async () => {
    drawn++;
    return Response.json({ images: [PNG.toString("base64")] });
  });
  setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing, age: "ADULTS" }) } }] }));
  return () => drawn;
}

const portraits = async (id: string) => (await t.db.query(`select review_status, content_rating from character_assets where character_id = $1 and kind = 'portrait'`, [id])).rows;
const make = async (o: Parameters<typeof validCharacter>[0] = {}) => (await (await api.createCharacter(validCharacter(o), newUserCookie())).json()).id as string;

describe("a headshot for every character", () => {
  it("is off in tests unless one turns it on", async () => {
    expect(defaultPortraitsEnabled()).toBe(false);
    const drawn = fakes();
    await make();
    expect(drawn()).toBe(0);
    setDefaultPortraitsForTests(true);
    expect(defaultPortraitsEnabled()).toBe(true);
    vi.stubEnv("DEFAULT_PORTRAITS", "0");
    setDefaultPortraitsForTests(null);
    expect(defaultPortraitsEnabled({ DEFAULT_PORTRAITS: "0" })).toBe(false);
  });

  it("is drawn when a character is made, with no looks picked", async () => {
    setDefaultPortraitsForTests(true);
    setInlineGenerationForTests(true);
    const drawn = fakes();
    const id = await make({ name: "Mara Quill" });
    expect(drawn()).toBe(1);
    expect(await portraits(id)).toEqual([{ review_status: "approved", content_rating: "pg" }]);
  });

  it("is drawn for a character whose looks draw is over its cap, from the bio", async () => {
    setDefaultPortraitsForTests(true);
    setInlineGenerationForTests(true);
    vi.stubEnv("LOOKS_PORTRAITS_PER_DAY", "0");
    fakes();
    const id = await make({ extras: { looks: { gender: "woman" } } });
    expect(await portraits(id)).toEqual([{ review_status: "approved", content_rating: "pg" }]);
  });

  it("is never drawn twice, nor for one taken off the show", async () => {
    const drawn = fakes();
    const id = await make();
    const gone = await make();
    await t.db.query(`update characters set owner_id = 'deleted' where id = $1`, [gone]);
    setDefaultPortraitsForTests(true);
    expect(await ensurePortrait(t.db, id)).toBe("show");
    expect(await ensurePortrait(t.db, id)).toBe("has");
    expect(await ensurePortrait(t.db, gone)).toEqual({ failed: "taken off the show" });
    expect(drawn()).toBe(1);
  });

  it("is swept up for whoever has none, private ones too, a few at a time", async () => {
    fakes();
    const ids = [await make({ name: "Ana Pell" }), await make({ name: "Bo Reyes" }), await make({ name: "Cy Dunn" })];
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [ids[0]]);
    setDefaultPortraitsForTests(true);
    const r = await portraitSweep(t.db, 2);
    expect([r.drawn, r.failed, r.left]).toEqual([2, 0, 1]);
    expect((await portraitSweep(t.db, 2)).drawn).toBe(1);
    for (const id of ids) expect(await portraits(id)).toHaveLength(1);
    expect(await portraitSweep(t.db)).toEqual({ drawn: 0, failed: 0, left: 0 });
  });

  it("keeps nothing the PG check doesn't call PG", async () => {
    fakes("REVEALING");
    const id = await make();
    setDefaultPortraitsForTests(true);
    expect(await ensurePortrait(t.db, id)).toEqual({ failed: "the PG check rated it suggestive" });
    expect(await portraits(id)).toEqual([]);
  });
});
