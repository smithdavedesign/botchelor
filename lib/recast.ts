/**
 * The recast (David, 2026-11-02: "clean up the agent-made characters, make sure they're all very unique, have a soul and
 * extra personality, have a base image and body … fun roleplay, e.g. Pirate, President, Alien … then have them all go on
 * dates"). The show's own agent-made characters (our sims', loops' and checks' agents, never an outside visitor's, and
 * never one taken off the show) are rewritten, drawn and dated through the app's own paths, as their owner:
 *
 *  - **The sheet:** the ordinary owner edit (PATCH /api/characters/[id]), so the PG sheet check, the name rule, the soul's
 *    check and the Go deeper secrets all hold exactly as for any owner.
 *  - **The portrait:** drawn from their written look in Venice's safe mode and passed by the show's PG picture check
 *    (checkMedia "pg_image": Hive or the alternatives, as `pg_via` says), like a season newcomer's (lib/season-gen.ts),
 *    and rated clothed by the show portraits' rating check, then kept in the asset ledger as the show's own drawing. Their
 *    newest approved portrait is their face.
 *  - **The body:** the PG Studio's full-body identity view from that face (lib/studio/pg.ts showIdentityViews).
 *  - **Dates:** the deck's own ranking (lib/dating.ts findMatches) picks who suits whom; a like is the ordinary swipe
 *    (lib/swipes.ts), an answer the ordinary answer_match, and the booking /api/admin/book-date.
 */
import { recordAsset, reviewAsset } from "./assets";
import { checkMedia, checkRating, mediaGate, showsRole } from "./adult/moderation";
import { NEGATIVE_PROMPT, venicePicture } from "./adult/media";
import { loadCharacter } from "./character";
import type { Db } from "./db";
import { lookFor } from "./agent-portraits";
import { isAnime } from "./looks";
import { DELETED_OWNER } from "./rules";
import { checkPgPictureText } from "./safety";
import { portraitPrompt } from "./season-gen";
import { showIdentityViews } from "./studio/pg";

export const RECAST_PORTRAIT_VERSION = "recast-portrait-v1";
/** How long a written look (characters.look: pictures only, never shown) may be. */
export const RECAST_LOOK_MAX = 300;

/**
 * The owner of a character the recast may act on: agent-made, not the house's, still on the show. Null otherwise (a
 * person's character, a house one, or one kept only for its old dates).
 */
export async function recastOwner(db: Db, characterId: string): Promise<string | null> {
  const r = await db.query<{ owner_id: string | null }>(
    `select owner_id from characters where id = $1 and created_via = 'mcp' and not is_house and owner_id is not null and owner_id <> $2`,
    [characterId, DELETED_OWNER],
  );
  return r.rows[0]?.owner_id ?? null;
}

/**
 * Who the picture must show them as (David, 2026-11-02: "a teacher reads as a teacher, a president as a president"):
 * `role` names it ("a ghost-ship captain"), `props` what they wear and hold that says so, `scene` where they are.
 */
export type RecastRole = { role: string; props?: string | null; scene?: string | null; kind?: string | null };
export const ROLE_MAX = 80;
/** `kind`: the short type the check asks about ("a pirate captain"), so it judges the profession, not every adjective. */
export const KIND_MAX = 120;
/**
 * Recast portraits are drawn on a model that follows the props and setting (2026-11-02 A/B: the settings' lustify-v8 drew
 * a face and dropped the props; qwen-image-2-1-turbo drew the jukebox, the lamp, the desert arch), $0.02 a picture.
 */
export const RECAST_PORTRAIT_MODEL = "qwen-image-2-1-turbo";
export const PROPS_MAX = 200;
export const SCENE_MAX = 160;

const tidy = (s: string | null | undefined): string => (s ?? "").trim().replace(/[.\s]+$/, "");

/**
 * An anime portrait's negative prompt: every word of the usual steer away from anyone young-looking (lib/adult/media.ts
 * NEGATIVE_PROMPT, which venicePicture sends by default) but its "cartoon, anime, illustration", which would pull an anime
 * portrait back to a photograph; then the childlike looks anime drifts to, and a photograph.
 */
export const ANIME_NEGATIVE_PROMPT = [
  ...NEGATIVE_PROMPT.split(",")
    .map((w) => w.trim())
    .filter((w) => w && !/^(cartoon|anime|illustration)$/i.test(w)),
  "childlike face",
  "childlike body",
  "chibi",
  "photograph",
  "photorealistic",
].join(", ");

/**
 * The portrait's prompt: their look, then what makes them recognisably them, pushed harder on the second try. `anime`
 * (their looks' style, lib/looks.ts) draws the same in clean modern anime (David, 2026-11-08: "add the most popular type
 * of anime characters"), said twice over to be a grown adult: anime reads young, and the PG checks refuse anyone who
 * might be under 18 (checkMedia's minor check, the rating's ADULTS question), so the prompt asks for an adult's face and
 * proportions outright.
 */
export function recastPortraitPrompt(look: string, age: number, r: RecastRole | null, push = false, anime = false): string {
  const props = tidy(r?.props);
  const scene = tidy(r?.scene);
  if (anime) {
    const role = r?.role ? tidy(r.role) : "";
    return [
      `Clean modern anime illustration, a chest-up character portrait of ${tidy(look)}.`,
      role ? `They are ${role}${props ? `, with ${props}` : ""}.` : "",
      scene ? `Behind them, ${scene}.` : "A soft painted background.",
      push && role ? `It must be unmistakable at a glance that they are ${role}: ${props ? `${props} prominent, in focus and in frame, ` : ""}${scene ? "the setting clearly visible behind them" : "the costume clearly visible"}.` : "",
      `Cel shading, clean linework, rich colour. Clearly a grown adult of ${Math.max(21, age)} with mature adult proportions and an adult face. Looking at the viewer, fully clothed, tasteful.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (!r?.role) return portraitPrompt(look, age);
  return [
    `Warm, natural editorial portrait photograph from the chest up of ${tidy(look)}.`,
    `They are ${tidy(r.role)}${props ? `, with ${props}` : ""}.`,
    scene ? `Behind them, ${scene}.` : "",
    push ? `It must be unmistakable at a glance that they are ${tidy(r.role)}: ${props ? `${props} prominent, in focus and in frame, ` : ""}${scene ? "the setting clearly visible behind them" : "the costume clearly visible"}.` : "",
    `Clearly ${age} years old, an adult. Looking at the camera, photorealistic, fully clothed.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The full-body outfit: what they wear and hold, pushed harder on the second try. */
export function recastOutfit(outfit: string | null | undefined, r: RecastRole | null, push = false): string | null {
  const worn = tidy(outfit);
  if (!r?.role) return worn || null;
  const props = tidy(r.props);
  const base = [worn, props ? `with ${props}` : ""].filter(Boolean).join(", ");
  return push ? `${base || "their costume"}, so they are unmistakably ${tidy(r.role)} at a glance, every prop clearly visible` : base || null;
}

/** The role's words, held to the show's PG picture words; a refusal names the field. */
export function roleWordsRefusal(r: RecastRole | null): string | null {
  if (!r) return null;
  const v = checkPgPictureText({ role: r.role, props: r.props ?? undefined, scene: r.scene ?? undefined, kind: r.kind ?? undefined });
  return v.ok ? null : `the ${v.field}'s words don't pass the show's PG picture words`;
}

export type RecastPortrait =
  | { ok: true; character_id: string; asset_id: string; via: string[]; prompt: string; role_ok: boolean | null; tries: number }
  | { ok: false; character_id: string; reason: string; again: boolean };

type Drawn = { ok: true; pic: { bytes: Buffer; mime: string }; prompt: string; via: string[]; role_ok: boolean | null } | { ok: false; reason: string; again: boolean };

/**
 * One try: drawn in safe mode, through the show's PG check and the clothed rating, then asked if it reads as them. An
 * anime one is steered by ANIME_NEGATIVE_PROMPT instead of the default.
 */
async function drawOnce(db: Db, prompt: string, r: RecastRole | null, anime = false): Promise<Drawn> {
  if (!checkPgPictureText({ prompt }).ok) return { ok: false, reason: "their words don't pass the show's PG word check", again: false };
  const gate = await mediaGate(db, { pg: true });
  if (!gate.ok) return { ok: false, reason: gate.reason, again: true };
  let pic: { bytes: Buffer; mime: string };
  try {
    pic = await venicePicture(db, prompt, { safe: true, model: RECAST_PORTRAIT_MODEL, ...(anime ? { negative: ANIME_NEGATIVE_PROMPT } : {}) });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message.slice(0, 160) : "error", again: true };
  }
  const media = { base64: pic.bytes.toString("base64"), mime: pic.mime };
  const verdict = await checkMedia(db, media, "pg_image");
  if (!verdict.ok) return { ok: false, reason: `the PG check: ${verdict.reason}`.slice(0, 200), again: false };
  // A face on every public page: clothed, not just "not nude" (the show portraits' own rating check, lib/agent-portraits.ts).
  const rated = await checkRating(db, media);
  if (!rated.ok) return { ok: false, reason: rated.reason, again: !rated.checked };
  if (rated.rating !== "pg") return { ok: false, reason: "the PG check rated it suggestive", again: false };
  const role_ok = r?.role ? await showsRole(db, media, r.role, r.kind) : null;
  return { ok: true, pic, prompt, via: verdict.via ?? [], role_ok };
}

/**
 * A recast character's portrait: their look (saved first when given, PG words only) and who they are (`role`: its props
 * and setting), drawn in safe mode, checked by the show's PG picture check and the clothed rating, kept and approved.
 * When the vision check says it doesn't read as their role, it's drawn once more with the props pushed harder, and the
 * second is kept either way (`role_ok` false flags it for review); never a third. Never throws; `again` says a retry later
 * may work (a busy provider, the check paused) rather than the picture having been refused.
 */
export async function drawRecastPortrait(db: Db, characterId: string, look?: string | null, role?: RecastRole | null): Promise<RecastPortrait> {
  const no = (reason: string, again = false): RecastPortrait => ({ ok: false, character_id: characterId, reason, again });
  const written = look?.trim();
  if (written) {
    if (written.length > RECAST_LOOK_MAX) return no(`the look is over ${RECAST_LOOK_MAX} characters`);
    if (!checkPgPictureText({ look: written }).ok) return no("the look's words don't pass the show's PG word check");
  }
  const roleRefusal = roleWordsRefusal(role ?? null);
  if (roleRefusal) return no(roleRefusal);
  if (written) await db.query(`update characters set look = $2 where id = $1`, [characterId, written]);
  const c = await loadCharacter(db, characterId);
  if (!c) return no("no such character");
  const who = lookFor(c);
  if (!who) return no("nothing written about them to draw from");
  const r = role?.role ? role : null;
  const anime = isAnime(c);
  let tries = 1;
  let drawn = await drawOnce(db, recastPortraitPrompt(who, c.age, r, false, anime), r, anime);
  if (drawn.ok && drawn.role_ok === false) {
    tries = 2;
    const again = await drawOnce(db, recastPortraitPrompt(who, c.age, r, true, anime), r, anime);
    // The pushed try is kept when it passed the PG checks; otherwise the first (safe, just not clearly them) stays.
    if (again.ok) drawn = again;
  }
  if (!drawn.ok) return no(drawn.reason, drawn.again);
  const { pic, prompt } = drawn;
  const assetId = await recordAsset(db, {
    character_id: characterId,
    kind: "portrait",
    source_type: "generated",
    source_model: "venice",
    prompt,
    prompt_version: RECAST_PORTRAIT_VERSION,
    url: `data:${pic.mime};base64,${pic.bytes.toString("base64")}`,
    content_rating: "pg",
  });
  await reviewAsset(db, assetId, "approved", "the show's own portrait for the recast: drawn from their look in safe mode, PG-checked");
  return { ok: true, character_id: characterId, asset_id: assetId, via: drawn.via, prompt, role_ok: drawn.role_ok, tries };
}

export type RecastBody = { ok: true; made: number; role_ok: boolean | null; tries: number } | { ok: false; status: number; error: string; message: string };

/**
 * Their full-body reference (lib/studio/pg.ts showIdentityViews) in their costume and props. With a role, a view that the
 * vision check says doesn't read as it isn't kept; one more is drawn with the props pushed harder and kept either way
 * (`role_ok` false flags it for review).
 */
export async function drawRecastBody(db: Db, characterId: string, baseUrl: string, outfit?: string | null, role?: RecastRole | null): Promise<RecastBody> {
  const roleRefusal = roleWordsRefusal(role ?? null);
  if (roleRefusal) return { ok: false, status: 422, error: "content_rejected", message: roleRefusal };
  const r = role?.role ? role : null;
  let verdict: boolean | null = null;
  const accept = r ? async (file: { bytes: Buffer; mime: string }) => (verdict = await showsRole(db, { base64: file.bytes.toString("base64"), mime: file.mime }, r.role, r.kind)) : undefined;
  const first = await showIdentityViews(db, characterId, ["full_body"], baseUrl, recastOutfit(outfit, r), { accept });
  if (!first.ok) return first;
  if (first.pictures.length) return { ok: true, made: first.pictures.length, role_ok: verdict, tries: 1 };
  if (!r || !first.misses) return { ok: false, status: 422, error: "not_made", message: first.message ?? "Nothing came through." };
  const second = await showIdentityViews(db, characterId, ["full_body"], baseUrl, recastOutfit(outfit, r, true), { accept, keepOnMiss: true });
  if (!second.ok) return second;
  if (!second.pictures.length) return { ok: false, status: 422, error: "not_made", message: second.message ?? "Nothing came through." };
  return { ok: true, made: second.pictures.length, role_ok: verdict, tries: 2 };
}
