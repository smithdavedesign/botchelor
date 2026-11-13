/**
 * A character's live face (docs/PRDs/digital-human.md, Tier 1): a face built once at a renderer from the character's
 * face-kit portrait, and a session minted for a call when the person may have one. The first renderer is Simli
 * (./simli.ts); this is the one place that knows which, so another can take its place behind the same calls.
 *
 *  - **On:** `LIVE_FACE_PROVIDER=simli` (everyone) or `simli:admins` (admins only, the rollout), and `SIMLI_API_KEY`.
 *    Unset, nothing here does anything and a call is exactly Tier 0 (lib/face-kit.ts).
 *  - **A face** lives in live_faces: one per character per kit portrait (`source_id`, the kit's) per provider. It's
 *    built by an admin (/api/admin/live-face: each face is one of the plan's few a month, so never on a call), from the
 *    kit's portrait (plain top, mouth closed, facing the camera: what the renderer asks for). It takes hours; the kit
 *    route's poll collects it (collectLiveFaces). A new kit portrait means a new face; the old plays until then.
 *  - **A session** is minted at a call's start (and again on a reconnect) when the face is ready and it's on for this
 *    person: the browser gets the token, opens the stream itself, and sends our voice (lib/live-face-shared.ts).
 *    Nothing is charged by the renderer until the browser connects; what it used is reported at the call's end
 *    (companion_live_calls.face_seconds) for the spend view.
 *  - **Fallback:** anything failing here (no key, no face, Simli down, the browser refused) leaves the call on Tier 0.
 */
import type { Db } from "../db";
import { faceKitBytes, faceKitFile, faceKitOf, faceSource } from "../face-kit";
import { type LiveFaceProvider, type LiveFaceSession } from "../live-face-shared";
import { createSimliFace, deleteSimliFace, listSimliFaces, mintSimliSession, outOfFaces, simliFaceStatus, SIMLI_STREAM_PX, SimliError } from "./simli";

export type { LiveFaceProvider, LiveFaceSession } from "../live-face-shared";

type Env = Record<string, string | undefined>;
export type LiveFaceMode = "off" | "admins" | "on";

export const simliKey = (env: Env = process.env): string | null => env.SIMLI_API_KEY?.trim() || null;

/** Whether live faces are on, and for whom: the provider setting, and its key. */
export function liveFaceMode(env: Env = process.env): LiveFaceMode {
  const v = (env.LIVE_FACE_PROVIDER ?? "").trim().toLowerCase();
  if (!v || v === "off" || v === "0") return "off";
  const [provider, who] = v.split(":");
  if (provider !== "simli" || !simliKey(env)) return "off";
  return who === "admins" ? "admins" : "on";
}
export function liveFaceOn(env: Env, who: { admin: boolean }): boolean {
  const mode = liveFaceMode(env);
  return mode === "on" || (mode === "admins" && who.admin);
}

/** A face still "making" after this long with no word from the renderer is given up (Simli says about four hours). */
const FACE_GIVE_UP_MS = 12 * 60 * 60 * 1000;
/** A face's status isn't asked for more than once a minute. */
const POLL_EVERY_MS = 60 * 1000;

export type LiveFaceRow = { id: string; character_id: string; source_id: string; provider: LiveFaceProvider; provider_face_id: string | null; status: "making" | "ready" | "failed"; error: string | null; created_at: string; updated_at: string };

async function rowFor(db: Db, characterId: string, sourceId: string, provider: LiveFaceProvider = "simli"): Promise<LiveFaceRow | null> {
  const { rows } = await db.query<LiveFaceRow>(
    `select id, character_id, source_id, provider, provider_face_id, status, error, created_at::text, updated_at::text from live_faces where character_id = $1 and source_id = $2 and provider = $3`,
    [characterId, sourceId, provider],
  );
  return rows[0] ?? null;
}

/** The character's live face for the kit portrait they have now: its state, or null when none was ever asked for. */
export async function liveFaceState(db: Db, characterId: string, baseUrl: string): Promise<LiveFaceRow | null> {
  const source = await faceSource(db, characterId, baseUrl);
  return source ? rowFor(db, characterId, source.id) : null;
}

export type LiveFaceBlocked = { ok: false; status: number; error: string; message: string };

/**
 * Builds the character's face at the renderer from their kit's portrait: refused without the key, a kit portrait, or a
 * monthly generation left; one that's building or ready isn't built again. Returns at once with the renderer's id; the
 * build itself takes hours (collectLiveFaces follows it).
 */
export async function buildLiveFace(db: Db, characterId: string, baseUrl: string, env: Env = process.env): Promise<{ ok: true; face_id: string; status: LiveFaceRow["status"] } | LiveFaceBlocked> {
  const fail = (status: number, error: string, message: string): LiveFaceBlocked => ({ ok: false, status, error, message });
  const key = simliKey(env);
  if (!key) return fail(409, "not_set_up", "Live faces need SIMLI_API_KEY on the server.");
  const source = await faceSource(db, characterId, baseUrl);
  if (!source) return fail(409, "no_portrait", "They have no approved safe portrait, so no face kit and no live face.");
  const kit = await faceKitOf(db, characterId, baseUrl);
  const portraitId = kit?.stills.portrait?.split("/").pop();
  if (!portraitId) return fail(409, "no_kit", "Draw their face kit first: the live face is built from its portrait.");
  const have = await rowFor(db, characterId, source.id);
  if (have && have.status !== "failed" && have.provider_face_id) return { ok: true, face_id: have.provider_face_id, status: have.status };
  const file = await faceKitFile(db, portraitId);
  const bytes = file ? await faceKitBytes(file) : null;
  if (!file || !bytes) return fail(409, "no_kit", "The kit's portrait couldn't be read.");
  const name = (await db.query<{ name: string }>(`select name from characters where id = $1`, [characterId])).rows[0]?.name ?? characterId;
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
 * forgotten after a long while → failed. At most three, each asked about once a minute. `characterId` narrows it.
 */
export async function collectLiveFaces(db: Db, env: Env = process.env, characterId?: string): Promise<number> {
  const key = simliKey(env);
  if (!key) return 0;
  const { rows } = await db.query<LiveFaceRow>(
    `select id, character_id, source_id, provider, provider_face_id, status, error, created_at::text, updated_at::text from live_faces
      where status = 'making' and provider_face_id is not null and updated_at < now() - make_interval(secs => $2) and ($1::text is null or character_id = $1)
      order by created_at limit 3`,
    [characterId ?? null, POLL_EVERY_MS / 1000],
  );
  let ready = 0;
  for (const r of rows) {
    const set = (status: LiveFaceRow["status"], error: string | null = null) => db.query(`update live_faces set status = $2, error = $3, updated_at = now() where id = $1 and status = 'making'`, [r.id, status, error?.slice(0, 200) ?? null]);
    try {
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
        else await db.query(`update live_faces set updated_at = now() where id = $1`, [r.id]);
      } else await db.query(`update live_faces set updated_at = now() where id = $1`, [r.id]);
    } catch (err) {
      console.error(`[live-face] ${r.character_id}: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
      await db.query(`update live_faces set updated_at = now() where id = $1`, [r.id]);
    }
  }
  return ready;
}

/**
 * A session for a call with this character, when live faces are on for this person and the face is ready: the token
 * the browser opens the stream with. Null for any other reason, quietly: the call goes on as Tier 0.
 */
export async function liveFaceSession(db: Db, characterId: string, baseUrl: string, who: { admin: boolean }, opts: { maxSeconds?: number; idleSeconds?: number; env?: Env } = {}): Promise<LiveFaceSession | null> {
  const env = opts.env ?? process.env;
  if (!liveFaceOn(env, who)) return null;
  const key = simliKey(env)!;
  const face = await liveFaceState(db, characterId, baseUrl);
  if (!face || face.status !== "ready" || !face.provider_face_id) return null;
  try {
    const s = await mintSimliSession(key, face.provider_face_id, { maxSeconds: opts.maxSeconds, idleSeconds: opts.idleSeconds, background: env.SIMLI_BACKGROUND_ID?.trim() || null });
    return { provider: "simli", token: s.token, px: SIMLI_STREAM_PX };
  } catch (err) {
    console.error(`[live-face] session for ${characterId}: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
    return null;
  }
}

/** Forgets a character's live face here and at the renderer (a new portrait, or taking it down). */
export async function dropLiveFace(db: Db, characterId: string, env: Env = process.env): Promise<number> {
  const key = simliKey(env);
  const { rows } = await db.query<{ id: string; provider_face_id: string | null }>(`select id, provider_face_id from live_faces where character_id = $1`, [characterId]);
  for (const r of rows) {
    if (key && r.provider_face_id) await deleteSimliFace(key, r.provider_face_id).catch(() => {});
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
