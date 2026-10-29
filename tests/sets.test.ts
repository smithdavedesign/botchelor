import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/sets/[slug]/route";
import { HIVE_MODERATION, setCheckFetchForTests } from "@/lib/adult/check";
import { saveAdultSettings } from "@/lib/adult/settings";
import { drawQueuedSets, ensureSet, listSetQueue, SET_MODEL, setPrompt, setSetsFetchForTests } from "@/lib/sets";
import { normalizeScene, setPath } from "@/lib/venues";
import { BASE_URL, startTestDb } from "./helpers";

// Drawn sets for places of their own (lib/sets.ts): once per place, screened by Hive, served for the scene's backdrop.
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
});
afterEach(() => {
  setSetsFetchForTests(null);
  setCheckFetchForTests(null);
});

const JPEG = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
const CLEAN = { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }, { class: "general_nsfw", value: 0.01 }] }] };

function fakeFal() {
  const drawn: string[] = [];
  setSetsFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `https://fal.run/${SET_MODEL}`) {
      drawn.push(JSON.parse(String(init?.body)).prompt);
      return Response.json({ images: [{ url: "https://cdn.fal.test/set.jpg" }] });
    }
    return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
  });
  return drawn;
}
const hive = (body: unknown) => setCheckFetchForTests(async (input: RequestInfo | URL) => (String(input) === HIVE_MODERATION ? Response.json(body) : new Response("?", { status: 500 })));
const keys = () => saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive" });
const serve = (label: string) => GET(new Request(`${BASE_URL}${setPath(label)}`), { params: Promise.resolve({ slug: setPath(label).split("/").pop()! }) });

describe("drawn sets", () => {
  it("draws a place once, empty, screened, and serves it however the place is written", async () => {
    await keys();
    const drawn = fakeFal();
    hive(CLEAN);
    expect((await serve("The Observatory")).status).toBe(404);
    expect(await ensureSet(t.db, "elsewhere@the observatory")).toBe("ready");
    expect(drawn).toEqual([setPrompt("the observatory")]);
    expect(drawn[0]).toMatch(/no people/);
    const res = await serve("An observatory");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(await ensureSet(t.db, "elsewhere@The Observatory")).toBe("exists");
    expect(drawn).toHaveLength(1);
  });

  it("serves the scene picker a small WebP copy for ?w=, and the full set without it", async () => {
    const { default: sharp } = await import("sharp");
    const big = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#402060" } }).jpeg().toBuffer();
    await t.db.query(`insert into place_sets (normalized, label, status, mime, data) values ('greenhouse', 'a greenhouse', 'ready', 'image/jpeg', $1)`, [big]);
    const thumb = await GET(new Request(`${BASE_URL}${setPath("a greenhouse")}?w=400`), { params: Promise.resolve({ slug: setPath("a greenhouse").split("/").pop()! }) });
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    expect(thumb.headers.get("cache-control")).toMatch(/max-age=604800/);
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([400, 225]);
    expect((await serve("a greenhouse")).headers.get("content-type")).toBe("image/jpeg");
  });

  it("keeps nothing Hive refuses, and doesn't try it again", async () => {
    await keys();
    const drawn = fakeFal();
    hive({ output: [{ classes: [{ class: "no_child_present", value: 0.9 }, { class: "general_nsfw", value: 0.8 }] }] });
    expect(await ensureSet(t.db, "elsewhere@a sauna")).toBe("refused");
    expect((await serve("a sauna")).status).toBe(404);
    expect(await ensureSet(t.db, "elsewhere@a sauna")).toBe("exists");
    expect(drawn).toHaveLength(1);
  });

  it("draws nothing for a library venue, a place that fails the show's text check, or without keys", async () => {
    const drawn = fakeFal();
    hive(CLEAN);
    expect(await ensureSet(t.db, "bowling_alley")).toBe("skipped");
    expect(await ensureSet(t.db, null)).toBe("skipped");
    expect(await ensureSet(t.db, "elsewhere@the observatory")).toBe("failed");
    expect(drawn).toEqual([]);
  });
});

describe("the queue of sets still to draw (David, 2026-10-26: \"if we don't have a picture for the scene add it to a queue\")", () => {
  it("draws the due ones a scene left behind, cut off or failed for a passing reason; leaves the rest; lists what's waiting", async () => {
    await keys();
    const drawn = fakeFal();
    hive(CLEAN);
    // A bathroom cut off mid-draw half an hour ago, a kitchen whose retry is due, a cellar not due yet, a dungeon refused.
    await t.db.query(
      `insert into place_sets (normalized, label, status, reason, attempts, retry_at, updated_at) values
         ($1, 'Sweet''s bathroom', 'drawing', null, 0, null, now() - interval '30 minutes'),
         ('kitchen', 'kitchen', 'failed', 'fal 503', 1, now() - interval '1 minute', now() - interval '20 minutes'),
         ('cellar', 'cellar', 'failed', 'fal 503', 1, now() + interval '1 hour', now() - interval '5 minutes'),
         ('dungeon', 'dungeon', 'refused', 'the safety check refused it', 1, null, now())`,
      [normalizeScene("Sweet's bathroom")],
    );
    expect((await listSetQueue(t.db)).map((q) => q.label).sort()).toEqual(["Sweet's bathroom", "cellar", "dungeon", "kitchen"]);
    const done = await drawQueuedSets(t.db, 5);
    expect(done.map((d) => d.label).sort()).toEqual(["Sweet's bathroom", "kitchen"]);
    expect(done.every((d) => d.status === "ready")).toBe(true);
    expect(drawn).toHaveLength(2);
    expect((await listSetQueue(t.db)).map((q) => q.label).sort()).toEqual(["cellar", "dungeon"]);
  });
});
