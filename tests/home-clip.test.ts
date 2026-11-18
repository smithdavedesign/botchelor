// The home page plays the day's clip (lib/home-clip.ts, 2026-11-15): the row helper, the admin upload route's refusals
// (no key, not aired, private), the public file route (byte ranges, taken down with its date), and the home hero for a
// visitor with a clip, without one, with a stale one and with the switches off; the sentence box and its events.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { renderToStaticMarkup } from "react-dom/server";
import { POST as upload } from "@/app/api/admin/home-clip/route";
import { GET as clipFile } from "@/app/api/home-clip/[id]/[file]/route";
import { expressEventAt, expressStartedEvent, EXPRESS_SAY_KEY, EXPRESS_TEXT_MAX, EXPRESS_TEXT_MIN } from "@/lib/express-create";
import { getEpisodeView } from "@/lib/game";
import { CLIP_FRESH_DAYS, clipCaption, clipRefusal, homeExpressBoxOn, homeHeroClipOn, latestHomeClip, LOOP_MAX_BYTES, looksLikeJpeg, looksLikeMp4, saveHomeClip } from "@/lib/home-clip";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setObjectStoreForTests, type ObjectStore } from "@/lib/object-store";
import { api, BASE_URL, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

const KEY = ["owner", "pass", "clip"].join("-");
/** The smallest things the route takes for an MP4 and a JPEG: the right first bytes (it never decodes them). */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(40, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 3)]);

/** Enough spoken lines for the hero's typed-in date (lib/featured-date.ts). */
const LINES = ["So you review fountains?", "Only the ones that deserve it.", "And this one?", "A four. It's trying too hard.", "Harsh.", "Fair."].map((dialogue, i) => ({
  side: i % 2 ? "b" : "a",
  dialogue,
}));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from home_clips");
  jar.cookies.clear();
  vi.stubEnv("FRONTIER_PASSWORD", KEY);
  setObjectStoreForTests(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setObjectStoreForTests(undefined);
});

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
};
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const home = async () => text(renderToStaticMarkup(await (await import("@/app/page")).default({ searchParams: Promise.resolve({}) })));

/** A date with a house character; `aired`: revealed and public. */
async function date(opts: { aired?: boolean; name?: string } = {}) {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name: opts.name ?? "Pell Ardent" }), owner)).json()).id as string;
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  await t.db.query(`update episodes set visibility = 'public', transcript = $2::jsonb where id = $1`, [ep.id, JSON.stringify(LINES)]);
  if (opts.aired !== false) expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  else await t.db.query(`update episodes set revealed_at = null where id = $1`, [ep.id]);
  return { owner, character, id: ep.id as string };
}

function form(episode: string, over: Record<string, string | Blob | null> = {}) {
  const f = new FormData();
  const fields: Record<string, string | Blob | null> = {
    episode,
    width: "480",
    height: "854",
    seconds: "12",
    day: "2026-11-15",
    loop: new Blob([new Uint8Array(MP4)], { type: "video/mp4" }),
    poster: new Blob([new Uint8Array(JPEG)], { type: "image/jpeg" }),
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) if (v !== null) f.set(k, v);
  return f;
}
const send = (body: FormData, key: string | null = KEY) => upload(new Request(`${BASE_URL}/api/admin/home-clip`, { method: "POST", headers: key ? { "x-frontier-key": key } : {}, body }));
const file = (id: string, name: string, headers: Record<string, string> = {}) => clipFile(new Request(`${BASE_URL}/api/home-clip/${id}/${name}`, { headers }), { params: Promise.resolve({ id, file: name }) });

describe("the switches and the pure parts", () => {
  it("are on unless 0, and the box also needs one-sentence create", () => {
    expect(homeHeroClipOn({})).toBe(true);
    expect(homeHeroClipOn({ HOME_HERO_CLIP: "0" })).toBe(false);
    expect(homeExpressBoxOn({})).toBe(true);
    expect(homeExpressBoxOn({ HOME_EXPRESS_BOX: "0" })).toBe(false);
    expect(homeExpressBoxOn({ EXPRESS_CREATE: "0" })).toBe(false);
  });
  it("knows an MP4 and a JPEG by their first bytes", () => {
    expect(looksLikeMp4(MP4)).toBe(true);
    expect(looksLikeMp4(JPEG)).toBe(false);
    expect(looksLikeJpeg(JPEG)).toBe(true);
    expect(looksLikeJpeg(MP4)).toBe(false);
  });
  it("captions the pair, and the ending when there is one", () => {
    expect(clipCaption({ names: ["Juno", "Pell"], ending: "A second date" })).toBe("Juno × Pell · It ended: A second date");
    expect(clipCaption({ names: ["Juno", "Pell"], ending: null })).toBe("Juno × Pell");
  });
  it("carries where the sentence was typed on the express events, and nothing when it was /create itself", () => {
    const started = expressStartedEvent({ length: 40, named: false, example: false });
    expect(expressEventAt(started, "home")).toEqual({ name: "express_started", props: { length: 40, named: false, example: false, place: "home" } });
    expect(expressEventAt(started, null)).toBe(started);
    expect(EXPRESS_SAY_KEY).toBe("bz_express_say");
  });
});

describe("POST /api/admin/home-clip", () => {
  it("needs the admin password", async () => {
    const d = await date();
    expect((await send(form(d.id), null)).status).toBe(403);
    expect((await send(form(d.id), "wrong")).status).toBe(403);
    // A signed-in visitor's cookie is not the password either.
    const res = await upload(new Request(`${BASE_URL}/api/admin/home-clip`, { method: "POST", headers: { cookie: d.owner }, body: form(d.id) }));
    expect(res.status).toBe(403);
    expect((await t.db.query("select 1 from home_clips")).rows).toHaveLength(0);
  });

  it("refuses a date that hasn't aired, a private or unlisted one, one with a private character, and one that isn't there", async () => {
    const unaired = await date({ aired: false });
    const res = await send(form(unaired.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_aired");

    const priv = await date({ name: "Otto Fenn" });
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [priv.id]);
    expect((await (await send(form(priv.id))).json()).error).toBe("episode_not_found");
    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [priv.id]);
    expect((await (await send(form(priv.id))).json()).error).toBe("not_public");

    const shy = await date({ name: "Mira Vale" });
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [shy.character]);
    const refused = await send(form(shy.id));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("not_public");

    expect((await send(form("no-such-date"))).status).toBe(404);
    expect((await t.db.query("select 1 from home_clips")).rows).toHaveLength(0);
  });

  it("refuses the wrong files, sizes and shapes", async () => {
    const d = await date();
    expect((await (await send(form(d.id, { loop: new Blob([new Uint8Array(JPEG)]) }))).json()).error).toBe("invalid_files");
    expect((await (await send(form(d.id, { poster: null }))).json()).error).toBe("missing_files");
    expect((await send(form(d.id, { loop: new Blob([new Uint8Array(Buffer.concat([MP4, Buffer.alloc(LOOP_MAX_BYTES)]))]) }))).status).toBe(413);
    expect((await (await send(form(d.id, { seconds: "90" }))).json()).error).toBe("invalid_size");
    expect((await (await send(form(d.id, { width: "4000" }))).json()).error).toBe("invalid_size");
    expect((await (await send(form("../etc"))).json()).error).toBe("invalid_episode");
  });

  it("answers 404 when the clip is switched off", async () => {
    const d = await date();
    vi.stubEnv("HOME_HERO_CLIP", "0");
    expect((await send(form(d.id))).status).toBe(404);
  });

  it("keeps an aired public date's clip, one per date, and serves its files with byte ranges", async () => {
    const d = await date();
    const res = await send(form(d.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, episode_id: d.id, day: "2026-11-15" });
    expect(body.loop).toBe(`/api/home-clip/${body.id}/loop.mp4`);

    const whole = await file(body.id, "loop.mp4");
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("cache-control")).toContain("public");
    const bytes = Buffer.from(await whole.arrayBuffer());
    expect(looksLikeMp4(bytes)).toBe(true);
    // Safari asks for the first two bytes before it plays anything.
    const part = await file(body.id, "loop.mp4", { range: "bytes=0-1" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-1/${bytes.length}`);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(bytes.subarray(0, 2));
    const tail = await file(body.id, "loop.mp4", { range: "bytes=-4" });
    expect(Buffer.from(await tail.arrayBuffer())).toEqual(bytes.subarray(bytes.length - 4));
    expect((await file(body.id, "loop.mp4", { range: `bytes=${bytes.length}-` })).status).toBe(416);
    const poster = await file(body.id, "poster.jpg");
    expect(poster.headers.get("content-type")).toBe("image/jpeg");
    expect(looksLikeJpeg(Buffer.from(await poster.arrayBuffer()))).toBe(true);
    expect((await file(body.id, "other.bin")).status).toBe(404);
    expect((await file("nope", "loop.mp4")).status).toBe(404);

    // The same date again replaces its clip: one row, a new id, the old address gone.
    const again = await (await send(form(d.id, { day: "2026-11-16" }))).json();
    expect(again.id).not.toBe(body.id);
    expect((await t.db.query<{ day: string }>("select day from home_clips")).rows).toEqual([{ day: "2026-11-16" }]);
    expect((await file(body.id, "loop.mp4")).status).toBe(404);
  });

  it("puts the files in the store when there is one, and sends a signed link", async () => {
    const kept = new Map<string, Buffer>();
    const store: ObjectStore = {
      put: async (key, bytes) => void kept.set(key, bytes),
      get: async (key) => kept.get(key) ?? null,
      remove: async (key) => void kept.delete(key),
      presign: async (key) => ({ url: `https://media.example/${key}?signed=1`, maxAge: 900 }),
    };
    setObjectStoreForTests(store);
    const d = await date();
    const body = await (await send(form(d.id))).json();
    expect([...kept.keys()].every((k) => k.startsWith("clips/"))).toBe(true);
    expect(kept.size).toBe(2);
    const row = (await t.db.query<{ loop_key: string; loop_data: Buffer | null }>("select loop_key, loop_data from home_clips")).rows[0];
    expect(row.loop_key).toMatch(/^clips\/.+\.mp4$/);
    expect(row.loop_data).toBeNull();
    const res = await file(body.id, "loop.mp4");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://media.example/${row.loop_key}?signed=1`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=900");
    // Sent again, the date's old files leave the store with the old row.
    await send(form(d.id));
    expect(kept.size).toBe(2);
    expect(kept.has(row.loop_key)).toBe(false);
  });
});

describe("latestHomeClip", () => {
  it("is the newest fresh clip of a date still public, with its names and ending", async () => {
    expect(await latestHomeClip(t.db)).toBeNull();
    const d = await date();
    expect(clipRefusal(await getEpisodeView(t.db, d.id, null))).toBeNull();
    const { id } = await saveHomeClip(t.db, { episode_id: d.id, day: "2026-11-15", loop: MP4, poster: JPEG, width: 480, height: 854, seconds: 12 });
    const clip = await latestHomeClip(t.db);
    expect(clip).toMatchObject({ id, episode_id: d.id, watch_href: `/episodes/${d.id}?play=1`, loop_src: `/api/home-clip/${id}/loop.mp4`, poster_src: `/api/home-clip/${id}/poster.jpg`, width: 480, height: 854, seconds: 12 });
    expect(clip!.names).toEqual(["Pell Ardent", HOUSE_CHARACTERS[0].name]);
    expect(clip!.ending).toBe("A second date");

    // Stale: older than CLIP_FRESH_DAYS, by the clock handed in or by the row's own date.
    expect(await latestHomeClip(t.db, new Date(Date.now() + (CLIP_FRESH_DAYS + 1) * 86_400_000))).toBeNull();
    expect(await latestHomeClip(t.db, new Date(Date.now() + (CLIP_FRESH_DAYS - 1) * 86_400_000))).not.toBeNull();
  });

  it("drops a clip whose date was reported away, went private, or whose character did; and the files go with it", async () => {
    const d = await date();
    const { id } = await saveHomeClip(t.db, { episode_id: d.id, day: "2026-11-15", loop: MP4, poster: JPEG, width: 480, height: 854, seconds: 12 });
    expect(await latestHomeClip(t.db)).not.toBeNull();

    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [d.id]);
    expect(await latestHomeClip(t.db)).toBeNull();
    expect((await file(id, "loop.mp4")).status).toBe(404);
    expect((await file(id, "poster.jpg")).status).toBe(404);
    await t.db.query(`update episodes set visibility = 'public' where id = $1`, [d.id]);
    expect(await latestHomeClip(t.db)).not.toBeNull();

    await t.db.query(`update characters set visibility = 'private' where id = $1`, [d.character]);
    expect(await latestHomeClip(t.db)).toBeNull();
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [d.character]);

    for (let i = 0; i < 3; i++) expect((await api.report({ episode_id: d.id, reason: "other" }, newUserCookie())).status).toBeLessThan(300);
    expect(await latestHomeClip(t.db)).toBeNull();
    expect((await file(id, "loop.mp4")).status).toBe(404);
  });
});

describe("the home hero", () => {
  const withClip = async () => {
    const d = await date();
    const { id } = await saveHomeClip(t.db, { episode_id: d.id, day: "2026-11-15", loop: MP4, poster: JPEG, width: 480, height: 854, seconds: 12 });
    return { ...d, clip: id };
  };

  it("plays the clip in a phone for a visitor with no character, poster first, and keeps the headline, the doors and the real date", async () => {
    const d = await withClip();
    as(null);
    const html = await home();
    expect(html).toContain('class="hero-art has-clip"');
    expect(html).toContain('<section class="hero has-clip">');
    // Muted, looping, inline, nothing loaded before it plays: the poster is the first paint.
    expect(html).toMatch(/<video[^>]*class="home-clip-video"[^>]*>/);
    const video = /<video[^>]*>/.exec(html)![0];
    for (const attr of ["muted", "loop", "playsInline", 'preload="none"', `poster="/api/home-clip/${d.clip}/poster.jpg"`]) expect(video.toLowerCase(), attr).toContain(attr.toLowerCase());
    expect(video).not.toContain("autoplay"); // the script starts it, so reduced motion and save-data can leave it still
    expect(html).toContain(`<source src="/api/home-clip/${d.clip}/loop.mp4" type="video/mp4"/>`);
    expect(html).toContain('class="phone phone-short"');
    // The two, how it ended (public: it aired), and one tap to the whole date.
    expect(html).toContain(`Pell Ardent × ${HOUSE_CHARACTERS[0].name} · It ended: A second date`);
    expect(html).toContain(`href="/episodes/${d.id}?play=1"`);
    expect(html).toContain("Watch the whole date");
    // What was there stays.
    expect(html).toContain('<h2 class="hero-title">Give your character a love life.</h2>'); // under the first screen (lib/home-open.ts)
    expect(html).toContain('href="/create">Make your character</a>');
    // The clip's "Watch the whole date" is the way to watch; the hero doesn't ask twice (design review 2026-11-16, D-18).
    expect(html).not.toContain('href="/watch">Watch episodes</a>');
    expect(html).toContain('href="/create?sample=1"');
    expect(html).toContain("Bring your character");
    expect(html).toContain("A real date from the show: nobody wrote it in advance.");
    expect(html).toContain('class="home-date"');
  });

  it("is exactly today's hero with no clip, a stale one, or the switch off", async () => {
    await date();
    as(null);
    const plain = await home();
    expect(plain).not.toContain("home-clip");
    expect(plain).not.toContain("has-clip");
    expect(plain).toContain('<section class="hero">');
    expect(plain).toContain('class="hero-art has-date"');
    expect(plain).not.toContain('class="home-date"');

    const d = (await t.db.query<{ id: string }>("select id from episodes limit 1")).rows[0];
    await saveHomeClip(t.db, { episode_id: d.id, day: "2026-10-01", loop: MP4, poster: JPEG, width: 480, height: 854, seconds: 12 });
    expect(await home()).toContain("has-clip");
    await t.db.query(`update home_clips set created_at = now() - make_interval(days => $1::int)`, [CLIP_FRESH_DAYS + 1]);
    const stale = await home();
    expect(stale).not.toContain("has-clip");
    expect(stale).toContain('class="hero-art has-date"');

    await t.db.query(`update home_clips set created_at = now()`);
    vi.stubEnv("HOME_HERO_CLIP", "0");
    const off = await home();
    expect(off).not.toContain("has-clip");
    expect(off).toContain('class="hero-art has-date"');
  });

  it("leaves an owner's home as it is: no clip, no box", async () => {
    const d = await withClip();
    as(d.owner);
    const html = await home();
    expect(userIdOf(d.owner)).toBeTruthy();
    expect(html).not.toContain("has-clip");
    expect(html).not.toContain("home-express");
    expect(html).toContain('<a class="button" href="/create">Make your character</a>');
  });

  it("puts the sentence box under the headline for a visitor, and the old button back when express is off", async () => {
    as(null);
    const html = await home();
    const box = html.indexOf('class="home-express"');
    expect(box).toBeGreaterThan(html.indexOf("<h1>Give your character a love life.</h1>"));
    expect(box).toBeLessThan(html.indexOf('id="hero-cta"'));
    expect(html).toContain('<form class="home-express" action="/create" method="get">');
    expect(html).toContain("Describe someone in a sentence");
    const input = /<input[^>]*name="say"[^>]*>/.exec(html)![0];
    for (const attr of ['required=""', `minLength="${EXPRESS_TEXT_MIN}"`, `maxLength="${EXPRESS_TEXT_MAX}"`]) expect(input, attr).toContain(attr);
    expect(html).toContain('data-track="home-express"');
    // The box's button is the main one; the long way in, the sample and the import stay.
    expect(html).toContain('<a class="button-ghost" href="/create">Make your character</a>');
    expect(html).toContain('href="/create?sample=1"');
    expect(html).toContain('data-track="hero-import"');

    for (const [k, v] of [["EXPRESS_CREATE", "0"], ["HOME_EXPRESS_BOX", "0"]] as const) {
      vi.stubEnv(k, v);
      const off = await home();
      expect(off, k).not.toContain("home-express");
      expect(off, k).toContain('<a class="button" href="/create">Make your character</a>');
      vi.unstubAllEnvs();
      vi.stubEnv("FRONTIER_PASSWORD", KEY);
    }
  });
});
