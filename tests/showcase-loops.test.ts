import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as animatePost } from "@/app/api/admin/showcase/animate/route";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { runFfmpeg } from "@/lib/media-tools/ffmpeg";
import { listShowcase, publish, saveCreatorProfile, type ShowcaseViewer } from "@/lib/showcase";
import { madeOf } from "@/lib/showcase-made";
import { loopBatch, loopPromptPasses, loopTargets, SHOW_CREATOR } from "@/lib/showcase-loops";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Living portraits (lib/showcase-loops.ts; David, 2026-10-29): a safe picture brought to life for the reels. The real
// ffmpeg on a real little clip; Replicate and the PG check faked.

let t: Awaited<ReturnType<typeof startTestDb>>;
let MP4: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  const { files } = await runFfmpeg({ args: ["-f", "lavfi", "-i", "testsrc2=duration=2:size=240x320:rate=16", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", "clip.mp4"], inputs: {}, outputs: ["clip.mp4"] });
  MP4 = files["clip.mp4"];
}, 60_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("REPLICATE_API_TOKEN", "placeholder-replicate");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReplicatePausesForTests(false);
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setReplicateFetchForTests(null);
  setModerationFetchForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ANYONE: ShowcaseViewer = { id: null, admin: false, ratings: ["pg"] };

/** Replicate, faked: every prediction comes back done, its video the little test clip. What was asked is kept. */
function fakeReplicate() {
  const asked: { url: string; body: Record<string, unknown> }[] = [];
  setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://replicate.delivery/")) return new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } });
    asked.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return Response.json({ id: `pred-${asked.length}`, status: "succeeded", output: `https://replicate.delivery/x/${asked.length}.mp4` });
  });
  return asked;
}
/** The PG check, faked: every frame comes back as `clothing`, its people `age`. */
const verdict = (clothing: string, age = "ADULTS") => setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing, age }) } }] }));

async function world() {
  const raw = newUserCookie();
  const me = userIdOf(raw);
  const mine = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
  await claimAdmin(t.db, me);
  await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
  // Two pg pictures of hers on the showcase, and a suggestive one (never animated: pg only).
  for (const [id, rating] of [["pg-1", "pg"], ["pg-2", "pg"], ["pg-3", "suggestive"]]) {
    await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating) values ($1, $2, $3, 'p', 'image/png', $4, $5)`, [id, me, mine, PNG, rating]);
    const r = await publish(t.db, me, { source: "pg", media_id: id });
    if (!r.ok) throw new Error(r.message);
  }
  // Agent-made characters: a public one with a safe portrait, a private one, and one with no portrait at all.
  const agent = async (name: string, visibility: string, portrait: boolean) => {
    const id = (await (await api.createCharacter(validCharacter({ name }), newUserCookie())).json()).id as string;
    await t.db.query(`update characters set created_via = 'mcp', visibility = $2 where id = $1`, [id, visibility]);
    if (portrait)
      await t.db.query(`insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'm', $3, 'approved', 'pg')`, [
        `asset-${id}`,
        id,
        "/cast/house-juniper-v3.webp",
      ]);
    return id;
  };
  const open = await agent("Agent Open", "public", true);
  const hidden = await agent("Agent Hidden", "private", true);
  const bare = await agent("Agent Bare", "public", false);
  return { me, mine, open, hidden, bare };
}

describe("living portraits", () => {
  it("animates an admin's pg pictures, and (asked to) the public agent-made characters' safe portraits; never one twice", async () => {
    const w = await world();
    expect(loopPromptPasses(false) && loopPromptPasses(true)).toBe(true);
    const targets = await loopTargets(t.db, w.me, BASE_URL, { agents: true });
    expect(targets.map((x) => [x.source, x.character_id]).sort()).toEqual([["portrait", w.open], ["post", w.mine], ["post", w.mine]].sort());
    expect((await loopTargets(t.db, w.me, BASE_URL)).every((x) => x.source === "post")).toBe(true);

    const asked = fakeReplicate();
    verdict("CLOTHED");
    const r = await loopBatch(t.db, w.me, BASE_URL, { agents: true });
    expect([r.made.length, r.failed.length, r.left]).toEqual([3, 0, 0]);
    // Replicate's safety checker stays on; the picture goes by its public link.
    expect(asked.every((a) => a.body.input && !("disable_safety_checker" in (a.body.input as object)))).toBe(true);
    expect(asked.map((a) => (a.body.input as { image: string }).image).sort()).toEqual(
      [`${BASE_URL}/api/assets/asset-${w.open}`, ...(await t.db.query<{ id: string }>(`select id from showcase_posts where media_id in ('pg-1', 'pg-2')`)).rows.map((p) => `${BASE_URL}/api/showcase/${p.id}/media`)].sort(),
    );
    // Hers under her handle; the agent-made one under the show's own.
    const clips = (await listShowcase(t.db, ANYONE, { medium: "clip" })).posts;
    expect(clips.map((p) => [p.creator.handle, p.character.id]).sort()).toEqual([["botchelor", w.open], ["mara", w.mine], ["mara", w.mine]].sort());
    expect((await t.db.query(`select handle from creator_profiles where user_id = $1`, [SHOW_CREATOR.user_id])).rows).toEqual([{ handle: "botchelor" }]);
    // What made it: the model, the prompt as sent, a living portrait.
    const made = await madeOf(t.db, ANYONE, clips[0].id);
    expect(made).toMatchObject({ how: "A living portrait: their safe picture, brought to life", model: { id: "wan-video/wan-2.2-i2v-fast", provider: "Replicate" } });
    expect(made?.prompt).toMatch(/comes gently to life/);
    // Each once: nothing left, and another run makes nothing.
    expect((await loopBatch(t.db, w.me, BASE_URL, { agents: true })).made).toEqual([]);
  });

  it("keeps nothing a frame of which fails the PG check, and never tries it again", async () => {
    const w = await world();
    fakeReplicate();
    verdict("CLOTHED", "MINOR");
    const r = await loopBatch(t.db, w.me, BASE_URL);
    expect(r.made).toEqual([]);
    expect(r.failed.map((f) => f.error)).toEqual([expect.stringMatching(/a frame didn't pass/), expect.stringMatching(/a frame didn't pass/)]);
    expect((await t.db.query(`select 1 from adult_images where kind = 'video'`)).rows).toHaveLength(0);
    expect((await t.db.query<{ status: string }>(`select status from showcase_loops`)).rows.map((x) => x.status)).toEqual(["failed", "failed"]);
    expect(await loopTargets(t.db, w.me, BASE_URL)).toEqual([]);
  });

  it("is an admin's alone, and a private character's posts stay off the public showcase", async () => {
    const w = await world();
    const post = (cookie: string, body: unknown = {}) => animatePost(new Request(`${BASE_URL}/x`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    expect((await post(signedInCookie(userIdOf(newUserCookie())))).status).toBe(403);
    fakeReplicate();
    verdict("CLOTHED");
    expect(await (await post(signedInCookie(w.me))).json()).toMatchObject({ ok: true, left: 0 });
    // Mara turns private: her posts leave the public showcase (her own view keeps them).
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [w.mine]);
    expect((await listShowcase(t.db, ANYONE, {})).posts).toEqual([]);
    expect((await listShowcase(t.db, { id: w.me, admin: true, ratings: ["pg", "suggestive", "nsfw"] }, {})).posts.length).toBeGreaterThan(0);
  });
});
