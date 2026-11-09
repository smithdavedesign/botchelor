import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as checkGet } from "@/app/api/jobs/showcase-check/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { hasAudioTrack } from "@/lib/media-audio";
import { runFfmpeg } from "@/lib/media-tools/ffmpeg";
import { listShowcase, publish, saveCreatorProfile, type ShowcaseViewer } from "@/lib/showcase";
import { audioBatch, audioCount } from "@/lib/showcase-audio";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// David, 2026-11-09, "1": the showcase's 🔇 only on a clip that has sound. The living portraits have no sound track, so
// on them the switch did nothing. Real ffmpeg clips: one with a sound track, one without.

let t: Awaited<ReturnType<typeof startTestDb>>;
let SILENT: Buffer;
let SOUND: Buffer;
let FRAGMENTED: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  const video = ["-f", "lavfi", "-i", "testsrc2=duration=1:size=320x240:rate=12"];
  const x264 = ["-pix_fmt", "yuv420p", "-c:v", "libx264"];
  SILENT = (await runFfmpeg({ args: [...video, ...x264, "-y", "a.mp4"], inputs: {}, outputs: ["a.mp4"] })).files["a.mp4"];
  SOUND = (
    await runFfmpeg({ args: [...video, "-f", "lavfi", "-i", "sine=frequency=440:duration=1", ...x264, "-c:a", "aac", "-shortest", "-movflags", "+faststart", "-y", "b.mp4"], inputs: {}, outputs: ["b.mp4"] })
  ).files["b.mp4"];
  FRAGMENTED = (
    await runFfmpeg({ args: [...video, "-f", "lavfi", "-i", "sine=duration=1", ...x264, "-c:a", "aac", "-shortest", "-movflags", "frag_keyframe+empty_moov", "-y", "c.mp4"], inputs: {}, outputs: ["c.mp4"] })
  ).files["c.mp4"];
}, 60_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

describe("hasAudioTrack", () => {
  it("tells a clip with a sound track from one without, wherever its moov box is", () => {
    expect(hasAudioTrack(SILENT)).toBe(false);
    expect(hasAudioTrack(SOUND)).toBe(true);
    expect(hasAudioTrack(FRAGMENTED)).toBe(true);
  });

  it("doesn't guess about what it can't read", () => {
    expect(hasAudioTrack(Buffer.from("not really an mp4"))).toBeNull();
    expect(hasAudioTrack(new Uint8Array(0))).toBeNull();
    // Cut short before its moov (moov after mdat, file truncated): unknown, not silent.
    expect(hasAudioTrack(SOUND.subarray(0, 40))).toBeNull();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    expect(hasAudioTrack(png)).toBeNull();
  });
});

const ANYONE: ShowcaseViewer = { id: null, admin: false, ratings: ["pg"] };

async function world() {
  const raw = newUserCookie();
  const me = userIdOf(raw);
  const mara = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
  await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
  const ids: Record<string, string> = {};
  for (const [id, mime, data] of [
    ["clip-silent", "video/mp4", SILENT],
    ["clip-sound", "video/mp4", SOUND],
    ["clip-odd", "video/mp4", Buffer.from("not really an mp4")],
    ["picture", "image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
  ] as const) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating) values ($1, $2, $3, $4, 'p', $5, $6, 'ready', 'pg')`, [
      id, me, mara, mime.startsWith("video/") ? "video" : "scene", mime, data,
    ]);
    const r = await publish(t.db, me, { source: "after_dark", media_id: id });
    if (!r.ok) throw new Error(r.message);
    ids[id] = r.post_id;
  }
  return ids;
}
const silentBy = async () => Object.fromEntries((await listShowcase(t.db, ANYONE, {})).posts.map((p) => [p.media_id, Boolean(p.silent)]));

describe("which showcase clips have sound", () => {
  it("reads each live clip once and marks only a known-silent one, so its 🔇 goes", async () => {
    const ids = await world();
    // Clips only, never a picture; until read, none is silent (the button shows, as before).
    expect(await audioCount(t.db)).toBe(3);
    expect(await silentBy()).toEqual({ "clip-silent": false, "clip-sound": false, "clip-odd": false, picture: false });

    const run = await audioBatch(t.db);
    expect(Object.fromEntries(run.results.map((r) => [r.post_id, r.outcome]))).toEqual({
      [ids["clip-silent"]]: "silent",
      [ids["clip-sound"]]: "sound",
      [ids["clip-odd"]]: "unknown",
    });
    expect(run.left).toBe(0);
    // Unknown keeps its button: only the one read as silent loses it.
    expect(await silentBy()).toEqual({ "clip-silent": true, "clip-sound": false, "clip-odd": false, picture: false });
    // Once: nothing left to read.
    expect((await audioBatch(t.db)).results).toEqual([]);
  }, 60_000);

  it("comes with the hourly job, and alone with ?audio=1", async () => {
    await world();
    vi.stubEnv("CRON_SECRET", "cron-placeholder");
    const job = (q = "") => checkGet(new Request(`${BASE_URL}/api/jobs/showcase-check${q}`, { headers: { authorization: "Bearer cron-placeholder" } })).then((r) => r.json());
    expect(await job("?audio=1")).toMatchObject({ ok: true, left: 0 });
    await t.db.query(`update showcase_posts set has_audio = null`);
    expect(await job()).toMatchObject({ ok: true, audio: { ok: true, left: 0 } });
  }, 60_000);
});
