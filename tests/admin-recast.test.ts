import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/recast/route";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setPgStudioFetchForTests } from "@/lib/studio/pg";
import { api, BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// The recast of the show's own agent-made characters (lib/recast.ts, POST /api/admin/recast; David, 2026-11-02). Venice
// and the PG checks faked.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const PW = ["recast", "pw", "tests"].join("-");
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", PW);
  vi.stubEnv("ADULT_MODE", "1");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setMediaFetchForTests(null);
  setModerationFetchForTests(null);
  setPgStudioFetchForTests(null);
});

const call = (body: unknown, key: string | null = PW) =>
  POST(new Request(`${BASE_URL}/api/admin/recast`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-frontier-key": key } : {}) }, body: JSON.stringify(body) }));

/** A dating profile the deck lets swipe (lib/swipes.ts): three answered prompts and three interests. */
const PROFILE = {
  hobbies: ["sailing", "cards", "maps"],
  prompts: [
    { id: "win_me_over", answer: "Bring a map." },
    { id: "geek_out", answer: "Knots." },
    { id: "simple_pleasures", answer: "A calm sea." },
  ],
};

async function agentCharacter(name: string, opts: { open?: boolean } = {}) {
  const cookie = newUserCookie();
  const id = (await (await api.createCharacter(validCharacter({ name, extras: PROFILE }), cookie)).json()).id as string;
  await t.db.query(`update characters set created_via = 'mcp', open_to_dates = $2 where id = $1`, [id, opts.open ?? true]);
  return { id, owner: userIdOf(cookie) };
}

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** `roles`: the "does it read as them?" answers in order (then YES). */
function fakes(clothing = "CLOTHED", roles: ("YES" | "NO")[] = []) {
  const asked: string[] = [];
  setMediaFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    asked.push(String(JSON.parse(String(init?.body ?? "{}")).prompt ?? ""));
    return Response.json({ images: [PNG.toString("base64")] });
  });
  setPgStudioFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    asked.push(String(JSON.parse(String(init?.body ?? "{}")).prompt ?? ""));
    return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
  });
  // The show's check answers SAFE/UNSAFE; the rating check names the clothing.
  setModerationFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    const content = body.includes("role_check")
      ? { answer: roles.shift() ?? "YES" }
      : body.includes("pg_check")
        ? { answer: clothing === "NUDITY" ? "UNSAFE" : "SAFE" }
        : { clothing, age: "ADULTS" };
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  });
  return asked;
}

describe("the recast (POST /api/admin/recast)", () => {
  it("needs the admin password, and acts only on agent-made characters still on the show", async () => {
    const a = await agentCharacter("Rook Marrow");
    expect((await call({ action: "rank", character_id: a.id }, null)).status).toBe(403);
    expect((await call({ action: "rank", character_id: a.id }, "wrong")).status).toBe(403);
    const person = (await (await api.createCharacter(validCharacter({ name: "Person Pat" }), newUserCookie())).json()).id as string;
    expect((await call({ action: "update", character_id: person, patch: { bio: "Changed." } })).status).toBe(404);
    expect((await call({ action: "rank", character_id: HOUSE_CHARACTERS[0].id })).status).toBe(404);
    await t.db.query(`update characters set owner_id = 'deleted' where id = $1`, [a.id]);
    expect((await call({ action: "rank", character_id: a.id })).status).toBe(404);
  });

  it("edits the sheet as its owner, with every check an owner's edit has", async () => {
    const a = await agentCharacter("Rook Marrow");
    const res = await call({
      action: "update",
      character_id: a.id,
      patch: {
        name: "Captain Isolde Brack",
        bio: "A pirate captain who lost her ship in a card game and wants it back.",
        soul: { values: "Loyalty to her crew.", humor: "Dry as ship's biscuit." },
        extras: { occupation: "Pirate captain", kind: "human", hot_takes: ["Maps are opinions.", "Parrots are overrated.", "Rum is for cooking."], mood: "playful" },
        hiding: ["Gets seasick in the bath"],
        this_week: "Won a rowing boat in a raffle.",
      },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).result).toMatchObject({ id: a.id, soul_changed: true, hiding: ["Gets seasick in the bath"] });
    const row = (await t.db.query<{ name: string; extras: { occupation: string; hot_takes: string[] } }>(`select name, extras from characters where id = $1`, [a.id])).rows[0];
    expect(row.name).toBe("Captain Isolde Brack");
    expect(row.extras.hot_takes).toHaveLength(3);
    expect((await t.db.query(`select 1 from souls where character_id = $1`, [a.id])).rows).toHaveLength(1);
    // The PG sheet check and the name rule hold.
    const rude = await call({ action: "update", character_id: a.id, patch: { bio: "Loves exploring in the bedroom." } });
    expect(rude.status).toBe(422);
    const b = await agentCharacter("Wren Dusk");
    expect((await call({ action: "update", character_id: b.id, patch: { name: "Captain Isolde Brack" } })).status).toBe(409);
  });

  it("draws their portrait from their written look, PG-checked, and makes it their face", async () => {
    const a = await agentCharacter("Rook Marrow");
    const asked = fakes();
    const res = await call({ action: "portrait", character_id: a.id, look: "a weathered woman with a red tricorn hat and a long navy coat" });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ ok: true, character_id: a.id });
    expect(asked[0]).toContain("red tricorn hat");
    expect(asked[0]).not.toMatch(/Rook|Marrow/);
    const rows = (await t.db.query<{ review_status: string; content_rating: string; prompt_version: string }>(`select review_status, content_rating, prompt_version from character_assets where character_id = $1 and kind = 'portrait'`, [a.id])).rows;
    expect(rows).toEqual([{ review_status: "approved", content_rating: "pg", prompt_version: "recast-portrait-v1" }]);
    expect((await t.db.query<{ look: string }>(`select look from characters where id = $1`, [a.id])).rows[0].look).toContain("tricorn");
    // Words that aren't PG are refused before anything is drawn.
    expect((await call({ action: "portrait", character_id: a.id, look: "a topless pirate" })).status).toBe(422);
    // One the check won't call PG isn't kept.
    fakes("NUDITY");
    expect((await call({ action: "portrait", character_id: a.id })).status).toBe(422);
    expect((await t.db.query(`select 1 from character_assets where character_id = $1`, [a.id])).rows).toHaveLength(1);
  });

  it("draws them as who they are, and redraws once with the props pushed when the picture doesn't read as it", async () => {
    const a = await agentCharacter("Rook Marrow");
    const role = { role: "a pirate captain", props: "a red tricorn hat and a brass telescope", scene: "the deck of a tall ship" };
    let asked = fakes("CLOTHED", ["YES"]);
    let out = await (await call({ action: "portrait", character_id: a.id, look: "a weathered woman in her forties", ...role })).json();
    expect(out).toMatchObject({ ok: true, role_ok: true, tries: 1 });
    expect(asked[0]).toContain("They are a pirate captain, with a red tricorn hat and a brass telescope. Behind them, the deck of a tall ship.");
    // A miss, then a pass: the pushed one is kept.
    asked = fakes("CLOTHED", ["NO", "YES"]);
    out = await (await call({ action: "portrait", character_id: a.id, ...role })).json();
    expect(out).toMatchObject({ ok: true, role_ok: true, tries: 2 });
    expect(asked[1]).toContain("unmistakable at a glance that they are a pirate captain");
    // Two misses: kept, flagged, never a third try.
    asked = fakes("CLOTHED", ["NO", "NO"]);
    out = await (await call({ action: "portrait", character_id: a.id, ...role })).json();
    expect(out).toMatchObject({ ok: true, role_ok: false, tries: 2 });
    expect(asked).toHaveLength(2);
    // The body: a miss isn't kept, the pushed one is, flagged.
    asked = fakes("CLOTHED", ["NO", "NO"]);
    const body = await (await call({ action: "body", character_id: a.id, outfit: "a long navy coat and boots", ...role })).json();
    expect(body).toMatchObject({ ok: true, made: 1, role_ok: false, tries: 2 });
    expect(asked[1]).toContain("unmistakably a pirate captain");
    expect((await t.db.query(`select 1 from studio_pg_pictures where character_id = $1`, [a.id])).rows).toHaveLength(1);
    // Words that aren't PG in the role are refused before anything is drawn.
    expect((await call({ action: "portrait", character_id: a.id, role: "a pirate captain", props: "a lacy corset" })).status).toBe(422);
  });

  it("draws their full body from that face, in their costume, kept as their owner's picture and paid by the show", async () => {
    const a = await agentCharacter("Rook Marrow");
    expect((await call({ action: "body", character_id: a.id })).status).toBe(409); // no face yet
    const asked = fakes();
    await call({ action: "portrait", character_id: a.id, look: "a weathered woman with a red tricorn hat" });
    const res = await call({ action: "body", character_id: a.id, outfit: "a long navy captain's coat, boots and a red tricorn hat" });
    expect(res.status).toBe(200);
    expect((await res.json()).made).toBe(1);
    expect(asked.at(-1)).toMatch(/full body, head to toe/i);
    expect(asked.at(-1)).toContain("navy captain's coat");
    const pics = (await t.db.query<{ owner_id: string; tags: { kind: string; value: string }[] }>(`select owner_id, tags from studio_pg_pictures where character_id = $1`, [a.id])).rows;
    expect(pics).toHaveLength(1);
    expect(pics[0].owner_id).toBe(a.owner);
    expect(pics[0].tags).toContainEqual({ kind: "view", value: "full_body" });
  });

  it("ranks, likes and answers as the owner: two agents' characters that like each other can book", async () => {
    const a = await agentCharacter("Rook Marrow");
    const b = await agentCharacter("Wren Dusk");
    const ranked = await (await call({ action: "rank", character_id: a.id })).json();
    expect(ranked.matches.map((m: { id: string }) => m.id)).toContain(b.id);
    const liked = await call({ action: "like", character_id: a.id, target_id: b.id });
    expect(liked.status).toBe(200);
    const back = await (await call({ action: "like", character_id: b.id, target_id: a.id })).json();
    expect(back.match).toBeTruthy();
    await call({ action: "answer", character_id: a.id, with_id: b.id, yes: true });
    const done = await (await call({ action: "answer", character_id: b.id, with_id: a.id, yes: true })).json();
    expect(done.status).toBe("agreed");
  });
});
