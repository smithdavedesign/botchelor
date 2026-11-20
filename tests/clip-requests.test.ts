// A person's own date as a clip to post (lib/clip-requests.ts, 2026-11-20): who may ask and for which dates, one live
// request a date, the first free then the plan or a bought date, the daily cap, the switch; the Mac's routes (claim,
// done, failed) and their secret; the notice when it's ready; who may open the files; and the episode page's box.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST as postClip } from "@/app/api/clips/route";
import { GET as getClip } from "@/app/api/clips/[id]/route";
import { GET as clipFileRoute } from "@/app/api/clips/[id]/[file]/route";
import { POST as claimRoute } from "@/app/api/clips/worker/claim/route";
import { POST as doneRoute } from "@/app/api/clips/worker/done/route";
import { POST as failedRoute } from "@/app/api/clips/worker/failed/route";
import ClipRequest from "@/app/episodes/[id]/ClipRequest";
import {
  CLIP_MAX_ATTEMPTS,
  CLIP_REQUESTS_DAILY_DEFAULT,
  clipCaption,
  clipDailyCap,
  clipPageFor,
  clipRefusal,
  clipRequestsOn,
  clipWorkerAuthorized,
  creditLine,
  isTestName,
  requestClip,
  type ClipDateFacts,
  type ClipView,
} from "@/lib/clip-requests";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setObjectStoreForTests } from "@/lib/object-store";
import { api, BASE_URL, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

const SECRET = ["clip", "worker", "secret", "0123456789"].join("-");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(64, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
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
  for (const table of ["clip_requests", "token_grants", "admins", "notifications", "creator_profiles"]) await t.db.query(`delete from ${table}`);
  vi.stubEnv("CLIP_REQUESTS", "1");
  vi.stubEnv("CLIP_WORKER_SECRET", SECRET);
  vi.stubEnv("CLIP_REQUESTS_DAILY", "");
  setObjectStoreForTests(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setObjectStoreForTests(undefined);
});

/** A date between a person's character and a house character; aired and public unless told otherwise. */
async function date(opts: { aired?: boolean; name?: string; owner?: string } = {}) {
  const owner = opts.owner ?? newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name: opts.name ?? "Pell Ardent" }), owner)).json()).id as string;
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  await t.db.query(`update episodes set visibility = 'public', transcript = $2::jsonb where id = $1`, [ep.id, JSON.stringify(LINES)]);
  if (opts.aired !== false) expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  else await t.db.query(`update episodes set revealed_at = null where id = $1`, [ep.id]);
  return { owner, user: userIdOf(owner), character, id: ep.id as string };
}

const ask = (cookie: string | null, body: Record<string, unknown>) =>
  postClip(new Request(`${BASE_URL}/api/clips`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const status = (id: string, cookie: string | null) => getClip(new Request(`${BASE_URL}/api/clips/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });
const worker = (secret: string | null = SECRET): Record<string, string> => (secret ? { authorization: `Bearer ${secret}` } : {});
const claim = (secret: string | null = SECRET) => claimRoute(new Request(`${BASE_URL}/api/clips/worker/claim`, { method: "POST", headers: worker(secret) }));
function doneForm(id: string, attempt: number, over: Record<string, string | Blob | null> = {}) {
  const f = new FormData();
  const fields: Record<string, string | Blob | null> = {
    id,
    attempt: String(attempt),
    seconds: "31.5",
    clip: new Blob([new Uint8Array(MP4)], { type: "video/mp4" }),
    poster: new Blob([new Uint8Array(PNG)], { type: "image/png" }),
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) if (v !== null) f.set(k, v);
  return f;
}
const done = (body: FormData, secret: string | null = SECRET) => doneRoute(new Request(`${BASE_URL}/api/clips/worker/done`, { method: "POST", headers: worker(secret), body }));
const failed = (body: Record<string, unknown>, secret: string | null = SECRET) =>
  failedRoute(new Request(`${BASE_URL}/api/clips/worker/failed`, { method: "POST", headers: { "content-type": "application/json", ...worker(secret) }, body: JSON.stringify(body) }));
const file = (id: string, name: string, cookie: string | null, query = "") =>
  clipFileRoute(new Request(`${BASE_URL}/api/clips/${id}/${name}${query}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id, file: name }) });
const tokensUsed = async (user: string) => Number((await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [user])).rows[0]?.used ?? 0);
const grant = (user: string, n: number) => t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), user, n]);

/** Asks, claims and finishes a clip of a fresh date: returns the date and the ready clip's id. */
async function readyClip(opts: { name?: string } = {}) {
  const d = await date(opts);
  const made = (await (await ask(d.owner, { episode_id: d.id })).json()).clip as ClipView;
  const got = (await (await claim()).json()).request;
  expect(got.id).toBe(made.id);
  expect((await done(doneForm(got.id, got.attempt))).status).toBe(200);
  return { ...d, clip: made.id };
}

describe("the switches and the pure rules", () => {
  it("is off unless CLIP_REQUESTS=1, with a small daily cap by default", () => {
    expect(clipRequestsOn({})).toBe(false);
    expect(clipRequestsOn({ CLIP_REQUESTS: "0" })).toBe(false);
    expect(clipRequestsOn({ CLIP_REQUESTS: "1" })).toBe(true);
    expect(clipDailyCap({})).toBe(CLIP_REQUESTS_DAILY_DEFAULT);
    expect(clipDailyCap({ CLIP_REQUESTS_DAILY: "5" })).toBe(5);
    expect(clipDailyCap({ CLIP_REQUESTS_DAILY: "-2" })).toBe(CLIP_REQUESTS_DAILY_DEFAULT);
  });

  it("lets the worker in only with the full secret, and never with a short one", () => {
    const req = (h: string | null) => new Request(`${BASE_URL}/x`, { headers: h ? { authorization: h } : {} });
    expect(clipWorkerAuthorized(req(`Bearer ${SECRET}`), { CLIP_WORKER_SECRET: SECRET })).toBe(true);
    expect(clipWorkerAuthorized(req(`Bearer ${SECRET}x`), { CLIP_WORKER_SECRET: SECRET })).toBe(false);
    expect(clipWorkerAuthorized(req(null), { CLIP_WORKER_SECRET: SECRET })).toBe(false);
    expect(clipWorkerAuthorized(req("Bearer short"), { CLIP_WORKER_SECRET: "short" })).toBe(false);
    expect(clipWorkerAuthorized(req("Bearer "), {})).toBe(false);
  });

  it("refuses everything but a finished, shareable date, to its own owner", () => {
    const side = (id: string, owner: string | null, extra: Partial<ClipDateFacts["characters"][0]> = {}) => ({ id, name: `Name ${id}`, owner_id: owner, visibility: "public", maker: null, ...extra });
    const ok: ClipDateFacts = { id: "e", status: "ready", revealed: true, visibility: "public", after_dark: false, reports: 0, characters: [side("a", "u1"), side("b", null)] };
    expect(clipRefusal(ok, "u1")).toEqual({ side: 0 });
    expect(clipRefusal({ ...ok, visibility: "unlisted" }, "u1")).toEqual({ side: 0 });
    expect(clipRefusal(null, "u1")).toEqual({ refusal: "not_found" });
    expect(clipRefusal(ok, "u2")).toEqual({ refusal: "not_yours" });
    expect(clipRefusal(ok, null)).toEqual({ refusal: "not_yours" });
    expect(clipRefusal(ok, "u1", "b")).toEqual({ refusal: "not_yours" });
    expect(clipRefusal({ ...ok, revealed: false }, "u1")).toEqual({ refusal: "not_ended" });
    expect(clipRefusal({ ...ok, status: "generating" }, "u1")).toEqual({ refusal: "not_ended" });
    expect(clipRefusal({ ...ok, visibility: "private" }, "u1")).toEqual({ refusal: "private_date" });
    expect(clipRefusal({ ...ok, after_dark: true }, "u1")).toEqual({ refusal: "after_dark" });
    expect(clipRefusal({ ...ok, reports: 1 }, "u1")).toEqual({ refusal: "reported" });
    expect(clipRefusal({ ...ok, characters: [side("a", "u1"), side("b", "u3", { visibility: "private" })] }, "u1")).toEqual({ refusal: "private_character" });
    expect(clipRefusal({ ...ok, characters: [side("a", "u1"), side("b", null, { name: "Quinn Tester" })] }, "u1")).toEqual({ refusal: "test_character" });
    // Owning both sides: the one asked for, else side a.
    const both: ClipDateFacts = { ...ok, characters: [side("a", "u1"), side("b", "u1")] };
    expect(clipRefusal(both, "u1", "b")).toEqual({ side: 1 });
    expect(clipRefusal(both, "u1")).toEqual({ side: 0 });
  });

  it("knows our test characters by name", () => {
    expect(isTestName("Mira Quell")).toBe(true);
    expect(isTestName("Planna Testwell")).toBe(true);
    expect(isTestName("E2E Bot")).toBe(true);
    expect(isTestName("Celeste Moreau")).toBe(false);
    expect(isTestName("Testarossa")).toBe(false);
  });

  it("credits the maker by their public handle, or names nobody, and keeps the character's name as written", () => {
    expect(creditLine("Nell Arden-Vance", { handle: "dave", name: "Dave" })).toBe("Nell Arden-Vance by @dave · botchelor.com");
    expect(creditLine("Nell", null)).toBe("Nell · made on botchelor.com");
    const caption = clipCaption({ mine: "Nell", other: "Sable", maker: { handle: "dave", name: "Dave" }, otherMaker: null, episodeId: "ep1" });
    expect(caption).toContain("Nell is by Dave: botchelor.com/creators/dave");
    expect(caption).toContain("botchelor.com/episodes/ep1?ref=clip");
    expect(caption).toContain("AI-generated fiction");
    expect(caption).not.toContain("Sable is by");
  });
});

describe("POST /api/clips", () => {
  it("is off by default", async () => {
    vi.stubEnv("CLIP_REQUESTS", "");
    const d = await date();
    const res = await ask(d.owner, { episode_id: d.id });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("off");
    expect((await t.db.query("select 1 from clip_requests")).rows).toHaveLength(0);
  });

  it("is for the owner of one side only", async () => {
    const d = await date();
    expect((await ask(newUserCookie(), { episode_id: d.id })).status).toBe(403);
    expect((await ask(null, { episode_id: d.id })).status).toBe(403);
    // The house character on the date isn't theirs to clip either.
    expect((await ask(d.owner, { episode_id: d.id, character_id: HOUSE_CHARACTERS[0].id })).status).toBe(403);
    expect((await ask(d.owner, { episode_id: "no-such-date" })).status).toBe(404);
    const res = await ask(d.owner, { episode_id: d.id });
    expect(res.status).toBe(201);
    const { clip } = await res.json();
    expect(clip).toMatchObject({ status: "queued", charge: "free", character_id: d.character, clip_src: null });
    expect(clip.credit).toBe("Pell Ardent · made on botchelor.com");
  });

  it("waits for the date to air, and refuses private, After Dark, reported and test-character dates", async () => {
    const unaired = await date({ aired: false });
    expect((await (await ask(unaired.owner, { episode_id: unaired.id })).json()).error).toBe("not_ended");

    const priv = await date({ name: "Corin Vale" });
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [priv.id]);
    expect((await (await ask(priv.owner, { episode_id: priv.id })).json()).error).toBe("private_date");

    const night = await date({ name: "Ada Lune" });
    await t.db.query(`update episodes set setup = coalesce(setup, '{}'::jsonb) || '{"after_dark": true}'::jsonb where id = $1`, [night.id]);
    expect((await (await ask(night.owner, { episode_id: night.id })).json()).error).toBe("after_dark");

    const reported = await date({ name: "Bea Thorn" });
    await t.db.query(`insert into reports (episode_id, reporter_id, reason) values ($1, $2, 'other')`, [reported.id, crypto.randomUUID()]);
    const res = await ask(reported.owner, { episode_id: reported.id });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("reported");

    const hidden = await date({ name: "Cal Wren" });
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [hidden.character]);
    expect((await (await ask(hidden.owner, { episode_id: hidden.id })).json()).error).toBe("private_character");

    const ours = await date({ name: "Quinn Tester" });
    expect((await (await ask(ours.owner, { episode_id: ours.id })).json()).error).toBe("test_character");
    expect((await t.db.query("select 1 from clip_requests")).rows).toHaveLength(0);
  });

  it("allows an unlisted date, as the owner's own share does", async () => {
    const d = await date();
    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [d.id]);
    expect((await ask(d.owner, { episode_id: d.id })).status).toBe(201);
  });

  it("keeps one live request a date: asking again returns it, charged once", async () => {
    const d = await date();
    const first = (await (await ask(d.owner, { episode_id: d.id })).json()).clip;
    const again = await ask(d.owner, { episode_id: d.id });
    expect(again.status).toBe(200);
    expect((await again.json()).clip.id).toBe(first.id);
    expect((await t.db.query("select 1 from clip_requests")).rows).toHaveLength(1);
  });

  it("gives the first clip free, then asks for the plan or a bought date, and counts a failed free one as unused", async () => {
    const owner = newUserCookie();
    const user = userIdOf(owner);
    const one = await date({ owner, name: "Pell Ardent" });
    const two = await date({ owner, name: "Rook Halloway" });
    expect((await (await ask(owner, { episode_id: one.id })).json()).clip.charge).toBe("free");
    const refused = await ask(owner, { episode_id: two.id });
    expect(refused.status).toBe(402);
    expect((await refused.json()).error).toBe("needs_tokens");

    await grant(user, 2);
    const paid = await ask(owner, { episode_id: two.id });
    expect(paid.status).toBe(201);
    expect((await paid.json()).clip.charge).toBe("tokens");
    expect(await tokensUsed(user)).toBe(1);

    // With the plan (an admin counts), nothing is spent.
    const three = await date({ owner, name: "Sorrel Imm" });
    await t.db.query(`insert into admins (user_id) values ($1)`, [user]);
    expect((await (await ask(owner, { episode_id: three.id })).json()).clip.charge).toBe("plan");
    expect(await tokensUsed(user)).toBe(1);

    // Their free one failing gives it back.
    await t.db.query(`update clip_requests set status = 'failed' where episode_id = $1`, [one.id]);
    await t.db.query(`delete from admins`);
    const four = await date({ owner, name: "Tamar Oake" });
    expect((await (await ask(owner, { episode_id: four.id })).json()).clip.charge).toBe("free");
  });

  it("stops at the daily cap for everyone together", async () => {
    vi.stubEnv("CLIP_REQUESTS_DAILY", "1");
    const a = await date({ name: "Pell Ardent" });
    const b = await date({ name: "Rook Halloway" });
    expect((await ask(a.owner, { episode_id: a.id })).status).toBe(201);
    const res = await ask(b.owner, { episode_id: b.id });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("busy_today");
    // Tomorrow is a new day.
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect((await requestClip(t.db, b.user, { episode_id: b.id }, tomorrow)).ok).toBe(true);
  });

  it("credits a public creator page, and the other side's only on a public date", async () => {
    const d = await date();
    await t.db.query(`insert into creator_profiles (user_id, handle, display_name) values ($1, 'pellmaker', 'Pell''s Maker')`, [d.user]);
    const { clip } = await (await ask(d.owner, { episode_id: d.id })).json();
    expect(clip.credit).toBe("Pell Ardent by @pellmaker · botchelor.com");
    expect(clip.caption).toContain("Pell Ardent is by Pell's Maker: botchelor.com/creators/pellmaker");
  });
});

describe("the worker's routes", () => {
  it("are a 404 without the secret, with a wrong one, or with none set", async () => {
    const d = await date();
    await ask(d.owner, { episode_id: d.id });
    expect((await claim(null)).status).toBe(404);
    expect((await claim("wrong-secret-wrong-secret")).status).toBe(404);
    expect((await done(doneForm("x", 1), null)).status).toBe(404);
    expect((await failed({ id: "x", attempt: 1, error: "e" }, null)).status).toBe(404);
    vi.stubEnv("CLIP_WORKER_SECRET", "");
    expect((await claim("")).status).toBe(404);
    expect((await t.db.query(`select status from clip_requests`)).rows[0]).toEqual({ status: "queued" });
  });

  it("claims the oldest request with the date as a stranger sees it, once", async () => {
    const d = await date();
    await ask(d.owner, { episode_id: d.id });
    const got = (await (await claim()).json()).request;
    expect(got).toMatchObject({ episode_id: d.id, character_id: d.character, side: "a", attempt: 1, credit: "Pell Ardent · made on botchelor.com" });
    expect(got.episode.id).toBe(d.id);
    expect(got.episode.transcript).toHaveLength(LINES.length);
    expect(got.episode.is_creator).toBe(false);
    expect((await (await claim()).json()).request).toBeNull();
    vi.stubEnv("CLIP_REQUESTS", "");
    expect((await (await claim()).json()).request).toBeNull();
  });

  it("fails a request whose date went private since, gives back its bought date and says so", async () => {
    const owner = newUserCookie();
    const user = userIdOf(owner);
    const first = await date({ owner, name: "Pell Ardent" });
    await ask(owner, { episode_id: first.id });
    await t.db.query(`update clip_requests set status = 'ready'`);
    const d = await date({ owner, name: "Rook Halloway" });
    await grant(user, 1);
    expect((await (await ask(owner, { episode_id: d.id })).json()).clip.charge).toBe("tokens");
    expect(await tokensUsed(user)).toBe(1);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [d.id]);
    expect((await (await claim()).json()).request).toBeNull();
    expect((await t.db.query(`select status, error from clip_requests where episode_id = $1`, [d.id])).rows[0]).toEqual({ status: "failed", error: "private_date" });
    expect(await tokensUsed(user)).toBe(0);
    const notes = (await t.db.query<{ kind: string; title: string }>(`select kind, title from notifications where user_id = $1`, [user])).rows;
    expect(notes.some((n) => n.kind === "date_clip" && /couldn't be made/.test(n.title))).toBe(true);
  });

  it("keeps the finished clip, marks it ready and tells its owner", async () => {
    const d = await readyClip();
    const { clip } = await (await status(d.clip, d.owner)).json();
    expect(clip).toMatchObject({ status: "ready", seconds: 31.5, clip_src: `/api/clips/${d.clip}/clip.mp4`, poster_src: `/api/clips/${d.clip}/poster.png`, page: `/clips/${d.clip}` });
    const notes = (await t.db.query<{ kind: string; title: string; link: string }>(`select kind, title, link from notifications where user_id = $1 and kind = 'date_clip'`, [d.user])).rows;
    expect(notes).toEqual([{ kind: "date_clip", title: expect.stringMatching(/^🎬 Your clip of Pell Ardent × .+ is ready$/), link: `/clips/${d.clip}` }]);
    // A second report for the same attempt, or a stale attempt, changes nothing.
    expect((await done(doneForm(d.clip, 1))).status).toBe(409);
  });

  it("checks what it's sent", async () => {
    const d = await date();
    await ask(d.owner, { episode_id: d.id });
    const got = (await (await claim()).json()).request;
    expect((await done(doneForm(got.id, got.attempt, { clip: new Blob([new Uint8Array(PNG)]) }))).status).toBe(400);
    expect((await done(doneForm(got.id, got.attempt, { seconds: "0" }))).status).toBe(400);
    expect((await done(doneForm(got.id, got.attempt, { poster: new Blob([new Uint8Array(MP4)]) }))).status).toBe(400);
    expect((await done(doneForm(got.id, got.attempt + 1))).status).toBe(409);
    expect((await done(doneForm("no-such-clip", 1))).status).toBe(404);
  });

  it("puts a passing failure back in the queue, and fails for good after the last attempt, giving back a bought date", async () => {
    const owner = newUserCookie();
    const user = userIdOf(owner);
    const first = await date({ owner, name: "Pell Ardent" });
    await ask(owner, { episode_id: first.id });
    await t.db.query(`update clip_requests set status = 'ready'`);
    const d = await date({ owner, name: "Rook Halloway" });
    await grant(user, 1);
    const asked = (await (await ask(owner, { episode_id: d.id })).json()).clip;
    for (let attempt = 1; attempt <= CLIP_MAX_ATTEMPTS; attempt++) {
      const got = (await (await claim()).json()).request;
      expect(got).toMatchObject({ id: asked.id, attempt });
      const res = await failed({ id: got.id, attempt, error: "Venice timed out", retry: true });
      expect((await res.json()).status).toBe(attempt < CLIP_MAX_ATTEMPTS ? "queued" : "failed");
    }
    expect((await (await status(asked.id, owner)).json()).clip.status).toBe("failed");
    expect(await tokensUsed(user)).toBe(0);
    // A failed clip can be asked for again.
    await grant(user, 1);
    expect((await ask(owner, { episode_id: d.id })).status).toBe(201);
  });

  it("fails at once without retry, and takes back a render that went quiet past its lease", async () => {
    const d = await date();
    await ask(d.owner, { episode_id: d.id });
    let got = (await (await claim()).json()).request;
    // The lease runs out (the Mac slept): the next claim takes it again as a new attempt.
    await t.db.query(`update clip_requests set leased_until = now() - interval '1 minute'`);
    const again = (await (await claim()).json()).request;
    expect(again).toMatchObject({ id: got.id, attempt: 2 });
    // The first attempt's late report counts for nothing.
    expect((await failed({ id: got.id, attempt: 1, error: "late" })).status).toBe(409);
    got = again;
    expect((await (await failed({ id: got.id, attempt: 2, error: "the date has 2 spoken lines" })).json()).status).toBe("failed");
  });
});

describe("reading a clip", () => {
  it("is its owner's to check, and its files open for anyone with the link while the date is shareable", async () => {
    const d = await readyClip();
    expect((await status(d.clip, newUserCookie())).status).toBe(404);
    expect((await status(d.clip, null)).status).toBe(404);

    const mine = await file(d.clip, "clip.mp4", d.owner);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("video/mp4");
    expect(mine.headers.get("cache-control")).toContain("private");
    const stranger = await file(d.clip, "clip.mp4", null);
    expect(stranger.status).toBe(200);
    expect((await file(d.clip, "poster.png", null)).headers.get("content-type")).toBe("image/png");
    const dl = await file(d.clip, "clip.mp4", d.owner, "?download=1");
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename="botchelor-clip-/);
    expect((await file(d.clip, "other.txt", d.owner)).status).toBe(404);

    // The date goes private: its owner keeps the clip, nobody else sees it.
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [d.id]);
    expect((await file(d.clip, "clip.mp4", null)).status).toBe(404);
    expect((await file(d.clip, "clip.mp4", d.owner)).status).toBe(200);
    expect(await clipPageFor(t.db, d.clip, null)).toBeNull();
    expect((await clipPageFor(t.db, d.clip, d.user))?.owner).toBe(true);
  });

  it("serves an unlisted date's clip by link, and none once reports hide the date", async () => {
    const d = await readyClip();
    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [d.id]);
    expect((await file(d.clip, "clip.mp4", null)).status).toBe(200);
    expect((await clipPageFor(t.db, d.clip, null))?.owner).toBe(false);
    for (let i = 0; i < 3; i++) await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [d.id, crypto.randomUUID()]);
    expect((await file(d.clip, "clip.mp4", null)).status).toBe(404);
  });

  it("shows a stranger nothing of a clip still rendering", async () => {
    const d = await date();
    const { clip } = await (await ask(d.owner, { episode_id: d.id })).json();
    expect(await clipPageFor(t.db, clip.id, null)).toBeNull();
    expect((await clipPageFor(t.db, clip.id, d.user))?.status).toBe("queued");
    expect((await file(clip.id, "clip.mp4", d.owner)).status).toBe(404);
  });

  it("answers nothing on After Dark's own host, not even to the owner", async () => {
    const d = await readyClip();
    vi.stubEnv("AFTER_DARK_ONLY", "1");
    vi.stubEnv("AFTER_DARK_ORIGIN", "https://afterdark.example");
    expect((await status(d.clip, d.owner)).status).toBe(404);
    expect((await file(d.clip, "clip.mp4", d.owner)).status).toBe(404);
    expect((await ask(d.owner, { episode_id: d.id })).status).toBe(404);
    expect((await claim()).status).toBe(404);
  });
});

describe("the episode page's box (app/episodes/[id]/ClipRequest.tsx)", () => {
  const view = (over: Partial<ClipView> = {}): ClipView => ({
    id: "c1",
    episode_id: "e1",
    character_id: "ch1",
    status: "queued",
    charge: "free",
    credit: "Nell by @dave · botchelor.com",
    caption: "My OC Nell went on an AI blind date",
    page: "/clips/c1",
    clip_src: null,
    download_src: null,
    poster_src: null,
    seconds: null,
    created_at: new Date().toISOString(),
    ready_at: null,
    ...over,
  });
  const html = (initial: ClipView | null) => renderToStaticMarkup(createElement(ClipRequest, { episodeId: "e1", characterId: "ch1", initial, price: "your first one is free" }));

  it("offers a clip, says it's rendering, then gives Download, Share and the caption", () => {
    expect(html(null)).toContain("Make a clip to post");
    expect(html(null)).toContain("your first one is free");
    expect(html(view())).toContain("Rendering your clip");
    expect(html(view({ status: "failed" }))).toContain("Make a clip to post");
    const ready = html(view({ status: "ready", clip_src: "/api/clips/c1/clip.mp4", download_src: "/api/clips/c1/clip.mp4?download=1" }));
    expect(ready).toContain("Download");
    expect(ready).toContain("Share");
    expect(ready).toContain("My OC Nell went on an AI blind date");
    expect(ready).toContain('href="/clips/c1"');
  });
});
