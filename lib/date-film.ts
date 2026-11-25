/**
 * A date on film (2026-11-24; David: "make all 3 on the show. I don't want to be drained too much money tho"). For one
 * featured date a day (the home clip's date, lib/home-clip.ts), the show makes:
 *
 *  - **Scenes** (free): up to FILM_SCENES pictures of both of them in the date's place, each at a moment the date's own
 *    lines describe. Drawn on Workers AI (lib/workers-ai.ts) from both portraits and the place's backdrop, checked like
 *    every free picture (the show's PG check with the explicit question), kept as WebP.
 *  - **Confessionals** (paid): each public diary-cam line said to camera. The character's confessional still
 *    (lib/show-shots.ts) and their Aura voice (lib/companion-live.ts) go to Replicate's Wan 2.2 S2V, the reels' talking
 *    model: one take, at most about 7.5 s, about 2¢ a second. The still was checked when it was drawn and the words are
 *    the date's own public line; the clip itself isn't checked again (as the cast's intros aren't, lib/cast-intros.ts).
 *
 * **The money.** Only a confessional costs anything, and every one is held against two ceilings before it's made, in
 * one statement (holdFilmBudget): the UTC day's (DATE_FILM_DAY_USD, default FILM_DAY_USD) and the month's
 * (DATE_FILM_MONTH_USD, default FILM_MONTH_USD). Past either, nothing is made until the day or the month turns, and the
 * page shows the diary cam in words as it always did. A hold that's never settled (a deploy mid-clip) stays counted:
 * the ceilings can be undershot, never passed. DATE_FILM=0 turns all of it off.
 *
 * **Who's filmed.** Only a date a stranger may see (lib/home-clip.ts clipRefusal: aired, public, not hidden, both
 * characters public, its story holding), and only the diary lines that date shows a stranger (lib/game.ts: a house
 * character's always, a person's character's once their host shared them). The files are served only while that
 * stays true (filmFile).
 */
import sharp from "sharp";
import { adultKeys } from "./adult/settings";
import { checkMedia, checkReady, isVerdict } from "./adult/moderation";
import { runModel } from "./adult/replicate";
import { STYLE_WORDS, isDrawnStyle } from "./art-style";
import { loadCharacter, type Character } from "./character";
import { auraVoiceFor, speakAura } from "./companion-live";
import type { Db } from "./db";
import {
  FILM_CLIP_MAX_USD,
  FILM_LINE_CHARS,
  filmCost,
  filmLines,
  momentCaption,
  sceneMoments,
  type FilmMoment,
} from "./date-film-shared";
import { voiceForTake } from "./date-film-wav";
import { getEpisodeView, type EpisodeView } from "./game";
import { clipRefusal, STILL_PUBLIC } from "./home-clip";
import { keepBytes } from "./object-store";
import { venueBackdrop } from "./portraits";
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { checkPgPictureText } from "./safety";
import { shotFile, shotSource } from "./show-shots";
import { pgSubject } from "./studio/pg";
import { resizedWebp } from "./thumbs";
import { drawWithWorkersAi, workersAiBudget, workersAiConfig } from "./workers-ai";

type Env = Record<string, string | undefined>;

/* ------------------------------------------------- switches and ceilings ------------------------------------------------- */

/** On unless DATE_FILM=0. */
export function dateFilmOn(env: Env = process.env): boolean {
  return env.DATE_FILM?.trim() !== "0";
}

/** The ceilings, in dollars: a UTC day's and a month's. About two confessionals a day, every day of a month. */
export const FILM_DAY_USD = 0.35;
export const FILM_MONTH_USD = 8;

const dollars = (raw: string | undefined, fallback: number): number => {
  const v = raw?.trim() ? Number(raw) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/** DATE_FILM_DAY_USD and DATE_FILM_MONTH_USD when they're numbers of dollars (0 stops the paid half), else the defaults. */
export function filmBudgets(env: Env = process.env): { day: number; month: number } {
  return { day: dollars(env.DATE_FILM_DAY_USD, FILM_DAY_USD), month: dollars(env.DATE_FILM_MONTH_USD, FILM_MONTH_USD) };
}

export const FILM_MODEL = "wan-video/wan-2.2-s2v";
export const SCENE_MODEL = "workers-ai/flux-2-klein-4b";
/** Aura's price (lib/call-costs.ts): $0.030 a thousand characters. */
const VOICE_USD_PER_CHAR = 0.00003;
/** A scene's frame: drawn at about a megapixel, four by five, kept at this width. */
const SCENE = { width: 896, height: 1120, keep: 896 };
/** What one scene costs of the day's free pictures, about (three reference pictures), and what filming leaves for people's own. */
const SCENE_NEURONS = 180;
const SCENES_RESERVE_NEURONS = 1000;
/** An item is tried this many times at most; one "making" this long was lost with its request. */
export const FILM_ATTEMPTS = 2;
const LOST_MS = 15 * 60 * 1000;
const MAX_MP4 = 40 * 1024 * 1024;

const dayOf = (now: Date) => now.toISOString().slice(0, 10);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** What filming has cost today and this month (UTC), holds included. */
export async function filmSpent(db: Db, now: Date = new Date()): Promise<{ day: string; today: number; month: number; items: number }> {
  const day = dayOf(now);
  const row = (
    await db.query<{ today: number | null; month: number | null; items: number | null }>(
      `select (select usd from date_film_spend where day = $1) as today,
              (select coalesce(sum(usd), 0) from date_film_spend where day like $2) as month,
              (select coalesce(sum(items), 0)::int from date_film_spend where day like $2) as items`,
      [day, `${day.slice(0, 7)}-%`],
    )
  ).rows[0];
  return { day, today: Number(row?.today ?? 0), month: Number(row?.month ?? 0), items: Number(row?.items ?? 0) };
}

export type FilmHold = { day: string; held: number };

/**
 * Holds `usd` of the day's and the month's ceilings, atomically: null when either would be passed (nothing is held).
 * One statement: two requests can't both take the last of a day.
 */
export async function holdFilmBudget(db: Db, usd: number, now: Date = new Date(), env: Env = process.env): Promise<FilmHold | null> {
  const { day: dayCap, month: monthCap } = filmBudgets(env);
  const held = round6(usd);
  if (!(held > 0) || held > dayCap || held > monthCap) return null;
  const day = dayOf(now);
  await db.query(`insert into date_film_spend (day) values ($1) on conflict (day) do nothing`, [day]);
  const { rows } = await db.query(
    `update date_film_spend set usd = round((usd + $2::float8)::numeric, 6)::float8, items = items + 1
      where day = $1 and usd + $2::float8 <= $3::float8
        and (select coalesce(sum(usd), 0) from date_film_spend where day like $4) + $2::float8 <= $5::float8
      returning usd`,
    [day, held, dayCap + 1e-9, `${day.slice(0, 7)}-%`, monthCap + 1e-9],
  );
  return rows.length ? { day, held } : null;
}

/** Books what a held item really cost in place of what it held (0: it was never made). */
export async function settleFilmBudget(db: Db, hold: FilmHold, spent: number): Promise<void> {
  await db.query(
    `update date_film_spend set usd = greatest(0, round((usd - $2::float8 + $3::float8)::numeric, 6))::float8,
            items = greatest(0, items - (case when $3::float8 > 0 then 0 else 1 end))
      where day = $1`,
    [hold.day, hold.held, round6(Math.max(0, spent))],
  );
}

/* ------------------------------------------------- the prompts ------------------------------------------------- */

/** What the talking model is told: a confessional, the lips with the words, nothing else changing. */
export const FILM_PROMPT =
  "A person sits in an armchair and talks straight to the camera, like a reality show confessional: lips moving with the words, " +
  "small natural head movements, blinking, a slight shift of the shoulders. The camera is locked off. The room, the clothes and the " +
  "face stay exactly as in the picture. Clean frame: no on-screen text, no subtitles, no captions.";

/** What someone's doing, when the date's own words for it may go into a picture prompt; else a plain moment. */
function momentWords(m: FilmMoment): string {
  const said = [m.action, m.emotion].filter(Boolean).join(", ");
  return said && checkPgPictureText({ words: said }).ok ? m.action + (m.emotion ? `, ${m.emotion}` : "") : "is talking, mid-sentence";
}

/** Where the date was, as picture words: its setting's first sentence when that's PG words, else a plain evening out. */
function placeWords(setting: string): string {
  const first = (setting.match(/[^.!?]+/)?.[0] ?? "").trim().slice(0, 160);
  return first && checkPgPictureText({ words: first }).ok ? first.charAt(0).toLowerCase() + first.slice(1) : "a cosy bar in the evening";
}

/**
 * One scene's prompt: image 0 and image 1 are the two of them (their portraits), image 2 the place when it has a
 * picture. Who's doing what comes from the date's line; the other one reacts. Both faces showing, nobody else.
 */
export function scenePrompt(pair: readonly [Character, Character], moment: FilmMoment, setting: string, hasPlace: boolean): string {
  const subject = (c: Character, n: number) => {
    const s = pgSubject(c);
    return `the ${s.noun} from image ${n}${s.look ? ` (${s.look})` : ""}`;
  };
  const style = pgSubject(pair[0]).style ?? "realistic";
  const { noun, short } = STYLE_WORDS[style];
  const drawn = isDrawnStyle(style);
  const doer = moment.side === "a" ? 0 : 1;
  const other = doer === 0 ? 1 : 0;
  return [
    `${drawn ? `A ${noun}` : "A photograph"} of two people on a date, both in one picture: ${subject(pair[0], 0)} and ${subject(pair[1], 1)}, keeping both faces, hair and outfits exactly as in their pictures${drawn ? ", in the same drawn style" : ""}.`,
    `${cap(subject(pair[doer], doer).replace(/ \(.*\)$/, ""))} ${momentWords(moment)}; ${subject(pair[other], other).replace(/ \(.*\)$/, "")} is listening and reacting.`,
    `They are at ${placeWords(setting)}${hasPlace ? ", the place in image 2" : ""}.`,
    "Both of them in frame from the waist up, close together at the same table or spot, turned toward each other so both faces show. Only the two of them.",
    `${short} Two clearly grown adults, fully clothed. No text, no captions, no logo, no watermark, no frame or border.`,
  ].join(" ");
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A steady seed per date and slot, so drawing again draws the same picture; a retry is the next one. */
function sceneSeed(episodeId: string, slot: number, attempt: number): number {
  let h = 2166136261 >>> 0;
  for (const ch of `${episodeId}:${slot}:${attempt}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------- filming ------------------------------------------------- */

export type FilmRun = {
  episode_id: string;
  /** Why it stopped: done, off (DATE_FILM=0), or why this date isn't filmed (lib/home-clip.ts clipRefusal). */
  stopped: "done" | "off" | "episode_not_found" | "not_aired" | "not_public" | "story_contradicts";
  scenes: { drawn: number; refused: number; failed: number; had: number; note: string | null };
  confessionals: { made: number; failed: number; had: number; note: string | null };
  /** What this run spent, in dollars. */
  spent_usd: number;
};

type Row = { id: string; kind: "scene" | "confessional"; slot: number; status: "making" | "ready" | "refused" | "failed"; attempts: number; updated_at: Date | string };

type FilmOpts = { baseUrl?: string; env?: Env; now?: Date; fetchImpl?: typeof fetch; only?: "scenes" | "confessionals" };

/** Whether an item is still to be made: never tried, lost mid-make, or failed with a try left. */
const wanted = (r: Row | undefined, now: Date): boolean => {
  if (!r) return true;
  if (r.status === "making") return now.getTime() - new Date(r.updated_at).getTime() > LOST_MS && r.attempts < FILM_ATTEMPTS;
  return r.status === "failed" && r.attempts < FILM_ATTEMPTS;
};

/**
 * Takes an item to make, atomically: a new row, or one that failed, or one lost mid-make. Null when someone else has it
 * (the hourly job and the clip upload can both reach a date in the same minute): two requests never make the same item.
 */
async function claim(db: Db, episodeId: string, kind: Row["kind"], slot: number, fields: { character_id?: string | null; line?: string | null; line_at?: number | null; model: string }): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `insert into date_film (id, episode_id, kind, slot, status, character_id, line, line_at, model, attempts)
     values ($1, $2, $3, $4, 'making', $5, $6, $7, $8, 1)
     on conflict (episode_id, kind, slot) do update set status = 'making', error = null, character_id = excluded.character_id, line = excluded.line,
       line_at = excluded.line_at, model = excluded.model, attempts = date_film.attempts + 1, updated_at = now()
      where (date_film.status = 'failed' or (date_film.status = 'making' and date_film.updated_at < now() - make_interval(secs => $9::int)))
        and date_film.attempts < $10::int
     returning id`,
    [crypto.randomUUID(), episodeId, kind, slot, fields.character_id ?? null, fields.line ?? null, fields.line_at ?? null, fields.model, Math.round(LOST_MS / 1000), FILM_ATTEMPTS],
  );
  return rows[0]?.id ?? null;
}

const fail = (db: Db, id: string, status: "failed" | "refused", error: string) =>
  db.query(`update date_film set status = $2, error = $3, updated_at = now() where id = $1`, [id, status, error.slice(0, 300)]);

async function bytesAt(url: string, doFetch: typeof fetch): Promise<Buffer | null> {
  try {
    if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const res = await doFetch(url, { signal: AbortSignal.timeout(20_000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (value?.length) parts.push(Buffer.from(value));
    if (done) break;
  }
  return Buffer.concat(parts);
}

/** The scenes still to draw: free, one at a time. */
async function drawScenes(db: Db, view: EpisodeView, pair: readonly [Character, Character], had: Map<string, Row>, opts: Required<Pick<FilmOpts, "baseUrl" | "env" | "now" | "fetchImpl">>): Promise<FilmRun["scenes"]> {
  const out: FilmRun["scenes"] = { drawn: 0, refused: 0, failed: 0, had: 0, note: null };
  const moments = sceneMoments(view.transcript ?? []);
  const todo = moments.map((m, slot) => ({ m, slot, row: had.get(`scene:${slot}`) })).filter((x) => {
    if (x.row?.status === "ready") out.had += 1;
    return wanted(x.row, opts.now);
  });
  if (!todo.length) return { ...out, note: moments.length ? null : "the date's lines say nothing of what they did" };
  if (!workersAiConfig(opts.env)) return { ...out, note: "the free pictures aren't set up" };
  if (!(await checkReady(db, { pg: true }))) return { ...out, note: "no picture check is ready" };

  const faces: Buffer[] = [];
  for (const c of pair) {
    const source = await shotSource(db, c.id, opts.baseUrl);
    const face = source ? await bytesAt(source.url, opts.fetchImpl) : null;
    if (!face) return { ...out, note: `${c.name} has no portrait to draw from` };
    faces.push(face);
  }
  const backdrop = venueBackdrop(view.venue);
  const place = backdrop ? await bytesAt(new URL(backdrop, opts.baseUrl).toString(), opts.fetchImpl) : null;

  for (const { m, slot, row } of todo) {
    const budget = await workersAiBudget({ env: opts.env, fetchImpl: opts.fetchImpl });
    if (!budget || budget.left - SCENE_NEURONS < SCENES_RESERVE_NEURONS) return { ...out, note: "the day's free pictures are nearly used up" };
    const speaker = pair[m.side === "a" ? 0 : 1];
    const id = await claim(db, view.id, "scene", slot, { character_id: speaker.id, line: momentCaption(speaker.name, m.action), line_at: m.at, model: SCENE_MODEL });
    if (!id) continue; // another request is drawing it
    const drawn = await drawWithWorkersAi(
      { prompt: scenePrompt(pair, m, view.setting, Boolean(place)), width: SCENE.width, height: SCENE.height, refs: place ? [...faces, place] : faces, seed: sceneSeed(view.id, slot, row?.attempts ?? 0) },
      { env: opts.env, fetchImpl: opts.fetchImpl },
    );
    if (!drawn.ok) {
      await fail(db, id, "failed", drawn.detail);
      if (drawn.reason === "budget") return { ...out, note: "the day's free pictures are used up" };
      out.failed += 1;
      continue;
    }
    const v = await checkMedia(db, { base64: drawn.base64, mime: drawn.mime }, "pg_image", { unfiltered: true });
    if (!v.ok) {
      // No verdict (a checker down) is a reason to try again, not a refusal.
      const unchecked = !isVerdict(v);
      await fail(db, id, unchecked ? "failed" : "refused", v.reason);
      if (unchecked) out.failed += 1;
      else out.refused += 1;
      continue;
    }
    const small = await resizedWebp(drawn.bytes, SCENE.keep);
    if (!small) {
      await fail(db, id, "failed", "the picture could not be resized");
      out.failed += 1;
      continue;
    }
    const kept = await keepBytes("clips", `film-${id}`, small, "image/webp");
    await db.query(`update date_film set status = 'ready', error = null, mime = 'image/webp', data = $2, object_key = $3, updated_at = now() where id = $1`, [id, kept.data, kept.object_key]);
    out.drawn += 1;
  }
  return out;
}

/** The id inside a shot's address (/api/shots/<id>.webp). */
const shotIdOf = (src: string | null | undefined): string | null => /\/api\/shots\/([\w-]{1,64})\.webp/.exec(src ?? "")?.[1] ?? null;

/** One confessional: the voice, then the take. What it spent, and whether it's kept. */
async function filmConfessional(
  db: Db,
  view: EpisodeView,
  who: Character,
  slot: number,
  line: string,
  token: string,
  opts: Required<Pick<FilmOpts, "env" | "now">>,
): Promise<{ ok: boolean; tried: boolean; spent: number; note: string | null }> {
  const c = view.characters[slot];
  const stillId = shotIdOf(c.shots?.confessional);
  const still = stillId ? await shotFile(db, stillId) : null;
  if (!still) return { ok: false, tried: false, spent: 0, note: `${c.name} has no confessional still yet` };
  const cuts = filmLines(line);
  let words = cuts[0];
  if (!words) return { ok: false, tried: false, spent: 0, note: `${c.name}'s line is too long to say in one take` };

  // Held before anything is made: a full take and every voice it might take to fit one. Past the day's or the month's
  // ceiling, nothing is.
  const voicesUsd = cuts.reduce((sum, cut) => sum + cut.length * VOICE_USD_PER_CHAR, 0);
  const hold = await holdFilmBudget(db, FILM_CLIP_MAX_USD + voicesUsd, opts.now, opts.env);
  if (!hold) return { ok: false, tried: false, spent: 0, note: "the day's or the month's film budget is spent" };

  const voice = auraVoiceFor(who);
  const id = await claim(db, view.id, "confessional", slot, { character_id: c.id, line: words, model: FILM_MODEL });
  if (!id) {
    // Another request is making it: what was held for this one goes back.
    await settleFilmBudget(db, hold, 0);
    return { ok: false, tried: false, spent: 0, note: null };
  }
  let spent = 0;
  try {
    // Said at its longest first; a voice that runs past one take is said again, shorter.
    let take: ReturnType<typeof voiceForTake> = null;
    for (const cut of cuts) {
      words = cut;
      const wav = await streamBytes(await speakAura(cut, voice, { container: "wav", env: opts.env }));
      spent += cut.length * VOICE_USD_PER_CHAR;
      take = voiceForTake(wav);
      if (take) break;
    }
    if (!take) throw new Error(`the voice ran too long for one take (${words.length} characters)`);
    if (words !== cuts[0]) await db.query(`update date_film set line = $2 where id = $1`, [id, words]);
    const image = `data:image/jpeg;base64,${(await sharp(still.bytes).jpeg({ quality: 92 }).toBuffer()).toString("base64")}`;
    const audio = `data:audio/wav;base64,${take.wav.toString("base64")}`;
    const file = await runModel(token, FILM_MODEL, { image, audio, prompt: FILM_PROMPT, num_frames_per_chunk: take.frames }, { maxBytes: MAX_MP4, timeoutMs: 600_000, cancelAfter: "10m" });
    spent += filmCost(take.frames);
    const kept = await keepBytes("clips", `film-${id}`, file.bytes, "video/mp4");
    await db.query(
      `update date_film set status = 'ready', error = null, mime = 'video/mp4', data = $2, object_key = $3, seconds = $4, voice = $5, poster_src = $6, cost_usd = $7, updated_at = now() where id = $1`,
      [id, kept.data, kept.object_key, take.seconds, voice, c.shots?.confessional ?? null, round6(spent)],
    );
    await settleFilmBudget(db, hold, spent);
    return { ok: true, tried: true, spent, note: null };
  } catch (err) {
    const why = err instanceof Error ? err.message : "the clip couldn't be made";
    await fail(db, id, "failed", why).catch(() => null);
    // A take that ran out of time may still be billed: its hold stays. Anything else settles to what was really spent.
    if (!/timed? ?out|didn't finish|canceled/i.test(why)) await settleFilmBudget(db, hold, spent).catch(() => null);
    else spent = hold.held;
    await db.query(`update date_film set cost_usd = $2 where id = $1`, [id, round6(spent)]).catch(() => null);
    return { ok: false, tried: true, spent, note: why.slice(0, 200) };
  }
}

/**
 * Films what a date is still missing: its scenes (free), then its confessionals (within the ceilings). Safe to call
 * again: what's ready is left alone, what failed is tried FILM_ATTEMPTS times at most. Never throws for one bad item.
 */
export async function filmDate(db: Db, episodeId: string, o: FilmOpts = {}): Promise<FilmRun> {
  const env = o.env ?? process.env;
  const now = o.now ?? new Date();
  const run: FilmRun = { episode_id: episodeId, stopped: "done", scenes: { drawn: 0, refused: 0, failed: 0, had: 0, note: null }, confessionals: { made: 0, failed: 0, had: 0, note: null }, spent_usd: 0 };
  if (!dateFilmOn(env)) return { ...run, stopped: "off" };
  // As a stranger sees it: a private date is null here, an unaired one isn't revealed.
  const view = await getEpisodeView(db, episodeId, null);
  const refusal = clipRefusal(view);
  if (refusal || !view) return { ...run, stopped: refusal ?? "episode_not_found" };
  if (view.characters.length !== 2) return { ...run, scenes: { ...run.scenes, note: "only a date of two is filmed" } };

  const opts = { baseUrl: o.baseUrl ?? env.SITE_URL ?? "https://botchelor.com", env, now, fetchImpl: o.fetchImpl ?? fetch };
  const rows = (await db.query<Row>(`select id, kind, slot, status, attempts, updated_at from date_film where episode_id = $1`, [episodeId])).rows;
  const had = new Map(rows.map((r) => [`${r.kind}:${r.slot}`, r]));

  const a = await loadCharacter(db, view.characters[0].id);
  const b = await loadCharacter(db, view.characters[1].id);
  if (!a || !b) return { ...run, scenes: { ...run.scenes, note: "a character is gone" } };
  const pair = [a, b] as const;

  if (o.only !== "confessionals") {
    run.scenes = await drawScenes(db, view, pair, had, opts).catch((err) => ({ ...run.scenes, note: err instanceof Error ? err.message.slice(0, 200) : "the scenes failed" }));
  }

  if (o.only !== "scenes") {
    // The lines this date shows a stranger (lib/game.ts diary), each on its own side.
    const sides = (view.diary ?? [])
      .map((d) => ({ slot: view.characters.findIndex((c) => c.id === d.character_id), line: d.line }))
      .filter((s) => s.slot === 0 || s.slot === 1);
    const todo = sides.filter((s) => {
      const row = had.get(`confessional:${s.slot}`);
      if (row?.status === "ready") run.confessionals.had += 1;
      return wanted(row, now);
    });
    if (todo.length) {
      const token = (await adultKeys(db, env).catch(() => null))?.replicate ?? null;
      if (!token) run.confessionals.note = "no Replicate key";
      else if (!env.DEEPGRAM_API_KEY?.trim()) run.confessionals.note = "no voice key (DEEPGRAM_API_KEY)";
      else {
        // One after the other: the second is held only against what the first left of the ceilings.
        for (const s of todo) {
          const made = await filmConfessional(db, view, pair[s.slot], s.slot, s.line, token, { env, now });
          run.spent_usd = round6(run.spent_usd + made.spent);
          if (made.ok) run.confessionals.made += 1;
          else {
            if (made.tried) run.confessionals.failed += 1;
            if (made.note) run.confessionals.note = made.note;
          }
        }
      }
    } else if (!sides.length) run.confessionals.note = "this date shows no diary line to strangers";
  }
  return run;
}

// Reading a date's film for a page or a route lives apart (lib/date-film-read.ts), so they don't load the image and model code.
export { dateFilm, filmFile, type FilmFile } from "./date-film-read";

/* ------------------------------------------------- the day's date ------------------------------------------------- */

/**
 * The day's date: the newest home clip's of the last day and a half, while it's still one anyone may see. Asking again
 * is cheap: filmDate leaves what's ready alone and makes no call for a date with nothing left to make.
 */
export async function filmDueEpisode(db: Db, now: Date = new Date()): Promise<string | null> {
  const row = (
    await db.query<{ episode_id: string }>(
      `select c.episode_id
         from home_clips c
         join episodes e on e.id = c.episode_id
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where c.created_at > $2::timestamptz - interval '36 hours' and ${STILL_PUBLIC}
        order by c.created_at desc
        limit 1`,
      [REPORT_HIDE_THRESHOLD, now.toISOString()],
    )
  ).rows[0];
  return row?.episode_id ?? null;
}

/** The hourly step: film what the day's date is still missing. Null when there's no such date, or it's off. */
export async function filmDue(db: Db, o: FilmOpts = {}): Promise<FilmRun | null> {
  const env = o.env ?? process.env;
  if (!dateFilmOn(env)) return null;
  const id = await filmDueEpisode(db, o.now ?? new Date()).catch(() => null);
  return id ? filmDate(db, id, o) : null;
}

/** For the admin's view: the ceilings, what's spent, and the newest dates on film. */
export async function filmStatus(db: Db, now: Date = new Date(), env: Env = process.env) {
  const spent = await filmSpent(db, now);
  const caps = filmBudgets(env);
  const recent = (
    await db.query<{ episode_id: string; scenes: number; confessionals: number; failed: number; usd: number; at: Date | string }>(
      `select episode_id, count(*) filter (where kind = 'scene' and status = 'ready')::int as scenes,
              count(*) filter (where kind = 'confessional' and status = 'ready')::int as confessionals,
              count(*) filter (where status in ('failed', 'refused'))::int as failed,
              coalesce(sum(cost_usd), 0)::float8 as usd, max(updated_at) as at
         from date_film group by episode_id order by max(updated_at) desc limit 10`,
    )
  ).rows;
  return {
    on: dateFilmOn(env),
    day: spent.day,
    spent_today_usd: spent.today,
    spent_month_usd: spent.month,
    day_ceiling_usd: caps.day,
    month_ceiling_usd: caps.month,
    clip_holds_usd: FILM_CLIP_MAX_USD,
    line_chars: FILM_LINE_CHARS,
    recent: recent.map((r) => ({ ...r, at: new Date(r.at).toISOString() })),
  };
}
