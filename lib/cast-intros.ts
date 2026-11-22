/**
 * Cast video intros (David, 2026-11-14: OmniHuman "was good"; "just do the cast on the show only as a demo for now"):
 * a short clip of each character on this season's show saying hello in their own voice, rendered once by OmniHuman
 * on fal (the renderer David rated highest on the compare; 14¢ a second of clip, so the show's few, not every
 * character) from their approved portrait, kept in the object store and shown on their contestant card. One row per
 * character in character_intros; the voice is Aura's, the same voice their calls use; the voiced line is served
 * publicly (a UUID nobody is told) because fal takes URLs, not bytes.
 */
import { randomUUID } from "node:crypto";
import { adultKeys } from "./adult/settings";
import { type Character, loadCharacter } from "./character";
import { auraVoiceFor, speakAura } from "./companion-live";
import { LIVE_AUDIO_RATE } from "./companion-live-shared";
import type { Db } from "./db";
import { pcmOfWav } from "./live-face/compare";
import { rendererById } from "./live-face/renderers";
import { keepBytes, readBytes } from "./object-store";
import { approvedPortraitSelect } from "./portrait-sql";
import { characterPortrait } from "./portraits";
import { showCastIds } from "./season-cast";
import { escapeRegExp } from "./text";

type Env = Record<string, string | undefined>;

/** The renderer the intros use (lib/live-face/renderers.ts) and what it costs, for the row and the spend view. */
export const INTRO_RENDERER = "fal:omnihuman";
/** A line this long is about nine seconds of voice: enough to say hello, little enough to pay for. */
export const INTRO_MAX_CHARS = 150;
/** OmniHuman takes a couple of minutes a clip and queues at busy times. */
const INTRO_TIMEOUT_MS = 15 * 60_000;
/** A failed or lost intro can be asked for again after this long. */
const RETRY_AFTER_MS = 10 * 60_000;

export type IntroRow = {
  id: string;
  character_id: string;
  line: string;
  voice: string;
  renderer: string;
  status: "making" | "ready" | "failed";
  audio_key: string | null;
  audio_data: Buffer | null;
  seconds: number | null;
  mime: string | null;
  object_key: string | null;
  data: Buffer | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const COLS = `id, character_id, line, voice, renderer, status, audio_key, audio_data, seconds, mime, object_key, data, cost_usd, error, created_at::text, updated_at::text`;

/**
 * What they say: their name and the start of their bio, cut at a sentence, at most INTRO_MAX_CHARS. A bio that already
 * opens with their name isn't prefixed again.
 */
export function introLineFor(c: Pick<Character, "name" | "bio">): string {
  const first = c.name.split(/\s+/)[0];
  const bio = c.bio.replace(/\s+/g, " ").trim();
  const opensWithName = new RegExp(`^(hi|hey|hello)?[,!. ]*(i'?m|i am|it'?s|this is)?\\s*${escapeRegExp(first)}\\b`, "i").test(bio);
  const lead = opensWithName ? "" : `Hi, I'm ${first}. `;
  const room = INTRO_MAX_CHARS - lead.length;
  // Whole sentences while they fit; else the first sentence cut at a word.
  const sentences = bio.match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) ?? [bio];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > room) break;
    out += s;
  }
  if (!out.trim()) {
    const cut = bio.slice(0, room);
    out = cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trim().replace(/[,;:]$/, "") + ".";
  }
  return (lead + out).trim();
}

/**
 * The character's ready intro for their card, or null. The URL carries the render's time: the clip is cached for a
 * year (immutable, at Cloudflare too) and a re-render keeps its id, so a new render must be a new URL (2026-11-20,
 * the four intros re-rendered from the house-look-a portraits).
 */
export async function introOf(db: Db, characterId: string): Promise<{ id: string; url: string; line: string; seconds: number | null } | null> {
  const row = (
    await db.query<Pick<IntroRow, "id" | "line" | "seconds"> & { v: string | number }>(
      `select id, line, seconds, floor(extract(epoch from updated_at))::bigint as v from character_intros where character_id = $1 and status = 'ready'`,
      [characterId],
    )
  ).rows[0];
  return row ? { id: row.id, url: introUrl(row.id, String(row.v)), line: row.line, seconds: row.seconds } : null;
}

/**
 * The clip's URL; `version` (the render's time) makes each render its own URL for the year-long cache. It goes in the
 * path (`intro-<v>.mp4`), not a query: Cloudflare skips its cache for any URL with a query string (2026-11-20: `?v=`
 * came back BYPASS, every view from the app).
 */
export const introUrl = (id: string, version?: string): string => `/api/cast-intro/${encodeURIComponent(id)}/intro${version ? `-${encodeURIComponent(version)}` : ""}.mp4`;

/** Whether a file name is the clip: `intro.mp4`, or a render's own `intro-<v>.mp4`. */
export const isIntroClipFile = (file: string): boolean => /^intro(-\d+)?\.mp4$/.test(file);
export const introAudioUrl = (id: string): string => `/api/cast-intro/${encodeURIComponent(id)}/audio.wav`;

/**
 * Where a ready clip is kept (its store key; null when only Postgres has it) and its type, without reading it: the
 * route sends a clip kept on Bunny's CDN straight there (lib/object-store.ts cdnLink), with byte ranges from the edge.
 */
export async function introKey(db: Db, id: string): Promise<{ key: string | null; mime: string } | null> {
  const row = (await db.query<{ object_key: string | null; mime: string | null }>(`select object_key, mime from character_intros where id = $1 and status = 'ready'`, [id])).rows[0];
  return row ? { key: row.object_key, mime: row.mime ?? "video/mp4" } : null;
}

/** The clip's bytes, when it's ready. */
export async function introFile(db: Db, id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const row = (await db.query<IntroRow>(`select ${COLS} from character_intros where id = $1 and status = 'ready'`, [id])).rows[0];
  if (!row) return null;
  const bytes = await readBytes(row);
  return bytes ? { bytes, mime: row.mime ?? "video/mp4" } : null;
}

/** The voiced line as a WAV (fal fetches it while rendering; it stays for the record). */
export async function introAudio(db: Db, id: string): Promise<Buffer | null> {
  const row = (await db.query<Pick<IntroRow, "audio_key" | "audio_data">>(`select audio_key, audio_data from character_intros where id = $1`, [id])).rows[0];
  return row ? readBytes({ object_key: row.audio_key, data: row.audio_data }) : null;
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

/** The character's portrait as a URL fal can fetch: their newest approved PG portrait asset, else the house portrait file. */
export async function introPortraitUrl(db: Db, characterId: string, baseUrl: string): Promise<string | null> {
  const asset = (await db.query<{ id: string }>(`${approvedPortraitSelect("$1")}`, [characterId])).rows[0];
  const path = asset ? `/api/assets/${encodeURIComponent(asset.id)}` : characterPortrait(characterId);
  return path ? new URL(path, baseUrl).toString() : null;
}

export type IntroResult = { ok: true; id: string; status: IntroRow["status"]; seconds: number | null; cost_usd: number | null } | { ok: false; status: number; error: string; message: string };

/**
 * Renders (or re-renders a failed) intro for one character: the line voiced by Aura, kept; the clip from OmniHuman on
 * the house fal key, kept. Waits for the render (minutes): callers run it in the background. A ready intro isn't made
 * again; a character with no portrait, or a server with no fal key, is refused.
 */
export async function renderIntro(db: Db, characterId: string, baseUrl: string, env: Env = process.env, opts: { signal?: AbortSignal } = {}): Promise<IntroResult> {
  const fail = (status: number, error: string, message: string): IntroResult => ({ ok: false, status, error, message });
  const have = (await db.query<IntroRow>(`select ${COLS} from character_intros where character_id = $1`, [characterId])).rows[0];
  if (have?.status === "ready") return { ok: true, id: have.id, status: "ready", seconds: have.seconds, cost_usd: have.cost_usd };
  const c = await loadCharacter(db, characterId);
  if (!c) return fail(404, "not_found", "No such character.");
  const portraitUrl = await introPortraitUrl(db, characterId, baseUrl);
  if (!portraitUrl) return fail(409, "no_portrait", "They have no approved portrait to render from.");
  const apiKey = (await adultKeys(db, env).catch(() => ({ fal: null as string | null }))).fal;
  if (!apiKey) return fail(409, "no_key", "The house has no fal key set.");
  const renderer = rendererById(INTRO_RENDERER);
  if (!renderer) return fail(500, "no_renderer", `No renderer ${INTRO_RENDERER}.`);
  const id = have?.id ?? randomUUID();
  const line = introLineFor(c);
  const voice = auraVoiceFor(c);
  await db.query(
    `insert into character_intros (id, character_id, line, voice, renderer, status) values ($1, $2, $3, $4, $5, 'making')
     on conflict (character_id) do update set line = excluded.line, voice = excluded.voice, renderer = excluded.renderer, status = 'making', error = null, updated_at = now()`,
    [id, characterId, line, voice, INTRO_RENDERER],
  );
  const set = (fields: string, values: unknown[]) => db.query(`update character_intros set ${fields}, updated_at = now() where id = $1`, [id, ...values]);
  try {
    const wav = await collect(await speakAura(line, voice, { container: "wav", env, signal: opts.signal }));
    const pcm = pcmOfWav(wav);
    const seconds = Math.round((pcm.length / 2 / LIVE_AUDIO_RATE) * 100) / 100;
    if (!seconds) throw new Error("Aura returned no audio");
    const audio = await keepBytes("companion", `intro-audio-${id}`, wav, "audio/wav");
    await set(`audio_key = $2, audio_data = $3, seconds = $4`, [audio.object_key, audio.data, seconds]);
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), INTRO_TIMEOUT_MS);
    opts.signal?.addEventListener("abort", () => stop.abort());
    try {
      const out = await renderer.speak(
        { characterId, portraitUrl, loopUrl: null, audio: { pcm, wav, rate: LIVE_AUDIO_RATE, seconds, url: new URL(introAudioUrl(id), baseUrl).toString() }, bundleKey: null, line },
        { apiKey, env, signal: stop.signal },
      );
      // intros/: on Bunny's CDN where the show has its settings, so the card's clip plays from the edge with byte ranges
      // (lib/object-store.ts BUNNY_AREAS); one rendered before this is in companion/ until scripts/intros-to-bunny.mjs moves it.
      const stored = await keepBytes("intros", id, out.mp4, "video/mp4");
      await set(`status = 'ready', mime = 'video/mp4', object_key = $2, data = $3, cost_usd = $4, error = null`, [stored.object_key, stored.data, out.cost_usd]);
      return { ok: true, id, status: "ready", seconds, cost_usd: out.cost_usd };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 300) : "error";
    await set(`status = 'failed', error = $2`, [why]).catch(() => {});
    return fail(502, "render_failed", why);
  }
}

/** The intros of everyone on this season's show, as the admin page lists them (missing ones as null). */
export async function showIntros(db: Db): Promise<{ character_id: string; intro: Pick<IntroRow, "id" | "status" | "line" | "seconds" | "cost_usd" | "error" | "updated_at"> | null }[]> {
  const ids = showCastIds();
  const { rows } = ids.length ? await db.query<IntroRow>(`select ${COLS} from character_intros where character_id = any($1::text[])`, [ids]) : { rows: [] as IntroRow[] };
  return ids.map((character_id) => {
    const r = rows.find((x) => x.character_id === character_id);
    return { character_id, intro: r ? { id: r.id, status: r.status, line: r.line, seconds: r.seconds, cost_usd: r.cost_usd, error: r.error, updated_at: r.updated_at } : null };
  });
}

/**
 * Renders the intros this season's show still lacks (none yet, or failed a while ago), one after another (each a
 * couple of minutes at fal). Returns what it made and what it couldn't.
 */
export async function renderShowIntros(db: Db, baseUrl: string, env: Env = process.env): Promise<{ made: string[]; skipped: string[]; failed: { character_id: string; why: string }[] }> {
  const made: string[] = [];
  const skipped: string[] = [];
  const failed: { character_id: string; why: string }[] = [];
  for (const { character_id, intro } of await showIntros(db)) {
    const stale = intro && intro.status !== "ready" && Date.now() - new Date(intro.updated_at).getTime() > RETRY_AFTER_MS;
    if (intro && (intro.status === "ready" || !stale)) {
      skipped.push(character_id);
      continue;
    }
    const r = await renderIntro(db, character_id, baseUrl, env);
    if (r.ok) made.push(character_id);
    else failed.push({ character_id, why: r.message });
  }
  return { made, skipped, failed };
}
