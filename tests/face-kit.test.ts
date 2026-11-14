import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminPost } from "@/app/api/admin/face-kit/route";
import { GET as kitGet } from "@/app/api/face-kit/route";
import { GET as fileGet } from "@/app/api/face-kit/[id]/route";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { collectFaceKits, ensureFaceKit, FACE_KIT_USD, faceKitBlocked, faceKitOf, facePromptsPass, makeFaceKit } from "@/lib/face-kit";
import { FACE_STILLS } from "@/lib/face-kit-shared";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { runFfmpeg } from "@/lib/media-tools/ffmpeg";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// A character's face kit for calls (lib/face-kit.ts; docs/PRDs/digital-human.md Tier 0): drawn on Replicate (faked),
// every still and three frames of the loop through the PG check (faked), kept and served; who may start one, and when.
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
  setReplicatePausesForTests(false);
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setReplicateFetchForTests(null);
  setModerationFetchForTests(null);
  setReplicatePausesForTests(true);
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

  it("is drawn from the approved safe portrait: the portrait first, the mouths, blink and looks from it, the loop queued and collected, all checked, then served", async () => {
    const id = await withPortrait();
    const { asked, polled } = fakeReplicate();
    verdict("CLOTHED");
    const made = await makeFaceKit(t.db, id, BASE_URL);
    expect(made).toEqual({ ok: true, made: 7, queued: true, failed: [] });
    // Seven edits of Qwen and one Wan clip, Replicate's safety checker on for all of them (the public side).
    expect(asked).toHaveLength(8);
    expect(asked.every((a) => !("disable_safety_checker" in a.input))).toBe(true);
    const edits = asked.filter((a) => !a.url.includes("wan-video"));
    expect(edits[0].input.image).toEqual([`${BASE_URL}/cast/house-juniper-v3.webp`]);
    const kit = await faceKitOf(t.db, id, BASE_URL);
    expect(kit && Object.keys(kit.stills).sort()).toEqual([...FACE_STILLS].sort());
    const portrait = kit!.stills.portrait!;
    // Every other still, and the loop, start from the kit's own portrait, by its public link.
    expect(edits.slice(1).every((a) => (a.input.image as string[])[0] === `${BASE_URL}${portrait}`)).toBe(true);
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
    const loop = await fileGet(new Request(`${BASE_URL}${got.kit.loop}`), { params: Promise.resolve({ id: got.kit.loop!.split("/").pop()! }) });
    expect(loop.headers.get("content-type")).toBe("video/mp4");
    // Complete: a call starting with them draws nothing more.
    const before = asked.length;
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toBeNull();
    expect(asked).toHaveLength(before);
    expect(await collectFaceKits(t.db)).toBe(0);
    expect(FACE_KIT_USD).toBeCloseTo(0.26, 2);
  });

  it("draws a character made in anime in anime, never as a photograph, and replaces a kit drawn as a photograph before", async () => {
    const id = await withPortrait("Tsuki Anime");
    const { asked } = fakeReplicate();
    verdict("CLOTHED");
    // A kit made while they were drawn as photographs (before their style was anime, or before this fix).
    expect(await makeFaceKit(t.db, id, BASE_URL)).toMatchObject({ ok: true, made: 7 });
    expect(asked.every((a) => /Photorealistic/.test(String(a.input.prompt)))).toBe(true);
    await t.db.query(`update characters set extras = jsonb_set(extras, '{looks}', '{"style":"anime"}'::jsonb) where id = $1`, [id]);
    // That kit isn't theirs any more: none is shown, and the next call draws one.
    expect(await faceKitOf(t.db, id, BASE_URL)).toBeNull();
    asked.length = 0;
    expect(await ensureFaceKit(t.db, id, BASE_URL)).toMatchObject({ ok: true, made: 7, queued: true });
    expect(asked).toHaveLength(8);
    for (const a of asked) {
      expect(String(a.input.prompt)).not.toMatch(/photograph|Photorealistic/i);
      expect(String(a.input.prompt)).toMatch(/anime/);
      expect(String(a.input.prompt)).toMatch(/adult/);
    }
    expect(Object.keys((await faceKitOf(t.db, id, BASE_URL))!.stills).sort()).toEqual([...FACE_STILLS].sort());
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
    expect(await makeFaceKit(t.db, id, BASE_URL)).toEqual({ ok: true, made: 7, queued: true, failed: [] });
  });

  it("a still that comes out undressed fails on its own; the rest of the kit stands", async () => {
    const id = await withPortrait();
    fakeReplicate();
    let n = 0;
    setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing: ++n === 3 ? "REVEALING" : "CLOTHED", age: "ADULTS" }) } }] }));
    const made = await makeFaceKit(t.db, id, BASE_URL);
    expect(made).toMatchObject({ ok: true, made: 6, queued: true });
    expect((made as { failed: string[] }).failed).toEqual([expect.stringMatching(/it came out revealing/)]);
    const kit = await faceKitOf(t.db, id, BASE_URL);
    expect(Object.keys(kit!.stills)).toHaveLength(6);
    expect(kit!.failed).toMatch(/still: it came out revealing/);
  });

  it("draws a few a day on calls (FACE_KIT_PER_DAY), never more; one being made isn't started twice", async () => {
    vi.stubEnv("FACE_KIT_PER_DAY", "1");
    const a = await withPortrait("First Face");
    const b = await withPortrait("Second Face");
    const { asked } = fakeReplicate();
    verdict("CLOTHED");
    expect(await ensureFaceKit(t.db, a, BASE_URL)).toMatchObject({ ok: true, made: 7 });
    expect(await ensureFaceKit(t.db, b, BASE_URL)).toMatchObject({ ok: false, error: "capped" });
    expect(asked).toHaveLength(8);
    // The loop's still on its way: a call with the first draws nothing more.
    expect(await ensureFaceKit(t.db, a, BASE_URL)).toBeNull();
    expect(asked).toHaveLength(8);
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
