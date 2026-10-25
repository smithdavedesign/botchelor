/**
 * Theater matching pictures (David, 2026-10-24: "show images in the theater if we have one that matches the scene";
 * 2026-10-25: "tag the individual assets, together assets, scenes … and show them in theater mode"). As a scene runs,
 * the pair's own media that fits what's happening is offered — no drawing, no spend: the 📷 chip (a picture of the
 * current act), and the backdrop (the best fit for where they are or what's happening, a clip looped). What fits is read
 * from each item's tags (lib/adult/media-tags.ts): the current act (the latest position the recent lines name, or
 * undressing/sex by the stage; lib/adult/beats.ts positionIn, lib/adult/acts.ts ids), the place's keys, how far the night
 * has gone. A miss just shows nothing.
 */
import type { Db } from "../db";
import { isAdmin } from "../admins";
import { positionIn } from "./beats";
import { candidates, ensureTagged, modelTagLater, placeKeys, rank, type Candidate, type MatchWant } from "./media-tags";
import { eligiblePair } from "./scenes";

const UNDRESSING = 3;
const SEX = 4;
/** How many of the most recent lines to read for the act happening now. */
const RECENT = 8;

/** The act happening now: the latest position the recent lines name, else undressing or sex by the stage, else none. */
export function currentAct(lines: readonly { text: string }[], stage: number): string | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - RECENT); i--) {
    const p = positionIn(lines[i]?.text ?? "");
    if (p) return p;
  }
  if (stage >= SEX) return "face_to_face";
  if (stage >= UNDRESSING) return "undress";
  return null;
}

export type SceneMatch = { image_id: string; act: string } | null;

/** The pair's scene and where it is now: the act (null when nothing explicit is happening yet), the place, the stage. */
async function sceneWhere(db: Db, ownerId: string, x: string, y: string): Promise<{ a: string; b: string; act: string | null; place: string | null; stage: number } | null> {
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return null;
  const [a, b] = pair;
  const scene = (await db.query<{ lines: { text: string }[]; stage: number; place: string | null; set_place: string | null }>(`select lines, stage, place, set_place from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`, [ownerId, a, b])).rows[0];
  if (!scene) return null;
  return { a, b, act: currentAct(scene.lines ?? [], scene.stage ?? 0), place: scene.place ?? scene.set_place, stage: scene.stage ?? 0 };
}

/**
 * The pair's tagged media and what's happening now (lib/adult/media-tags.ts): the pair's untagged media is tagged first
 * (the back-fill), and the model's read of the owner's own words runs after the response.
 */
async function wantAndCandidates(db: Db, ownerId: string, x: string, y: string): Promise<{ want: MatchWant; list: Candidate[] } | null> {
  const where = await sceneWhere(db, ownerId, x, y);
  if (!where) return null;
  const admin = await isAdmin(db, ownerId);
  await ensureTagged(db, ownerId, [where.a, where.b], 200, { anyOwner: admin });
  await modelTagLater(db, ownerId, [where.a, where.b]);
  const list = await candidates(db, ownerId, where.a, where.b, { admin });
  return { want: { act: where.act, places: placeKeys(where.place), stage: where.stage }, list };
}
const hasTag = (c: Candidate, kind: string) => c.tags.some((t) => t.kind === kind);

export type SceneBackdrop = { kind: "clip" | "image"; id: string } | null;

/**
 * The best media the pair already has to stand behind the live scene as an immersive backdrop (David, 2026-10-25: "if we
 * have a fuzzy match for the scene put it as the background … if a sexual action matches a reel use it full immersive";
 * "Star has a blowjob video in the movie theater … especially since it's a POV"): any of their tagged pictures and clips
 * that fits where they are OR what's happening, ranked by lib/adult/media-tags.ts scoreMedia — the act, then the place,
 * the pair (or a first-person one of them, the viewer standing in for the partner; one alone never fills the screen),
 * pinned for dates, a clip over a still — never past how far the night has gone. The owner's own, or any to an admin.
 */
export async function sceneBackdrop(db: Db, ownerId: string, x: string, y: string): Promise<SceneBackdrop> {
  const got = await wantAndCandidates(db, ownerId, x, y);
  if (!got || (!got.want.act && !got.want.places.length)) return null;
  const best = rank(got.list, got.want, (c) => Boolean(c.character_b) || hasTag(c, "pov"))[0];
  return best ? { kind: best.mime.startsWith("video/") ? "clip" : "image", id: best.id } : null;
}

/**
 * A picture the pair already has of what's happening now, for the theater's 📷 chip: one of their tagged pictures of the
 * current act (the pair's, or one of them alone — pinned, first-person or not), the same place and the pair first. Null
 * when nothing's happening yet, there's no scene, or no such picture.
 */
export async function sceneMatch(db: Db, ownerId: string, x: string, y: string): Promise<SceneMatch> {
  const got = await wantAndCandidates(db, ownerId, x, y);
  const act = got?.want.act;
  if (!got || !act) return null;
  const best = rank(got.list, got.want, (c) => c.mime.startsWith("image/") && c.tags.some((t) => t.kind === "act" && t.value === act))[0];
  return best ? { image_id: best.id, act } : null;
}

export type SceneClip = { media_id: string; act: string } | null;

/**
 * A short clip the pair already has of the current act, to loop muted behind the scene (David, 2026-10-24: "if they have a
 * short reel like blowjob it can repeat in the background"): a tagged clip of the act — the pair's, or a first-person
 * one of them — the same place first, then newest. Null when nothing's happening or there's no such clip.
 */
export async function sceneClip(db: Db, ownerId: string, x: string, y: string): Promise<SceneClip> {
  const got = await wantAndCandidates(db, ownerId, x, y);
  const act = got?.want.act;
  if (!got || !act) return null;
  const best = rank(
    got.list,
    got.want,
    (c) => c.mime.startsWith("video/") && c.tags.some((t) => t.kind === "act" && t.value === act) && (Boolean(c.character_b) || hasTag(c, "pov")),
  )[0];
  return best ? { media_id: best.id, act } : null;
}
