/**
 * Ditto's clip library per character (docs/PRDs/digital-human.md, "The road from here", 1): what a call shows between
 * and around replies, rendered once from the kit's portrait by the Ditto worker and kept, so the idle, the reactions
 * and the talking all come from one renderer and every join is still-to-still:
 *
 *  - `idle`: eight seconds of silence with a slow sway of the head (Ditto's own blinks and small motion on top),
 *    fading in from and out to the portrait, so the browser can loop it in place of the kit's Wan loop;
 *  - `nod`, `tilt`: short reactions (a nod when the person's sentence lands; a tilt while the reply is thought
 *    about), each from the portrait back to the portrait, played over the idle on the browser's cue.
 *
 * A clip is asked for the first time a call starts with Ditto for that character (ensureDittoLibrary, in the
 * background: the call doesn't wait, the next one has them), about a cent for the three. Rows in live_face_clips,
 * bytes in the object store (or the row, without one), served by /api/live-face/clip/<id>.
 */
import { randomUUID } from "node:crypto";
import { LIVE_AUDIO_RATE } from "../companion-live-shared";
import type { Db } from "../db";
import { faceKitOf, faceSource } from "../face-kit";
import { type ReactionKind } from "../live-face-shared";
import { keepBytes, readBytes } from "../object-store";
import { dittoConfig, speakDitto } from "./ditto";

type Env = Record<string, string | undefined>;

export type LibraryKind = "idle" | ReactionKind;
export const LIBRARY_KINDS: readonly LibraryKind[] = ["idle", "nod", "tilt"];

/** Each clip: its length of silence, the pose motion on top, and the frames easing in from and out to the still. */
export const LIBRARY_SPEC: Record<LibraryKind, { seconds: number; motion: { kind: "sway" | "nod" | "tilt"; amount: number; period_s?: number; at_s?: number }; fade_in: number; fade_out: number }> = {
  idle: { seconds: 8, motion: { kind: "sway", amount: 1, period_s: 4.2 }, fade_in: 10, fade_out: 10 },
  nod: { seconds: 1.4, motion: { kind: "nod", amount: 1.4, at_s: 0.25 }, fade_in: 4, fade_out: 8 },
  tilt: { seconds: 1.8, motion: { kind: "tilt", amount: 1.3 }, fade_in: 6, fade_out: 8 },
};

/** A clip still "making" after this long is asked for again; a failed one after this long too. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

export type LibraryRow = { id: string; character_id: string; source_id: string; kind: LibraryKind; status: "making" | "ready" | "failed"; mime: string | null; object_key: string | null; data: Buffer | null; frames: number | null; error: string | null; created_at: string; updated_at: string };

export const libraryClipUrl = (id: string): string => `/api/live-face/clip/${encodeURIComponent(id)}`;

export type DittoLibrary = { idle: string | null; reactions: Partial<Record<ReactionKind, string>>; complete: boolean };

const COLS = `id, character_id, source_id, kind, status, mime, object_key, data, frames, error, created_at::text, updated_at::text`;

/** The character's ready clips for the kit they have now, as URLs the browser plays; `complete` when all three are there. */
export async function dittoLibrary(db: Db, characterId: string, baseUrl: string): Promise<DittoLibrary> {
  const none: DittoLibrary = { idle: null, reactions: {}, complete: false };
  const source = await faceSource(db, characterId, baseUrl);
  if (!source) return none;
  const { rows } = await db.query<Pick<LibraryRow, "id" | "kind" | "status">>(`select id, kind, status from live_face_clips where character_id = $1 and source_id = $2`, [characterId, source.id]);
  const out: DittoLibrary = { idle: null, reactions: {}, complete: false };
  for (const r of rows) {
    if (r.status !== "ready") continue;
    if (r.kind === "idle") out.idle = libraryClipUrl(r.id);
    else out.reactions[r.kind] = libraryClipUrl(r.id);
  }
  out.complete = Boolean(out.idle && out.reactions.nod && out.reactions.tilt);
  return out;
}

/** The bytes and type of one clip, when it's ready. */
export async function libraryClipFile(db: Db, id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const row = (await db.query<LibraryRow>(`select ${COLS} from live_face_clips where id = $1 and status = 'ready'`, [id])).rows[0];
  if (!row) return null;
  const bytes = await readBytes(row);
  return bytes ? { bytes, mime: row.mime ?? "video/mp4" } : null;
}

/** Silence as our voice comes: 16-bit mono PCM at the call's rate. */
export const silence = (seconds: number): Buffer => Buffer.alloc(Math.round(seconds * LIVE_AUDIO_RATE) * 2);

const making = new Set<string>();

/**
 * Renders whichever of the three clips the character lacks for their kit's portrait (missing, or failed or lost a
 * while ago), one after another on the Ditto endpoint, and keeps them. Safe to call on every Ditto call start: it does
 * nothing when all three are there, and a render in flight in this process isn't started twice. Returns how many it made.
 */
export async function ensureDittoLibrary(db: Db, characterId: string, baseUrl: string, env: Env = process.env): Promise<number> {
  const cfg = dittoConfig(env);
  if (!cfg) return 0;
  const source = await faceSource(db, characterId, baseUrl);
  if (!source) return 0;
  const kit = await faceKitOf(db, characterId, baseUrl);
  if (!kit?.stills.portrait) return 0;
  const sourceUrl = new URL(kit.stills.portrait, baseUrl).toString();
  const { rows } = await db.query<Pick<LibraryRow, "id" | "kind" | "status" | "updated_at">>(`select id, kind, status, updated_at::text from live_face_clips where character_id = $1 and source_id = $2`, [characterId, source.id]);
  let made = 0;
  for (const kind of LIBRARY_KINDS) {
    const have = rows.find((r) => r.kind === kind);
    const stale = have && have.status !== "ready" && Date.now() - new Date(have.updated_at).getTime() > RETRY_AFTER_MS;
    if (have && (have.status === "ready" || !stale)) continue;
    const lock = `${characterId}:${source.id}:${kind}`;
    if (making.has(lock)) continue;
    making.add(lock);
    const id = have?.id ?? randomUUID();
    try {
      await db.query(
        `insert into live_face_clips (id, character_id, source_id, kind, status) values ($1, $2, $3, $4, 'making')
         on conflict (character_id, source_id, kind) do update set status = 'making', error = null, updated_at = now()`,
        [id, characterId, source.id, kind],
      );
      const spec = LIBRARY_SPEC[kind];
      const out = await speakDitto(cfg, { source_url: sourceUrl, pcm: silence(spec.seconds), rate: LIVE_AUDIO_RATE, fade_in: spec.fade_in, fade_out: spec.fade_out, motion: spec.motion, emo: 4 }, { timeoutMs: 60_000 });
      const mp4 = Buffer.from(out.video_b64, "base64");
      const stored = await keepBytes("companion", `live-face-clip-${id}`, mp4, "video/mp4");
      await db.query(`update live_face_clips set status = 'ready', mime = 'video/mp4', object_key = $2, data = $3, frames = $4, error = null, updated_at = now() where id = $1`, [id, stored.object_key, stored.data, out.frames]);
      made++;
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 200) : "error";
      console.error(`[live-face] ${characterId}'s ${kind} clip: ${why}`);
      await db.query(`update live_face_clips set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, why]).catch(() => {});
    } finally {
      making.delete(lock);
    }
  }
  return made;
}

/** Forgets a character's clips (a new portrait, or taking the character down). */
export async function dropDittoLibrary(db: Db, characterId: string): Promise<number> {
  const { rows } = await db.query(`delete from live_face_clips where character_id = $1 returning id`, [characterId]);
  return rows.length;
}
