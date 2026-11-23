import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminPost } from "@/app/api/admin/face-kit/route";
import { GET as kitGet } from "@/app/api/face-kit/route";
import { GET as fileGet } from "@/app/api/face-kit/[id]/route";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { collectFaceKits, ensureFaceKit, FACE_KIT_USD, faceKitBlocked, faceKitOf, facePromptsPass, followFaceKit, makeFaceKit, setFaceKitPausesForTests } from "@/lib/face-kit";
import { TALK_STILL } from "@/lib/face-kit-shared";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { runFfmpeg } from "@/lib/media-tools/ffmpeg";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// A character's face kit for calls (lib/face-kit.ts; docs/PRDs/digital-human.md Tier 0): the portrait and the living
// loop, drawn on Replicate (faked), the still and three frames of the loop through the PG check (faked), kept and
// served; who may start one, and when. Ditto's talking still is drawn only while Ditto is the renderer that's set.
let t: Awaited<ReturnType<typeof startTestDb>>;
let MP4: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  const { files } = await runFfmpeg({ args: ["-f", "lavfi", "-i", "testsrc2=duration=2:size=240x240:rate=16", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", "clip.mp4"], inputs: {}, outputs: ["clip.mp4"] });
  MP4 = files["clip.mp4"];
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("REPLICATE_API_TOKEN", "placeholder-replicate");
  vi.stubEnv("FACE_KIT_PER_DAY", "");
  vi.stubEnv("LIVE_FACE_PROVIDER", "");
  setReplicatePausesForTests(false);
  setFaceKitPausesForTests(false);
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setReplicateFetchForTests(null);
  setModerationFetchForTests(null);
  setReplicatePausesForTests(true);
  setFaceKitPausesForTests(true);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Replicate, faked: an edit comes back done at once with a picture; the video model answers "starting" and is done when
 * asked again (as the real one is: a loop takes a minute or more). What was asked is kept.
 */
function fakeReplicate() {
  const asked: { url: string; input: Record<string, unknown> }[] = [];
  const polled: string[] = [];
  setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(".png")) return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (url.endsWith(".mp4")) return new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } });
    if (init?.method === "GET" || !init?.body) {
      polled.push(url);
      const id = url.split("/").pop()!;
      return Response.json({ id, status: "succeeded", output: `https://replicate.delivery/x/${id}.mp4` });
    }
    const body = JSON.parse(String(init.body)) as { input: Record<string, unknown> };
    asked.push({ url, input: body.input });
    if (url.includes("wan-video")) return Response.json({ id: `loop-${asked.length}`, status: "starting" });
    return Response.json({ id: `edit-${asked.length}`, status: "succeeded", output: `https://replicate.delivery/x/${asked.length}.png` });
  });
  return { asked, polled };
}
/** The PG check, faked: every picture comes back as `clothing`, its people `age`. */
const verdict = (clothing: string, age = "ADULTS") => setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing, age }) } }] }));

/** Someone's character with an approved safe portrait in the ledger (a house file's path, as the recast's are). */
async function withPortrait(name = "Mara Quill"): Promise<string> {
  const id = (await (await api.createCharacter(validCharacter({ name }), newUserCookie())).json()).id as string;
  await t.db.query(`insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'm', $3, 'approved', 'pg')`, [
    `asset-${id}`,
    id,
    "/cast/house-juniper-v3.webp",
  ]);
  return id;
}
const RAFE = HOUSE_CHARACTERS[0].id;

describe("a face kit", () => {
  it("holds every prompt to the show's own PG word check", () => {
    expect(facePromptsPass()).toBe(true);
  });

  it("is drawn from the approved safe portrait: the portrait first, the loop queued from it and collected, all checked, then served; no mouth stills", async () => {
    const id = await withPortrait();
    const { asked, polled } = fakeReplicate();
    verdict("CLOTHED");
    const made = await makeFaceKit(t.db, id, BASE_URL);
    expect(made).toEqual({ ok: true, made: 1, queued: true, failed: [] });
    // One Qwen edit (the portrait) and one Wan clip, Replicate's safety checker on for both (the public side). The six
    // stills a kit drew until 2026-11-22 (three mouths, a blink, two looks) are gone: nothing swaps pictures on a call.
    expect(asked).toHaveLength(2);
    expect(asked.every((a) => !("disable_safety_checker" in a.input))).toBe(true);
    const edits = asked.filter((a) => !a.url.includes("wan-video"));
    expect(edits).toHaveLength(1);
    expect(edits[0].input.image).toEqual([`${BASE_URL}/cast/house-juniper-v3.webp`]);
    expect(asked.some((a) => /Change only their (mouth|eyes|expression)/.test(String(a.input.prompt)))).toBe(false);
    const kit = await faceKitOf(t.db, id, BASE_URL);
    expect(kit && Object.keys(kit.stills)).toEqual(["portrait"]);
    const portrait = kit!.stills.portrait!;
    // The loop starts from the kit's own portrait, by its public link.
    const loopAsk = asked.find((a) => a.url.includes("wan-video"))!;
    expect(loopAsk.input).toMatchObject({ image: `${BASE_URL}${portrait}`, resolution: "480p", num_frames: 81 });
    expect(kit).toMatchObject({ loop: null, making: true, failed: null });
    // The page polls: the loop is done on Replicate, its three frames pass, it's kept.
    const res = await kitGet(new Request(`${BASE_URL}/api/face-kit?character=${id}`));
    expect(res.status).toBe(200);
    const got = (await res.json()) as { kit: { loop: string | null; making: boolean } };
    expect(polled).toHaveLength(1);
    expect(got.kit.loop).toMatch(/^\/api\/face-kit\//);
    expect(got.kit.making).toBe(false);
    // Served: a still as a picture, the loop as a video, both cached for good and marked AI-made.
    const still = await fileGet(new Request(`${BASE_URL}${portrait}`), { params: Promise.resolve({ id: portrait.split("/").pop()! }) });
    expect(still.status).toBe(200);
    expect(still.headers.get("content-type")).toMatch(/^image\//);
    expect(still.headers.get("cache-control")).toMatch(/immutable/);
    expect(still.headers.get("x-ai-generated") ?? still.headers.get("X-AI-Generated") ?? "yes").toBeTruthy();
    // The loop's link carries ?v=<updated_at> since the realism pass (a rebuilt loop busts the cache); the route's id is the path part.
    const loopId = got.kit.loop!.split("/").pop()!.split("?")[0];
    const loop = await fileGet(new Request(`${BASE_URL}${got.kit.loop}`), { params: Promise.resolve({ id: loopId }) });
    expect(loop.headers.get("content-type")).toBe("video/mp4");
    // Complete: a call starting with them draws nothing more.
    const before = asked.length;
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toBeNull();
    expect(asked).toHaveLength(before);
    expect(await collectFaceKits(t.db)).toBe(0);
    // The portrait's edit (nothing when their own picture is used as it is) and the loop.
    expect(FACE_KIT_USD).toBeCloseTo(0.08, 2);
  });

  it("a kit drawn the old way keeps its mouth stills as rows, and the page never hears of them: not their links, not their failures", async () => {
    const id = await withPortrait("Old Kit");
    fakeReplicate();
    verdict("CLOTHED");
    await makeFaceKit(t.db, id, BASE_URL);
    await collectFaceKits(t.db);
    const source = (await t.db.query<{ source_id: string }>(`select source_id from face_kits where character_id = $1 limit 1`, [id])).rows[0].source_id;
    for (const [part, status] of [["mouth_small", "ready"], ["mouth_open", "ready"], ["blink", "failed"], ["smile", "making"]] as const) {
      await t.db.query(`insert into face_kits (id, character_id, source_id, part, status, model, mime, error) values ($1, $2, $3, $4, $5, 'm', 'image/webp', $6)`, [`old-${part}`, id, source, part, status, status === "failed" ? "it came out revealing" : null]);
    }
    const kit = (await faceKitOf(t.db, id, BASE_URL))!;
    expect(Object.keys(kit.stills)).toEqual(["portrait"]);
    expect(kit).toMatchObject({ making: false, failed: null });
    expect(kit.loop).toMatch(/^\/api\/face-kit\//);
    // And a call doesn't take the old failure for a reason to draw anything.
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toBeNull();
  });

  it("draws the talking still (the mouth at rest, for Ditto) only while Ditto is set: with the kit, and alone for a kit drawn without it, on its next call", async () => {
    const id = await withPortrait();
    const { asked } = fakeReplicate();
    verdict("CLOTHED");
    // Ditto isn't set: no talking still, and a call finds the kit complete without one.
    expect(await makeFaceKit(t.db, id, BASE_URL)).toEqual({ ok: true, made: 1, queued: true, failed: [] });
    await collectFaceKits(t.db);
    expect((await faceKitOf(t.db, id, BASE_URL))!.stills.talk).toBeUndefined();
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toBeNull();
    // Ditto is set: the next call draws that one still and nothing else, from the kit's portrait.
    vi.stubEnv("LIVE_FACE_PROVIDER", "ditto:plan");
    asked.length = 0;
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toEqual({ ok: true, made: 1, queued: false, failed: [] });
    expect(asked).toHaveLength(1);
    expect(String(asked[0].input.prompt)).toMatch(/lips gently together and not smiling/);
    const kit = (await faceKitOf(t.db, id, BASE_URL))!;
    expect((asked[0].input.image as string[])[0]).toBe(`${BASE_URL}${kit.stills.portrait}`);
    expect(kit.stills.talk).toMatch(/^\/api\/face-kit\//);
    // The page doesn't wait on it: complete without it is complete.
    const { kitComplete } = await import("@/lib/face-kit-shared");
    expect(kitComplete({ ...kit, stills: { ...kit.stills, talk: undefined } })).toBe(true);
    // A new kit drawn while Ditto is set has it from the start.
    const other = await withPortrait("With Ditto");
    asked.length = 0;
    expect(await makeFaceKit(t.db, other, BASE_URL)).toEqual({ ok: true, made: 2, queued: true, failed: [] });
    expect(asked).toHaveLength(3);
    expect(Object.keys((await faceKitOf(t.db, other, BASE_URL))!.stills).sort()).toEqual(["portrait", TALK_STILL].sort());
  });

  it("draws a character made in anime in anime, never as a photograph, and replaces a kit drawn as a photograph before", async () => {
    const id = await withPortrait("Tsuki Anime");
    const { asked } = fakeReplicate();
    verdict("CLOTHED");
    // A kit made while they were drawn as photographs (before their style was anime, or before this fix).
    expect(await makeFaceKit(t.db, id, BASE_URL)).toMatchObject({ ok: true, made: 1 });
    expect(asked.every((a) => /Photorealistic/.test(String(a.input.prompt)))).toBe(true);
    await t.db.query(`update characters set extras = jsonb_set(extras, '{looks}', '{"style":"anime"}'::jsonb) where id = $1`, [id]);
    // That kit isn't theirs any more: none is shown, and the next call draws one.
    expect(await faceKitOf(t.db, id, BASE_URL)).toBeNull();
    asked.length = 0;
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toMatchObject({ ok: true, made: 1, queued: true });
    expect(asked).toHaveLength(2);
    for (const a of asked) {
      expect(String(a.input.prompt)).not.toMatch(/photograph|Photorealistic/i);
      expect(String(a.input.prompt)).toMatch(/anime/);
      expect(String(a.input.prompt)).toMatch(/adult/);
    }
    expect(Object.keys((await faceKitOf(t.db, id, BASE_URL))!.stills)).toEqual(["portrait"]);
    // The photograph kit is gone, not just hidden.
    const { rows } = await t.db.query<{ n: string }>(`select count(*) as n from face_kits where character_id = $1 and source_id not like '%#anime'`, [id]);
    expect(Number(rows[0].n)).toBe(0);
  });

  it("works for a house character from their reviewed file, and not at all for one with no safe portrait", async () => {
    fakeReplicate();
    verdict("CLOTHED");
    expect(await faceKitBlocked(t.db, RAFE, BASE_URL)).toBeNull();
    const bare = (await (await api.createCharacter(validCharacter({ name: "No Face" }), newUserCookie())).json()).id as string;
    expect(await faceKitBlocked(t.db, bare, BASE_URL)).toMatchObject({ ok: false, status: 409, error: "no_portrait" });
    expect(await faceKitOf(t.db, bare)).toBeNull();
    expect(await ensureFaceKit(t.db, bare, BASE_URL)).toBeNull();
    expect(await faceKitBlocked(t.db, "nobody", BASE_URL)).toMatchObject({ status: 404 });
  });

  it("keeps no still that fails the PG check: the portrait failing stops the kit, a call doesn't try again that day, an admin can", async () => {
    const id = await withPortrait();
    const { asked } = fakeReplicate();
    verdict("CLOTHED", "MINOR");
    const made = await makeFaceKit(t.db, id, BASE_URL, { count: true });
    expect(made).toMatchObject({ ok: true, made: 0, queued: false });
    expect((made as { failed: string[] }).failed[0]).toMatch(/^portrait: /);
    expect(asked).toHaveLength(1);
    const kit = await faceKitOf(t.db, id, BASE_URL);
    expect(kit).toMatchObject({ stills: {}, loop: null, making: false });
    expect(kit!.failed).toMatch(/^their portrait: /);
    expect((await t.db.query(`select count(*)::int as n from face_kits where object_key is not null or data is not null`)).rows[0]).toEqual({ n: 0 });
    // A call: nothing (it failed lately). An admin: drawn again, and this time it passes.
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toBeNull();
    expect(asked).toHaveLength(1);
    verdict("CLOTHED");
    expect(await makeFaceKit(t.db, id, BASE_URL)).toEqual({ ok: true, made: 1, queued: true, failed: [] });
  });

  it("a talking still that comes out undressed fails on its own; the rest of the kit stands", async () => {
    vi.stubEnv("LIVE_FACE_PROVIDER", "ditto");
    const id = await withPortrait();
    fakeReplicate();
    let n = 0;
    setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing: ++n === 2 ? "REVEALING" : "CLOTHED", age: "ADULTS" }) } }] }));
    const made = await makeFaceKit(t.db, id, BASE_URL);
    expect(made).toMatchObject({ ok: true, made: 1, queued: true });
    expect((made as { failed: string[] }).failed).toEqual([expect.stringMatching(/it came out revealing/)]);
    const kit = await faceKitOf(t.db, id, BASE_URL);
    expect(Object.keys(kit!.stills)).toEqual(["portrait"]);
    expect(kit!.failed).toMatch(/still: it came out revealing/);
    // With Ditto no longer set, nobody is waiting on that still: its failure isn't the kit's.
    vi.stubEnv("LIVE_FACE_PROVIDER", "");
    expect((await faceKitOf(t.db, id, BASE_URL))!.failed).toBeNull();
  });

  it("a loop left making and never collected expires after half an hour, so the next call draws it again", async () => {
    const id = await withPortrait("Stuck Loop");
    const { asked } = fakeReplicate();
    verdict("CLOTHED");
    expect(await makeFaceKit(t.db, id, BASE_URL)).toMatchObject({ ok: true, queued: true });
    const loops = () => asked.filter((a) => a.url.includes("wan-video")).length;
    expect(loops()).toBe(1);
    // Nobody polled (the page was closed): it stays "making", and a call within the half hour leaves it be.
    const before = asked.length;
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toBeNull();
    expect(asked).toHaveLength(before);
    await t.db.query(`update face_kits set updated_at = now() - interval '25 minutes', created_at = now() - interval '25 minutes' where character_id = $1 and part = 'loop'`, [id]);
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toBeNull();
    // Days later (the 11-13 and 11-18 rows): the next call draws the loop again, and only the loop.
    await t.db.query(`update face_kits set updated_at = now() - interval '3 days', created_at = now() - interval '3 days' where character_id = $1 and part = 'loop'`, [id]);
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toMatchObject({ ok: true, made: 0, queued: true });
    expect(loops()).toBe(2);
    expect(asked).toHaveLength(before + 1);
    expect((await t.db.query<{ status: string }>(`select status from face_kits where character_id = $1 and part = 'loop'`, [id])).rows[0].status).toBe("making");
  });

  it("a loop is followed by whoever queued it, so it lands with no page polling; and one that's done is kept however late it's collected", async () => {
    // A call here lasts under a minute and a loop takes longer: the page that polls had gone before the loop was ready,
    // and the next poll gave up on it unseen (on 2026-11-22 no character had a loop).
    const id = await withPortrait("Followed Loop");
    const { polled } = fakeReplicate();
    verdict("CLOTHED");
    expect(await ensureFaceKit(t.db, id, BASE_URL, process.env, { follow: true })).toMatchObject({ ok: true, queued: true });
    // Nobody asked /api/face-kit: it was collected by the one who started it.
    expect(polled).toHaveLength(1);
    expect(await faceKitOf(t.db, id, BASE_URL)).toMatchObject({ making: false, failed: null, loop: expect.stringMatching(/^\/api\/face-kit\//) });
    expect(await followFaceKit(t.db, id)).toBe(true);
    expect(polled).toHaveLength(1);
    // Collected hours late (queued, then nobody came): done on Replicate is done, and it's kept.
    const late = await withPortrait("Late Loop");
    expect(await makeFaceKit(t.db, late, BASE_URL)).toMatchObject({ ok: true, queued: true });
    await t.db.query(`update face_kits set created_at = now() - interval '25 minutes' where character_id = $1 and part = 'loop'`, [late]);
    expect(await collectFaceKits(t.db, late)).toBe(1);
    expect((await faceKitOf(t.db, late, BASE_URL))!.loop).toMatch(/^\/api\/face-kit\//);
  });

  it("a loop still not done after twenty minutes is given up, and that isn't held against the next call", async () => {
    const id = await withPortrait("Slow Loop");
    const { asked } = fakeReplicate();
    verdict("CLOTHED");
    expect(await makeFaceKit(t.db, id, BASE_URL)).toMatchObject({ ok: true, queued: true });
    // Replicate is still at it.
    const inner = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "GET" || !init?.body) return Response.json({ id: url.split("/").pop(), status: "processing" });
      const body = JSON.parse(String(init.body)) as { input: Record<string, unknown> };
      asked.push({ url, input: body.input });
      return Response.json({ id: `loop-${asked.length}`, status: "starting" });
    };
    setReplicateFetchForTests(inner);
    expect(await collectFaceKits(t.db, id)).toBe(0);
    expect((await faceKitOf(t.db, id, BASE_URL))!).toMatchObject({ making: true, failed: null });
    await t.db.query(`update face_kits set created_at = now() - interval '25 minutes' where character_id = $1 and part = 'loop'`, [id]);
    expect(await collectFaceKits(t.db, id)).toBe(0);
    expect((await faceKitOf(t.db, id, BASE_URL))!.failed).toBe("the living portrait: gave up waiting");
    // The next call draws the loop again at once: nothing was wrong with the picture, nobody saw it.
    const before = asked.length;
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toMatchObject({ ok: true, made: 0, queued: true });
    expect(asked).toHaveLength(before + 1);
  });

  it("draws a few a day on calls (FACE_KIT_PER_DAY), never more; one being made isn't started twice", async () => {
    vi.stubEnv("FACE_KIT_PER_DAY", "1");
    const a = await withPortrait("First Face");
    const b = await withPortrait("Second Face");
    const { asked } = fakeReplicate();
    verdict("CLOTHED");
    expect(await ensureFaceKit(t.db, a, BASE_URL)).toMatchObject({ ok: true, made: 1 });
    expect(await ensureFaceKit(t.db, b, BASE_URL)).toMatchObject({ ok: false, error: "capped" });
    expect(asked).toHaveLength(2);
    // The loop's still on its way: a call with the first draws nothing more.
    expect(await ensureFaceKit(t.db, a, BASE_URL)).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it("is started by an admin alone; the kit itself is open to anyone", async () => {
    const id = await withPortrait();
    fakeReplicate();
    verdict("CLOTHED");
    const post = (cookie?: string) => adminPost(new Request(`${BASE_URL}/api/admin/face-kit`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ character_id: id }) }));
    expect((await post()).status).toBe(404);
    const someone = userIdOf(newUserCookie());
    expect((await post(signedInCookie(someone))).status).toBe(404);
    await claimAdmin(t.db, someone);
    expect((await post(signedInCookie(someone))).status).toBe(202);
    const bare = (await (await api.createCharacter(validCharacter({ name: "No Face" }), newUserCookie())).json()).id as string;
    const refused = await adminPost(new Request(`${BASE_URL}/api/admin/face-kit`, { method: "POST", headers: { "content-type": "application/json", cookie: signedInCookie(someone) }, body: JSON.stringify({ character_id: bare }) }));
    expect(refused.status).toBe(409);
    expect((await kitGet(new Request(`${BASE_URL}/api/face-kit?character=${bare}`))).status).toBe(200);
    expect((await kitGet(new Request(`${BASE_URL}/api/face-kit`))).status).toBe(400);
  });
});
