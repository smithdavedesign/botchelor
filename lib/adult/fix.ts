/**
 * Fix (David, 2026-11-09: "we need a way to iterate over a broken image and fix it": a deformed hand, a small thing off,
 * or the same picture undressed): one of their pictures kept as it is but for what's asked, as a new version of it.
 *
 *  - **Kinds:** `faces` (each face made the face that person keeps, lib/adult/fix-faces.ts), `repair` (what's broken,
 *    as chips, REPAIRS, with their words if they like), `change` (one change, in their words) and `undress` (the same
 *    picture, the same pose and place, without clothes).
 *  - **A marked spot** (repair and change): the piece around it is cut out, fixed close up, and pasted back with a soft
 *    edge, so everything further from the spot than the edge is the original's own pixels. An edit model redraws the
 *    whole picture a little each time (faces drift, colours slide); a spot doesn't. On Replicate, whose links can't
 *    carry a picture made in between, the whole picture is fixed and only the spot is pasted back.
 *  - **Versions:** every fix is a new picture (`fixed_from` the version it was made from, `fix_root` the original), at
 *    most FIXES_MAX for an original across all its versions. A new one joins the gallery beside the rest; Keep makes
 *    one the version shown: the others leave the galleries (`superseded_by`, still listed here), and a night's beats
 *    that showed one of them show it instead.
 *  - **Held to:** only the owner's own pictures (the pipeline takes no uploads, so never a real person's photo); their
 *    words checked as the Studio checks its own words, against the characters' limits, and never past the picture's
 *    level (Undressed is the way to nude); Undressed only where their limits reach nude, never somewhere public with the
 *    two of them, and somewhere public alone only with the place empty (#1407: checked, failing closed); every result
 *    through the check before it's kept.
 *  - **Price:** faces, repair and change are free (our model's mistake), counted against the month's pictures (a Studio
 *    picture's against the Studio's); Undressed is the Studio's `prices.undress` (admins free), back if nothing's kept.
 */
import type { Db } from "../db";
import { isAdmin } from "../admins";
import { loadCharacter, type Character } from "../character";
import { keepBytes } from "../object-store";
import { checkAdultText } from "../safety";
import { fitRatio } from "../media-tools/image";
import { askRatio, ratiosFor } from "../studio/formats";
import { crossesTaboo } from "./acts";
import { mediaLimits } from "./clips";
import { runMedia } from "./fallback";
import { faceFor, fixFacePrompt } from "./fix-faces";
import { hivePausedMessage } from "./hive-limit";
import { hardNoHit } from "./limits";
import { levelForStage } from "./media-tags";
import { mediaByIds, mediaBytes, outputCheckReady, PICTURES_OFF_NOTE, signedMediaUrl, type Media } from "./media";
import { aloneInPicture, checkMedia, mediaGate } from "./moderation";
import { drawKeyframe, drawReplicateKeyframe, fitPrompt, KEYFRAME_MODEL, reelCast } from "./reels";
import { requestJson, withRequestLog } from "./request-log";
import { adultKeys, getAdultSettings } from "./settings";
import { identityOf, nounOf, nudeInPublic, shootLimits } from "./studio";
import { cleanCustom, EMPTY_PLACE, LEVEL_LABEL, type Level } from "./studio-catalog";
import type { StudioConfig } from "./studio-config";
import { refundAdTokens, spendAdTokens } from "./tokens";
import { countUse, overCap } from "./usage";

export const FIX_KINDS = ["faces", "repair", "change", "undress"] as const;
export type FixKind = (typeof FIX_KINDS)[number];

/** What's broken, as chips: each a fixed phrase, so a repair needs no words of theirs. */
export const REPAIRS = {
  hands: { label: "Hands", words: "the hands, each natural with five fingers, nothing fused, extra or bent the wrong way" },
  limbs: { label: "Arms and legs", words: "the arms and legs, two of each for each person, joints bending the natural way, nothing extra or missing and nothing merging into anyone or anything" },
  eyes: { label: "Eyes and teeth", words: "the eyes and teeth, both eyes matching and looking the same way, the teeth natural" },
  glitches: { label: "Glitches", words: "any glitches, warped or smeared patches, doubled edges, stray marks or lettering" },
} as const;
export type RepairId = keyof typeof REPAIRS;
export const REPAIR_IDS = Object.keys(REPAIRS) as RepairId[];

/** Fixes of one original, all its versions together: past it, a new picture is the better start. */
export const FIXES_MAX = 5;
/** The most the owner's words for one fix can run. */
export const FIX_NOTE_MAX = 240;
/** A marked spot's smallest side, as a fraction of the picture's. */
export const SPOT_MIN = 0.04;
/** A spot this much of the picture or more is the whole picture. */
const SPOT_WHOLE = 0.85;

/** A marked spot, as fractions of the picture: its top-left corner, width and height. */
export type Spot = { x: number; y: number; w: number; h: number };
export type FixAsk = { kind: FixKind; repairs?: readonly string[]; note?: string | null; spot?: Spot | null; who?: string | null };
type Fail = { ok: false; status: number; error: string; message: string };
export type FixResult = { ok: true; picture: Media; original: string; root: string } | Fail;
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });

/* ----------------------------------------------------- prompts ----------------------------------------------------- */

const KEEP = "Change nothing else: the same people, faces, pose, hair, clothes (or none), place, light, framing and colours.";
const KEEP_CLOSE = "Keep everything else in it exactly as it is, with the same skin tones, light, colours and grain, so it fits back into the photograph.";
const ADULT = "Photorealistic. Everyone shown is an adult.";
/** As dressed, or as explicit, as Picture 1 is: a fix never takes it further. */
const asItIs = (level: number): string => (level >= 2 ? "Uncensored, exactly as explicit as Picture 1 and no more." : "Exactly as dressed as in Picture 1.");
const bare = (s: string): string => s.trim().replace(/[\s.!;,]+$/, "");
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** What's broken put right (the chips' phrases, then their words), the rest of Picture 1 kept; `close` for a spot's piece. */
export function repairPrompt(repairs: readonly RepairId[], note: string | null, level: number, close = false): string {
  const what = [...repairs.map((r) => REPAIRS[r].words), ...(note ? [bare(note)] : [])];
  const head = close ? "Picture 1 is a close-up cut from a photograph." : "Picture 1 is the photograph to keep exactly as it is, but for what's wrong in it.";
  return fitPrompt([head], `Put right ${what.join("; and ")}.`, [close ? KEEP_CLOSE : KEEP, asItIs(level), ADULT]);
}

/** One change, in their words, the rest of Picture 1 kept; `close` for a spot's piece. */
export function changePrompt(note: string, level: number, close = false): string {
  const head = close ? "Picture 1 is a close-up cut from a photograph." : "Picture 1 is the photograph to keep exactly as it is, but for one change.";
  return fitPrompt([head], `The change: ${bare(note)}.`, [close ? KEEP_CLOSE : KEEP, asItIs(level), ADULT]);
}

/**
 * Picture 1 again with these undressed (each with their nude body reference's picture number, when they have one),
 * anyone else in it as dressed as before, nothing else changed; the place empty when it's somewhere public.
 */
export function undressPrompt(targets: readonly { tag: string; body: number | null }[], dressed: readonly string[], level: number, emptyPlace: boolean): string {
  const two = targets.length > 1;
  const head = `Picture 1 is the photograph to keep exactly as it is, but with ${two ? "both of them" : targets[0].tag} undressed: no clothes at all.`;
  const bodies = targets.filter((t) => t.body !== null).map((t) => `${cap(t.tag)}'s body is the body from Picture ${t.body}.`);
  const keep = `The very same ${two ? "people, faces" : "person, face"}, hair, pose, expression, place, light, framing and colours: only the clothes go.`;
  const others = dressed.map((d) => `${cap(d)} stays exactly as dressed as in Picture 1.`);
  const tail = level >= 3 ? "Uncensored, exactly as explicit as Picture 1 and no more." : "Nude, with nothing sexual or explicit added.";
  return fitPrompt([head], [...bodies, keep, ...others].join(" "), [emptyPlace ? `${EMPTY_PLACE}.` : "", tail, ADULT]);
}

/* ------------------------------------------------------ spots ------------------------------------------------------ */

export type Box = { left: number; top: number; width: number; height: number };
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** A marked spot made sane: inside the picture, and big enough to fix; nearly all of it is the whole picture (null). */
export function cleanSpot(s: Spot | null | undefined): { spot: Spot | null; error: string | null } {
  if (!s) return { spot: null, error: null };
  if (![s.x, s.y, s.w, s.h].every((n) => Number.isFinite(n))) return { spot: null, error: "That spot isn't on the picture." };
  const x = clamp01(s.x);
  const y = clamp01(s.y);
  const w = Math.min(clamp01(s.w), 1 - x);
  const h = Math.min(clamp01(s.h), 1 - y);
  if (w < SPOT_MIN || h < SPOT_MIN) return { spot: null, error: "Mark a bigger spot: drag across the whole of what's wrong." };
  if (w * h >= SPOT_WHOLE) return { spot: null, error: null };
  return { spot: { x, y, w, h }, error: null };
}

/** The spot in pixels, and the piece cut around it: the spot with room on every side, so the model sees what it joins. */
export function spotBoxes(width: number, height: number, s: Spot, room = 0.35): { spot: Box; piece: Box } {
  const left = Math.min(width - 1, Math.round(s.x * width));
  const top = Math.min(height - 1, Math.round(s.y * height));
  const right = Math.max(left + 1, Math.min(width, Math.round((s.x + s.w) * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round((s.y + s.h) * height)));
  const spot = { left, top, width: right - left, height: bottom - top };
  const pad = Math.max(32, Math.round(Math.max(spot.width, spot.height) * room));
  const pl = Math.max(0, left - pad);
  const pt = Math.max(0, top - pad);
  const pr = Math.min(width, right + pad);
  const pb = Math.min(height, bottom + pad);
  return { spot, piece: { left: pl, top: pt, width: pr - pl, height: pb - pt } };
}

/** How soft a spot's edge is, in pixels: the band past the spot over which the fix fades into the original. */
export const featherFor = (spot: Box): number => Math.max(4, Math.round(Math.min(spot.width, spot.height) * 0.12));

const sharpOf = async () => (await import("sharp")).default;

/**
 * The fixed piece laid back over the original: the spot in full, fading out over `featherFor(spot)` pixels past it (a
 * smoothstep), and everything further out the original's own pixels, untouched. PNG stays PNG; a JPEG or WebP is saved
 * again at quality 95.
 */
export async function pasteSpot(original: Buffer, fixed: Buffer, piece: Box, spot: Box): Promise<{ bytes: Buffer; mime: string }> {
  const sharp = await sharpOf();
  const meta = await sharp(original, { failOn: "none" }).metadata();
  const rgb = await sharp(fixed, { failOn: "none" }).resize(piece.width, piece.height, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  const feather = featherFor(spot);
  const mask = Buffer.alloc(piece.width * piece.height);
  const sl = spot.left - piece.left;
  const st = spot.top - piece.top;
  const sr = sl + spot.width;
  const sb = st + spot.height;
  for (let y = 0; y < piece.height; y++) {
    const dy = y < st ? st - y : y >= sb ? y - sb + 1 : 0;
    for (let x = 0; x < piece.width; x++) {
      const dx = x < sl ? sl - x : x >= sr ? x - sr + 1 : 0;
      const d = dx || dy ? Math.hypot(dx, dy) : 0;
      const t = Math.min(1, d / feather);
      mask[y * piece.width + x] = d >= feather ? 0 : Math.round(255 * (1 - t * t * (3 - 2 * t)));
    }
  }
  const overlay = await sharp(rgb, { raw: { width: piece.width, height: piece.height, channels: 3 } })
    .joinChannel(mask, { raw: { width: piece.width, height: piece.height, channels: 1 } })
    .png()
    .toBuffer();
  const img = sharp(original, { failOn: "none" }).composite([{ input: overlay, left: piece.left, top: piece.top }]);
  if (meta.format === "jpeg") return { bytes: await img.jpeg({ quality: 95 }).toBuffer(), mime: "image/jpeg" };
  if (meta.format === "webp") return { bytes: await img.webp({ quality: 95 }).toBuffer(), mime: "image/webp" };
  return { bytes: await img.png().toBuffer(), mime: "image/png" };
}

/** A piece of a picture, as a PNG. */
async function cutPiece(bytes: Buffer, box: Box): Promise<Buffer> {
  const sharp = await sharpOf();
  return sharp(bytes, { failOn: "none" }).extract(box).png().toBuffer();
}

/* ---------------------------------------------------- versions ---------------------------------------------------- */

type Row = {
  id: string; character_id: string | null; character_b: string | null; mime: string; prompt: string | null; shoot_id: string | null; scene_chapter: number | null;
  scene_place: string | null; preset: string | null; level: number | null; pov: string | null; aspect: string | null; fixed_from: string | null; fix_root: string | null;
};

/** One of the owner's own ready pictures, with its level (its own, else its shoot's) and whose eyes it's seen through. */
async function fixable(db: Db, viewer: string, mediaId: string): Promise<Row | null> {
  return (
    (
      await db.query<Row>(
        `select i.id, i.character_id, i.character_b, i.mime, i.prompt, i.shoot_id, i.scene_chapter, i.scene_place, i.preset, i.aspect, i.fixed_from, i.fix_root,
                coalesce(i.level, (select case when s.choices->>'level' ~ '^[0-3]$' then (s.choices->>'level')::int end from adult_studio_shoots s where s.id = i.shoot_id)) as level,
                (select t.value from adult_media_tags t where t.media_id = i.id and t.kind = 'pov' and not t.removed limit 1) as pov
           from adult_images i where i.id = $1 and i.owner_id = $2 and i.status = 'ready' and i.kind = 'scene' and i.mime like 'image/%'`,
        [mediaId, viewer],
      )
    ).rows[0] ?? null
  );
}

/** The original a version comes from (itself, for the original); a Fix faces of before #fix walked up its `fixed_from`. */
async function rootOf(db: Db, row: Pick<Row, "id" | "fixed_from" | "fix_root">): Promise<string> {
  if (row.fix_root) return row.fix_root;
  let id = row.id;
  let from = row.fixed_from;
  for (let i = 0; from && i < 10; i++) {
    const up = (await db.query<{ fixed_from: string | null; fix_root: string | null }>(`select fixed_from, fix_root from adult_images where id = $1`, [from])).rows[0];
    if (!up) break;
    if (up.fix_root) return up.fix_root;
    id = from;
    from = up.fixed_from;
  }
  return id;
}

type VersionRow = { id: string; fixed_from: string | null; fix_kind: string | null; fix_note: string | null; fix_spot: Spot | null; superseded_by: string | null; created_at: Date | string };
/** Every ready version of an original, the original first, then oldest to newest. */
async function versionRows(db: Db, viewer: string, root: string): Promise<VersionRow[]> {
  return (
    await db.query<VersionRow>(
      `select id, fixed_from, fix_kind, fix_note, fix_spot, superseded_by, created_at from adult_images
        where owner_id = $2 and status = 'ready' and (id = $1 or fix_root = $1 or (fix_root is null and fixed_from = $1))
        order by (id = $1) desc, created_at, id`,
      [root, viewer],
    )
  ).rows;
}

/** How many fixes an original's versions have had. */
export async function fixesOf(db: Db, viewer: string, root: string): Promise<number> {
  return (await versionRows(db, viewer, root)).filter((v) => v.id !== root).length;
}

/* ------------------------------------------------------ limits ------------------------------------------------------ */

/**
 * Words that would take a picture a level further (lib/adult/studio-catalog.ts Level): into underwear, out of their
 * clothes, or into sex. A fix keeps a picture at its own level, so they're refused there; Undressed is the way to nude.
 * (lib/adult/limits.ts overIntensity reads stages from a night's lines, and lets "make her naked" through at flirty.)
 */
export const RAISES: readonly { to: Level; words: RegExp }[] = [
  { to: 1, words: /\b(lingerie|underwear|bra|panties|knickers|thong|boxers|briefs|bikini|swimsuit|negligee|corset|stockings|garters?|see-through (?:dress|top|shirt|blouse|robe|gown|nightie))\b/i },
  {
    to: 2,
    words:
      /\b(naked|nude|nudity|undress\w*|unclothed|topless|bottomless|strip(?:s|ped|ping)?\s+(?:her|him|them|off|down|naked|nude|bare)|stripper|striptease|bare[- ]?(?:chested|breasted|bodied|bottomed)|bare (?:chest|breasts?|butt|bottom|ass)|nipples?|(?:clothes|clothing|dress|shirt|top|bra|panties|underwear|pants|skirt|jeans|trousers)\s+(?:off|removed|gone)|(?:take|takes|took|taking|pull|pulls|pulled|remove|removes|removed|removing|lose|loses|without|no)\s+(?:off\s+)?(?:her|his|their|the|all|any)?\s*(?:clothes|clothing|dress|shirt|top|bra|panties|underwear|pants|skirt|jeans|trousers|bikini|swimsuit|lingerie))\b/i,
  },
  {
    to: 3,
    words:
      /\b(sex|sexual|fuck\w*|penetrat\w*|blow ?jobs?|hand ?jobs?|oral sex|cum(?:s|ming|shot)?|orgasm\w*|masturbat\w*|erection|intercourse|thrusting|cunnilingus|fellatio|doggy ?style|penis|cock|dick|pussy|vagina|clit\w*)\b/i,
  },
];
/** The highest level their words reach, of the ones RAISES knows (0 when none). */
export const levelOfWords = (text: string): Level => RAISES.reduce<Level>((top, r) => (r.words.test(text) && r.to > top ? r.to : top), 0);
const levelOf = (n: number | null): Level => (n === 1 || n === 2 || n === 3 ? n : 0);

type Held = { maxLevel: Level; hit: (text: string) => string | null; pair: boolean };
/** What a fix of their picture is held to: the pair's limits for two, the Studio's for one, under the Studio's maximum. */
async function heldTo(db: Db, viewer: string, people: readonly Character[], config: StudioConfig): Promise<Held> {
  if (people.length === 2) {
    const l = await mediaLimits(db, viewer, people[0].id, people[1].id);
    return { maxLevel: Math.min(config.max_level, levelForStage(l.maxStage), l.explicit ? 3 : 2) as Level, hit: l.hit, pair: true };
  }
  const identity = await identityOf(db, viewer, people[0].id);
  const hard = { chips: identity.hard_nos, own: [] };
  return {
    maxLevel: shootLimits(identity, config).maxLevel,
    hit: (text) => {
      const h = hardNoHit(text, hard);
      return h ? `crossed a hard limit (${h})` : null;
    },
    pair: false,
  };
}

/** Their words checked before anything's spent: the lines After Dark never crosses, their limits, and the picture's level. */
function wordsRefusal(note: string, held: Held, level: Level): Fail | null {
  if (!checkAdultText({ words: note }).ok || crossesTaboo(note)) return fail(422, "not_allowed", "Those words cross one of the lines After Dark never crosses.");
  const hit = held.hit(note);
  if (hit) return fail(422, "not_allowed", `Those words ${hit}.`);
  const reach = levelOfWords(note);
  if (reach <= level) return null;
  // Out of their clothes, and no further: what they're after is Undressed.
  if (reach === 2) return fail(422, "undress_instead", "To take their clothes off, pick Undressed.");
  return fail(422, "past_level", `A fix keeps the picture as it is (${LEVEL_LABEL[level].toLowerCase()}): those words would take it further.`);
}

const whoseLimits = (people: readonly Character[]): string => (people.length === 2 ? "Their" : `${people[0].name.split(/\s+/)[0]}'s`);
/** A picture past what they're held to now (their limits lowered since, or a partner's consent taken back) isn't remade. */
const pastLimits = (held: Held, people: readonly Character[]): string =>
  `${whoseLimits(people)} limits stop at ${LEVEL_LABEL[held.maxLevel].toLowerCase()} now, and this picture is past that, so it can't be fixed.`;

/** Whether Undressed can be had for this picture, and why not: their limits, and somewhere public. */
function undressRefusal(held: Held, people: readonly Character[], place: string | null): Fail | null {
  if (held.maxLevel < 2) return fail(422, "locked", `${whoseLimits(people)} limits stop at ${LEVEL_LABEL[held.maxLevel].toLowerCase()}: change them in the Studio to go further.`);
  if (people.length === 2 && nudeInPublic({ level: 2, place })) return fail(422, "public", "Somewhere public, the two of them stay dressed: undress them somewhere private.");
  return null;
}

/* ------------------------------------------------------- fix ------------------------------------------------------- */

/** Who's in it as the prompt calls them, and which of them it shows (seen through someone's eyes, only the other one). */
function castOf(row: Row, people: readonly Character[], viewer: string): { tag: string; c: Character; i: number; shown: boolean }[] {
  const tags = people.length === 2 ? reelCast(people[0], people[1], viewer).map((p) => p.tag) : [`the ${nounOf(people[0])}`];
  return people.map((c, i) => ({ c, i, tag: tags[i], shown: row.pov === "a" ? i === 1 : row.pov === "b" ? i === 0 : true }));
}

async function peopleOf(db: Db, row: Row): Promise<Character[] | null> {
  const ids = [row.character_id, row.character_b].filter((x): x is string => Boolean(x));
  const people = (await Promise.all(ids.map((id) => loadCharacter(db, id)))).filter((c): c is Character => Boolean(c));
  return people.length === ids.length && people.length > 0 ? people : null;
}

/**
 * Fixes one of their pictures (lib/adult/fix.ts's header): checks what's asked and what it's held to before anything's
 * spent, draws it, checks the result like any picture, and keeps it as a new version beside the one it was made from.
 */
export async function fixPicture(db: Db, viewer: string, mediaId: string, ask: FixAsk, baseUrl: string): Promise<FixResult> {
  const row = await fixable(db, viewer, mediaId);
  if (!row?.character_id) return fail(404, "not_found", "There's no picture of yours with that id.");
  if (!(FIX_KINDS as readonly string[]).includes(ask.kind)) return fail(422, "unknown_kind", "Pick how to fix it.");
  const root = await rootOf(db, row);
  if ((await fixesOf(db, viewer, root)) >= FIXES_MAX) return fail(409, "too_many", `That picture has been fixed ${FIXES_MAX} times: try a new one instead.`);
  const level = levelOf(row.level);

  // What's asked, checked before anything's looked up or spent.
  const note = ask.kind === "repair" || ask.kind === "change" ? (cleanCustom(ask.note ?? undefined, FIX_NOTE_MAX) ?? null) : null;
  const repairs = ask.kind === "repair" ? [...new Set(ask.repairs ?? [])].filter((r): r is RepairId => (REPAIR_IDS as string[]).includes(r)) : [];
  if (ask.kind === "change" && !note) return fail(422, "no_words", "Say what to change.");
  if (ask.kind === "repair" && !repairs.length && !note) return fail(422, "nothing_asked", "Pick what's wrong, or say it.");
  const spotted = ask.kind === "repair" || ask.kind === "change" ? cleanSpot(ask.spot) : { spot: null, error: null };
  if (spotted.error) return fail(422, "bad_spot", spotted.error);
  const spot = spotted.spot;

  const people = await peopleOf(db, row);
  if (!people) return fail(404, "not_found", "That picture's characters aren't there any more.");
  const settings = await getAdultSettings(db);
  const held = await heldTo(db, viewer, people, settings.studio);
  if (level > held.maxLevel) return fail(422, "past_limits", pastLimits(held, people));
  if (note) {
    const refused = wordsRefusal(note, held, level);
    if (refused) return refused;
  }
  const cast = castOf(row, people, viewer);
  const targets = cast.filter((p) => p.shown && (!ask.who || ask.who === p.c.id));

  // Undressed: their limits, the place, and their nude body references.
  let undress: { prompt: string; bodies: string[]; alone: boolean } | null = null;
  if (ask.kind === "undress") {
    if (!targets.length) return fail(422, "nobody", "There's nobody of theirs to undress in that one.");
    const refused = undressRefusal(held, people, row.scene_place);
    if (refused) return refused;
    const alone = nudeInPublic({ level: 2, place: row.scene_place });
    const bodies: string[] = [];
    const numbered = await Promise.all(
      targets.map(async (t) => {
        const identity = await identityOf(db, viewer, t.c.id);
        return identity.body && identity.bodyNude ? identity.body : null;
      }),
    );
    const withBodies = targets.map((t, k) => {
      const body = numbered[k];
      if (!body) return { tag: t.tag, body: null };
      bodies.push(body);
      return { tag: t.tag, body: bodies.length + 1 };
    });
    const dressed = cast.filter((p) => p.shown && !targets.includes(p)).map((p) => p.tag);
    undress = { prompt: undressPrompt(withBodies, dressed, level, alone), bodies, alone };
  }
  // Faces: the face each one keeps.
  let faces: string[] = [];
  if (ask.kind === "faces") {
    if (!targets.length) return fail(422, "no_face", "There's no face of theirs to fix in that one.");
    const found = await Promise.all(targets.map((p) => faceFor(db, viewer, p.c.id, row.prompt ?? "")));
    if (found.some((f) => !f)) return fail(409, "no_face", "Each of them needs a face first: pick one in the Studio.");
    faces = found as string[];
  }

  // Ready to draw: the checker, the month's pictures, Hive's day.
  if (!(await outputCheckReady(db))) return fail(409, "not_set_up", PICTURES_OFF_NOTE);
  const capKind = row.shoot_id ? "studio" : "pictures";
  const capped = await overCap(db, viewer, capKind);
  if (capped) return fail(429, "capped", capped);
  const gate = await mediaGate(db, { owner: viewer });
  if (!gate.ok) return fail(503, "hive_paused", gate.message);

  // Undressed costs the Studio's price (admins free), taken now and given back if nothing's kept.
  const price = ask.kind === "undress" && !(await isAdmin(db, viewer)) ? settings.studio.prices.undress : 0;
  if (price > 0 && !(await spendAdTokens(db, viewer, price))) return fail(402, "needs_tokens", `Undressed costs ${price} token${price === 1 ? "" : "s"}. Get more on the tokens page.`);
  const refuse = async (status: number, error: string, message: string): Promise<Fail> => {
    if (price > 0) await refundAdTokens(db, viewer, price);
    return fail(status, error, `${message}${price > 0 ? " Your tokens are back." : ""}`);
  };

  const keys = await adultKeys(db);
  const picture = signedMediaUrl(row.id, baseUrl);
  const ratio = row.aspect ?? "3:4";
  const replicate = () => ({ token: keys.replicate!, keyframe: settings.replicate_keyframe_model, video: settings.replicate_video_model, videoLora: settings.replicate_video_lora });
  // A spot: the original's own pixels, to cut the piece from and paste it back into.
  const original = spot ? await mediaBytes(db, row.id, viewer) : null;
  if (spot && !original) return refuse(404, "not_found", "That picture's file is missing.");
  const size = original ? await (await sharpOf())(original.data, { failOn: "none" }).metadata().catch(() => null) : null;
  if (spot && !(size?.width && size.height)) return refuse(422, "unreadable", "That picture can't be fixed in a spot: fix the whole of it instead.");
  const boxes = spot && size?.width && size.height ? spotBoxes(size.width, size.height, spot) : null;
  const pieceRatio = boxes ? `${boxes.piece.width}:${boxes.piece.height}` : ratio;
  const pieceUrl = boxes && original ? `data:image/png;base64,${(await cutPiece(original.data, boxes.piece)).toString("base64")}` : null;

  const promptFor = (close: boolean): string =>
    ask.kind === "repair" ? repairPrompt(repairs, note, level, close) : ask.kind === "change" ? changePrompt(note!, level, close) : (undress?.prompt ?? "");
  let file: { bytes: Buffer; mime: string };
  let made: { provider: string; fell_back: boolean };
  let sent: string | null;
  try {
    const logged = await withRequestLog(() =>
      runMedia(db, "keyframe", async (p) => {
        if (ask.kind === "faces") {
          // One face at a time on Venice (an edit model holds one face far better than two); one call on Replicate.
          if (p === "replicate") {
            const others = targets.slice(1).map((t, k) => ({ tag: t.tag, from: k + 3 }));
            return drawReplicateKeyframe(replicate(), fixFacePrompt(targets[0].tag, others, level), [picture, ...faces.map((f) => signedMediaUrl(f, baseUrl))], askRatio(ratio, ratiosFor("replicate", settings.replicate_keyframe_model)));
          }
          let current: { bytes: Buffer; mime: string } | null = null;
          for (const [k, t] of targets.entries()) {
            const from = current ? `data:${current.mime};base64,${current.bytes.toString("base64")}` : picture;
            current = await drawKeyframe(keys.venice!, fixFacePrompt(t.tag, [], level), [from, signedMediaUrl(faces[k], baseUrl)], KEYFRAME_MODEL, askRatio(ratio, ratiosFor("venice", KEYFRAME_MODEL)));
          }
          return current!;
        }
        const images = [picture, ...(undress?.bodies ?? []).map((b) => signedMediaUrl(b, baseUrl))];
        if (p === "replicate") {
          return drawReplicateKeyframe(replicate(), promptFor(false), images, askRatio(ratio, ratiosFor("replicate", settings.replicate_keyframe_model)));
        }
        // On Venice a spot's piece goes in close up, at its own shape.
        return pieceUrl
          ? drawKeyframe(keys.venice!, promptFor(true), [pieceUrl], KEYFRAME_MODEL, askRatio(pieceRatio, ratiosFor("venice", KEYFRAME_MODEL)))
          : drawKeyframe(keys.venice!, promptFor(false), images, KEYFRAME_MODEL, askRatio(ratio, ratiosFor("venice", KEYFRAME_MODEL)));
      }),
    );
    const out = logged.value.value;
    made = { provider: logged.value.provider, fell_back: logged.value.fell_back };
    sent = requestJson(logged.requests);
    if (boxes && original && size?.width && size.height) {
      // The piece back into the original: from the close-up (Venice), or cut from the whole picture fixed (Replicate).
      const sharp = await sharpOf();
      const piece =
        made.provider === "replicate"
          ? await sharp((await fitRatio(out, `${size.width}:${size.height}`)).bytes, { failOn: "none" }).resize(size.width, size.height, { fit: "fill" }).extract(boxes.piece).png().toBuffer()
          : (await fitRatio(out, pieceRatio)).bytes;
      file = await pasteSpot(original.data, piece, boxes.piece, boxes.spot);
    } else {
      file = await fitRatio(out, ratio);
    }
  } catch (err) {
    return refuse(502, "not_made", `It couldn't be fixed (${err instanceof Error ? err.message.slice(0, 160) : "error"}).`);
  }

  // Checked like any picture; somewhere public and nude, only with nobody else in it (fails closed).
  const checkable = { base64: file.bytes.toString("base64"), mime: file.mime };
  const verdict = await checkMedia(db, checkable, "image", { owner: viewer });
  const reject = async (reason: string) =>
    db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'fix', $3)`, [crypto.randomUUID(), viewer, reason.slice(0, 300)]).catch(() => {});
  if (!verdict.ok) {
    if (verdict.paused) return refuse(503, "hive_paused", hivePausedMessage(verdict.paused, { discarded: true }));
    if (verdict.reason.startsWith("the check couldn't run")) return refuse(503, "check_busy", "The safety check couldn't look at it just now, so it wasn't kept. Try again in a few minutes.");
    await reject(verdict.reason);
    return refuse(422, "discarded", `The safety check discarded the fixed picture (${verdict.reason}).`);
  }
  const newLevel = ask.kind === "undress" ? Math.max(level, 2) : level;
  const alone = undress?.alone ?? (people.length === 1 && nudeInPublic({ level: newLevel, place: row.scene_place }));
  if (alone) {
    const one = await aloneInPicture(db, checkable);
    if (one !== true) {
      await reject(one === null ? "the check for anyone else in the picture couldn't run" : "someone else was in the picture, somewhere public");
      return refuse(
        one === null ? 503 : 422,
        "not_alone",
        one === null ? "The check for anyone else in the picture couldn't run, so it wasn't kept. Try again in a few minutes." : "Someone else turned up in it, somewhere public, so it wasn't kept.",
      );
    }
  }

  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, file.bytes, file.mime);
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, fell_back, model, preset, scene_chapter, scene_place,
                               shoot_id, level, fixed_from, fix_root, fix_kind, fix_note, fix_spot, nsfw_score, request, aspect)
     values ($1, $2, $3, $4, 'scene', $5, $6, $7, $8, 'ready', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23::jsonb, $24)`,
    [
      id, viewer, row.character_id, row.character_b, row.prompt, file.mime, kept.data, kept.object_key, made.provider, made.fell_back,
      made.provider === "replicate" ? settings.replicate_keyframe_model : KEYFRAME_MODEL, row.preset, row.scene_chapter, row.scene_place, row.shoot_id, newLevel,
      row.id, root, ask.kind, note ?? (repairs.length ? repairs.join(",") : null), spot ? JSON.stringify(spot) : null, verdict.nsfw ?? null, sent, row.aspect,
    ],
  );
  // What it shows, as the one it was made from shows it, but for the pin for dates (that stays the owner's call).
  await db.query(
    `insert into adult_media_tags (media_id, owner_id, kind, value, source) select $2, $3, kind, value, source from adult_media_tags where media_id = $1 and not removed and kind <> 'date'
     on conflict (media_id, kind, value) do nothing`,
    [row.id, id, viewer],
  );
  await db.query(`update adult_images set tagged_at = now() where id = $1`, [id]);
  await countUse(db, viewer, capKind);
  const [picked] = await mediaByIds(db, [id], viewer);
  return { ok: true, picture: picked, original: row.id, root };
}

/** The old Fix faces, now one kind of fix (app/api/admin/after-dark/fix-faces). */
export function fixFaces(db: Db, viewer: string, mediaId: string, opts: { who?: string | null }, baseUrl: string): Promise<FixResult> {
  return fixPicture(db, viewer, mediaId, { kind: "faces", who: opts.who ?? null }, baseUrl);
}

/* ------------------------------------------------------ sheet ------------------------------------------------------ */

export type FixVersion = { id: string; kind: FixKind | null; note: string | null; spot: Spot | null; from: string | null; shown: boolean; created_at: string };
export type FixState = {
  root: string;
  versions: FixVersion[];
  /** Fixes still to be had for the original. */
  left: number;
  repairs: { id: RepairId; label: string }[];
  /** The most their words for one fix can run. */
  note_max: number;
  /** Who's in it, and whose face can be fixed (a face picked for each). */
  people: { id: string; name: string; shown: boolean; face: boolean }[];
  undress: { ok: boolean; why: string | null; price: number; empty_place: boolean };
  /** Why it can't be fixed at all (past what they're held to now), or null. */
  blocked: string | null;
  /**
   * The version Keep last made the one shown (the others were hidden for it), or null before any Keep. A fix made since
   * is shown beside it until one of them is kept.
   */
  kept: string | null;
};

/** Everything the Fix sheet shows for a picture: its versions, what's left, and whether Undressed can be had, and for what. */
export async function fixState(db: Db, viewer: string, mediaId: string): Promise<{ ok: true; state: FixState } | Fail> {
  const row = await fixable(db, viewer, mediaId);
  if (!row?.character_id) return fail(404, "not_found", "There's no picture of yours with that id.");
  const people = await peopleOf(db, row);
  if (!people) return fail(404, "not_found", "That picture's characters aren't there any more.");
  const root = await rootOf(db, row);
  const rows = await versionRows(db, viewer, root);
  const settings = await getAdultSettings(db);
  const held = await heldTo(db, viewer, people, settings.studio);
  const cast = castOf(row, people, viewer);
  const faces = await Promise.all(cast.map((p) => (p.shown ? faceFor(db, viewer, p.c.id, row.prompt ?? "") : Promise.resolve(null))));
  const refused = undressRefusal(held, people, row.scene_place);
  const admin = await isAdmin(db, viewer);
  return {
    ok: true,
    state: {
      root,
      versions: rows.map((v) => ({
        id: v.id,
        kind: v.id === root ? null : ((FIX_KINDS as readonly string[]).includes(v.fix_kind ?? "") ? (v.fix_kind as FixKind) : "faces"),
        note: v.fix_note,
        spot: v.fix_spot,
        from: v.id === root ? null : v.fixed_from,
        shown: !v.superseded_by,
        created_at: new Date(v.created_at).toISOString(),
      })),
      left: Math.max(0, FIXES_MAX - rows.filter((v) => v.id !== root).length),
      repairs: REPAIR_IDS.map((id) => ({ id, label: REPAIRS[id].label })),
      note_max: FIX_NOTE_MAX,
      people: cast.map((p, k) => ({ id: p.c.id, name: p.c.name.split(/\s+/)[0], shown: p.shown, face: Boolean(faces[k]) })),
      undress: {
        ok: !refused,
        why: refused?.message ?? null,
        price: admin ? 0 : settings.studio.prices.undress,
        empty_place: people.length === 1 && nudeInPublic({ level: 2, place: row.scene_place }),
      },
      blocked: levelOf(row.level) > held.maxLevel ? pastLimits(held, people) : null,
      kept: rows.find((v) => v.superseded_by)?.superseded_by ?? null,
    },
  };
}

/**
 * Keep one version: it's the one the galleries show, the others leave them (still in the Fix sheet), and a night's beat
 * that showed one of them shows it instead. Keeping the original puts things back as they were before any fix.
 */
export async function keepVersion(db: Db, viewer: string, mediaId: string): Promise<{ ok: true; kept: string; picture: Media; hidden: string[]; state: FixState } | Fail> {
  const row = await fixable(db, viewer, mediaId);
  if (!row?.character_id) return fail(404, "not_found", "There's no picture of yours with that id.");
  const root = await rootOf(db, row);
  const ids = (await versionRows(db, viewer, root)).map((v) => v.id);
  const hidden = ids.filter((x) => x !== row.id);
  await db.query(`update adult_images set superseded_by = case when id = $1 then null else $1 end where owner_id = $2 and id = any($3)`, [row.id, viewer, ids]);
  if (hidden.length) await db.query(`update adult_beats set picture_id = $1 where owner_id = $2 and picture_id = any($3)`, [row.id, viewer, hidden]);
  const state = await fixState(db, viewer, row.id);
  if (!state.ok) return state;
  const [picture] = await mediaByIds(db, [row.id], viewer);
  return { ok: true, kept: row.id, picture, hidden, state: state.state };
}
