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
 *  - Start frames: each one's own baseline, a portrait of them alone that already passed the age check, so the
 *    characters look like themselves. Venice fetches each one from a link signed for minutes (lib/adult/media.ts).
 *  - One person a shot (David, 2026-10-21: Star Dust and Sable's video showed people who aren't in After Dark, and Star
 *    with herself): a shot starts from a picture of the speaker alone, so it films the speaker alone, talking to the other
 *    one off camera. Asked for "two adults" from a one-person picture, the video model made the second one up: a
 *    stranger, or a copy of the speaker. The other one is seen in their own shots.
 *  - Chained (David, 2026-10-21: "uses the baseline in between the video switch… make it feel more like a continuous
 *    movie"): only each character's first shot starts from a picture. Their next one waits for it and starts from its
 *    last frame (lib/adult/frames.ts), so the pose carries on and the cuts read as shot, reverse shot. The two
 *    characters' chains run side by side. A shot whose last frame can't be had hands on its own picture instead.
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
import { REEL_STALLED_MS } from "./reel-timing";
import { checkAdultText } from "../safety";
import { checkOutput } from "./check";
import { adultModel } from "./mode";
import { ensureBaseline, signedMediaUrl } from "./media";
import { keepBytes } from "../object-store";
import { lastFrame } from "./frames";
import { siteUrl } from "../site";
import { eligiblePair, type SceneLine } from "./scenes";
import { adultKeys, getAdultSettings } from "./settings";

export const VENICE = "https://api.venice.ai/api/v1";
/** Shots in a reel, and how many words a shot can carry (people say about 2.5 words a second). */
export const REEL_SHOTS = 6;
const WORDS_5S = 12;
const WORDS_MAX = 24;
const SHOTS_PER_POLL = 2;
/**
 * A shot Hive couldn't check (busy, rate-limited) waits this long before it's fetched and sent again. Without it, an
 * open page polling every 15s re-sent two 10 MB shots to Hive each time, which kept Hive rate-limiting the whole site
 * (2026-10-19). And a reel still waiting after REEL_GIVE_UP_MS gives up on those shots, so it stops blocking new ones.
 */
export const CHECK_RETRY_MS = 10 * 60 * 1000;
export const REEL_GIVE_UP_MS = 3 * 60 * 60 * 1000;
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
  /** After a check that couldn't run: not fetched or sent to Hive again before this time. */
  retry_at?: string;
  /** Chained: the shot (index) of the same character this one waits for, and starts from the last frame of. */
  after?: number;
  /** A ready shot's last frame (an adult_images 'frame'), for the same character's next shot. */
  last_frame?: string;
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
            `Prefer short, vivid spoken lines. Each shot films the speaker alone: the other one is just off camera, never in the frame. ` +
            `For each, describe in one sentence what the speaker is physically doing as they say it, alone in the frame (camera-ready, no dialogue). ` +
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
  // Spread across the night, more of them past the middle where it peaks. No motion: a line's action is often done to
  // the other one, who isn't in the shot.
  const out: { line: number; motion: string }[] = [];
  for (let k = 0; k < want; k++) {
    const t = want === 1 ? 0.6 : Math.pow(k / (want - 1), 0.8);
    const pick = usable[Math.min(usable.length - 1, Math.round(t * (usable.length - 1)))];
    if (!out.some((o) => o.line === pick.i)) out.push({ line: pick.i, motion: "" });
  }
  return out;
}

async function venice(key: string, path: string, body: unknown): Promise<Response> {
  return doFetch(`${VENICE}${path}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

/**
 * The pictures to start shots from: each one's own baseline, a portrait of them alone that passed the check. Never a
 * picture of two people, and never a scene picture: one made "of" one of them can still show the other, or someone the
 * picture model made up, and the shot would put that face in this pair's video (David, 2026-10-19: Cass Vega and Sable's
 * video showed Chud, from Chud and Sable's night). A reel makes a baseline first for anyone without one.
 */
export async function startFrames(db: Db, a: string, b: string): Promise<{ id: string; character_id: string | null; character_b: string | null; kind: string }[]> {
  return (
    await db.query<{ id: string; character_id: string | null; character_b: string | null; kind: string }>(
      `select id, character_id, character_b, kind from adult_images
        where status = 'ready' and kind = 'baseline' and character_b is null and character_id in ($1, $2)
        order by created_at desc limit 8`,
      [a, b],
    )
  ).rows;
}

/** The start frame for a shot of `speaker`: their own baseline (rotated, should they have more than one). */
export function frameFor(frames: { id: string; character_id: string | null; character_b: string | null }[], speaker: string, k: number): string | null {
  const own = frames.filter((f) => f.character_id === speaker && !f.character_b);
  return own.length ? own[k % own.length].id : null;
}

/** The reel holding the one-at-a-time slot, for the refusal: which pair, how far along, and whether it looks stuck. */
export type BusyReel = { id: string; a: string; b: string; names: [string, string]; done: number; shots: number; minutes: number; stalled: boolean };

export type MakeReelResult = { ok: true; reel: Reel } | { ok: false; status: number; error: string; message: string; busy?: BusyReel };

/** What the refusal says about the reel in the way: the pair's names, progress, and, once it's stuck, what to do. */
export function busyMessage(r: BusyReel): string {
  const of = `${r.done} of ${r.shots} shots`;
  const age = r.minutes < 1 ? "just now" : r.minutes < 90 ? `${r.minutes} min ago` : `${Math.round(r.minutes / 60)} hours ago`;
  const what = `A video of ${r.names[0]} and ${r.names[1]} is still being made (${of}, started ${age}).`;
  return r.stalled
    ? `${what} That's much longer than usual, so it looks stuck: stop it to get its tokens back, then make a new one.`
    : `${what} One video at a time, and they usually take a few minutes.`;
}

/** The owner's reel still making, if any, after giving up on any past REEL_GIVE_UP_MS (no provider is called). */
async function busyReel(db: Db, ownerId: string): Promise<BusyReel | null> {
  const { rows } = await db.query<{ id: string; character_a: string; character_b: string; shots: ReelShot[]; created_at: string | Date; a_name: string | null; b_name: string | null }>(
    `select r.id, r.character_a, r.character_b, r.shots, r.created_at, ca.name as a_name, cb.name as b_name
       from adult_reels r left join characters ca on ca.id = r.character_a left join characters cb on cb.id = r.character_b
      where r.owner_id = $1 and r.status = 'making' order by r.created_at`,
    [ownerId],
  );
  for (const r of rows) {
    const age = Date.now() - new Date(r.created_at).getTime();
    if (age > REEL_GIVE_UP_MS) {
      await stopReel(db, ownerId, r.id, "gave up waiting");
      continue;
    }
    const first = (n: string | null) => (n ?? "them").split(/\s+/)[0];
    return {
      id: r.id,
      a: r.character_a,
      b: r.character_b,
      names: [first(r.a_name), first(r.b_name)],
      done: r.shots.filter((s) => s.status !== "queued").length,
      shots: r.shots.length,
      minutes: Math.floor(age / 60_000),
      stalled: age > REEL_STALLED_MS,
    };
  }
  return null;
}

/**
 * Stops a reel still being made: its shots still out are given up, the ones already in are kept (a reel with any is
 * ready), and the share of tokens for the rest comes back. Anything else is left as it is.
 */
export async function stopReel(db: Db, ownerId: string, id: string, reason = "stopped"): Promise<Reel | null> {
  const row = (await db.query<{ owner_id: string; status: string; shots: ReelShot[] }>(`select owner_id, status, shots from adult_reels where id = $1`, [id])).rows[0];
  if (!row || row.owner_id !== ownerId) return null;
  if (row.status !== "making") return getReel(db, id);
  const shots = row.shots.map((s) => (s.status === "queued" ? { ...s, status: "failed" as const, reason } : s));
  await db.query(`update adult_reels set shots = $2::jsonb, updated_at = now() where id = $1 and status = 'making'`, [id, JSON.stringify(shots)]);
  return settleIfDone(db, id);
}

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
  const busy = await busyReel(db, ownerId);
  if (busy) return { ok: false, status: 409, error: "busy", message: busyMessage(busy), busy };
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
    // Each character's later shots wait for their previous one, to start from where it ended.
    shots.forEach((s, k) => {
      const prev = shots.slice(0, k).findLastIndex((p) => p.who === s.who);
      if (prev >= 0) s.after = prev;
    });
    await db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots) values ($1, $2, $3, $4, 'making', $5, $6::jsonb)`, [
      id,
      ownerId,
      a,
      b,
      pays ? price : 0,
      JSON.stringify(shots),
    ]);
    // Queue each character's first shot now (the two run in parallel on Venice); a shot that can't be queued is marked
    // failed. The rest wait for theirs (advanceReel queues them).
    for (const s of shots.filter((x) => x.after === undefined)) {
      await queueShot(db, keys.venice, settings.reel_model, s, s.who === "a" ? ca : cb, baseUrl).catch((err) => {
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

/** Queues one shot: the speaker alone in the frame, as in their start picture, talking to the other one off camera. */
async function queueShot(db: Db, key: string, model: string, s: ReelShot, speaker: Character | null, baseUrl: string): Promise<void> {
  const who = speaker?.pronouns?.startsWith("she") ? "woman" : speaker?.pronouns?.startsWith("he") ? "man" : "person";
  const words = s.text.split(" ").length;
  const duration = words <= WORDS_5S ? "5s" : "10s";
  const base =
    `One consenting adult ${who}, the person in this picture, alone in the frame. ${s.motion || "Close to the camera, intimate."} ` +
    `The ${who} is speaking to someone just off camera, lips moving with the words. Only this one person is ever in the frame: ` +
    `nobody else appears, and never a second copy of them. Cinematic, realistic, warm low light, the face stays the same as in the picture.`;
  const body: Record<string, unknown> = {
    model,
    duration,
    resolution: "720p",
    negative_prompt:
      "child, teen, minor, young-looking, cartoon, anime, distorted faces, extra limbs, text, watermark, " +
      "second person, another person, two people, duplicate person, twin, clone, crowd",
    image_url: signedMediaUrl(s.media_id!, baseUrl),
  };
  if (AUDIO_IN.test(model)) {
    // Our voice, so the words are exact and the voice is theirs every time; the model lip-syncs to it.
    const tts = await venice(key, "/audio/speech", { model: "tts-kokoro", input: s.text, voice: speaker ? voiceFor(speaker) : "af_river", response_format: "mp3" });
    if (!tts.ok) throw new Error(`voice ${tts.status}`);
    body.audio_url = `data:audio/mpeg;base64,${Buffer.from(await tts.arrayBuffer()).toString("base64")}`;
    body.prompt = base;
  } else {
    body.prompt = `${base} The ${who} says: "${s.text}"`;
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
export async function advanceReel(db: Db, ownerId: string, id: string, baseUrl = siteUrl()): Promise<Reel | null> {
  const row = (await db.query<{ owner_id: string; character_a: string; character_b: string; status: string; shots: ReelShot[]; created_at: string | Date }>(`select owner_id, character_a, character_b, status, shots, created_at from adult_reels where id = $1`, [id])).rows[0];
  if (!row || row.owner_id !== ownerId) return null;
  if (row.status !== "making") return getReel(db, id);
  const keys = await adultKeys(db);
  const shots = row.shots;
  // A couple of finished shots per poll: Hive rate-limits a burst (429), and the next poll takes the rest.
  let checked = 0;
  const now = Date.now();
  // Waited long enough: shots still unchecked are given up (their share of tokens comes back), so the reel settles.
  if (now - new Date(row.created_at).getTime() > REEL_GIVE_UP_MS) {
    for (const s of shots) if (s.status === "queued") Object.assign(s, { status: "failed", reason: s.reason ?? "gave up waiting" });
  }
  for (const s of shots) {
    if (s.status !== "queued" || !s.queue_id || !s.model || !keys.venice || checked >= SHOTS_PER_POLL) continue;
    if (s.retry_at && now < new Date(s.retry_at).getTime()) continue;
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
    // The check couldn't run (Hive busy or down): not a refusal yet. Try again after a wait, and send nothing more to
    // Hive this poll.
    if (!verdict.ok && verdict.reason.startsWith("the check couldn't run") && !verdict.reason.includes("no Hive key")) {
      s.retry_at = new Date(now + CHECK_RETRY_MS).toISOString();
      s.reason = verdict.reason.slice(0, 200);
      break;
    }
    if (!verdict.ok) {
      s.status = "discarded";
      s.reason = verdict.reason.slice(0, 200);
      await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'reel', $3)`, [crypto.randomUUID(), ownerId, verdict.reason.slice(0, 300)]).catch(() => {});
      continue;
    }
    const mediaId = crypto.randomUUID();
    const kept = await keepBytes("after-dark", mediaId, bytes, "video/mp4");
    await db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image) values ($1, $2, $3, $4, 'video', $5, 'video/mp4', $6, $7, 'ready', $8)`,
      [mediaId, ownerId, row.character_a, row.character_b, `Reel shot: ${s.text}`.slice(0, 500), kept.data, kept.object_key, s.media_id ?? null],
    );
    s.status = "ready";
    s.media_id = mediaId;
    delete s.retry_at;
    delete s.reason;
    // Where this shot ended, for the same character's next one (a frame of a shot that just passed the check).
    if (shots.some((x) => x.after === shots.indexOf(s))) {
      const frame = await lastFrame(bytes);
      if (frame) {
        const frameId = crypto.randomUUID();
        const keptFrame = await keepBytes("after-dark", frameId, frame, "image/jpeg");
        await db.query(
          `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, source_image) values ($1, $2, $3, null, 'frame', $4, 'image/jpeg', $5, $6, 'ready', $7)`,
          [frameId, ownerId, s.who === "a" ? row.character_a : row.character_b, `Last frame: ${s.text}`.slice(0, 500), keptFrame.data, keptFrame.object_key, mediaId],
        );
        s.last_frame = frameId;
      }
    }
    // Ours now: Venice's copy can go.
    await venice(keys.venice, "/video/retrieve", { model: s.model, queue_id: s.queue_id, delete_media_on_completion: true }).catch(() => {});
  }
  // A chained shot whose previous one is done: queued now, from that one's last frame (or its own picture, when the
  // previous shot failed or its frame couldn't be had).
  const waiting = shots.filter((s) => s.status === "queued" && !s.queue_id && s.after !== undefined && shots[s.after].status !== "queued");
  if (waiting.length && keys.venice) {
    const settings = await getAdultSettings(db);
    const [ca, cb] = await Promise.all([loadCharacter(db, row.character_a), loadCharacter(db, row.character_b)]);
    for (const s of waiting) {
      const prev = shots[s.after!];
      if (prev.status === "ready" && prev.last_frame) s.media_id = prev.last_frame;
      await queueShot(db, keys.venice, settings.reel_model, s, s.who === "a" ? ca : cb, baseUrl).catch((err) => {
        s.status = "failed";
        s.reason = err instanceof Error ? err.message.slice(0, 200) : "error";
      });
    }
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
