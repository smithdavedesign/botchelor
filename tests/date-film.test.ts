// A date on film (lib/date-film.ts, 2026-11-24): the words said to camera and the take that holds them, the scenes'
// moments, the two ceilings on what it may spend, a whole date filmed against faked providers (the free pictures, the
// check, the voice, the talking model), the files' route, and the episode's page and JSON.
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/date-film/route";
import { GET as fileGet } from "@/app/api/date-film/[id]/[file]/route";
import { GET as episodeGet } from "@/app/api/episodes/[id]/route";
import DateScenes from "@/app/episodes/[id]/DateScenes";
import DiaryCam from "@/app/episodes/[id]/DiaryCam";
import { HIVE_MODERATION, HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setDeepgramFetchForTests } from "@/lib/companion-live";
import { dateFilm, dateFilmOn, FILM_ATTEMPTS, FILM_DAY_USD, FILM_MODEL, FILM_MONTH_USD, filmBudgets, filmDate, filmDue, filmSpent, holdFilmBudget, scenePrompt, settleFilmBudget } from "@/lib/date-film";
import { FILM_CLIP_MAX_USD, FILM_FPS, FILM_LEAD_S, FILM_MAX_FRAMES, FILM_MAX_VOICE_S, filmCost, filmFrames, filmLine, momentCaption, sceneMoments } from "@/lib/date-film-shared";
import { voiceForTake, wavOf, wavPcm } from "@/lib/date-film-wav";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setObjectStoreForTests } from "@/lib/object-store";
import { showStyleSql } from "@/lib/portrait-sql";
import { characterPortrait } from "@/lib/portraits";
import { api, BASE_URL, episodeJson, scriptedModel, scriptOutcome, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

const KEY = ["owner", "pass", "film"].join("-");
const WORKER = "https://images.worker.test";
const SITE = "https://botchelor.test";
const NOW = new Date("2026-11-24T01:10:00Z");
const HOUSE = HOUSE_CHARACTERS[0].id;

let t: Awaited<ReturnType<typeof startTestDb>>;
let PORTRAIT: Buffer;
let DRAWN: Buffer;
let STILL: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  PORTRAIT = await sharp({ create: { width: 64, height: 80, channels: 3, background: { r: 180, g: 120, b: 100 } } }).jpeg().toBuffer();
  DRAWN = await sharp({ create: { width: 448, height: 560, channels: 3, background: { r: 90, g: 60, b: 140 } } }).png().toBuffer();
  STILL = await sharp({ create: { width: 64, height: 80, channels: 3, background: { r: 200, g: 150, b: 160 } } }).webp().toBuffer();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", KEY);
  vi.stubEnv("DEEPGRAM_API_KEY", "placeholder-deepgram");
  vi.stubEnv("WORKERS_AI_URL", WORKER);
  vi.stubEnv("WORKERS_AI_KEY", "a-test-gate-key-0123456789");
  vi.stubEnv("SITE_URL", SITE);
  setObjectStoreForTests(null);
  setReplicatePausesForTests(false);
  await saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive", venice_key: "placeholder-venice", replicate_key: "placeholder-replicate", moderation: { pg_via: "hive" } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setCheckFetchForTests(null);
  setReplicateFetchForTests(null);
  setReplicatePausesForTests(true);
  setDeepgramFetchForTests(null);
  setObjectStoreForTests(undefined);
});

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(400, 7)]);
const silence = (seconds: number, rate = 24000) => wavOf(Buffer.alloc(Math.round(seconds * rate) * 2), rate);

/* ------------------------------------------------- fakes ------------------------------------------------- */

const CLEAN = { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }, { class: "general_nsfw", value: 0.01 }] }] };
const NSFW = { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }, { class: "general_nsfw", value: 0.5 }] }] };
const ADULTS = { choices: [{ message: { content: "ADULTS" } }] };
function hive(mod: unknown = CLEAN) {
  const seen = { calls: 0 };
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    seen.calls++;
    return String(input) === HIVE_MODERATION ? Response.json(mod) : String(input) === HIVE_VLM ? Response.json(ADULTS) : new Response("?", { status: 500 });
  });
  return seen;
}

type Draw = { prompt: string; size: string; refs: number };
/** The free pictures' Worker (`draw`, and a budget with `left` neurons left); every other address serves a portrait. */
function fakeWorker(opts: { left?: number } = {}) {
  const draws: Draw[] = [];
  const asked: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${WORKER}/draw`) {
      const form = init?.body as FormData;
      draws.push({ prompt: String(form.get("prompt")), size: `${form.get("width")}x${form.get("height")}`, refs: [0, 1, 2, 3].filter((i) => form.has(`input_image_${i}`)).length });
      return Response.json({ image: DRAWN.toString("base64"), model: "@cf/black-forest-labs/flux-2-klein-4b", neurons: 172.4, used: 172.4 * draws.length, limit: 9000 });
    }
    if (url === `${WORKER}/budget`) return Response.json({ day: "2026-11-24", used: 9000 - (opts.left ?? 8000), limit: 9000, left: opts.left ?? 8000 });
    asked.push(url);
    return new Response(new Uint8Array(PORTRAIT), { headers: { "content-type": "image/jpeg" } });
  }) as typeof fetch;
  return { draws, asked, fetchImpl };
}

/** The voice: `seconds` of WAV for every line, and what was asked for. */
function voice(seconds = 5) {
  const said: { voice: string; text: string }[] = [];
  setDeepgramFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    said.push({ voice: new URL(String(input)).searchParams.get("model") ?? "", text: (JSON.parse(String(init?.body)) as { text: string }).text });
    return new Response(new Uint8Array(silence(seconds)), { headers: { "content-type": "audio/wav" } });
  });
  return said;
}

/** The talking model: every take succeeds (or `fail`s), and what it was sent. */
function replicate(opts: { fail?: boolean; gate?: Promise<void> } = {}) {
  const takes: { model: string; input: Record<string, unknown> }[] = [];
  setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(".mp4")) return new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } });
    if (init?.method === "GET" || !init?.body) return Response.json({ id: url.split("/").pop(), status: "succeeded", output: `https://replicate.delivery/x/${url.split("/").pop()}.mp4` });
    takes.push({ model: /models\/(.+)\/predictions/.exec(url)?.[1] ?? url, input: (JSON.parse(String(init.body)) as { input: Record<string, unknown> }).input });
    if (opts.gate) await opts.gate;
    if (opts.fail) return Response.json({ id: `take-${takes.length}`, status: "failed", error: "the model fell over" });
    return Response.json({ id: `take-${takes.length}`, status: "succeeded", output: `https://replicate.delivery/x/take-${takes.length}.mp4` });
  });
  return takes;
}

/* ------------------------------------------------- a date ------------------------------------------------- */

const LINES = [
  { side: "a", act: 0, action: "sets down a thermos", emotion: "dry", dialogue: "You came back. The gulls said you would." },
  { side: "b", act: 0, action: "", emotion: "warm", dialogue: "You came in wearing the weather." },
  { side: "a", act: 1, action: "turns the candle a quarter turn", emotion: "curious", dialogue: "Did the slow one survive the tide?" },
  { side: "b", act: 1, action: "leans in over the table", emotion: "amused", dialogue: "It's sulking at every lamppost on the way in." },
  { side: "a", act: 1, action: "laughs into her sleeve", emotion: "delighted", dialogue: "That's the most honest thing anyone has said to me all week." },
  { side: "b", act: 2, action: "stands and offers a hand", emotion: "tender", dialogue: "Walk me to the door?" },
];

/** A person's character with an approved show portrait, and a confessional still of whoever is named. */
async function still(characterId: string, id: string) {
  const style = (await t.db.query<{ style: string }>(`select ${showStyleSql("c")} as style from characters c where c.id = $1`, [characterId])).rows[0].style;
  const asset = (await t.db.query<{ id: string }>(`select id from character_assets where character_id = $1 and kind = 'portrait' and review_status = 'approved' order by created_at desc limit 1`, [characterId])).rows[0]?.id;
  await t.db.query(`insert into show_shots (id, character_id, portrait_key, style, shot, status, model, mime, data) values ($1, $2, $3, $4, 'confessional', 'ready', 'm', 'image/webp', $5) on conflict (id) do nothing`, [
    id,
    characterId,
    asset ?? `static:${characterPortrait(characterId)}`,
    style,
    STILL,
  ]);
}

/** A public date between a person's character and a house character; `aired`, with its lines and the place. */
async function date(opts: { aired?: boolean; shared?: boolean; stills?: boolean } = {}) {
  // Signed in: with a session secret set (the keys need one), a bare id isn't a session.
  const owner = signedInCookie(crypto.randomUUID());
  const character = (await (await api.createCharacter(validCharacter({ name: "Pell Ardent" }), owner)).json()).id as string;
  const assetId = `portrait-${crypto.randomUUID()}`;
  await t.db.query(`insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'm', $3, 'approved', 'pg')`, [assetId, character, `/api/assets/${assetId}`]);
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE }, owner)).json();
  await t.db.query(`update episodes set visibility = 'public', transcript = $2::jsonb where id = $1`, [ep.id, JSON.stringify(LINES)]);
  if (opts.aired !== false) expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  else await t.db.query(`update episodes set revealed_at = null where id = $1`, [ep.id]);
  if (opts.shared) expect((await api.shareConfessionals(ep.id, true, owner)).status).toBe(200);
  if (opts.stills !== false) {
    await still(character, `still-${character}`);
    await still(HOUSE, "still-house");
  }
  return { owner, character, id: ep.id as string };
}

const rows = async (episodeId: string) =>
  (await t.db.query<{ kind: string; slot: number; status: string; attempts: number; line: string | null; cost_usd: number; seconds: string | null; error: string | null }>(`select kind, slot, status, attempts, line, cost_usd, seconds, error from date_film where episode_id = $1 order by kind, slot`, [episodeId])).rows;
const serve = (id: string, file: string, headers: Record<string, string> = {}) => fileGet(new Request(`${BASE_URL}/api/date-film/${id}/${file}`, { headers }), { params: Promise.resolve({ id, file }) });
const admin = (body: unknown, key: string | null = KEY) =>
  adminPost(new Request(`${BASE_URL}/api/admin/date-film`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-frontier-key": key } : {}) }, body: JSON.stringify(body) }));

/* ------------------------------------------------- the pure rules ------------------------------------------------- */

describe("the words said to camera", () => {
  it("keeps a line that fits, whole", () => {
    expect(filmLine("  She asked what I'm like with people I don't keep in my coat.  ")).toBe("She asked what I'm like with people I don't keep in my coat.");
    expect(filmLine("")).toBeNull();
  });
  it("keeps the opening sentences that fit, never half of one", () => {
    const line = "He ordered for me. In French. Badly. And then he looked so pleased with himself that I let the whole table believe it was what I wanted, which says more about me than about him.";
    expect(filmLine(line, 60)).toBe("He ordered for me. In French. Badly.");
  });
  it("cuts one long sentence at its last clause break that fits, and closes it", () => {
    const line = "Juniper called me the closest thing to a dear friend and kept her coat on the door, so I know exactly where she's standing, and I'm not sure I mind it as much as I ought to.";
    const cut = filmLine(line, 130)!;
    expect(cut).toBe("Juniper called me the closest thing to a dear friend and kept her coat on the door, so I know exactly where she's standing.");
    expect(cut.length).toBeLessThanOrEqual(130);
  });
  it("doesn't film a line with nowhere to cut it", () => {
    expect(filmLine("x".repeat(80) + " and " + "y".repeat(80), 100)).toBeNull();
  });
});

describe("one take", () => {
  it("is the frames that hold the voice with a breath either side, four to a step plus one", () => {
    // The live run of 2026-11-24: 5.08 s of voice made a 93-frame take.
    expect(filmFrames(5.08)).toBe(93);
    expect(filmFrames(1)).toBe(81);
    expect(filmFrames(FILM_MAX_VOICE_S)).toBe(FILM_MAX_FRAMES);
    expect(filmFrames(FILM_MAX_VOICE_S + 0.2)).toBeNull();
    for (const s of [2, 4.4, 5.9, 6.7]) expect((filmFrames(s)! - 1) % 4).toBe(0);
  });
  it("costs two cents a second, and a full take is what's held", () => {
    expect(filmCost(93)).toBeCloseTo(0.1163, 4);
    expect(FILM_CLIP_MAX_USD).toBeCloseTo((FILM_MAX_FRAMES / FILM_FPS) * 0.02, 3);
    expect(FILM_CLIP_MAX_USD).toBeLessThan(0.16);
  });
  it("lays the voice into the take: silence first, and exactly as long as its frames", () => {
    const loud = Buffer.alloc(24000 * 2 * 4, 1); // 4 s of non-silence
    const take = voiceForTake(wavOf(loud, 24000))!;
    expect(take.voice_seconds).toBe(4);
    expect(take.frames).toBe(filmFrames(4));
    expect(take.seconds).toBe(take.frames / FILM_FPS);
    const pcm = wavPcm(take.wav)!;
    expect(pcm.rate).toBe(24000);
    expect(pcm.pcm.length).toBe(Math.round(take.seconds * 24000) * 2);
    const lead = Math.round(FILM_LEAD_S * 24000) * 2;
    expect(pcm.pcm.subarray(0, lead).every((b) => b === 0)).toBe(true);
    expect(pcm.pcm[lead]).toBe(1);
    expect(pcm.pcm[lead + loud.length - 1]).toBe(1);
    expect(pcm.pcm.subarray(lead + loud.length).every((b) => b === 0)).toBe(true);
  });
  it("refuses a voice too long for one take, and anything that isn't a WAV", () => {
    expect(voiceForTake(silence(FILM_MAX_VOICE_S + 0.5))).toBeNull();
    expect(voiceForTake(Buffer.from("not a wav at all, not even close to one, no header"))).toBeNull();
  });
  it("reads a streamed WAV whose header doesn't know its length", () => {
    const wav = silence(2);
    wav.writeUInt32LE(0xffffffff, 40);
    expect(wavPcm(wav)!.pcm.length).toBe(24000 * 2 * 2);
  });
});

describe("the scenes' moments", () => {
  it("takes lines that say what someone did, in order, and never from the last act", () => {
    const got = sceneMoments(LINES as never);
    expect(got.map((m) => m.at)).toEqual([0, 3, 4]);
    expect(got[0]).toEqual({ at: 0, side: "a", action: "sets down a thermos", emotion: "dry" });
    expect(got.every((m) => LINES[m.at].act < 2)).toBe(true);
  });
  it("gives fewer when the date says less, down to none", () => {
    expect(sceneMoments(LINES.slice(0, 2) as never)).toHaveLength(1);
    expect(sceneMoments([{ side: "a", act: 0, action: "", dialogue: "Hi." }])).toEqual([]);
  });
  it("uses every act of a one-act date", () => {
    expect(sceneMoments([{ side: "a", act: 0, action: "waves from the door", dialogue: "Hi." }])).toHaveLength(1);
  });
  it("captions a moment with the first name", () => {
    expect(momentCaption("Juniper Vale", "Sets down a thermos.")).toBe("Juniper sets down a thermos");
  });
});

/* ------------------------------------------------- the money ------------------------------------------------- */

describe("the ceilings", () => {
  it("default to a few dollars a month, read from the environment when set, and 0 stops the paid half", () => {
    expect(filmBudgets({})).toEqual({ day: FILM_DAY_USD, month: FILM_MONTH_USD });
    expect(FILM_MONTH_USD).toBeLessThanOrEqual(10);
    // Two full takes fit a day; a third doesn't.
    expect(FILM_CLIP_MAX_USD * 2).toBeLessThanOrEqual(FILM_DAY_USD);
    expect(FILM_CLIP_MAX_USD * 3).toBeGreaterThan(FILM_DAY_USD);
    expect(filmBudgets({ DATE_FILM_DAY_USD: "0.2", DATE_FILM_MONTH_USD: "3" })).toEqual({ day: 0.2, month: 3 });
    expect(filmBudgets({ DATE_FILM_DAY_USD: "nonsense", DATE_FILM_MONTH_USD: "-1" })).toEqual({ day: FILM_DAY_USD, month: FILM_MONTH_USD });
    expect(dateFilmOn({})).toBe(true);
    expect(dateFilmOn({ DATE_FILM: "0" })).toBe(false);
  });

  it("holds inside the day's ceiling and refuses past it", async () => {
    const env = { DATE_FILM_DAY_USD: "0.30", DATE_FILM_MONTH_USD: "8" };
    expect(await holdFilmBudget(t.db, 0.15, NOW, env)).toEqual({ day: "2026-11-24", held: 0.15 });
    expect(await holdFilmBudget(t.db, 0.15, NOW, env)).not.toBeNull();
    expect(await holdFilmBudget(t.db, 0.01, NOW, env)).toBeNull();
    expect(await filmSpent(t.db, NOW)).toMatchObject({ today: 0.3, month: 0.3, items: 2 });
    // Tomorrow is another day.
    expect(await holdFilmBudget(t.db, 0.15, new Date("2026-11-25T00:00:01Z"), env)).not.toBeNull();
  });

  it("refuses past the month's ceiling whatever the day has left", async () => {
    const env = { DATE_FILM_DAY_USD: "0.35", DATE_FILM_MONTH_USD: "1" };
    for (const d of ["01", "02", "03"]) await t.db.query(`insert into date_film_spend (day, usd, items) values ($1, 0.3, 2)`, [`2026-11-${d}`]);
    expect(await holdFilmBudget(t.db, 0.15, NOW, env)).toBeNull();
    expect(await holdFilmBudget(t.db, 0.1, NOW, env)).not.toBeNull();
    expect(await holdFilmBudget(t.db, 0.01, NOW, env)).toBeNull();
    // Last month's spend isn't this month's.
    expect(await holdFilmBudget(t.db, 0.15, new Date("2026-12-01T00:00:01Z"), env)).not.toBeNull();
  });

  it("never lets two requests take the last of a day", async () => {
    const env = { DATE_FILM_DAY_USD: "0.20", DATE_FILM_MONTH_USD: "8" };
    const got = await Promise.all([1, 2, 3, 4].map(() => holdFilmBudget(t.db, 0.15, NOW, env)));
    expect(got.filter(Boolean)).toHaveLength(1);
    expect((await filmSpent(t.db, NOW)).today).toBe(0.15);
  });

  it("settles a hold to what was really spent, and gives all of it back when nothing was made", async () => {
    const env = { DATE_FILM_DAY_USD: "0.35", DATE_FILM_MONTH_USD: "8" };
    const a = (await holdFilmBudget(t.db, 0.155, NOW, env))!;
    await settleFilmBudget(t.db, a, 0.118);
    expect(await filmSpent(t.db, NOW)).toMatchObject({ today: 0.118, items: 1 });
    const b = (await holdFilmBudget(t.db, 0.155, NOW, env))!;
    await settleFilmBudget(t.db, b, 0);
    expect(await filmSpent(t.db, NOW)).toMatchObject({ today: 0.118, items: 1 });
  });

  it("holds nothing with a ceiling of 0, or for more than a ceiling", async () => {
    expect(await holdFilmBudget(t.db, 0.1, NOW, { DATE_FILM_MONTH_USD: "0" })).toBeNull();
    expect(await holdFilmBudget(t.db, 0.5, NOW, { DATE_FILM_DAY_USD: "0.35" })).toBeNull();
    expect((await filmSpent(t.db, NOW)).today).toBe(0);
  });
});

/* ------------------------------------------------- filming a date ------------------------------------------------- */

describe("filming a date", () => {
  it("draws the scenes free and films the diary lines a stranger may read, inside the ceilings", async () => {
    const d = await date({ shared: true });
    const worker = fakeWorker();
    const checks = hive();
    const said = voice(5);
    const takes = replicate();

    const run = await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl });
    expect(run).toMatchObject({ stopped: "done", scenes: { drawn: 3, refused: 0, failed: 0, had: 0 }, confessionals: { made: 2, failed: 0, had: 0 } });

    // The scenes: both portraits (and the place's picture when it has one), four by five, the date's own moments.
    expect(worker.draws).toHaveLength(3);
    expect(worker.draws.every((x) => x.size === "896x1120" && x.refs >= 2)).toBe(true);
    expect(worker.draws[0].prompt).toContain("sets down a thermos");
    expect(worker.draws[0].prompt).toMatch(/from image 0.*from image 1/);
    expect(worker.draws[0].prompt).toContain("Two clearly grown adults, fully clothed.");
    expect(worker.draws.some((x) => /offers a hand/.test(x.prompt))).toBe(false); // never the last act
    expect(checks.calls).toBeGreaterThanOrEqual(3);

    // The confessionals: the public diary lines, each in its own voice, one take each on the talking model.
    expect(said).toHaveLength(2);
    expect(said.map((s) => s.text).sort()).toEqual(["I came for a map-reader and left thinking about the candlelight.", "She insulted my cake and I have never felt more seen."]);
    expect(said.every((s) => s.voice.startsWith("aura-2-"))).toBe(true);
    expect(takes).toHaveLength(2);
    expect(takes[0].model).toBe(FILM_MODEL);
    expect(takes[0].input.num_frames_per_chunk).toBe(filmFrames(5));
    expect(String(takes[0].input.image)).toMatch(/^data:image\/jpeg;base64,/);
    expect(String(takes[0].input.audio)).toMatch(/^data:audio\/wav;base64,/);
    expect(String(takes[0].input.prompt)).toContain("no subtitles");

    // What it cost is what the ledger says, and it's under what two full takes would hold.
    const each = filmCost(filmFrames(5)!);
    expect(run.spent_usd).toBeGreaterThan(each * 2);
    expect(run.spent_usd).toBeLessThan(FILM_CLIP_MAX_USD * 2);
    expect((await filmSpent(t.db, NOW)).today).toBeCloseTo(run.spent_usd, 5);
    const kept = await rows(d.id);
    expect(kept.map((r) => `${r.kind}:${r.slot}:${r.status}`)).toEqual(["confessional:0:ready", "confessional:1:ready", "scene:0:ready", "scene:1:ready", "scene:2:ready"]);
    expect(kept.filter((r) => r.kind === "scene").every((r) => r.cost_usd === 0)).toBe(true);
    expect(Number(kept[0].seconds)).toBeCloseTo(filmFrames(5)! / FILM_FPS, 2);

    // As the page and the JSON carry it.
    const film = (await dateFilm(t.db, d.id))!;
    expect(film.scenes.map((s) => s.caption)).toEqual(["Pell sets down a thermos", `${HOUSE_CHARACTERS[0].name.split(" ")[0]} leans in over the table`, "Pell laughs into her sleeve"]);
    expect(film.scenes.map((s) => s.line_at)).toEqual([0, 3, 4]);
    expect(film.confessionals.map((c) => c.character_id)).toEqual([d.character, HOUSE]);
    expect(film.confessionals[1].poster).toBe("/api/shots/still-house.webp");

    // Asked again: nothing is drawn, said or filmed twice.
    const again = await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl });
    expect(again).toMatchObject({ scenes: { drawn: 0, had: 3 }, confessionals: { made: 0, had: 2 }, spent_usd: 0 });
    expect(worker.draws).toHaveLength(3);
    expect(takes).toHaveLength(2);
  });

  it("films only the house side's line until the host shares the other", async () => {
    const d = await date();
    const worker = fakeWorker();
    hive();
    const said = voice();
    replicate();
    const run = await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl });
    expect(run.confessionals.made).toBe(1);
    expect(said).toHaveLength(1);
    expect((await dateFilm(t.db, d.id))!.confessionals.map((c) => c.character_id)).toEqual([HOUSE]);
  });

  it("stops at the day's ceiling: the scenes are still drawn, and nothing paid is asked for", async () => {
    const d = await date({ shared: true });
    const worker = fakeWorker();
    hive();
    const said = voice();
    const takes = replicate();
    // Room for one full take, not two.
    vi.stubEnv("DATE_FILM_DAY_USD", "0.20");
    const run = await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl });
    expect(run.scenes.drawn).toBe(3);
    expect(run.confessionals).toMatchObject({ made: 1, failed: 0, note: "the day's or the month's film budget is spent" });
    expect(said).toHaveLength(1);
    expect(takes).toHaveLength(1);
    expect((await filmSpent(t.db, NOW)).today).toBeLessThanOrEqual(0.2);
    // The next day there's room again, and only the missing one is made.
    const next = await filmDate(t.db, d.id, { now: new Date("2026-11-25T01:10:00Z"), fetchImpl: worker.fetchImpl });
    expect(next.confessionals).toMatchObject({ made: 1, had: 1 });
    expect(takes).toHaveLength(2);
  });

  it("makes nothing paid with the month spent", async () => {
    const d = await date({ shared: true });
    const worker = fakeWorker();
    hive();
    const said = voice();
    const takes = replicate();
    await t.db.query(`insert into date_film_spend (day, usd, items) values ('2026-11-02', $1, 50)`, [FILM_MONTH_USD]);
    const run = await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl });
    expect(run.confessionals.made).toBe(0);
    expect(run.spent_usd).toBe(0);
    expect(said).toHaveLength(0);
    expect(takes).toHaveLength(0);
    expect(run.scenes.drawn).toBe(3);
  });

  it("gives a failed take its money back, tries it once more, then leaves it", async () => {
    const d = await date();
    const worker = fakeWorker();
    hive();
    voice();
    const takes = replicate({ fail: true });
    const first = await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl });
    expect(first.confessionals).toMatchObject({ made: 0, failed: 1 });
    // Only the voice was spent (a fraction of a cent): the take's hold went back.
    expect((await filmSpent(t.db, NOW)).today).toBeLessThan(0.01);
    await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl });
    await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl });
    expect(takes).toHaveLength(FILM_ATTEMPTS);
    const row = (await rows(d.id)).find((r) => r.kind === "confessional")!;
    expect(row).toMatchObject({ status: "failed", attempts: FILM_ATTEMPTS });
    expect(row.error).toContain("fell over");
    expect(await dateFilm(t.db, d.id).then((f) => f?.confessionals ?? [])).toEqual([]);
  });

  it("never films the same line twice when two requests reach a date together", async () => {
    const d = await date();
    const worker = fakeWorker();
    hive();
    voice();
    const takes = replicate();
    const [x, y] = await Promise.all([filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl, only: "confessionals" }), filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl, only: "confessionals" })]);
    expect(x.confessionals.made + y.confessionals.made).toBe(1);
    expect(takes).toHaveLength(1);
    // The one that stood aside held nothing in the end.
    expect((await filmSpent(t.db, NOW)).today).toBeCloseTo(x.spent_usd + y.spent_usd, 5);
    expect((await filmSpent(t.db, NOW)).today).toBeLessThan(FILM_CLIP_MAX_USD);
  });

  it("keeps a refused scene out and doesn't draw it again", async () => {
    const d = await date();
    const worker = fakeWorker();
    hive(NSFW);
    voice();
    replicate();
    const run = await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl, only: "scenes" });
    expect(run.scenes).toMatchObject({ drawn: 0, refused: 3 });
    expect((await dateFilm(t.db, d.id))?.scenes ?? []).toEqual([]);
    await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl, only: "scenes" });
    expect(worker.draws).toHaveLength(3);
  });

  it("leaves the day's free pictures for people's own when they're nearly gone", async () => {
    const d = await date();
    const worker = fakeWorker({ left: 900 });
    hive();
    const run = await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl, only: "scenes" });
    expect(run.scenes).toMatchObject({ drawn: 0, note: "the day's free pictures are nearly used up" });
    expect(worker.draws).toHaveLength(0);
  });

  it("films nothing of a date that hasn't aired, isn't public, or with the switch off", async () => {
    const worker = fakeWorker();
    hive();
    const said = voice();
    const takes = replicate();
    const unaired = await date({ aired: false });
    expect((await filmDate(t.db, unaired.id, { now: NOW, fetchImpl: worker.fetchImpl })).stopped).toBe("not_aired");
    const d = await date({ shared: true });
    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [d.id]);
    expect((await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl })).stopped).toBe("not_public");
    await t.db.query(`update episodes set visibility = 'public' where id = $1`, [d.id]);
    expect((await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl, env: { ...process.env, DATE_FILM: "0" } })).stopped).toBe("off");
    expect((await filmDate(t.db, "no-such-date", { now: NOW, fetchImpl: worker.fetchImpl })).stopped).toBe("episode_not_found");
    expect(worker.draws).toHaveLength(0);
    expect(said).toHaveLength(0);
    expect(takes).toHaveLength(0);
  });

  it("skips a side with no confessional still, at no cost", async () => {
    const d = await date({ stills: false });
    const worker = fakeWorker();
    hive();
    const said = voice();
    const run = await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl, only: "confessionals" });
    expect(run.confessionals).toMatchObject({ made: 0, failed: 0 });
    expect(run.confessionals.note).toContain("no confessional still yet");
    expect(said).toHaveLength(0);
    expect((await filmSpent(t.db, NOW)).today).toBe(0);
  });

  it("names who does what in a scene's prompt, by picture, and keeps the date's place", async () => {
    const pell = (await loadCharacter(t.db, (await date()).character))!;
    const house = (await loadCharacter(t.db, HOUSE))!;
    const p = scenePrompt([pell, house], { at: 3, side: "b", action: "leans in over the table", emotion: "amused" }, "A basement jazz bar, one table left beside the drummer. Tonight, against a ticking countdown.", true);
    expect(p).toMatch(/from image 1 leans in over the table, amused; the \w+ from image 0 is listening and reacting\./);
    expect(p).toContain("They are at a basement jazz bar, one table left beside the drummer, the place in image 2.");
    expect(p).toContain("Only the two of them.");
    expect(p).not.toContain("Pell");
    // Without a picture of the place, it isn't promised one.
    expect(scenePrompt([pell, house], { at: 0, side: "a", action: "waves", emotion: "" }, "", false)).toContain("They are at a cosy bar in the evening.");
  });
});

/* ------------------------------------------------- the day's date, and the routes ------------------------------------------------- */

describe("the day's date", () => {
  it("is the newest home clip's, and only while it's fresh", async () => {
    const d = await date({ shared: true });
    const worker = fakeWorker();
    hive();
    voice();
    replicate();
    expect(await filmDue(t.db, { now: NOW, fetchImpl: worker.fetchImpl })).toBeNull();
    await t.db.query(`insert into home_clips (id, episode_id, day, loop_data, poster_data, width, height, seconds, created_at) values ('clip-1', $1, '2026-11-23', $2, $2, 480, 854, 8, $3)`, [d.id, MP4, new Date(NOW.getTime() - 20 * 60 * 1000).toISOString()]);
    const run = await filmDue(t.db, { now: NOW, fetchImpl: worker.fetchImpl });
    expect(run).toMatchObject({ episode_id: d.id, scenes: { drawn: 3 }, confessionals: { made: 2 } });
    // Two days on, it's no longer the day's date.
    expect(await filmDue(t.db, { now: new Date(NOW.getTime() + 48 * 3600 * 1000), fetchImpl: worker.fetchImpl })).toBeNull();
    expect(await filmDue(t.db, { now: NOW, fetchImpl: worker.fetchImpl, env: { ...process.env, DATE_FILM: "0" } })).toBeNull();
  });
});

describe("the admin's route", () => {
  it("needs the admin key, films a named date and says what it spent against the ceilings", async () => {
    const d = await date({ shared: true });
    vi.stubGlobal("fetch", fakeWorker().fetchImpl);
    hive();
    voice();
    replicate();
    expect((await admin({ episode: d.id }, null)).status).toBe(403);
    expect((await admin({ episode: "../etc" })).status).toBe(400);
    const res = await admin({ episode: d.id });
    expect(res.status).toBe(200);
    const body = JSON.parse((await res.text()).trim());
    expect(body).toMatchObject({ ok: true, stopped: "done", scenes: { drawn: 3 }, confessionals: { made: 2 } });
    expect(body.film.scenes).toHaveLength(3);
    expect(body.film.confessionals).toHaveLength(2);
    expect(body.budget).toMatchObject({ on: true, day_ceiling_usd: FILM_DAY_USD, month_ceiling_usd: FILM_MONTH_USD });
    expect(body.budget.spent_today_usd).toBeGreaterThan(0);

    const status = await (await adminGet(new Request(`${BASE_URL}/api/admin/date-film`, { headers: { "x-frontier-key": KEY } }))).json();
    expect(status.recent[0]).toMatchObject({ episode_id: d.id, scenes: 3, confessionals: 2, failed: 0 });
    expect(status.spent_month_usd).toBeCloseTo(body.budget.spent_today_usd, 5);
    expect((await adminGet(new Request(`${BASE_URL}/api/admin/date-film`))).status).toBe(403);

    vi.stubEnv("DATE_FILM", "0");
    expect((await admin({ episode: d.id })).status).toBe(404);
  });
});

describe("the files", () => {
  it("are served while the date is public, with byte ranges, and go when it does", async () => {
    const d = await date({ shared: true });
    const worker = fakeWorker();
    hive();
    voice();
    replicate();
    await filmDate(t.db, d.id, { now: NOW, fetchImpl: worker.fetchImpl });
    const film = (await dateFilm(t.db, d.id))!;
    const sceneId = film.scenes[0].id;
    const clipId = film.confessionals[0].id;

    const scene = await serve(sceneId, "scene.webp");
    expect(scene.status).toBe(200);
    expect(scene.headers.get("content-type")).toBe("image/webp");
    expect(scene.headers.get("cache-control")).toBe("public, max-age=86400");
    expect((await sharp(Buffer.from(await scene.arrayBuffer())).metadata()).format).toBe("webp");

    const clip = await serve(clipId, "clip.mp4");
    expect(clip.status).toBe(200);
    expect(clip.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await clip.arrayBuffer()).equals(MP4)).toBe(true);
    const part = await serve(clipId, "clip.mp4", { range: "bytes=0-9" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-9/${MP4.length}`);
    expect((await serve(clipId, "clip.mp4", { range: `bytes=${MP4.length}-` })).status).toBe(416);

    // A scene isn't a clip, and nothing else is anything.
    expect((await serve(sceneId, "clip.mp4")).status).toBe(404);
    expect((await serve(clipId, "scene.webp")).status).toBe(404);
    expect((await serve(clipId, "other.bin")).status).toBe(404);
    expect((await serve("nope", "clip.mp4")).status).toBe(404);

    // The date's JSON carries it once aired.
    const json = await (await episodeGet(new Request(`${BASE_URL}/api/episodes/${d.id}`), { params: Promise.resolve({ id: d.id }) })).json();
    expect(json.film.scenes).toHaveLength(3);
    expect(json.film.confessionals[0]).toMatchObject({ src: `/api/date-film/${clipId}/clip.mp4`, line: "I came for a map-reader and left thinking about the candlelight." });

    // Taken down: the files go, and so does every mention of them.
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [d.id]);
    expect((await serve(sceneId, "scene.webp")).status).toBe(404);
    expect((await serve(clipId, "clip.mp4")).status).toBe(404);
    expect(await dateFilm(t.db, d.id)).toBeNull();
  });
});

describe("on the date's page", () => {
  it("shows the scenes with what's happening in each", () => {
    const html = renderToStaticMarkup(createElement(DateScenes, { names: ["Juniper Vale", "Barnaby Thorne"], scenes: [{ id: "s1", src: "/api/date-film/s1/scene.webp", line_at: 0, caption: "Juniper sets down a thermos" }] }));
    expect(html).toContain("From the date");
    expect(html).toContain('src="/api/date-film/s1/scene.webp"');
    expect(html).toContain('alt="Juniper Vale and Barnaby Thorne on the date. Juniper sets down a thermos."');
    expect(html).toContain("<figcaption>Juniper sets down a thermos</figcaption>");
    expect(renderToStaticMarkup(createElement(DateScenes, { names: ["A", "B"], scenes: [] }))).toBe("");
  });

  it("puts a filmed line's clip where the face would be, beside the words it says, and nowhere else", () => {
    const characters = [
      { id: "a", name: "Juniper Vale", house: true, hue: 20, portrait: null },
      { id: "b", name: "Barnaby Thorne", house: true, hue: 200, portrait: null },
    ];
    const clip = { id: "c1", character_id: "a", src: "/api/date-film/c1/clip.mp4", poster: "/api/shots/still-a.webp", seconds: 5.8, line: "He didn't rush me." };
    const html = renderToStaticMarkup(
      createElement(DiaryCam, { diary: [{ character_id: "a", line: "He didn't rush me." }, { character_id: "b", line: "I know where she's standing." }], characters, folded: false, clips: [clip] }),
    );
    expect(html.match(/data-confessional-clip/g)).toHaveLength(1);
    expect(html).toContain('src="/api/date-film/c1/clip.mp4"');
    expect(html).toContain('poster="/api/shots/still-a.webp"');
    expect(html).toContain('preload="none"');
    expect(html).not.toContain("autoplay");
    expect(html).toContain("Play Juniper&#x27;s diary cam: 6 seconds, with sound");
    expect(html).toContain("He didn&#x27;t rush me.");
    // A clip of a line the page isn't showing stays out.
    const none = renderToStaticMarkup(createElement(DiaryCam, { diary: [], characters, folded: false, choices: [{ character_id: "a", see_again: "yes", reason: null }], clips: [clip] }));
    expect(none).not.toContain("data-confessional-clip");
  });
});
