/**
 * A character's presence in the theater (docs/PRDs/theater-immersion.md #1 and #2; David, 2026-10-29: "a short loop of
 * your character instead of the icon so it looks like they are talking and are real"): made once, for one viewer, from
 * the face that viewer keeps for them (lib/adult/steering.ts faceReferenceId), and reused all night.
 *
 *  - **Their portrait** (PORTRAIT_PROMPT): them from the collarbones up, dressed plainly, edited from that face: the base
 *    of the rest, and the still the theater shows. Checked like any picture.
 *  - **Expressions** (EXPRESSIONS): seven edits of the portrait, the same person in the same picture with another look on
 *    their face (SillyTavern's Character Expressions, done our way). The writer gives each line a `face`
 *    (lib/adult/scenes.ts), and the theater shows the speaker's. Each one is checked like any picture.
 *  - **A living portrait** (the loop): a few seconds of them, still and natural, that starts from the portrait itself, so
 *    the theater plays it over the portrait and fades back into it at the end without the seam showing. Checked like any
 *    video (Hive). Its model is the settings' `presence_loop_model`.
 *
 * Kept in adult_presence, never in adult_images, so no gallery, library or export lists it; served to its owner by
 * /api/admin/after-dark/presence/<id> (behind the privacy blur's /after-dark/ hook). Made only when asked (makePresence),
 * once per face: a new face kept makes the old one's presence stale, and the theater shows the plain face until it's
 * made again. Counted in the month's pictures and clips.
 */
import { loadCharacter } from "../character";
import type { Db } from "../db";
import { keepBytes, readBytes } from "../object-store";
import { checkAdultText } from "../safety";
import { checkMedia, mediaGate } from "./moderation";
import { outputCheckReady, signedMediaUrl, signedPresenceUrl } from "./media";
import { queueVideo, releaseVideo, retrieveVideo, urlEdit } from "./reels";
import { adultKeys, getAdultSettings } from "./settings";
import { faceReferenceId } from "./steering";
import { EXPRESSIONS, type Expression } from "./faces";
import { countUse, overCap } from "./usage";

export { EXPRESSIONS, FACES, isFace, type Expression, type Face } from "./faces";

/** An expression's edit: the same person, the same picture, only the look on their face changed. */
export function expressionPrompt(expression: Expression): string {
  return (
    `Make one photograph of the person in Picture 1: exactly the same person, face, hair, skin tone, body, clothes, framing, light and background. ` +
    `Change only their facial expression: ${EXPRESSIONS[expression]}. Photorealistic. An adult.`
  );
}

/**
 * Their portrait, from the face they keep: the base of everything else. A kept face is often a whole-body picture, where
 * a face on the stage's 132 px tile is a few pixels and no look on it reads (2026-10-29, live), and sometimes an
 * undressed one; this is them from the collarbones up, dressed plainly, for any scene.
 */
export const PORTRAIT_PROMPT =
  "Make one photograph of the person in Picture 1: exactly the same person, the same face, features, hair and skin tone. " +
  "A close head-and-shoulders portrait from the collarbones up, centred, looking at the camera with a relaxed, natural expression, " +
  "in a simple plain top, soft even light, a plain softly blurred background. Photorealistic. An adult.";

/** The living portrait's direction: them, still and natural, ending as it began, so it loops. */
export const LOOP_PROMPT =
  "The same person, still and natural, as if waiting to speak: they breathe, blink, glance at the camera and give a small natural smile. " +
  "The camera doesn't move. No talking, no big gestures, nobody else comes in. They end as they began.";
const LOOP_NEGATIVE = "child, teen, minor, young-looking, distorted face, morphing face, extra people, a second person, talking, scene cut, camera movement, text, watermark";
/** A loop not back by then is given up. */
const LOOP_GIVE_UP_MS = 20 * 60 * 1000;

/** One character's presence for the page: the face it's made from, their portrait, a picture per expression, and the loop. Ids only. */
export type Presence = { face_id: string; portrait: string | null; expressions: Partial<Record<Expression, string>>; loop: string | null; making: boolean; missing: number };

type Row = { id: string; character_id: string; face_id: string; part: "portrait" | "expression" | "loop"; expression: Expression | null; status: "making" | "ready" | "failed" };

/** Every part of a presence: the portrait, the seven expressions and the loop. */
const PARTS = Object.keys(EXPRESSIONS).length + 2;
/** Expressions drawn at once: seven in three rounds fit the function's time. */
const AT_ONCE = 3;
/** An expression still "making" after this was lost with its function: it counts as failed, and is asked for again. */
const EXPRESSION_LOST_MS = 10 * 60 * 1000;

/** Each part of a character's presence for this viewer and face; an expression lost mid-draw reads as failed. */
async function rowsFor(db: Db, viewer: string, characterId: string, face: string): Promise<Row[]> {
  const { rows } = await db.query<Row & { updated_at: Date | string }>(
    `select id, character_id, face_id, part, expression, status, updated_at from adult_presence where owner_id = $1 and character_id = $2 and face_id = $3`,
    [viewer, characterId, face],
  );
  return rows.map(({ updated_at, ...r }) =>
    r.part === "expression" && r.status === "making" && Date.now() - new Date(updated_at).getTime() > EXPRESSION_LOST_MS ? { ...r, status: "failed" } : r,
  );
}

/** The presence each of these characters has for this viewer, made from the face they keep now (stale ones left out). */
export async function presenceOf(db: Db, viewer: string, characterIds: readonly string[]): Promise<Record<string, Presence>> {
  const out: Record<string, Presence> = {};
  for (const id of characterIds) {
    const face = await faceReferenceId(db, viewer, id);
    if (!face) continue;
    const rows = await rowsFor(db, viewer, id, face);
    if (!rows.length) continue;
    const p: Presence = { face_id: face, portrait: null, expressions: {}, loop: null, making: false, missing: 0 };
    for (const r of rows) {
      if (r.status === "making") p.making = true;
      if (r.status !== "ready") continue;
      if (r.part === "portrait") p.portrait = r.id;
      else if (r.part === "loop") p.loop = r.id;
      else if (r.expression) p.expressions[r.expression] = r.id;
    }
    // What "✨ Bring them to life" would still make: the parts neither ready nor on their way.
    p.missing = PARTS - rows.filter((r) => r.status !== "failed").length;
    out[id] = p;
  }
  return out;
}

export type MakeResult = { ok: true; made: number; queued: boolean; failed: string[] } | Blocked;
type Blocked = { ok: false; status: number; error: string; message: string };

/** Why a character's presence can't be made for this viewer now, or null: asked before the work goes in the background. */
export async function presenceBlocked(db: Db, viewer: string, characterId: string): Promise<Blocked | null> {
  const fail = (status: number, error: string, message: string): Blocked => ({ ok: false, status, error, message });
  const c = await loadCharacter(db, characterId);
  if (!c) return fail(404, "not_found", "There's no such character.");
  if (!(await faceReferenceId(db, viewer, characterId))) return fail(409, "no_face", `${c.name} has no face yet: set one in the Studio first.`);
  if (!(await outputCheckReady(db))) return fail(409, "not_set_up", "Pictures need the output check set up in After Dark's settings.");
  const capped = await overCap(db, viewer, "pictures");
  if (capped) return fail(429, "capped", capped);
  return null;
}

/**
 * Makes what's missing of a character's presence for this viewer, from the face they keep: their portrait first (an
 * edit of the face, checked), then the loop queued from it (collected later by collectPresence) and each expression (an
 * edit of the portrait, checked). What's made already for this face is left as it is; a failed one is tried again. A new
 * portrait starts the rest over: what was made from anything else isn't theirs to match.
 */
export async function makePresence(db: Db, viewer: string, characterId: string, baseUrl: string): Promise<MakeResult> {
  const blocked = await presenceBlocked(db, viewer, characterId);
  if (blocked) return blocked;
  const face = (await faceReferenceId(db, viewer, characterId))!;
  const keys = await adultKeys(db);
  const settings = await getAdultSettings(db);
  let have = await rowsFor(db, viewer, characterId, face);
  const done = (part: Row["part"], expression: Expression | null) => have.some((r) => r.part === part && r.expression === expression && r.status !== "failed");
  const failed: string[] = [];
  const edit = urlEdit(db);
  let made = 0;
  // The portrait, the base of the rest.
  let portrait = have.find((r) => r.part === "portrait" && r.status === "ready")?.id ?? null;
  if (!portrait) {
    const gate = await mediaGate(db, { owner: viewer });
    if (!gate.ok) return { ok: false, status: 503, error: "paused", message: gate.message };
    try {
      const { bytes, mime, model } = await edit(PORTRAIT_PROMPT, signedMediaUrl(face, baseUrl));
      const verdict = await checkMedia(db, { base64: bytes.toString("base64"), mime }, "image", { owner: viewer });
      if (!verdict.ok) {
        await rejected(db, viewer, `presence portrait: ${verdict.reason}`);
        return { ok: true, made: 0, queued: false, failed: [`their portrait: ${verdict.reason}`] };
      }
      await db.query(`delete from adult_presence where owner_id = $1 and character_id = $2 and face_id = $3`, [viewer, characterId, face]);
      portrait = await upsert(db, { owner: viewer, character: characterId, face, part: "portrait", expression: null, status: "ready", model, file: { bytes, mime } });
      await countUse(db, viewer, "pictures");
      made++;
      have = [];
    } catch (err) {
      return { ok: true, made: 0, queued: false, failed: [`their portrait: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`] };
    }
  }
  const base = signedPresenceUrl(portrait, baseUrl);
  // Then the loop: Venice takes minutes over it, so it's queued (its first frame the portrait itself) while the
  // expressions are drawn, and collected by collectPresence.
  let queued = false;
  if (!done("loop", null) && keys.venice) {
    const capped = await overCap(db, viewer, "clips");
    if (capped) failed.push(capped);
    else {
      try {
        const model = settings.presence_loop_model;
        const queueId = await queueVideo(keys.venice, { model, seconds: 5, image_url: base, prompt: LOOP_PROMPT, negative: LOOP_NEGATIVE });
        await upsert(db, { owner: viewer, character: characterId, face, part: "loop", expression: null, status: "making", model, queue: queueId });
        queued = true;
      } catch (err) {
        failed.push(`the living portrait: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
      }
    }
  }
  // The expressions, a few at a time so seven fit in the function's time; each marked making first, so the theater
  // knows to wait for them.
  const todo = (Object.keys(EXPRESSIONS) as Expression[]).filter((e) => !done("expression", e) && checkAdultText({ prompt: expressionPrompt(e) }).ok);
  for (const expression of todo) await upsert(db, { owner: viewer, character: characterId, face, part: "expression", expression, status: "making" });
  const one = async (expression: Expression): Promise<void> => {
    const set = (status: Row["status"], more: { model?: string; error?: string; file?: { bytes: Buffer; mime: string } } = {}) =>
      upsert(db, { owner: viewer, character: characterId, face, part: "expression", expression, status, ...more });
    try {
      const { bytes, mime, model } = await edit(expressionPrompt(expression), base);
      const verdict = await checkMedia(db, { base64: bytes.toString("base64"), mime }, "image", { owner: viewer });
      if (!verdict.ok) {
        await rejected(db, viewer, `presence ${expression}: ${verdict.reason}`);
        await set("failed", { error: verdict.reason });
        failed.push(`${expression}: ${verdict.reason}`);
        return;
      }
      await set("ready", { model, file: { bytes, mime } });
      await countUse(db, viewer, "pictures");
      made++;
    } catch (err) {
      const why = err instanceof Error ? err.message.slice(0, 200) : "error";
      await set("failed", { error: why });
      failed.push(`${expression}: ${why}`);
    }
  };
  for (let i = 0; i < todo.length; i += AT_ONCE) {
    const batch = todo.slice(i, i + AT_ONCE);
    const stop = (await overCap(db, viewer, "pictures")) ?? (await mediaGate(db, { owner: viewer }).then((g) => (g.ok ? null : g.message)));
    if (stop) {
      // What wasn't drawn goes back to being asked for.
      for (const expression of todo.slice(i)) await upsert(db, { owner: viewer, character: characterId, face, part: "expression", expression, status: "failed", error: stop });
      failed.push(stop);
      break;
    }
    await Promise.all(batch.map(one));
  }
  return { ok: true, made, queued, failed };
}

/**
 * The loops this viewer has being made, collected (the page asks as it polls): a finished one is checked by Hive and
 * kept, or discarded and logged; one not back in LOOP_GIVE_UP_MS is given up. While Hive is out for the day they wait.
 */
export async function collectPresence(db: Db, viewer: string): Promise<number> {
  const { rows } = await db.query<{ id: string; model: string; queue_id: string; created_at: Date | string }>(
    `select id, model, queue_id, created_at from adult_presence where owner_id = $1 and part = 'loop' and status = 'making' order by created_at limit 3`,
    [viewer],
  );
  if (!rows.length) return 0;
  const keys = await adultKeys(db);
  if (!keys.venice) return 0;
  let kept = 0;
  for (const r of rows) {
    if (Date.now() - new Date(r.created_at).getTime() > LOOP_GIVE_UP_MS) {
      await db.query(`update adult_presence set status = 'failed', error = 'gave up waiting', updated_at = now() where id = $1 and status = 'making'`, [r.id]);
      continue;
    }
    const got = await retrieveVideo(keys.venice, r.model, r.queue_id);
    if (got.state === "making") continue;
    if (got.state === "failed") {
      await db.query(`update adult_presence set status = 'failed', error = $2, updated_at = now() where id = $1 and status = 'making'`, [r.id, got.reason.slice(0, 200)]);
      continue;
    }
    const verdict = await checkMedia(db, { base64: got.bytes.toString("base64"), mime: "video/mp4" }, "video", { owner: viewer });
    // The check couldn't run (Hive busy): asked again on the next poll, and nothing more goes to Hive this one.
    if (!verdict.ok && verdict.reason.startsWith("the check couldn't run")) break;
    if (!verdict.ok) {
      await rejected(db, viewer, `presence loop: ${verdict.reason}`);
      await db.query(`update adult_presence set status = 'failed', error = $2, updated_at = now() where id = $1 and status = 'making'`, [r.id, verdict.reason.slice(0, 200)]);
      await releaseVideo(keys.venice, r.model, r.queue_id);
      continue;
    }
    const file = await keepBytes("after-dark", r.id, got.bytes, "video/mp4");
    const claimed = await db.query(
      `update adult_presence set status = 'ready', mime = 'video/mp4', data = $2, object_key = $3, error = null, updated_at = now() where id = $1 and status = 'making' returning id`,
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

/** One presence file of this viewer's, ready: its stored copy (bytes or its object key) and type. */
export async function presenceFile(db: Db, viewer: string, id: string): Promise<{ mime: string; object_key: string | null; data: Buffer | null } | null> {
  const r = (
    await db.query<{ mime: string | null; object_key: string | null; data: Buffer | null }>(`select mime, object_key, data from adult_presence where id = $1 and owner_id = $2 and status = 'ready'`, [id, viewer])
  ).rows[0];
  return r?.mime ? { mime: r.mime, object_key: r.object_key, data: r.data } : null;
}
export const presenceBytes = (f: { object_key: string | null; data: Buffer | null }) => readBytes(f);

/** A presence picture by id alone, for a provider holding its signed link (signedPresenceUrl): never a video. */
export async function presenceFileForLink(db: Db, id: string): Promise<{ mime: string; object_key: string | null; data: Buffer | null } | null> {
  const r = (
    await db.query<{ mime: string | null; object_key: string | null; data: Buffer | null }>(`select mime, object_key, data from adult_presence where id = $1 and status = 'ready' and part <> 'loop'`, [id])
  ).rows[0];
  return r?.mime?.startsWith("image/") ? { mime: r.mime, object_key: r.object_key, data: r.data } : null;
}

async function upsert(
  db: Db,
  p: { owner: string; character: string; face: string; part: Row["part"]; expression: Expression | null; status: Row["status"]; model?: string; queue?: string; error?: string; file?: { bytes: Buffer; mime: string } },
): Promise<string> {
  const id = crypto.randomUUID();
  const kept = p.file ? await keepBytes("after-dark", id, p.file.bytes, p.file.mime) : { data: null, object_key: null };
  await db.query(
    `insert into adult_presence (id, owner_id, character_id, face_id, part, expression, status, model, queue_id, mime, data, object_key, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (owner_id, character_id, face_id, part, coalesce(expression, '')) do update
       set id = excluded.id, status = excluded.status, model = excluded.model, queue_id = excluded.queue_id, mime = excluded.mime,
           data = excluded.data, object_key = excluded.object_key, error = excluded.error, updated_at = now()`,
    [id, p.owner, p.character, p.face, p.part, p.expression, p.status, p.model ?? null, p.queue ?? null, p.file?.mime ?? null, kept.data, kept.object_key, p.error?.slice(0, 200) ?? null],
  );
  return id;
}

async function rejected(db: Db, owner: string, reason: string): Promise<void> {
  await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'baseline', $3)`, [crypto.randomUUID(), owner, reason.slice(0, 300)]).catch(() => {});
}
