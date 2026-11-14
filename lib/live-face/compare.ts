/**
 * The renderer compare (docs/PRDs/digital-human.md, "Renderer compare"): an admin picks a character and a line, the
 * line is voiced once (Aura, the character's own voice), and every chosen renderer (lib/live-face/renderers.ts) gets
 * the same audio and the same kit, side by side, with its time, its estimated cost and a 1–5 rating that accumulates
 * per renderer and character. Keys: the admin's own Connection for a provider when they have one, else the house key.
 * Also here: a person's choice of live-face renderer for their own calls (user_live_face).
 */
import { randomUUID } from "node:crypto";
import { adultKeys } from "../adult/settings";
import { auraVoiceFor, speakAura } from "../companion-live";
import { LIVE_AUDIO_RATE } from "../companion-live-shared";
import { openConnection } from "../connections";
import type { Db } from "../db";
import { faceKitOf } from "../face-kit";
import { keepBytes, readBytes } from "../object-store";
import { inBackground } from "../sets";
import { JOB, liveFaceRowFor } from "./index";
import { RENDERERS, rendererById, type ClipRenderer, type RenderInput, type RendererProvider } from "./renderers";

type Env = Record<string, string | undefined>;

export type CompareRow = { id: string; user_id: string; character_id: string; character_name: string | null; line: string; voice: string; audio_seconds: number | null; created_at: string };
export type RenderRow = {
  id: string;
  compare_id: string;
  renderer: string;
  provider: string;
  model: string;
  status: "queued" | "running" | "done" | "failed";
  ms: number | null;
  cost_usd: number | null;
  error: string | null;
  rating: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export const LIVE_FACE_CHOICES = ["auto", "musetalk", "simli"] as const;
export type LiveFaceChoice = (typeof LIVE_FACE_CHOICES)[number];
export const isLiveFaceChoice = (v: unknown): v is LiveFaceChoice => typeof v === "string" && (LIVE_FACE_CHOICES as readonly string[]).includes(v);

const LINE_MAX = 240;
/** The hosted models queue and take minutes (OmniHuman ten or more at busy times); a render gets a quarter of an hour. */
const RENDER_TIMEOUT_MS = 15 * 60_000;

/** Which key each provider's renderers run on for this person: theirs, the house's, or none. */
export async function keysFor(db: Db, userId: string, env: Env = process.env): Promise<Record<RendererProvider, { apiKey: string | null; from: "yours" | "house" | null }>> {
  const house = await adultKeys(db, env).catch(() => ({ fal: null, replicate: null }) as { fal: string | null; replicate: string | null });
  const mine = async (p: string) => openConnection(db, userId, p, env).catch(() => null);
  const pick = async (p: string, houseKey: string | null) => {
    const own = await mine(p);
    if (own) return { apiKey: own, from: "yours" as const };
    return houseKey ? { apiKey: houseKey, from: "house" as const } : { apiKey: null, from: null };
  };
  return {
    house: { apiKey: null, from: "house" },
    fal: await pick("fal", house.fal),
    replicate: await pick("replicate", house.replicate),
    did: await pick("did", env.DID_API_KEY?.trim() || null),
    simli: await pick("simli", env.SIMLI_API_KEY?.trim() || null),
  };
}

/** The renderers for the page: each with whether it can run for this person and on whose key. */
export async function rendererListing(db: Db, userId: string, env: Env = process.env): Promise<(Omit<ClipRenderer, "speak" | "ready"> & { key: "yours" | "house" | null; ready: boolean })[]> {
  const keys = await keysFor(db, userId, env);
  return RENDERERS.map(({ speak: _speak, ready: isReady, ...r }) => {
    const k = keys[r.provider];
    const ready = r.runs && (isReady ? isReady(env) : Boolean(k.apiKey));
    return { ...r, key: k.from, ready };
  });
}

/** The characters a compare can use: those with a ready face kit (a portrait and a loop). */
export async function compareCharacters(db: Db): Promise<{ id: string; name: string; live_face: string | null }[]> {
  const { rows } = await db.query<{ id: string; name: string; live_face: string | null }>(
    `select c.id, c.name, (select provider_face_id from live_faces f where f.character_id = c.id and f.status = 'ready' and f.provider = 'musetalk' limit 1) as live_face
       from characters c
      where exists (select 1 from face_kits k where k.character_id = c.id and k.part = 'loop' and k.status = 'ready')
        and exists (select 1 from face_kits k where k.character_id = c.id and k.part = 'portrait' and k.status = 'ready')
      order by c.name limit 200`,
  );
  return rows;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const parts: Buffer[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (value?.length) parts.push(Buffer.from(value));
    if (done) break;
  }
  return Buffer.concat(parts);
}

/** The PCM inside a WAV (a 44-byte canonical header, which is what Aura writes). */
export function pcmOfWav(wav: Buffer): Buffer {
  if (wav.length >= 44 && wav.toString("ascii", 0, 4) === "RIFF") return wav.subarray(44);
  return wav;
}

export type StartResult = { ok: true; id: string; renders: string[] } | { ok: false; status: number; error: string; message: string };

/** Voices the line once and starts every chosen renderer on it; the renders finish in the background (compareState follows them). */
export async function startCompare(db: Db, who: { userId: string }, input: { characterId: string; line: string; renderers: string[] }, baseUrl: string, env: Env = process.env): Promise<StartResult> {
  const fail = (status: number, error: string, message: string): StartResult => ({ ok: false, status, error, message });
  const line = input.line.trim().slice(0, LINE_MAX);
  if (!line) return fail(400, "invalid_request", "Give them a line to say.");
  const chosen = Array.from(new Set(input.renderers)).map((id) => rendererById(id)).filter((r): r is ClipRenderer => Boolean(r && r.runs));
  if (!chosen.length) return fail(400, "invalid_request", "Pick at least one renderer.");
  const c = (await db.query<{ id: string; name: string; pronouns: string | null }>(`select id, name, pronouns from characters where id = $1`, [input.characterId])).rows[0];
  if (!c) return fail(404, "not_found", "No such character.");
  const kit = await faceKitOf(db, c.id, baseUrl);
  if (!kit?.stills.portrait || !kit.loop) return fail(409, "no_kit", "Draw their face kit first: the renderers work from its portrait and loop.");
  const voice = auraVoiceFor(c);
  let wav: Buffer;
  try {
    wav = await collect(await speakAura(line, voice, { container: "wav", env }));
  } catch (err) {
    return fail(502, "voice_failed", `Aura couldn't voice the line: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
  }
  const pcm = pcmOfWav(wav);
  const seconds = Math.round((pcm.length / 2 / LIVE_AUDIO_RATE) * 100) / 100;
  if (!seconds) return fail(502, "voice_failed", "Aura returned no audio.");
  const id = randomUUID();
  const stored = await keepBytes("companion", `compare-${id}`, wav, "audio/wav");
  await db.query(`insert into live_face_compares (id, user_id, character_id, line, voice, audio_seconds, audio_key, audio_data) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [
    id,
    who.userId,
    c.id,
    line,
    voice,
    seconds,
    stored.object_key,
    stored.data,
  ]);
  const renders: { renderId: string; r: ClipRenderer }[] = [];
  for (const r of chosen) {
    const renderId = randomUUID();
    await db.query(`insert into live_face_renders (id, compare_id, renderer, provider, model, status) values ($1, $2, $3, $4, $5, 'queued')`, [renderId, id, r.id, r.provider, r.model]);
    renders.push({ renderId, r });
  }
  const bundle = await liveFaceRowFor(db, c.id, baseUrl, "musetalk", env);
  const renderInput: RenderInput = {
    characterId: c.id,
    portraitUrl: new URL(kit.stills.portrait, baseUrl).toString(),
    loopUrl: new URL(kit.loop, baseUrl).toString(),
    audio: { pcm, wav, rate: LIVE_AUDIO_RATE, seconds, url: `${baseUrl.replace(/\/$/, "")}/api/live-face/audio/${id}.wav` },
    bundleKey: bundle && bundle.status === "ready" && bundle.provider_face_id && !bundle.provider_face_id.startsWith(JOB) ? bundle.provider_face_id : null,
  };
  const keys = await keysFor(db, who.userId, env);
  inBackground(() => Promise.allSettled(renders.map(({ renderId, r }) => runRender(db, renderId, r, renderInput, keys[r.provider].apiKey, env))));
  return { ok: true, id, renders: renders.map((x) => x.renderId) };
}

async function runRender(db: Db, renderId: string, r: ClipRenderer, input: RenderInput, apiKey: string | null, env: Env): Promise<void> {
  await db.query(`update live_face_renders set status = 'running', updated_at = now() where id = $1`, [renderId]);
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), RENDER_TIMEOUT_MS);
  try {
    const out = await r.speak(input, { apiKey, env, signal: stop.signal });
    const stored = await keepBytes("companion", `render-${renderId}`, out.mp4, "video/mp4");
    await db.query(`update live_face_renders set status = 'done', ms = $2, cost_usd = $3, note = $4, mp4_key = $5, mp4_data = $6, error = null, updated_at = now() where id = $1`, [
      renderId,
      out.ms,
      out.cost_usd,
      out.note ?? null,
      stored.object_key,
      stored.data,
    ]);
  } catch (err) {
    const why = stop.signal.aborted ? "took longer than fifteen minutes" : err instanceof Error ? err.message.slice(0, 300) : "error";
    await db.query(`update live_face_renders set status = 'failed', error = $2, updated_at = now() where id = $1`, [renderId, why]).catch(() => {});
  } finally {
    clearTimeout(timer);
  }
}

const RENDER_COLS = `id, compare_id, renderer, provider, model, status, ms, cost_usd, error, rating, note, created_at::text, updated_at::text`;

export async function compareState(db: Db, id: string): Promise<{ compare: CompareRow; renders: RenderRow[] } | null> {
  const compare = (
    await db.query<CompareRow>(
      `select p.id, p.user_id, p.character_id, c.name as character_name, p.line, p.voice, p.audio_seconds, p.created_at::text from live_face_compares p left join characters c on c.id = p.character_id where p.id = $1`,
      [id],
    )
  ).rows[0];
  if (!compare) return null;
  const { rows: renders } = await db.query<RenderRow>(`select ${RENDER_COLS} from live_face_renders where compare_id = $1 order by created_at`, [id]);
  return { compare, renders };
}

/** The last compares (newest first) with their renders, and each renderer's average rating over all of them. */
export async function listCompares(db: Db, limit = 12): Promise<{ compares: { compare: CompareRow; renders: RenderRow[] }[]; averages: { renderer: string; rated: number; average: number }[] }> {
  const { rows: compares } = await db.query<CompareRow>(
    `select p.id, p.user_id, p.character_id, c.name as character_name, p.line, p.voice, p.audio_seconds, p.created_at::text from live_face_compares p left join characters c on c.id = p.character_id order by p.created_at desc limit $1`,
    [limit],
  );
  const ids = compares.map((c) => c.id);
  const { rows: renders } = ids.length ? await db.query<RenderRow>(`select ${RENDER_COLS} from live_face_renders where compare_id = any($1::text[]) order by created_at`, [ids]) : { rows: [] as RenderRow[] };
  const { rows: averages } = await db.query<{ renderer: string; rated: number; average: number }>(
    `select renderer, count(rating)::int as rated, round(avg(rating)::numeric, 2)::float as average from live_face_renders where rating is not null group by renderer order by average desc`,
  );
  return { compares: compares.map((compare) => ({ compare, renders: renders.filter((r) => r.compare_id === compare.id) })), averages };
}

export async function rateRender(db: Db, renderId: string, rating: number | null): Promise<boolean> {
  const { rows } = await db.query(`update live_face_renders set rating = $2, updated_at = now() where id = $1 returning id`, [renderId, rating]);
  return rows.length > 0;
}

export async function renderClip(db: Db, renderId: string): Promise<Buffer | null> {
  const row = (await db.query<{ mp4_key: string | null; mp4_data: Buffer | null }>(`select mp4_key, mp4_data from live_face_renders where id = $1 and status = 'done'`, [renderId])).rows[0];
  return row ? readBytes({ object_key: row.mp4_key, data: row.mp4_data }) : null;
}

/** The compare's voiced line, for the providers to fetch (the id is the only key: a UUID nobody is told). */
export async function compareAudio(db: Db, id: string): Promise<Buffer | null> {
  const row = (await db.query<{ audio_key: string | null; audio_data: Buffer | null }>(`select audio_key, audio_data from live_face_compares where id = $1`, [id])).rows[0];
  return row ? readBytes({ object_key: row.audio_key, data: row.audio_data }) : null;
}

/* ------------------------------------------------ a person's renderer for their calls ------------------------------------------------ */

export async function userLiveFaceChoice(db: Db, userId: string): Promise<LiveFaceChoice> {
  const row = (await db.query<{ renderer: string }>(`select renderer from user_live_face where user_id = $1`, [userId])).rows[0];
  return row && isLiveFaceChoice(row.renderer) ? row.renderer : "auto";
}

export async function setUserLiveFaceChoice(db: Db, userId: string, choice: LiveFaceChoice): Promise<void> {
  if (choice === "auto") {
    await db.query(`delete from user_live_face where user_id = $1`, [userId]);
    return;
  }
  await db.query(`insert into user_live_face (user_id, renderer) values ($1, $2) on conflict (user_id) do update set renderer = excluded.renderer, updated_at = now()`, [userId, choice]);
}
