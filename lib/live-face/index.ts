/**
 * A character's live face (docs/PRDs/digital-human.md, Tier 1): a face built once at a renderer from the character's
 * face kit, and what a call needs to show it when the person may have one. Two renderers, one at a time, chosen by
 * `LIVE_FACE_PROVIDER`; this is the one place that knows which, so the routes and the browser don't.
 *
 *  - **Simli** (./simli.ts): `simli` or `simli:admins`, with `SIMLI_API_KEY`. A face is built from the kit's portrait
 *    (hours, one of the plan's few a month: so by an admin, never on a call); a call gets a five-minute token and the
 *    browser opens the stream and sends it the voice.
 *  - **MuseTalk** (./musetalk.ts, our worker on Runpod): `musetalk` or `musetalk:admins`, with `RUNPOD_API_KEY` and
 *    `LIVE_FACE_ENDPOINT`. A face is a bundle built from the kit's idle loop (a minute or two, pay-per-second: still an
 *    admin's call for now); on a call the server turns each clause of the voice into a clip (liveFaceClips) and streams
 *    it to the browser, which needs no token.
 *  - Unset, nothing here does anything and a call is exactly Tier 0 (lib/face-kit.ts).
 *  - **A face** lives in live_faces: one per character per kit source (`source_id`) per provider. A new kit means a
 *    new face; the old plays until then. The kit route's poll collects faces being built (collectLiveFaces).
 *  - **Fallback:** anything failing here (no key, no face, the renderer down, the browser refused) leaves the call on
 *    Tier 0. What a call used is reported at its end (companion_live_calls.face_provider, face_seconds).
 */
import type { Db } from "../db";
import { faceKitBytes, faceKitFile, faceKitOf, faceSource } from "../face-kit";
import { type LiveFaceProvider, type LiveFaceSession } from "../live-face-shared";
import { jobError, jobStatus, MUSETALK_STREAM_PX, type PrepareOutput, runpodConfig, type RunpodConfig, startPrepare, warmWorker } from "./musetalk";
import { createSimliFace, deleteSimliFace, listSimliFaces, mintSimliSession, outOfFaces, simliFaceStatus, SIMLI_STREAM_PX, SimliError } from "./simli";

export type { LiveFaceProvider, LiveFaceSession } from "../live-face-shared";

type Env = Record<string, string | undefined>;
export type LiveFaceMode = "off" | "admins" | "on";

export const simliKey = (env: Env = process.env): string | null => env.SIMLI_API_KEY?.trim() || null;

function setting(env: Env): { provider: LiveFaceProvider; who: string | undefined } | null {
  const v = (env.LIVE_FACE_PROVIDER ?? "").trim().toLowerCase();
  if (!v || v === "off" || v === "0") return null;
  const [provider, who] = v.split(":");
  if (provider !== "simli" && provider !== "musetalk") return null;
  return { provider, who };
}

/** The renderer that's set and has what it needs (its key, its endpoint), or null: then live faces are off. */
export function liveFaceProvider(env: Env = process.env): LiveFaceProvider | null {
  const s = setting(env);
  if (!s) return null;
  if (s.provider === "simli") return simliKey(env) ? "simli" : null;
  return runpodConfig(env) ? "musetalk" : null;
}

/** Whether live faces are on, and for whom: the provider setting, and its key. */
export function liveFaceMode(env: Env = process.env): LiveFaceMode {
  const s = setting(env);
  if (!s || !liveFaceProvider(env)) return "off";
  return s.who === "admins" ? "admins" : "on";
}
export function liveFaceOn(env: Env, who: { admin: boolean }): boolean {
  const mode = liveFaceMode(env);
  return mode === "on" || (mode === "admins" && who.admin);
}

/** A face still "making" after this long with no word from the renderer is given up (Simli says about four hours). */
const FACE_GIVE_UP_MS = 12 * 60 * 60 * 1000;
/** A face's status isn't asked for more than this often (a bundle takes a minute or two; a Simli face hours). */
const POLL_EVERY_MS = 20 * 1000;
/** A MuseTalk face being built keeps its Runpod job id here until the bundle's key takes its place. */
const JOB = "job:";

export type LiveFaceRow = { id: string; character_id: string; source_id: string; provider: LiveFaceProvider; provider_face_id: string | null; status: "making" | "ready" | "failed"; error: string | null; created_at: string; updated_at: string };

async function rowFor(db: Db, characterId: string, sourceId: string, provider: LiveFaceProvider): Promise<LiveFaceRow | null> {
  const { rows } = await db.query<LiveFaceRow>(
    `select id, character_id, source_id, provider, provider_face_id, status, error, created_at::text, updated_at::text from live_faces where character_id = $1 and source_id = $2 and provider = $3`,
    [characterId, sourceId, provider],
  );
  return rows[0] ?? null;
}

/** The character's live face at the renderer that's set, for the kit they have now: its state, or null when none was ever asked for. */
export async function liveFaceState(db: Db, characterId: string, baseUrl: string, env: Env = process.env): Promise<LiveFaceRow | null> {
  const provider = liveFaceProvider(env) ?? setting(env)?.provider;
  if (!provider) return null;
  const source = await faceSource(db, characterId, baseUrl);
  return source ? rowFor(db, characterId, source.id, provider) : null;
}

export type LiveFaceBlocked = { ok: false; status: number; error: string; message: string };

/**
 * Builds the character's face at the renderer that's set: Simli from the kit's portrait, MuseTalk from the kit's idle
 * loop. Refused without the renderer's key, a kit, or (Simli) a monthly generation left; one that's building or ready
 * isn't built again. Returns at once with the renderer's id; collectLiveFaces follows the build.
 */
/** MuseTalk's mouth-box shift for new faces (`LIVE_FACE_BBOX_SHIFT`, -17..16 for a 624-px loop; 0 = as detected). The 2026-11-14 A/B on Juniper found no visible gain at 8 or 14, so 0 stays. */
function bboxShift(env: Env): number {
  const n = Number.parseInt(env.LIVE_FACE_BBOX_SHIFT ?? "", 10);
  return Number.isFinite(n) ? Math.max(-30, Math.min(30, n)) : 0;
}

/** The face_kits row id in a kit file URL (lib/face-kit.ts faceKitUrl; the loop's carries a `?v=` so caches let go when its file changes). */
const idOfKitUrl = (url: string) => url.split("?")[0].split("/").pop() || null;

export async function buildLiveFace(db: Db, characterId: string, baseUrl: string, env: Env = process.env): Promise<{ ok: true; face_id: string; status: LiveFaceRow["status"] } | LiveFaceBlocked> {
  const fail = (status: number, error: string, message: string): LiveFaceBlocked => ({ ok: false, status, error, message });
  const provider = liveFaceProvider(env);
  if (!provider) return fail(409, "not_set_up", setting(env)?.provider === "musetalk" ? "Live faces need RUNPOD_API_KEY and LIVE_FACE_ENDPOINT on the server." : "Live faces need SIMLI_API_KEY on the server.");
  const source = await faceSource(db, characterId, baseUrl);
  if (!source) return fail(409, "no_portrait", "They have no approved safe portrait, so no face kit and no live face.");
  const kit = await faceKitOf(db, characterId, baseUrl);
  const have = await rowFor(db, characterId, source.id, provider);
  if (have && have.status !== "failed" && have.provider_face_id) return { ok: true, face_id: have.provider_face_id, status: have.status };
  const name = (await db.query<{ name: string }>(`select name from characters where id = $1`, [characterId])).rows[0]?.name ?? characterId;

  if (provider === "musetalk") {
    const loopId = kit?.loop ? idOfKitUrl(kit.loop) : null;
    if (!loopId) return fail(409, "no_kit", "Draw their face kit first: the live face is built from its idle loop.");
    const file = await faceKitFile(db, loopId);
    const bytes = file ? await faceKitBytes(file) : null;
    if (!file || !bytes) return fail(409, "no_kit", "The kit's idle loop couldn't be read.");
    try {
      const job = await startPrepare(runpodConfig(env)!, { id: characterId, loop: bytes, bbox_shift: bboxShift(env) });
      await upsert(db, { character: characterId, source: source.id, provider, face: `${JOB}${job.job_id}`, status: "making", error: null });
      return { ok: true, face_id: job.job_id, status: "making" };
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 200) : "error";
      await upsert(db, { character: characterId, source: source.id, provider, face: null, status: "failed", error: why });
      return fail(502, "provider_error", why);
    }
  }

  const key = simliKey(env)!;
  const portraitId = kit?.stills.portrait ? idOfKitUrl(kit.stills.portrait) : null;
  if (!portraitId) return fail(409, "no_kit", "Draw their face kit first: the live face is built from its portrait.");
  const file = await faceKitFile(db, portraitId);
  const bytes = file ? await faceKitBytes(file) : null;
  if (!file || !bytes) return fail(409, "no_kit", "The kit's portrait couldn't be read.");
  try {
    const made = await createSimliFace(key, { bytes, mime: file.mime }, `botchelor ${name}`.replace(/[^\w .-]/g, "").trim());
    await upsert(db, { character: characterId, source: source.id, provider: "simli", face: made.face_id, status: "making", error: null });
    return { ok: true, face_id: made.face_id, status: "making" };
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 200) : "error";
    if (outOfFaces(err)) return fail(402, "no_generations", "Simli has no face generations left this month on our plan.");
    await upsert(db, { character: characterId, source: source.id, provider: "simli", face: null, status: "failed", error: why });
    return fail(err instanceof SimliError ? 502 : 500, "provider_error", why);
  }
}

/**
 * Faces being built, followed (the kit route's poll and the admin page ask): done at the renderer → ready; failed, or
 * forgotten after a long while → failed. At most three, each asked about once a poll interval. `characterId` narrows it.
 */
export async function collectLiveFaces(db: Db, env: Env = process.env, characterId?: string): Promise<number> {
  const key = simliKey(env);
  const runpod = runpodConfig(env);
  if (!key && !runpod) return 0;
  const { rows } = await db.query<LiveFaceRow>(
    `select id, character_id, source_id, provider, provider_face_id, status, error, created_at::text, updated_at::text from live_faces
      where status = 'making' and provider_face_id is not null and updated_at < now() - make_interval(secs => $2) and ($1::text is null or character_id = $1)
      order by created_at limit 3`,
    [characterId ?? null, POLL_EVERY_MS / 1000],
  );
  let ready = 0;
  for (const r of rows) {
    const set = (status: LiveFaceRow["status"], error: string | null = null, face: string | null = r.provider_face_id) =>
      db.query(`update live_faces set status = $2, error = $3, provider_face_id = $4, updated_at = now() where id = $1 and status = 'making'`, [r.id, status, error?.slice(0, 200) ?? null, face]);
    const touch = () => db.query(`update live_faces set updated_at = now() where id = $1`, [r.id]);
    try {
      if (r.provider === "musetalk") {
        if (!runpod || !r.provider_face_id?.startsWith(JOB)) {
          await touch();
          continue;
        }
        const job = await jobStatus<PrepareOutput>(runpod, r.provider_face_id.slice(JOB.length));
        if (job.status === "COMPLETED" && job.output?.bundle_key) {
          await set("ready", null, job.output.bundle_key);
          // The worker re-timed a pulled-down loop to real 25 fps and stored it: the kit shows that one from now on
          // (same row, new file, so the kit's URL changes with its updated_at and caches let go).
          if (job.output.loop_key) {
            await db
              .query(`update face_kits set object_key = $3, data = null, mime = 'video/mp4', updated_at = now() where character_id = $1 and source_id = $2 and part = 'loop' and status = 'ready'`, [r.character_id, r.source_id, job.output.loop_key])
              .catch((err: unknown) => console.error(`[live-face] ${r.character_id}: the re-timed loop couldn't replace the kit's: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`));
          }
          ready++;
        } else if (job.status === "FAILED" || job.status === "CANCELLED" || job.status === "TIMED_OUT") await set("failed", `the renderer couldn't build it: ${jobError(job)}`);
        else if (Date.now() - new Date(r.created_at).getTime() > FACE_GIVE_UP_MS) await set("failed", "the renderer lost it");
        else await touch();
        continue;
      }
      if (!key) {
        await touch();
        continue;
      }
      const s = await simliFaceStatus(key, r.provider_face_id!);
      if (s.status === "completed") {
        await set("ready");
        ready++;
      } else if (s.status === "failed") await set("failed", "the renderer couldn't build it");
      else if (s.status === "not_found") {
        // Forgotten by the status call: a face that finished more than a day ago is in the account's list.
        const listed = (await listSimliFaces(key)).some((f) => f.id === r.provider_face_id && !f.is_deleted);
        if (listed) {
          await set("ready");
          ready++;
        } else if (Date.now() - new Date(r.created_at).getTime() > FACE_GIVE_UP_MS) await set("failed", "the renderer lost it");
        else await touch();
      } else await touch();
    } catch (err) {
      console.error(`[live-face] ${r.character_id}: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
      await touch();
    }
  }
  return ready;
}

/**
 * A session for a call with this character, when live faces are on for this person and the face is ready: for Simli
 * the token the browser opens the stream with; for MuseTalk the word that clips will come (and a worker warming up).
 * Null for any other reason, quietly: the call goes on as Tier 0.
 */
export async function liveFaceSession(db: Db, characterId: string, baseUrl: string, who: { admin: boolean }, opts: { maxSeconds?: number; idleSeconds?: number; env?: Env } = {}): Promise<LiveFaceSession | null> {
  const env = opts.env ?? process.env;
  if (!liveFaceOn(env, who)) return null;
  const face = await liveFaceState(db, characterId, baseUrl, env);
  if (!face || face.status !== "ready" || !face.provider_face_id) return null;
  if (face.provider === "musetalk") {
    void warmWorker(runpodConfig(env)!);
    return { provider: "musetalk", px: MUSETALK_STREAM_PX };
  }
  try {
    const s = await mintSimliSession(simliKey(env)!, face.provider_face_id, { maxSeconds: opts.maxSeconds, idleSeconds: opts.idleSeconds, background: env.SIMLI_BACKGROUND_ID?.trim() || null });
    return { provider: "simli", token: s.token, px: SIMLI_STREAM_PX };
  } catch (err) {
    console.error(`[live-face] session for ${characterId}: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
    return null;
  }
}

/** What a turn needs to render MuseTalk clips for this character, when that's on for this person and the bundle is ready; else null. */
export async function liveFaceClips(db: Db, characterId: string, baseUrl: string, who: { admin: boolean }, env: Env = process.env): Promise<{ runpod: RunpodConfig; bundle_key: string } | null> {
  if (liveFaceProvider(env) !== "musetalk" || !liveFaceOn(env, who)) return null;
  const face = await liveFaceState(db, characterId, baseUrl, env);
  if (!face || face.provider !== "musetalk" || face.status !== "ready" || !face.provider_face_id || face.provider_face_id.startsWith(JOB)) return null;
  return { runpod: runpodConfig(env)!, bundle_key: face.provider_face_id };
}

/** Forgets a character's live faces here and at Simli (a new portrait, or taking it down). A MuseTalk bundle stays in the bucket, unused. */
export async function dropLiveFace(db: Db, characterId: string, env: Env = process.env): Promise<number> {
  const key = simliKey(env);
  const { rows } = await db.query<{ id: string; provider: LiveFaceProvider; provider_face_id: string | null }>(`select id, provider, provider_face_id from live_faces where character_id = $1`, [characterId]);
  for (const r of rows) {
    if (key && r.provider === "simli" && r.provider_face_id) await deleteSimliFace(key, r.provider_face_id).catch(() => {});
    await db.query(`delete from live_faces where id = $1`, [r.id]);
  }
  return rows.length;
}

async function upsert(db: Db, p: { character: string; source: string; provider: LiveFaceProvider; face: string | null; status: LiveFaceRow["status"]; error: string | null }): Promise<void> {
  await db.query(
    `insert into live_faces (id, character_id, source_id, provider, provider_face_id, status, error) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (character_id, source_id, provider) do update set provider_face_id = excluded.provider_face_id, status = excluded.status, error = excluded.error, updated_at = now()`,
    [crypto.randomUUID(), p.character, p.source, p.provider, p.face, p.status, p.error],
  );
}
