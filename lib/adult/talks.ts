/**
 * Talking moments (docs/PRDs/theater-immersion.md #4; David, 2026-10-29: "a short loop of your character … so it looks
 * like they are talking and are real"): "🗣 Hear it from them" on the line on stage makes a few seconds of the one saying
 * it, their lips on their own voice. One face only: lip-sync on a shot of two moved the wrong mouth (#688), so it starts
 * from the speaker's portrait (lib/adult/presence.ts), and the voice is the line's own (lib/adult/voice-lines.ts), given
 * to a Wan model that takes audio in.
 *
 * A token item, priced like a clip on demand (clip_tokens; admins don't pay), counted in the month's clips, checked like
 * any video (Hive) before it's kept, and refunded when it can't be made. Kept per speaker and line: asking again for
 * the same words plays the one already made. In adult_talks, served to its owner by /api/admin/after-dark/talk/<id>.
 */
import { createHash } from "node:crypto";
import { isAdmin } from "../admins";
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import type { Db } from "../db";
import { keepBytes, readBytes } from "../object-store";
import { mediaBytes, signedPresenceUrl } from "./media";
import { checkMedia, mediaGate } from "./moderation";
import { presenceOf } from "./presence";
import { queueVideo, reelNight, releaseVideo, retrieveVideo } from "./reels";
import { eligiblePair } from "./scenes";
import { adultKeys, getAdultSettings } from "./settings";
import { countUse, overCap } from "./usage";
import { sayable, voiceLines } from "./voice-lines";

/**
 * The direction: this one person speaking to someone just off camera, and a clean frame. The first one live (2026-10-29)
 * burned garbled subtitles into most frames ("says the line" read as captions); asked for a frame with no text at all,
 * both Wan 2.6 Flash and 2.7 came back clean.
 */
export const TALK_PROMPT =
  "The person in the picture speaks to someone just off camera, their lips moving in time with the voice, a natural expression, " +
  "small head movements and a blink. The camera doesn't move. Only this one person. " +
  "A clean frame: no on-screen text, captions, subtitles, letters or words anywhere.";
const TALK_NEGATIVE =
  "subtitles, captions, on-screen text, text overlay, words, letters, lower third, watermark, logo, child, teen, minor, young-looking, distorted face, morphing face, extra people, a second person, scene cut, camera movement";
/** Talks made before the clean-frame direction (version 1) had subtitles burned in: never matched or played again. */
export const TALK_VERSION = 2;
/** Words that fit in a 5-second clip; more get 10. */
const WORDS_5S = 12;
/** One not back by then is given up, and its tokens go back. */
const GIVE_UP_MS = 20 * 60 * 1000;

export type Talk = { id: string; who: "a" | "b"; text: string; status: "making" | "ready" | "failed"; error: string | null };

type Row = { id: string; owner_id: string; tokens: number; model: string | null; queue_id: string | null; created_at: Date | string };

const keyOf = (speaker: string, words: string) => createHash("sha256").update(`${speaker}\n${words}`).digest("hex").slice(0, 32);

export type TalkAsk = { a: string; b: string; i: number; text: string; night_id?: string | null };
export type TalkResult = { ok: true; talk: Talk; price: number } | { ok: false; status: number; error: string; message: string };

/** What a talking moment costs this viewer, in bought tokens. */
export async function talkPrice(db: Db, viewer: string): Promise<number> {
  return (await isAdmin(db, viewer)) ? 0 : (await getAdultSettings(db)).clip_tokens;
}

/**
 * Makes the line's talking moment, or gives the one already made of these words: its voice made (or found), its price
 * taken, and the clip queued from the speaker's portrait (collected later by collectTalks).
 */
export async function makeTalk(db: Db, viewer: string, ask: TalkAsk, baseUrl: string): Promise<TalkResult> {
  const fail = (status: number, error: string, message: string): TalkResult => ({ ok: false, status, error, message });
  const pair = await eligiblePair(db, viewer, ask.a, ask.b);
  const night = pair ? await reelNight(db, viewer, ask.a, ask.b, ask.night_id ?? null) : null;
  if (!pair || !night) return fail(404, "not_found", "Pick two characters who are in after dark.");
  const line = night.lines[ask.i];
  if (!line || line.text !== ask.text) return fail(409, "stale", "That line isn't in the night any more.");
  const words = sayable(line.text);
  if (!words) return fail(409, "silent", "That line is only something they do: there's nothing to say.");
  const speaker = line.who === "a" ? pair[0] : pair[1];
  const key = keyOf(speaker, words);
  const price = await talkPrice(db, viewer);
  const had = (await db.query<Talk>(`select id, who, text, status, error from adult_talks where owner_id = $1 and key = $2 and status <> 'failed' and version = $3`, [viewer, key, TALK_VERSION])).rows[0];
  if (had) return { ok: true, talk: had, price };
  const portrait = (await presenceOf(db, viewer, [speaker]))[speaker]?.portrait;
  if (!portrait) return fail(409, "no_portrait", "✨ Bring them to life first (in ⋯): a talking moment starts from their portrait.");
  const keys = await adultKeys(db);
  if (!keys.venice) return fail(409, "not_set_up", "Talking moments need the Venice key in After Dark's settings.");
  const capped = await overCap(db, viewer, "clips");
  if (capped) return fail(429, "capped", capped);
  const gate = await mediaGate(db, { owner: viewer });
  if (!gate.ok) return fail(503, "paused", gate.message);
  // The line's own voice, made now if it hasn't been (and counted as a voiced line, as on 🔈).
  const voiced = await voiceLines(db, viewer, { a: ask.a, b: ask.b, night_id: ask.night_id ?? null, lines: [{ i: ask.i, text: ask.text }] });
  const voiceId = voiced.ok ? voiced.voices[0]?.id : null;
  const audio = voiceId ? await mediaBytes(db, voiceId, viewer) : null;
  if (!audio) return fail(502, "no_voice", voiced.ok ? `Their voice for that line couldn't be made (${voiced.voices[0]?.message ?? voiced.voices[0]?.reason ?? "error"}).` : voiced.message);
  if (price > 0 && !(await spendBoughtTokens(db, viewer, price))) return fail(402, "needs_tokens", `A talking moment costs ${price} token${price === 1 ? "" : "s"}. Get more on the shop page.`);
  const id = crypto.randomUUID();
  const model = (await getAdultSettings(db)).talk_model;
  try {
    const queueId = await queueVideo(keys.venice, {
      model,
      seconds: words.split(/\s+/).length <= WORDS_5S ? 5 : 10,
      image_url: signedPresenceUrl(portrait, baseUrl),
      prompt: TALK_PROMPT,
      negative: TALK_NEGATIVE,
      audio_url: `data:${audio.mime};base64,${audio.data.toString("base64")}`,
    });
    await db.query(
      `insert into adult_talks (id, owner_id, character_id, key, who, text, status, model, queue_id, tokens, version) values ($1, $2, $3, $4, $5, $6, 'making', $7, $8, $9, $10)
       on conflict (owner_id, key) do update set id = excluded.id, status = 'making', model = excluded.model, queue_id = excluded.queue_id, tokens = excluded.tokens,
         version = excluded.version, error = null, mime = null, data = null, object_key = null, created_at = now(), updated_at = now()`,
      [id, viewer, speaker, key, line.who, line.text, model, queueId, price, TALK_VERSION],
    );
    return { ok: true, talk: { id, who: line.who, text: line.text, status: "making", error: null }, price };
  } catch (err) {
    if (price > 0) await refundBoughtTokens(db, viewer, price);
    return fail(502, "not_started", `It couldn't start (${err instanceof Error ? err.message.slice(0, 160) : "error"}). Your tokens are back.`);
  }
}

/**
 * This viewer's talking moments being made, collected: a finished one checked (Hive) and kept, or discarded with its
 * tokens back; one not back in GIVE_UP_MS given up, tokens back too. While Hive is out they wait.
 */
export async function collectTalks(db: Db, viewer: string): Promise<number> {
  const { rows } = await db.query<Row>(`select id, owner_id, tokens, model, queue_id, created_at from adult_talks where owner_id = $1 and status = 'making' order by created_at limit 3`, [viewer]);
  if (!rows.length) return 0;
  const keys = await adultKeys(db);
  if (!keys.venice) return 0;
  const failed = async (r: Row, why: string) => {
    const done = await db.query(`update adult_talks set status = 'failed', error = $2, updated_at = now() where id = $1 and status = 'making' returning id`, [r.id, why.slice(0, 200)]);
    if (done.rows.length && r.tokens > 0) await refundBoughtTokens(db, r.owner_id, r.tokens);
  };
  let kept = 0;
  for (const r of rows) {
    if (Date.now() - new Date(r.created_at).getTime() > GIVE_UP_MS) {
      await failed(r, "gave up waiting");
      continue;
    }
    if (!r.model || !r.queue_id) continue;
    const got = await retrieveVideo(keys.venice, r.model, r.queue_id);
    if (got.state === "making") continue;
    if (got.state === "failed") {
      await failed(r, got.reason);
      continue;
    }
    const verdict = await checkMedia(db, { base64: got.bytes.toString("base64"), mime: "video/mp4" }, "video", { owner: viewer });
    if (!verdict.ok && verdict.reason.startsWith("the check couldn't run")) break;
    if (!verdict.ok) {
      await failed(r, `the check refused it: ${verdict.reason}`);
      await releaseVideo(keys.venice, r.model, r.queue_id);
      continue;
    }
    const file = await keepBytes("after-dark", r.id, got.bytes, "video/mp4");
    const claimed = await db.query(
      `update adult_talks set status = 'ready', mime = 'video/mp4', data = $2, object_key = $3, error = null, updated_at = now() where id = $1 and status = 'making' returning id`,
      [r.id, file.data, file.object_key],
    );
    if (claimed.rows.length) {
      await countUse(db, viewer, "clips");
      kept++;
    }
    await releaseVideo(keys.venice, r.model, r.queue_id);
  }
  return kept;
}

/** The pair's talking moments for this viewer, newest first: the theater matches them to its lines by who and text. */
export async function talksFor(db: Db, viewer: string, pair: [string, string]): Promise<Talk[]> {
  const { rows } = await db.query<Talk>(
    `select id, who, text, status, error from adult_talks where owner_id = $1 and character_id = any($2::text[]) and version = $3 order by created_at desc limit 60`,
    [viewer, pair, TALK_VERSION],
  );
  return rows;
}

/** A ready talking moment of this viewer's: its stored copy. */
export async function talkFile(db: Db, viewer: string, id: string): Promise<{ mime: string; object_key: string | null; data: Buffer | null } | null> {
  const r = (
    await db.query<{ mime: string | null; object_key: string | null; data: Buffer | null }>(`select mime, object_key, data from adult_talks where id = $1 and owner_id = $2 and status = 'ready' and version = $3`, [
      id,
      viewer,
      TALK_VERSION,
    ])
  ).rows[0];
  return r?.mime ? { mime: r.mime, object_key: r.object_key, data: r.data } : null;
}
export const talkBytes = (f: { object_key: string | null; data: Buffer | null }) => readBytes(f);
