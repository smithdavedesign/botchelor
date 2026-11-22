import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { setCheckFetchForTests } from "@/lib/adult/check";
import { collectMakingReels } from "@/lib/adult/reel-collector";
import { pollReels } from "@/lib/adult/reel-poll";
import { advanceReel, releaseVideo, retrieveVideo, setReelFetchForTests, setReelPausesForTests, shotVideoId, stopReel, type ReelShot } from "@/lib/adult/reels";
import { failureCode, recentVideoFailures } from "@/lib/adult/video-failures";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// 2026-11-22: the open page's poll and the host's collector collected the same finished shots at once; two were kept
// twice (loose copies in the Gallery), and whichever wrote the shot list last won. No live calls here.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setReelPausesForTests(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setReelFetchForTests(null);
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
});

const [A, B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const MODEL = "wan-3-0-image-to-video";
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const CLEAN = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.9 }] }] };

/** An admin with After Dark's Venice and Hive keys set. */
async function owner() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  const cookie = sessionCookies({ userId: id, authenticated: true })[0].split(";")[0];
  const res = await settingsPost(
    new Request(`${BASE_URL}/api/admin/after-dark/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }),
    }),
  );
  expect(res.status).toBe(200);
  return id;
}

/** A night's video being made, filmed two minutes ago, its shots queued on Venice as q1, q2… */
async function making(ownerId: string, n: number) {
  const id = crypto.randomUUID();
  const shots: ReelShot[] = Array.from({ length: n }, (_, i) => ({ line: i, who: "a", text: "Placeholder line.", motion: "", status: "queued", queue_id: `q${i + 1}`, model: MODEL, media_id: `frame-${i + 1}` }));
  await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, created_at) values ($1, $2, $3, $4, 'making', 0, $5::jsonb, now() - interval '2 minutes')`, [
    id,
    ownerId,
    A,
    B,
    JSON.stringify(shots),
  ]);
  return id;
}

/** Venice, recorded: `retrieve` answers each ask after a video (default: the video, a moment later). */
function fakeVenice(retrieve: (queueId: string, n: number) => Promise<Response> | Response = async () => new Response(MP4, { headers: { "content-type": "video/mp4" } })) {
  const calls: { path: string; queue_id: string; deleting: boolean }[] = [];
  let n = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}")) as { queue_id: string; delete_media_on_completion?: boolean };
    calls.push({ path, queue_id: body.queue_id, deleting: Boolean(body.delete_media_on_completion) });
    if (path === "/video/complete") return Response.json({ success: true });
    if (path === "/video/retrieve") return retrieve(body.queue_id, ++n);
    return new Response("?", { status: 500 });
  });
  const hive: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => (hive.push(String(input)), Response.json(CLEAN)));
  return { calls, hive, fetched: () => calls.filter((c) => c.path === "/video/retrieve" && !c.deleting) };
}

const reelRow = async (id: string) =>
  (await t.db.query<{ status: string; shots: ReelShot[]; collecting_until: unknown }>(`select status, shots, collecting_until from adult_reels where id = $1`, [id])).rows[0];
const videos = async (ownerId: string) => (await t.db.query<{ id: string }>(`select id from adult_images where owner_id = $1 and kind = 'video' order by id`, [ownerId])).rows.map((r) => r.id);
const later = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("two collectors on one reel", () => {
  it("the page's poll and the host's collector at once: each shot fetched, checked and kept once, none failed", async () => {
    const me = await owner();
    const id = await making(me, 2);
    const venice = fakeVenice(async () => (await later(15), new Response(MP4, { headers: { "content-type": "video/mp4" } })));
    await Promise.all([advanceReel(t.db, me, id), advanceReel(t.db, me, id), collectMakingReels(t.db)]);
    const row = await reelRow(id);
    expect(row.status).toBe("ready");
    expect(row.shots.map((s) => [s.status, s.media_id])).toEqual([
      ["ready", shotVideoId("venice", "q1")],
      ["ready", shotVideoId("venice", "q2")],
    ]);
    expect(await videos(me)).toEqual([shotVideoId("venice", "q1"), shotVideoId("venice", "q2")].sort());
    expect(venice.fetched().map((c) => c.queue_id)).toEqual(["q1", "q2"]);
    expect(venice.hive).toHaveLength(2);
    // Venice's copies deleted with its delete call, once each, and the reel let go.
    expect(venice.calls.filter((c) => c.path === "/video/complete").map((c) => c.queue_id)).toEqual(["q1", "q2"]);
    expect(row.collecting_until).toBeNull();
  });

  it("a pass whose hold lapsed while it fetched keeps no second copy and undoes nothing the other pass wrote", async () => {
    const me = await owner();
    const id = await making(me, 2);
    let open!: () => void;
    const gate = new Promise<void>((done) => (open = done));
    // The first ask hangs (a slow download) until the other pass has done everything.
    const venice = fakeVenice(async (_q, n) => {
      if (n === 1) await gate;
      return new Response(MP4, { headers: { "content-type": "video/mp4" } });
    });
    const slow = advanceReel(t.db, me, id);
    while (!venice.fetched().length) await later(1);
    await t.db.query(`update adult_reels set collecting_until = now() - interval '1 second' where id = $1`, [id]);
    expect((await advanceReel(t.db, me, id))!.status).toBe("ready");
    open();
    await slow;
    const row = await reelRow(id);
    expect(row.status).toBe("ready");
    expect(row.shots.map((s) => s.status)).toEqual(["ready", "ready"]);
    expect(await videos(me)).toEqual([shotVideoId("venice", "q1"), shotVideoId("venice", "q2")].sort());
  });

  it("a shot kept by a pass that didn't get to write it back is in, even with Venice's copy gone", async () => {
    const me = await owner();
    const id = await making(me, 1);
    const mine = shotVideoId("venice", "q1");
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, 'video', 'p', 'video/mp4', $5, 'ready')`, [
      mine,
      me,
      A,
      B,
      Buffer.from(MP4),
    ]);
    const venice = fakeVenice(() => Response.json({ error: "Media could not be found." }, { status: 404 }));
    expect((await advanceReel(t.db, me, id))!.status).toBe("ready");
    const row = await reelRow(id);
    expect(row.shots[0]).toMatchObject({ status: "ready", media_id: mine });
    expect(venice.fetched()).toHaveLength(0);
    expect(await videos(me)).toEqual([mine]);
  });

  it("Venice's copy is deleted only once ours is kept and the shot says so", async () => {
    const me = await owner();
    const id = await making(me, 1);
    const seen: boolean[] = [];
    fakeVenice();
    setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("https://api.venice.ai/api/v1", "");
      if (path === "/video/complete") {
        const row = await reelRow(id);
        seen.push((await videos(me)).includes(shotVideoId("venice", "q1")) && row.shots[0].media_id === shotVideoId("venice", "q1") && row.shots[0].status === "ready");
        return Response.json({ success: true });
      }
      expect(JSON.parse(String(init?.body)).delete_media_on_completion).toBeUndefined();
      return new Response(MP4, { headers: { "content-type": "video/mp4" } });
    });
    await advanceReel(t.db, me, id);
    expect(seen).toEqual([true]);
  });

  it("Stop gives up only the shots still out: one a pass has brought in stays in", async () => {
    const me = await owner();
    const id = await making(me, 2);
    await t.db.query(`update adult_reels set shots = jsonb_set(shots, '{0}', (shots->0) || '{"status": "ready", "media_id": "kept-1"}') where id = $1`, [id]);
    const r = (await stopReel(t.db, me, id))!;
    expect(r.shots.map((s) => [s.status, s.reason ?? null])).toEqual([
      ["ready", null],
      ["failed", "stopped"],
    ]);
  });
});

describe("a moment's trouble at Venice", () => {
  it("is asked again before a paid shot fails: busy, then its own trouble, then the video", async () => {
    const me = await owner();
    const id = await making(me, 1);
    const answers = [new Response("busy", { status: 503 }), new Response("slow down", { status: 429 }), new Response(MP4, { headers: { "content-type": "video/mp4" } })];
    const venice = fakeVenice(() => answers.shift()!);
    expect((await advanceReel(t.db, me, id))!.status).toBe("ready");
    expect(venice.fetched()).toHaveLength(3);
  });

  it("a failure that stays fails the shot (logged once, with no scene words); no answer at all leaves it for the next poll", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const me = await owner();
    const id = await making(me, 1);
    const venice = fakeVenice(() => new Response(JSON.stringify({ error: "Inference processing failed." }), { status: 500 }));
    expect((await advanceReel(t.db, me, id))!.status).toBe("failed");
    expect(venice.fetched()).toHaveLength(3);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[ad-video]"));
    expect(lines).toEqual([`[ad-video] shot failed: reel ${id} (night), shot 1 of 1, venice ${MODEL}, Venice 500`]);
    const other = await making(me, 1);
    fakeVenice(() => Promise.reject(new TypeError("fetch failed")));
    expect((await advanceReel(t.db, me, other))!.status).toBe("making");
    expect((await reelRow(other)).shots[0].status).toBe("queued");
  });

  it("retrieveVideo: asked three times at most, a 404 at once; and the delete falls back to the old way", async () => {
    const answers: (Response | Error)[] = [new Response("", { status: 502 }), new Response(MP4, { headers: { "content-type": "video/mp4" } })];
    let asked = 0;
    setReelFetchForTests(async () => {
      asked++;
      const a = answers.shift() ?? new Response("gone", { status: 404 });
      if (a instanceof Error) throw a;
      return a;
    });
    expect((await retrieveVideo("k", MODEL, "q1")).state).toBe("ready");
    expect(asked).toBe(2);
    expect(await retrieveVideo("k", MODEL, "q1")).toEqual({ state: "failed", reason: "Venice 404", status: 404 });
    expect(asked).toBe(3);
    answers.push(new Response("", { status: 429 }), new Response("", { status: 429 }), new Response("", { status: 429 }));
    expect((await retrieveVideo("k", MODEL, "q1")).state).toBe("making");
    expect(asked).toBe(6);
    const sent: { path: string; body: Record<string, unknown> }[] = [];
    setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("https://api.venice.ai/api/v1", "");
      sent.push({ path, body: JSON.parse(String(init?.body)) });
      return path === "/video/complete" ? new Response("no", { status: 500 }) : new Response(MP4, { headers: { "content-type": "video/mp4" } });
    });
    await releaseVideo("k", MODEL, "q1");
    expect(sent.map((s) => s.path)).toEqual(["/video/complete", "/video/retrieve"]);
    expect(sent[1].body).toMatchObject({ queue_id: "q1", delete_media_on_completion: true });
  });
});

describe("failures leave a trace", () => {
  it("a short code for the log, and the last week's failed shots and talks for the Providers page", async () => {
    expect(failureCode("Venice 402: {\"error\":\"Insufficient USD\"}")).toBe("Venice 402");
    expect(failureCode("the check couldn't run (Hive answered 429)")).toBe("Hive 429");
    expect(failureCode("gave up waiting")).toBe("gave up waiting");
    expect(failureCode("something we never saw")).toBe("other");
    const me = await owner();
    const id = await making(me, 2);
    await t.db.query(`update adult_reels set status = 'failed', shots = jsonb_set(jsonb_set(shots, '{0,status}', '"failed"'), '{0,reason}', '"Venice 500"') where id = $1`, [id]);
    await t.db.query(`insert into adult_talks (id, owner_id, character_id, key, who, text, status, model, error) values ('talk-1', $1, $2, 'k1', 'a', 'Placeholder line.', 'failed', 'wan-2.6-flash-image-to-video', 'gave up waiting')`, [me, A]);
    const rows = await recentVideoFailures(t.db);
    expect(rows.map((r) => [r.what, r.id, r.detail, r.code])).toEqual(
      expect.arrayContaining([
        ["shot", id, "night video, shot 1 of 2", "Venice 500"],
        ["talk", "talk-1", "talking moment", "gave up waiting"],
      ]),
    );
    expect(rows).toHaveLength(2);
  });
});

describe("the page's poll", () => {
  it("asks once at a time, waits for the answer before the next, and stops once the video is done", async () => {
    vi.useFakeTimers();
    try {
      let inFlight = 0;
      let most = 0;
      let asks = 0;
      const got: string[] = [];
      const ask = async (rid: string) => {
        asks++;
        inFlight++;
        most = Math.max(most, inFlight);
        // Slower than the gap between asks (a collection downloading and checking shots).
        await new Promise((done) => setTimeout(done, 40_000));
        inFlight--;
        return { id: rid, status: asks >= 3 ? "ready" : "making" };
      };
      const stop = pollReels(["r1"], ask, (r) => got.push(r.status), 15_000);
      await vi.advanceTimersByTimeAsync(200_000);
      expect(most).toBe(1);
      expect(got).toEqual(["making", "making", "ready"]);
      await vi.advanceTimersByTimeAsync(200_000);
      expect(asks).toBe(3);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
