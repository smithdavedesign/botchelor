import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as portraitsPost } from "@/app/api/admin/showcase/portraits/route";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { lookFor, portraitBatch, portraitTargets } from "@/lib/agent-portraits";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { loopTargets } from "@/lib/showcase-loops";
import { adminRemoveCharacters } from "@/lib/account";
import { listShowcase, publish, saveCreatorProfile } from "@/lib/showcase";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, setupEpisode, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// The show's own portraits for public agent-made characters with none (lib/agent-portraits.ts; David, 2026-10-29),
// and the house cast's living portraits with the rest of the show's characters (lib/showcase-loops.ts). Venice and the
// PG check faked.

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
  vi.stubEnv("ADULT_MODE", "1");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setMediaFetchForTests(null);
  setModerationFetchForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Venice draws a picture (what it was asked is kept); the PG check says `clothing`. */
function fakes(clothing = "CLOTHED") {
  const asked: string[] = [];
  setMediaFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    asked.push(String(JSON.parse(String(init?.body ?? "{}")).prompt ?? ""));
    return Response.json({ images: [PNG.toString("base64")] });
  });
  setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing, age: "ADULTS" }) } }] }));
  return asked;
}

async function agent(name: string, o: { appearance?: string; bio?: string; pronouns?: string; visibility?: string } = {}) {
  const id = (await (await api.createCharacter(validCharacter({ name, ...(o.bio ? { bio: o.bio } : {}), ...(o.pronouns ? { pronouns: o.pronouns } : {}) }), newUserCookie())).json()).id as string;
  await t.db.query(`update characters set created_via = 'mcp', visibility = $2, appearance = $3 where id = $1`, [id, o.visibility ?? "public", o.appearance ?? null]);
  return id;
}

describe("the show's own portraits", () => {
  it("draw from their written look, or else their age, pronouns and bio, never their name", () => {
    const base = { id: "x", age: 33, pronouns: "he/him", look: { appearance: null, hue: null, portrait: null } };
    expect(lookFor({ ...base, bio: "Pilot who flies rescue missions in remote northern terrain." })).toBe(
      "a man of 33, a pilot who flies rescue missions in remote northern terrain, in everyday clothes that suit it",
    );
    expect(lookFor({ ...base, pronouns: "she/her", bio: "An astronomer on city rooftops." })).toBe("a woman of 33, an astronomer on city rooftops, in everyday clothes that suit it");
    expect(lookFor({ ...base, look: { ...base.look, appearance: "tall, freckled, short red hair, green rain jacket" }, bio: "Pilot." })).toBe("tall, freckled, short red hair, green rain jacket");
    expect(lookFor({ ...base, bio: "" })).toBeNull();
  });

  it("go to public agent-made characters with none, PG-checked, approved, each tried once; then they can come to life", async () => {
    const jax = await agent("Jax Holloway", { bio: "Pilot who flies rescue missions in remote northern terrain.", pronouns: "he/him" });
    const tess = await agent("Tess Marlow", { appearance: "a woman with curly black hair and a denim jacket" });
    await agent("Hidden Hal", { visibility: "private" });
    // Taken off the show: never drawn, never brought to life.
    const gone = await agent("Gone Gil", { bio: "Retired lighthouse keeper." });
    await t.db.query(`update characters set owner_id = 'deleted' where id = $1`, [gone]);
    expect((await portraitTargets(t.db)).sort()).toEqual([jax, tess].sort());
    const asked = fakes();
    const r = await portraitBatch(t.db);
    expect([r.results.every((x) => x.ok), r.left]).toEqual([true, 0]);
    // Safe mode, from their look or bio, never their name.
    expect(asked.some((p) => p.includes("a pilot who flies rescue missions"))).toBe(true);
    expect(asked.some((p) => p.includes("curly black hair"))).toBe(true);
    expect(asked.every((p) => !/Jax|Tess|Holloway|Marlow/.test(p))).toBe(true);
    const rows = (await t.db.query<{ character_id: string; review_status: string; content_rating: string }>(`select character_id, review_status, content_rating from character_assets where kind = 'portrait' and prompt_version = 'show-portrait-v1'`)).rows;
    expect(rows.map((x) => [x.review_status, x.content_rating])).toEqual([["approved", "pg"], ["approved", "pg"]]);
    // Their living portraits are next in line, with the house cast's.
    const house = HOUSE_CHARACTERS[0].id;
    await t.db.query(`insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ('house-p', $1, 'portrait', 'generated', 'm', '/cast/house-juniper-v3.webp', 'approved', 'pg') on conflict (id) do nothing`, [house]);
    const owner = userIdOf(newUserCookie());
    const loops = await loopTargets(t.db, owner, BASE_URL, { agents: true });
    expect(loops.filter((x) => x.source === "portrait").map((x) => x.character_id)).toEqual(expect.arrayContaining([jax, tess, house]));
    await t.db.query(`insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ('gone-p', $1, 'portrait', 'generated', 'm', '/cast/house-juniper-v3.webp', 'approved', 'pg')`, [gone]);
    expect((await loopTargets(t.db, owner, BASE_URL, { agents: true })).map((x) => x.character_id)).not.toContain(gone);
  });

  it("keep nothing the PG check doesn't call PG, and leave that one for its creator", async () => {
    const jax = await agent("Jax Holloway", { bio: "Pilot who flies rescue missions.", pronouns: "he/him" });
    fakes("REVEALING");
    const r = await portraitBatch(t.db);
    expect(r.results).toEqual([{ character_id: jax, ok: false, reason: "the PG check rated it suggestive", again: false }]);
    expect((await t.db.query(`select 1 from character_assets where character_id = $1`, [jax])).rows).toHaveLength(0);
    expect(await portraitTargets(t.db)).toEqual([]);
  });

  it("never leave a character taken off the show on the showcase", async () => {
    // One that's been on a date, so it's kept as a sheet for that date rather than deleted.
    const { creator: raw, character } = await setupEpisode();
    const me = userIdOf(raw);
    const id = character.id as string;
    await saveCreatorProfile(t.db, me, { handle: "quinn", display_name: "Quinn" });
    await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating) values ('q-1', $1, $2, 'p', 'image/png', $3, 'pg')`, [me, id, PNG]);
    const r = await publish(t.db, me, { source: "pg", media_id: "q-1" });
    if (!r.ok) throw new Error(r.message);
    const anyone = { id: null, admin: false, ratings: ["pg" as const] };
    expect((await listShowcase(t.db, anyone, {})).posts).toHaveLength(1);
    expect(await adminRemoveCharacters(t.db, [id])).toMatchObject([{ outcome: "anonymized" }]);
    expect((await listShowcase(t.db, anyone, {})).posts).toHaveLength(0);
    expect((await t.db.query(`select 1 from showcase_posts where character_id = $1 and status = 'live'`, [id])).rows).toHaveLength(0);
  });

  it("is an admin's alone", async () => {
    const raw = newUserCookie();
    const me = userIdOf(raw);
    const post = () => portraitsPost(new Request(`${BASE_URL}/x`, { method: "POST", headers: { cookie: signedInCookie(me) } }));
    expect((await post()).status).toBe(403);
    await claimAdmin(t.db, me);
    expect(await (await post()).json()).toMatchObject({ ok: true, results: [], left: 0 });
  });
});
