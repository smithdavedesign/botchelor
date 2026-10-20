/**
 * The full-night video (David, 2026-10-19: "send the full conversation over to be generated with the transcript and a
 * few base images of both characters… this is the bread winner"). A reel is a short film of a whole night: the model
 * picks its strongest lines across the night (the opening, the build, the peak, the close: the peak is rarely at either
 * end), each line becomes one shot of the speaker saying it, and the shots play in order with the line as a caption.
 *
 *  - Voices: each character gets one stock voice (Venice's Kokoro, open-weight), the same in every reel. Never a cloned
 *    voice: a cloned voice could be a real person's.
 *  - Shots: Venice image-to-video. With a voiced model (audio in, e.g. Wan 2.6) the shot is lip-synced to our audio;
 *    with a model that makes its own sound (e.g. Wan 3.0) the line is quoted in the prompt instead. The model is a
 *    setting (`reel_model`), so the test that sounds more real picks it.
 *  - Start frames: the pair's own pictures (baselines and scene pictures that already passed the age check), rotated, so
 *    the characters look like themselves. Venice fetches each one from a link signed for minutes (lib/adult/media.ts).
 *  - The check: every shot goes through Hive before it's stored (lib/adult/check.ts); a failed shot is discarded and its
 *    share of the tokens given back.
 *  - The price: `reel_tokens` bought tokens (After Dark's settings), admins free.
 *
 * Shots take minutes on Venice, so a reel is queued and then advanced by whoever's watching (GET polls advanceReel).
 */
import { isAdmin } from "../admins";
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import type { Character } from "../character";
import { loadCharacter } from "../character";
import type { Db } from "../db";
import { checkAdultText } from "../safety";
import { checkOutput } from "./check";
import { adultModel } from "./mode";
import { ensureBaseline, signedMediaUrl } from "./media";
import { eligiblePair, type SceneLine } from "./scenes";
import { adultKeys, getAdultSettings } from "./settings";

export const VENICE = "https://api.venice.ai/api/v1";
/** Shots in a reel, and how many words a shot can carry (people say about 2.5 words a second). */
export const REEL_SHOTS = 6;
const WORDS_5S = 12;
const WORDS_MAX = 24;
const SHOTS_PER_POLL = 2;
/** Kokoro's stock voices, by how a character is referred to. */
const VOICES = {
  she: ["af_bella", "af_nicole", "af_sarah", "af_heart", "af_nova", "af_jessica", "af_kore", "af_aoede"],
  he: ["am_onyx", "am_michael", "am_adam", "am_eric", "am_liam", "am_fenrir", "am_echo", "am_puck"],
  they: ["af_river", "am_echo", "af_sky", "am_liam"],
} as const;
/** Models that take our audio in and lip-sync to it; anything else gets the line quoted in its prompt. */
const AUDIO_IN = /^wan-2\.(5|6)|^wan-2-7-(image|text)-to-video/;

export type ReelShot = {
  line: number;
  who: "a" | "b";
  text: string;
  motion: string;
  status: "queued" | "ready" | "discarded" | "failed";
  queue_id?: string;
  model?: string;
  media_id?: string;
  reason?: string;
};
export type Reel = { id: string; status: "making" | "ready" | "failed"; tokens: number; shots: ReelShot[]; created_at: string };

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setReelFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

/** A character's voice: picked once from their pronouns and id, so it's the same in every reel. */
export function voiceFor(c: Pick<Character, "id" | "pronouns">): string {
  const p = c.pronouns?.toLowerCase() ?? "";
  const list = p.startsWith("she") ? VOICES.she : p.startsWith("he") ? VOICES.he : VOICES.they;
  let h = 0;
  for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** What a line says out loud (its *action* apart), cut to what fits a shot. */
export function spoken(text: string): { speech: string; action: string } {
  const m = text.match(/^\*([^*]+)\*\s*([\s\S]*)$/);
  const words = (m ? m[2] : text).trim().split(/\s+/).filter(Boolean);
  return { speech: words.slice(0, WORDS_MAX).join(" "), action: m ? m[1].trim() : "" };
}

/**
 * The lines a reel is made of: the model's pick of the strongest moments across the whole night, in order. Falls back
 * to lines spread across the night, weighted past the middle, when the model's pick can't be read.
 */
export async function pickLines(db: Db, lines: SceneLine[], n: number = REEL_SHOTS): Promise<{ line: number; motion: string }[]> {
  const usable = lines.map((l, i) => ({ i, ...spoken(l.text) })).filter((l) => l.speech.split(" ").length >= 3);
  if (!usable.length) return [];
  const want = Math.min(n, usable.length);
  try {
    const list = usable.map((l) => `${l.i}: ${lines[l.i].who.toUpperCase()}: ${l.action ? `(${l.action}) ` : ""}${l.speech}`).join("\n");
    const raw = await (await adultModel(db)).complete(
      [
        { role: "system", content: "You cut a short film from a private scene between two consenting adults. You pick lines; you never write new ones." },
        {
          role: "user",
          content:
            `Here is the whole night, one line per row as "index: speaker: line":\n${list}\n\n` +
            `Pick the ${want} lines that make the best short film of this night, in order: how it starts, how it builds, its most intense moment (usually in the middle or later, not at either end) and how it lands. ` +
            `Prefer short, vivid spoken lines. For each, describe in one sentence what the two of them are physically doing as it's said (camera-ready, no dialogue). ` +
            `Reply with a JSON object: {"shots": [{"line": 12, "motion": "..."}]}`,
        },
      ],
      { temperature: 0.4, maxTokens: 900 },
    );
    const parsed = JSON.parse(raw.trim()) as { shots?: { line?: unknown; motion?: unknown }[] };
    const ok = new Set(usable.map((l) => l.i));
    const shots = (parsed.shots ?? [])
      .map((s) => ({ line: Number(s.line), motion: typeof s.motion === "string" ? s.motion.trim().slice(0, 300) : "" }))
      .filter((s, k, all) => ok.has(s.line) && all.findIndex((x) => x.line === s.line) === k)
      .sort((x, y) => x.line - y.line)
      .slice(0, want);
    if (shots.length >= Math.min(3, want)) return shots;
  } catch {
    /* fall through to the spread */
  }
  // Spread across the night, more of them past the middle where it peaks.
  const out: { line: number; motion: string }[] = [];
  for (let k = 0; k < want; k++) {
    const t = want === 1 ? 0.6 : Math.pow(k / (want - 1), 0.8);
    const pick = usable[Math.min(usable.length - 1, Math.round(t * (usable.length - 1)))];
    if (!out.some((o) => o.line === pick.i)) out.push({ line: pick.i, motion: pick.action });
  }
  return out;
}

async function venice(key: string, path: string, body: unknown): Promise<Response> {
  return doFetch(`${VENICE}${path}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

/**
 * The pair's pictures that passed the check, to start shots from: each one's own (their baseline, and pictures of
 * them alone) and pictures of exactly these two together. Never a picture with someone else in it: a character's
 * pictures with another partner would put that partner's face in this pair's video (David, 2026-10-19: Cass Vega and
 * Sable's video showed Chud, from Chud and Sable's night, because Cass had no pictures of her own).
 */
export async function startFrames(db: Db, a: string, b: string): Promise<{ id: string; character_id: string | null; character_b: string | null; kind: string }[]> {
  return (
    await db.query<{ id: string; character_id: string | null; character_b: string | null; kind: string }>(
      `select id, character_id, character_b, kind from adult_images
        where status = 'ready' and kind <> 'video'
          and ((character_b is null and character_id in ($1, $2))
            or (character_id = $1 and character_b = $2) or (character_id = $2 and character_b = $1))
        order by (kind = 'baseline') desc, created_at desc limit 16`,
      [a, b],
    )
  ).rows;
}

/** The start frame for a shot of `speaker`: their own pictures first (rotated), then the two of them together. */
export function frameFor(frames: { id: string; character_id: string | null; character_b: string | null }[], speaker: string, k: number): string | null {
  const own = frames.filter((f) => f.character_id === speaker && !f.character_b);
  const together = frames.filter((f) => f.character_b);
  const pool = own.length ? own : together;
  return pool.length ? pool[k % pool.length].id : null;
}

export type MakeReelResult = { ok: true; reel: Reel } | { ok: false; status: number; error: string; message: string };

/**
 * Starts a reel of a night: spends the tokens (admins free), picks the lines, voices them and queues one shot per line.
 * `lines` is the night (the running scene, or a saved one).
 */
export async function makeReel(db: Db, ownerId: string, x: string, y: string, lines: SceneLine[], baseUrl: string, opts: { shots?: number } = {}): Promise<MakeReelResult> {
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return { ok: false, status: 404, error: "not_found", message: "Pick two characters who are in after dark." };
  const [a, b] = pair;
  const settings = await getAdultSettings(db);
  const keys = await adultKeys(db);
  if (!keys.venice || !keys.hive) return { ok: false, status: 409, error: "not_set_up", message: "Videos need the Venice and Hive keys in After Dark's settings." };
  if (lines.length < 6) return { ok: false, status: 409, error: "too_short", message: "Let the night run a little longer first: a video needs at least six lines." };
  const busy = await db.query(`select 1 from adult_reels where owner_id = $1 and status = 'making'`, [ownerId]);
  if (busy.rows.length) return { ok: false, status: 409, error: "busy", message: "A video is already being made. It takes a few minutes." };
  const pays = !(await isAdmin(db, ownerId));
  const price = settings.reel_tokens;
  if (pays && !(await spendBoughtTokens(db, ownerId, price))) {
    return { ok: false, status: 402, error: "needs_tokens", message: `A video of the night costs ${price} tokens. Get more on the shop page.` };
  }
  const id = crypto.randomUUID();
  try {
    const [ca, cb] = await Promise.all([loadCharacter(db, a), loadCharacter(db, b)]);
    // Each of them needs a picture of their own to start their shots from: a baseline is made now if they have none.
    for (const c of [ca, cb]) if (c) await ensureBaseline(db, ownerId, c);
    const frames = await startFrames(db, a, b);
    const picks = await pickLines(db, lines, Math.min(12, Math.max(2, opts.shots ?? settings.reel_shots)));
    const shots: ReelShot[] = [];
    for (const [k, p] of picks.entries()) {
      const l = lines[p.line];
      const { speech } = spoken(l.text);
      // Every word that will be spoken, and every direction, is held to the two lines first.
      if (!checkAdultText({ speech, motion: p.motion }).ok) continue;
      const speaker = l.who === "a" ? ca : cb;
      const frame = speaker ? frameFor(frames, speaker.id, k) : null;
      if (!frame) continue;
      shots.push({ line: p.line, who: l.who, text: speech, motion: p.motion, status: "queued", media_id: frame });
    }
    if (!shots.length) throw new Error("no usable lines");
    await db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots) values ($1, $2, $3, $4, 'making', $5, $6::jsonb)`, [
      id,
      ownerId,
      a,
      b,
      pays ? price : 0,
      JSON.stringify(shots),
    ]);
    // Queue every shot now (they run in parallel on Venice); a shot that can't be queued is marked failed.
    for (const s of shots) {
      const speaker = s.who === "a" ? ca : cb;
      const listener = s.who === "a" ? cb : ca;
      await queueShot(db, keys.venice, settings.reel_model, s, speaker, listener, baseUrl).catch((err) => {
        s.status = "failed";
        s.reason = err instanceof Error ? err.message.slice(0, 200) : "error";
      });
    }
    await db.query(`update adult_reels set shots = $2::jsonb where id = $1`, [id, JSON.stringify(shots)]);
    return { ok: true, reel: await settleIfDone(db, id) };
  } catch (err) {
    if (pays) await refundBoughtTokens(db, ownerId, price);
    await db.query(`delete from adult_reels where id = $1`, [id]).catch(() => {});
    return { ok: false, status: 502, error: "not_started", message: `The video couldn't start (${err instanceof Error ? err.message : "error"}). Your tokens are back.` };
  }
}

async function queueShot(db: Db, key: string, model: string, s: ReelShot, speaker: Character | null, listener: Character | null, baseUrl: string): Promise<void> {
  const who = (c: Character | null) => `${c?.pronouns?.startsWith("she") ? "woman" : c?.pronouns?.startsWith("he") ? "man" : "person"}`;
  const words = s.text.split(" ").length;
  const duration = words <= WORDS_5S ? "5s" : "10s";
  const base =
    `Two consenting adults, a ${who(speaker)} and a ${who(listener)}, alone together. ${s.motion || "They stay close, intimate."} ` +
    `The ${who(speaker)} is speaking to the other, lips moving with the words. Cinematic, realistic, warm low light, faces stay consistent.`;
  const body: Record<string, unknown> = {
    model,
    duration,
    resolution: "720p",
    negative_prompt: "child, teen, minor, young-looking, cartoon, anime, distorted faces, extra limbs, text, watermark",
    image_url: signedMediaUrl(s.media_id!, baseUrl),
  };
  if (AUDIO_IN.test(model)) {
    // Our voice, so the words are exact and the voice is theirs every time; the model lip-syncs to it.
    const tts = await venice(key, "/audio/speech", { model: "tts-kokoro", input: s.text, voice: speaker ? voiceFor(speaker) : "af_river", response_format: "mp3" });
    if (!tts.ok) throw new Error(`voice ${tts.status}`);
    body.audio_url = `data:audio/mpeg;base64,${Buffer.from(await tts.arrayBuffer()).toString("base64")}`;
    body.prompt = base;
  } else {
    body.prompt = `${base} The ${who(speaker)} says: "${s.text}"`;
    body.audio = true;
  }
  if (/^wan-3/.test(model)) body.aspect_ratio = "adaptive";
  const res = await venice(key, "/video/queue", body);
  if (!res.ok) throw new Error(`Venice ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const q = (await res.json()) as { queue_id?: string };
  if (!q.queue_id) throw new Error("Venice returned no queue id");
  s.queue_id = q.queue_id;
  s.model = model;
}

/** Checks a reel's queued shots once: stores each finished one that passes Hive, discards the rest. */
export async function advanceReel(db: Db, ownerId: string, id: string): Promise<Reel | null> {
  const row = (await db.query<{ owner_id: string; character_a: string; character_b: string; status: string; shots: ReelShot[] }>(`select owner_id, character_a, character_b, status, shots from adult_reels where id = $1`, [id])).rows[0];
  if (!row || row.owner_id !== ownerId) return null;
  if (row.status !== "making") return getReel(db, id);
  const keys = await adultKeys(db);
  const shots = row.shots;
  // A couple of finished shots per poll: Hive rate-limits a burst (429), and the next poll takes the rest.
  let checked = 0;
  for (const s of shots) {
    if (s.status !== "queued" || !s.queue_id || !s.model || !keys.venice || checked >= SHOTS_PER_POLL) continue;
    // Venice keeps the file until we've stored our own (a check that can't run yet is tried again next poll).
    const res = await venice(keys.venice, "/video/retrieve", { model: s.model, queue_id: s.queue_id });
    if (!res.ok) {
      s.status = "failed";
      s.reason = `Venice ${res.status}`;
      continue;
    }
    if (!(res.headers.get("content-type") ?? "").includes("video")) continue; // still being made
    const bytes = Buffer.from(await res.arrayBuffer());
    checked++;
    const verdict = await checkOutput(keys.hive, { base64: bytes.toString("base64"), mime: "video/mp4" }, "video");
    // The check couldn't run (Hive busy or down): not a refusal yet, so try this shot again on the next poll.
    if (!verdict.ok && verdict.reason.startsWith("the check couldn't run") && !verdict.reason.includes("no Hive key")) continue;
    if (!verdict.ok) {
      s.status = "discarded";
      s.reason = verdict.reason.slice(0, 200);
      await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'reel', $3)`, [crypto.randomUUID(), ownerId, verdict.reason.slice(0, 300)]).catch(() => {});
      continue;
    }
    const mediaId = crypto.randomUUID();
    await db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, source_image) values ($1, $2, $3, $4, 'video', $5, 'video/mp4', $6, 'ready', $7)`,
      [mediaId, ownerId, row.character_a, row.character_b, `Reel shot: ${s.text}`.slice(0, 500), bytes, s.media_id ?? null],
    );
    s.status = "ready";
    s.media_id = mediaId;
    // Ours now: Venice's copy can go.
    await venice(keys.venice, "/video/retrieve", { model: s.model, queue_id: s.queue_id, delete_media_on_completion: true }).catch(() => {});
  }
  await db.query(`update adult_reels set shots = $2::jsonb, updated_at = now() where id = $1`, [id, JSON.stringify(shots)]);
  return settleIfDone(db, id);
}

/** Once no shot is still being made: ready if any came through, and the share of tokens for the ones that didn't, back. */
async function settleIfDone(db: Db, id: string): Promise<Reel> {
  const r = (await db.query<{ owner_id: string; status: string; tokens: number; shots: ReelShot[] }>(`select owner_id, status, tokens, shots from adult_reels where id = $1`, [id])).rows[0];
  if (r.status === "making" && !r.shots.some((s) => s.status === "queued")) {
    const good = r.shots.filter((s) => s.status === "ready").length;
    const status = good ? "ready" : "failed";
    const refund = r.tokens - Math.ceil((r.tokens * good) / r.shots.length);
    const done = await db.query(`update adult_reels set status = $2, updated_at = now() where id = $1 and status = 'making' returning 1`, [id, status]);
    if (done.rows.length && refund > 0) await refundBoughtTokens(db, r.owner_id, refund);
  }
  return (await getReel(db, id))!;
}

export async function getReel(db: Db, id: string): Promise<Reel | null> {
  const r = (await db.query<{ id: string; status: Reel["status"]; tokens: number; shots: ReelShot[]; created_at: string }>(`select id, status, tokens, shots, created_at from adult_reels where id = $1`, [id])).rows[0];
  return r ? { ...r, created_at: new Date(r.created_at).toISOString() } : null;
}

/** The pair's reels for this person, newest first. */
export async function listReels(db: Db, ownerId: string, x: string, y: string): Promise<Reel[]> {
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return [];
  const { rows } = await db.query<{ id: string; status: Reel["status"]; tokens: number; shots: ReelShot[]; created_at: string }>(
    `select id, status, tokens, shots, created_at from adult_reels where owner_id = $1 and character_a = $2 and character_b = $3 order by created_at desc limit 20`,
    [ownerId, ...pair],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}
