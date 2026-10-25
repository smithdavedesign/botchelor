/**
 * The After Dark Studio (docs/PRDs/studio.md; David, 2026-10-24): a private photo studio for an owner's own character,
 * and the workshop for the identity every later picture and video keeps.
 *
 *  - **Who:** the owner of a character switched into their After Dark; an admin also the season's house cast. Who may
 *    open it at all is a setting (`studio.open_to`: admins until payments and age checks are live).
 *  - **Shoot:** the character alone, composed from the menus (lib/adult/studio-catalog.ts), made `shoot_size` times by the
 *    multi-image edit from the face they keep (Picture 1), their body reference (Picture 2, when there is one) and the
 *    place's drawn set (when there is one). The viewer's ratings steer it (lib/adult/steering.ts); their light test picks
 *    the light when they don't.
 *  - **Restyle:** the same person with looks changed (the looks builder's chips), as edits of the face: candidates framed
 *    like a baseline, which "Use this face" can make the face, and "Save to their look" writes to the character.
 *  - **Recast:** new baselines drawn from their look by a text-to-image model.
 *  - **Body reference:** a full-body picture of them alone, which shoots add after the face.
 *  - **Pair shoot (v2):** the character with someone else in their After Dark, from the picture menu's acts, outfits and
 *    framings (lib/adult/pictures-menu.ts), held to the pair's own limits within the Studio's highest level, never to how
 *    far their night has gone: a shoot is staged, not a moment of the night.
 *  - **More like this, Upscale (v2):** pictures like one of theirs (it goes in after the face and body), or one made larger
 *    on Venice's upscaler, each checked and kept like any other.
 *  - **Their own key (v2):** any job on the Venice or Replicate key they connected (Connections, After Dark pictures):
 *    `prices.own_key` tokens, their key's month and cap, our check still on every picture.
 *  - **Setups, Animate (v3):** a shoot's choices saved under a name and run on any of their characters; a picture of one
 *    of them made a 5 or 10 s clip on After Dark's video model, queued and collected as the page polls, checked by Hive.
 *  - **Price and caps:** a shoot's tokens are taken first (admins free), given back whole when nothing came through; one
 *    free redo for a shoot the viewer 👎'd whole; monthly caps per person (lib/adult/usage.ts).
 *  - **The check:** every picture passes the output check before it's kept (lib/adult/check.ts), as everywhere.
 */
import { isAdmin } from "../admins";
import { episodeAllowance, refundBoughtTokens, spendBoughtTokens } from "../allowance";
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import { LOOK_DETAILS, LOOK_STEPS, hairWords, tileId, looksAppearance, looksPictureWords, normaliseLooks, optionPrompt, optionsFor, type Gender, type Looks } from "../looks";
import { readyTiles } from "../looks-draw";
import { dataColumn, keepBytes, readBytes } from "../object-store";
import { pairKey } from "../relationships";
import { checkAdultText } from "../safety";
import { actById, actMenu, crossesTaboo, FRAMINGS, type Framing, type MediaLimits, type MenuAct } from "./acts";
import { nudeSql } from "./attire";
import { eligibleIds } from "./characters";
import { mediaLimits } from "./clips";
import type { CheckResult } from "./check";
import { isPublicPlace } from "./continuity";
import { HivePausedError, hivePausedErrorMessage, hivePausedUntil } from "./hive-limit";
import { checkMedia, checkReady, mediaGate } from "./moderation";
import { HARD_NO_IDS, INTENSITIES, type Intensity } from "./limits";
import { baselinePrompt, characterMedia, ensureBaseline, listMedia, mediaByIds, NEGATIVE_PROMPT, physicalLook, replicatePictureInput, signedMediaUrl, venicePicture, type Media } from "./media";
import { PICTURE_PRESETS, type PresetId } from "./rating-tags";
import { FRAMING_LABEL, OUTFITS, picturePlaces, planPicture } from "./pictures-menu";
import {
  baselines,
  busyMessage,
  busyReel,
  drawKeyframe,
  NUDE_FROM,
  nudeBaselines,
  queueVideo,
  reelCast,
  reelNight,
  releaseVideo,
  replicateKeyframeInput,
  replicateSetImage,
  retrieveVideo,
  setPictures,
  veniceUpscale,
} from "./reels";
import { eligiblePair } from "./scenes";
import { sharePartners, sharesOf, type OutgoingShare, type SharePartner } from "./shares";
import { STAGES } from "./stages";
import { runModel } from "./replicate";
import { adultKeys, getAdultSettings } from "./settings";
import { choosePreset, faceReferenceId, NO_STEERING, steeringFor, withSteering } from "./steering";
import {
  ANIMATE_MOTIONS,
  ANIMATE_SECONDS,
  type AnimateGuide,
  animatePrompt,
  cleanCustom,
  CUSTOM_MAX,
  DIALOG_MAX,
  bodyPrompt,
  groupById,
  headshotPrompt,
  LEVEL_FOR_INTENSITY,
  LEVEL_LABEL,
  optionById,
  planShoot,
  restylePrompt,
  shootPrompt,
  STRENGTHS,
  STUDIO_GROUPS,
  studioMenu,
  VARIATION_HINTS,
  variationPrompt,
  type AnimateSeconds,
  type Level,
  type Noun,
  type ShootChoices,
  type ShootLimits,
  type Strength,
  type Subject,
} from "./studio-catalog";
import type { StudioConfig, StudioModel } from "./studio-config";
import { studioTileId, TILE_GROUPS } from "./studio-tiles";
import { jobKey, jobUsability, recordJobFailure, recordJobSpend } from "../connections";
import { countUse, overCap, usageLeft } from "./usage";
import { requestJson, withRequestLog, type LoggedRequest } from "./request-log";

/* ------------------------------------------------- who may ------------------------------------------------- */

export type StudioFail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): StudioFail => ({ ok: false, status, error, message });

/** The character and what the viewer may do with them here. */
export type StudioAccess = { ok: true; character: Character; noun: Noun; gender: Gender | null; admin: boolean; config: StudioConfig } | StudioFail;

export const nounOf = (c: Pick<Character, "pronouns">): Noun => (c.pronouns?.startsWith("she") ? "woman" : c.pronouns?.startsWith("he") ? "man" : "person");

/**
 * Whether the viewer may use the Studio on this character: the Studio open to them (`open_to`), and the character
 * their own and switched into their After Dark, or, for an admin, one of the house cast in it. Never another person's.
 */
export async function studioAccess(db: Db, viewer: string, characterId: string): Promise<StudioAccess> {
  const settings = await getAdultSettings(db);
  const config = settings.studio;
  const admin = await isAdmin(db, viewer);
  if (config.open_to === "admins" && !admin) return fail(404, "not_found", "The Studio isn't open yet.");
  const c = await loadCharacter(db, characterId);
  if (!c) return fail(404, "not_found", "No character with that id.");
  const own = c.ownerId === viewer;
  if (!own && !(admin && c.house)) return fail(404, "not_found", "The Studio is for your own characters.");
  if (!(await eligibleIds(db, viewer)).has(c.id)) return fail(409, "not_switched_on", `Switch ${c.name} into After Dark first.`);
  const picked = c.extras?.looks?.gender;
  const noun = nounOf(c);
  const gender: Gender | null = picked ?? (noun === "person" ? null : noun);
  return { ok: true, character: c, noun, gender, admin, config };
}

/* ------------------------------------------------ identity ------------------------------------------------ */

export type Identity = { face: string | null; body: string | null; faceCrop: string | null; strength: Strength; intensity: Intensity; hard_nos: string[] };

/** The viewer's own settings for the character: the body reference and face anchor (while ready), strength, studio limits. */
export async function identityOf(db: Db, viewer: string, characterId: string): Promise<Identity> {
  const r = (
    await db.query<{ body_image_id: string | null; face_crop_image_id: string | null; strength: string | null; intensity: string | null; hard_nos: unknown; body_ready: boolean | null; face_crop_ready: boolean | null }>(
      `select i.body_image_id, i.face_crop_image_id, i.strength, i.intensity, i.hard_nos,
              (select m.status = 'ready' from adult_images m where m.id = i.body_image_id) as body_ready,
              (select m.status = 'ready' from adult_images m where m.id = i.face_crop_image_id) as face_crop_ready
         from adult_identity i where i.owner_id = $1 and i.character_id = $2`,
      [viewer, characterId],
    )
  ).rows[0];
  const strength = (STRENGTHS as readonly string[]).includes(r?.strength ?? "") ? (r!.strength as Strength) : "balanced";
  const intensity = (INTENSITIES as readonly string[]).includes(r?.intensity ?? "") ? (r!.intensity as Intensity) : "explicit";
  const hard_nos = Array.isArray(r?.hard_nos) ? (r!.hard_nos as unknown[]).filter((x): x is string => typeof x === "string" && HARD_NO_IDS.includes(x)) : [];
  return { face: await faceReferenceId(db, viewer, characterId), body: r?.body_ready ? r.body_image_id : null, faceCrop: r?.face_crop_ready ? r.face_crop_image_id : null, strength, intensity, hard_nos };
}

async function upsertIdentity(db: Db, viewer: string, characterId: string, col: "body_image_id" | "face_crop_image_id" | "strength" | "intensity" | "hard_nos", value: unknown): Promise<void> {
  const v = col === "hard_nos" ? JSON.stringify(value) : value;
  await db.query(
    `insert into adult_identity (owner_id, character_id, ${col}) values ($1, $2, $3${col === "hard_nos" ? "::jsonb" : ""})
     on conflict (owner_id, character_id) do update set ${col} = excluded.${col}, updated_at = now()`,
    [viewer, characterId, v],
  );
}

/** What a shoot is held to: the studio intensity's level (never past the configured maximum), the hard nos, switches. */
export function shootLimits(identity: Pick<Identity, "intensity" | "hard_nos">, config: StudioConfig): ShootLimits {
  return {
    maxLevel: Math.min(config.max_level, LEVEL_FOR_INTENSITY[identity.intensity] ?? 3) as Level,
    hardNos: identity.hard_nos,
    disabled: new Set(config.disabled_options),
    pov: config.pov,
    filthy: identity.intensity === "filthy",
  };
}

/** Who a picture shows: the noun, the age, the look's words (the looks builder's picks, else their sheet's), the outfit. */
export function subjectOf(c: Character, viewer: string, undressed: boolean): Subject {
  const picks = looksPictureWords(c.extras?.looks, c.ownerId === viewer);
  return { noun: nounOf(c), age: c.age, look: picks.body || physicalLook(c, undressed), outfit: picks.outfit };
}

/* --------------------------------------------------- models --------------------------------------------------- */

/** A model from the Studio's list for a job, by id or the job's default; null when it isn't on the list. */
export function studioModel(config: StudioConfig, job: "edit" | "new", id?: string | null): StudioModel | null {
  const want = id || (job === "edit" ? config.default_edit : config.default_new);
  const m = config.models.find((x) => x.id === want);
  return m && m.job === job ? m : null;
}

type Keys = { venice: string | null; replicate: string | null; hive: string | null };

const MAX_BYTES = 40 * 1024 * 1024;

/** Draws one picture on the model: an edit from `images` (the face first), or a new one from words. */
async function drawOne(db: Db, m: StudioModel, keys: Keys, prompt: string, images: string[], negative: string): Promise<{ bytes: Buffer; mime: string }> {
  if (m.provider === "venice") {
    if (!keys.venice) throw new Error("No Venice key saved in After Dark's settings.");
    return m.job === "edit" ? drawKeyframe(keys.venice, prompt, images.slice(0, m.max_images), m.id) : venicePicture(db, prompt, { model: m.id, key: keys.venice, negative });
  }
  if (!keys.replicate) throw new Error("No Replicate key saved in After Dark's settings.");
  const input = m.job === "edit" ? replicateKeyframeInput(prompt, images.slice(0, m.max_images)) : replicatePictureInput(m.id, prompt, negative);
  const file = await runModel(keys.replicate, m.id, input, { maxBytes: MAX_BYTES, timeoutMs: 120_000 });
  if (!file.mime.startsWith("image/")) throw new Error("Replicate returned no picture.");
  return file;
}

/* --------------------------------------------------- jobs --------------------------------------------------- */

export type ShootKind = "shoot" | "restyle" | "recast" | "body" | "face" | "pair" | "variations" | "upscale" | "animate";
export type Shoot = {
  id: string;
  kind: ShootKind;
  status: "making" | "ready" | "partial" | "failed";
  model: string | null;
  provider: string | null;
  tokens: number;
  asked: number;
  made: number;
  pictures: string[];
  redo_of: string | null;
  error: string | null;
  created_at: string;
  /** A free redo can be asked for: the viewer 👎'd every picture, and it hasn't been redone. */
  redo?: boolean;
};

export type JobResult = { ok: true; shoot: Shoot; pictures: Media[]; refunded: boolean; message: string | null } | StudioFail;

let pauses = true;
/** Tests skip the pause between checks. */
export function setStudioPausesForTests(on: boolean): void {
  pauses = on;
}
const pause = (ms: number) => (pauses ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
/** Between two checks, so a shoot's four don't reach the checker as one burst (it rate-limits). */
const CHECK_GAP_MS = 1500;

type JobSpec = {
  kind: ShootKind;
  /** What the pictures are kept as: a baseline (a face candidate) or a picture of them alone. */
  pictureKind: "baseline" | "scene";
  prompts: { prompt: string; preset: PresetId | null }[];
  images: string[];
  negative: string;
  model: StudioModel;
  tokens: number;
  choices: unknown;
  place: string | null;
  redoOf?: string | null;
  /** A picture of the two of them (an eligible pair, lib/adult/scenes.ts): the other one. */
  partner?: string | null;
  /** On the viewer's own Venice or Replicate key (Connections' After Dark pictures job), not ours. */
  ownKey?: boolean;
  /** What the pictures count against: Studio pictures (the default), or upscales. */
  cap?: "studio" | "upscales";
  /** Draws each picture itself instead of the model (an upscale). */
  draw?: (keys: Keys, p: { prompt: string }) => Promise<{ bytes: Buffer; mime: string }>;
};

const shootRow = (r: {
  id: string; kind: ShootKind; status: Shoot["status"]; model: string | null; provider: string | null; tokens: number; asked: number; made: number; pictures: unknown;
  redo_of: string | null; error: string | null; created_at: string | Date;
}): Shoot => ({
  id: r.id, kind: r.kind, status: r.status, model: r.model, provider: r.provider, tokens: r.tokens, asked: r.asked, made: r.made,
  pictures: Array.isArray(r.pictures) ? (r.pictures as string[]) : [], redo_of: r.redo_of, error: r.error, created_at: new Date(r.created_at).toISOString(),
});

/**
 * Runs one Studio job: the cap and the gate first (nothing spent on a refusal), the tokens, then every picture drawn at
 * once, checked one after another, and the ones that pass kept. Nothing came through: the tokens come back whole.
 */
async function runJob(db: Db, viewer: string, access: Extract<StudioAccess, { ok: true }>, spec: JobSpec): Promise<JobResult> {
  const c = access.character;
  const house = await adultKeys(db);
  if (!(await checkReady(db))) return fail(409, "not_set_up", "Pictures need a checker in After Dark's settings (every picture is checked before it's kept).");
  // Their own key (Connections, After Dark pictures): its provider must be the model's, and it must be usable this month.
  let keys: Keys = { venice: house.venice, replicate: house.replicate, hive: house.hive };
  let own: { provider: string } | null = null;
  if (spec.ownKey) {
    const usable = await jobUsability(db, viewer, "after_dark");
    if (usable.state === "none") return fail(409, "no_own_key", "Connect a Venice or Replicate key under Connections (After Dark pictures) first.");
    if (usable.state !== "ok") return fail(409, "own_key_paused", usable.message);
    const jk = await jobKey(db, viewer, "after_dark");
    if (!jk) return fail(409, "no_own_key", "Connect a Venice or Replicate key under Connections (After Dark pictures) first.");
    if (!access.config.own_keys[jk.provider as "venice" | "replicate"]) return fail(403, "own_key_off", "Own keys for that provider are switched off in the settings.");
    if (jk.provider !== spec.model.provider) return fail(422, "wrong_model", `${spec.model.label} doesn't run on your ${jk.provider === "venice" ? "Venice" : "Replicate"} key: pick one of its models.`);
    keys = { venice: jk.provider === "venice" ? jk.apiKey : null, replicate: jk.provider === "replicate" ? jk.apiKey : null, hive: house.hive };
    own = { provider: jk.provider };
  } else if (spec.model.provider === "venice" ? !keys.venice : !keys.replicate) {
    return fail(409, "not_set_up", `${spec.model.label} needs the ${spec.model.provider === "venice" ? "Venice" : "Replicate"} key in After Dark's settings.`);
  }
  const asked = spec.prompts.length;
  // A picture of two is kept under the pair's order, as every picture of a pair is (lib/relationships.ts pairKey).
  const [first, second] = spec.partner ? pairKey(c.id, spec.partner) : [c.id, null];
  const capKind = spec.cap ?? (own ? "studio_byok" : "studio");
  const left = await usageLeft(db, viewer, capKind);
  if (left !== null && left < asked) return fail(429, "over_cap", `That's ${asked} and ${left} are left this month. They reset on the 1st.`);
  const gate = await mediaGate(db, { owner: viewer });
  if (!gate.ok) return fail(503, "hive_paused", gate.message);
  const pays = spec.tokens > 0 && !access.admin;
  if (pays && !(await spendBoughtTokens(db, viewer, spec.tokens))) {
    return fail(402, "needs_tokens", `That costs ${spec.tokens} token${spec.tokens === 1 ? "" : "s"}. Get more on the shop page.`);
  }
  const id = crypto.randomUUID();
  await db.query(
    `insert into adult_studio_shoots (id, owner_id, character_id, partner_id, kind, choices, model, provider, own_key, tokens, asked, status, redo_of)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, 'making', $12)`,
    [id, viewer, c.id, spec.partner ?? null, spec.kind, JSON.stringify(spec.choices ?? {}), spec.model.id, spec.model.provider, Boolean(own), pays ? spec.tokens : 0, asked, spec.redoOf ?? null],
  );
  // Every picture at once (each a minute or so), then checked one at a time.
  const drawn = await Promise.all(
    spec.prompts.map((p) =>
      // Each with its own log of what it sent (lib/adult/request-log.ts), kept with the picture.
      withRequestLog(() => (spec.draw ? spec.draw(keys, p) : drawOne(db, spec.model, keys, p.prompt, spec.images, spec.negative))).then(
        ({ value: file, requests }) => ({ file, p, requests }),
        (err: unknown) => {
          // A refusal of their own key (invalid, out of credit) goes on its Connections card, as a portrait's does.
          const status = (err as { status?: number })?.status;
          if (own && status) void recordJobFailure(db, viewer, "after_dark", own.provider, `${err instanceof Error ? err.message : "error"} (HTTP ${status})`);
          return { error: err instanceof Error ? err.message.slice(0, 200) : "error" };
        },
      ),
    ),
  );
  const kept: Media[] = [];
  let lastError: string | null = null;
  let checked = 0;
  let paused: string | null = null;
  for (const d of drawn) {
    if ("error" in d) {
      lastError = d.error;
      continue;
    }
    if (paused) continue;
    if (checked++) await pause(CHECK_GAP_MS);
    const verdict: CheckResult = await checkMedia(db, { base64: d.file.bytes.toString("base64"), mime: d.file.mime }, "image", { owner: viewer });
    if (!verdict.ok) {
      lastError = verdict.reason;
      if (verdict.paused) paused = verdict.paused;
      if (!verdict.reason.startsWith("the check couldn't run")) {
        await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'studio', $3)`, [crypto.randomUUID(), viewer, `studio ${spec.kind}: ${verdict.reason}`.slice(0, 300)]).catch(() => {});
      }
      continue;
    }
    const pid = crypto.randomUUID();
    const store = await keepBytes("after-dark", pid, d.file.bytes, d.file.mime);
    await db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, fell_back, model, preset, scene_place, shoot_id, nsfw_score, request)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready', $10, false, $11, $12, $13, $14, $15, $16::jsonb)`,
      [pid, viewer, first, second, spec.pictureKind, d.p.prompt.slice(0, 2000), d.file.mime, store.data, store.object_key, spec.model.provider, spec.model.id, d.p.preset, spec.place?.slice(0, 120) ?? null, id, verdict.nsfw ?? null, requestJson(d.requests)],
    );
    await countUse(db, viewer, capKind);
    kept.push({
      id: pid, character_id: first, character_b: second, kind: spec.pictureKind, status: "ready", created_at: new Date().toISOString(), mime: d.file.mime, clip: false,
      place: spec.place, provider: spec.model.provider, fell_back: false, note: null, preset: d.p.preset, rating: null, tags: [], face: false,
    });
  }
  const made = kept.length;
  // On their own key, what the provider billed them: every picture it drew, kept or not (the job's monthly cap).
  const drawnCount = drawn.filter((d) => !("error" in d)).length;
  if (own && drawnCount) await recordJobSpend(db, viewer, "after_dark", own.provider, Math.round(spec.model.usd * drawnCount * 10000) / 10000);
  const status: Shoot["status"] = made === 0 ? "failed" : made < asked ? "partial" : "ready";
  const refunded = made === 0 && pays;
  if (refunded) await refundBoughtTokens(db, viewer, spec.tokens);
  const row = (
    await db.query<Parameters<typeof shootRow>[0]>(
      `update adult_studio_shoots set made = $2, status = $3, pictures = $4::jsonb, error = $5, tokens = $6, updated_at = now() where id = $1
       returning id, kind, status, model, provider, tokens, asked, made, pictures, redo_of, error, created_at`,
      [id, made, status, JSON.stringify(kept.map((k) => k.id)), lastError, refunded ? 0 : pays ? spec.tokens : 0],
    )
  ).rows[0];
  const message =
    made === 0
      ? `Nothing came through${lastError ? ` (${lastError})` : ""}.${refunded ? " Your tokens are back." : ""}`
      : made < asked
        ? `${made} of ${asked} came through; the rest ${paused ? "waited on the safety check" : "didn't pass the check or failed to draw"}.`
        : null;
  return { ok: true, shoot: shootRow(row), pictures: kept, refunded, message: paused && made === 0 ? hivePausedErrorMessage(new HivePausedError(paused, "", true), refunded) : message };
}

/** The face they keep, made first if they have none (a baseline, as everywhere), as a link the edit model can fetch. */
async function faceLink(db: Db, viewer: string, c: Character, baseUrl: string): Promise<string | StudioFail> {
  let face = await faceReferenceId(db, viewer, c.id);
  if (!face) {
    try {
      await ensureBaseline(db, viewer, c);
    } catch (err) {
      return fail(err instanceof HivePausedError ? 503 : 502, "no_face", `A first picture of ${c.name} couldn't be made (${err instanceof Error ? err.message.slice(0, 160) : "error"}).`);
    }
    face = await faceReferenceId(db, viewer, c.id);
  }
  return face ? signedMediaUrl(face, baseUrl) : fail(409, "no_face", `${c.name} has no picture to keep the face from yet.`);
}

/**
 * "Sharpen the face": a tight head-and-shoulders close-up made once from the baseline and set as the face anchor, so
 * every later shoot leads with the face itself and a heavy override changes the pose and scene without drifting it
 * (David, 2026-10-24: "provide a headshot as context, then let the rest override"). Drawn and checked like any picture;
 * the one that comes through becomes the character's face anchor (adult_identity.face_crop_image_id). An edit model only
 * (it reworks the baseline). Until one is made, shoots use the baseline exactly as before — this can only add a sharper
 * face, never make one worse.
 */
export async function faceAnchorShoot(db: Db, viewer: string, characterId: string, input: { model?: string | null; own_key?: boolean }, baseUrl: string): Promise<JobResult> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config } = access;
  const model = studioModel(config, "edit", input.model);
  if (!model) return fail(422, "unknown_model", "Pick one of the Studio's edit models.");
  if (model.job !== "edit") return fail(422, "wrong_model", `${model.label} makes a new picture from words; the face anchor reworks their baseline, so pick an edit model.`);
  const face = await faceLink(db, viewer, c, baseUrl);
  if (typeof face !== "string") return face;
  const prompt = headshotPrompt(subjectOf(c, viewer, false));
  const res = await runJob(db, viewer, access, {
    kind: "face", pictureKind: "scene", prompts: [{ prompt, preset: null }], images: [face], negative: NEGATIVE_PROMPT,
    model, tokens: input.own_key ? config.prices.own_key : config.prices.body, choices: {}, place: null, ownKey: input.own_key === true,
  });
  // The one that came through becomes the anchor (every later shoot's Picture 1), so it's used, not just stored.
  if (res.ok && res.pictures[0]) await upsertIdentity(db, viewer, c.id, "face_crop_image_id", res.pictures[0].id);
  return res;
}

/** The words a check reads: the choices and the look, never the prompt's fixed words. */
const wordsOk = (words: string): boolean => checkAdultText({ words }).ok && !crossesTaboo(words);

/* --------------------------------------------------- a shoot --------------------------------------------------- */

export type ShootInput = { choices: ShootChoices; model?: string | null; own_key?: boolean };

/** The places of the character's nights (the viewer's, with a drawn set), for the place menu: "own:<n>". */
export async function ownPlaces(db: Db, viewer: string, characterId: string): Promise<{ id: string; label: string; public: boolean }[]> {
  const { rows } = await db.query<{ place: string }>(
    `select distinct set_place as place from (
       select set_place from adult_scenes where owner_id = $1 and (character_a = $2 or character_b = $2) and set_place is not null
       union all
       select set_place from adult_nights where owner_id = $1 and (character_a = $2 or character_b = $2) and set_place is not null
     ) p order by 1 limit 12`,
    [viewer, characterId],
  );
  const sets = await setPictures(db, rows.map((r) => r.place));
  return rows.filter((r) => sets.get(r.place)).map((r, i) => ({ id: `own:${i}`, label: r.place, public: isPublicPlace(r.place) }));
}

export async function shoot(db: Db, viewer: string, characterId: string, input: ShootInput, baseUrl: string, opts: { redoOf?: string; free?: boolean } = {}): Promise<JobResult> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config } = access;
  const model = studioModel(config, "edit", input.model);
  if (!model) return fail(422, "unknown_model", "Pick one of the Studio's models.");
  const identity = await identityOf(db, viewer, c.id);
  const limits = shootLimits(identity, config);
  const places = input.choices.place?.startsWith("own:") ? await ownPlaces(db, viewer, c.id) : [];
  const own = places.find((p) => p.id === input.choices.place);
  const planned = planShoot(input.choices, limits, subjectOf(c, viewer, false), { place: own?.label ?? null, public: own?.public });
  if (!planned.ok) return fail(422, planned.error, planned.message);
  const { plan } = planned;
  const subject = subjectOf(c, viewer, plan.level >= 2);
  // Everything the picture is built from, the owner's own words (custom, extra, dialog) included, is held to the lines first.
  const ownWords = [plan.custom ?? "", plan.dialog ?? "", ...Object.values(plan.extra ?? {})].join(" ");
  if (!wordsOk(`${plan.parts.map((p) => p.words).join(" ")} ${subject.look} ${ownWords}`)) return fail(422, "not_allowed", "That shoot crosses one of the lines After Dark never crosses.");
  // The light: theirs, or the one their light test picks (and the picture keeps it, so their ratings teach the test).
  let preset: PresetId | null = PICTURE_PRESETS.find((p) => p.id === input.choices.light)?.id ?? null;
  if (!input.choices.light) {
    const chosen = await choosePreset(db, viewer, c.id).catch(() => null);
    if (chosen) {
      preset = chosen.id;
      plan.parts.push({ group: "light", words: chosen.words.replace(/\.$/, "") });
    }
  }
  const face = await faceLink(db, viewer, c, baseUrl);
  if (typeof face !== "string") return face;
  // Picture 1 the face: the tight close-up anchor when they've made one (so a heavy override doesn't drift the face),
  // else the baseline. Loose keeps the baseline (loose is the face held lightly, by design).
  const crop = identity.strength !== "loose" && identity.faceCrop ? identity.faceCrop : null;
  // Picture 2 their body reference (when they have one, the model takes it, and the face isn't held loosely), then the set.
  const images = [crop ? signedMediaUrl(crop, baseUrl) : face];
  const refs = { body: false, set: false };
  if (identity.body && identity.strength !== "loose" && model.max_images >= 2) {
    images.push(signedMediaUrl(identity.body, baseUrl));
    refs.body = true;
  }
  const set = plan.place ? ((await setPictures(db, [plan.place])).get(plan.place) ?? null) : null;
  if (set && model.max_images > images.length) {
    images.push(model.provider === "replicate" ? replicateSetImage(set, plan.place!, baseUrl) : set);
    refs.set = true;
  }
  const steer = await steeringFor(db, viewer, [c.id]).catch(() => NO_STEERING);
  const prompt = withSteering(shootPrompt(plan, subject, refs, identity.strength), steer, null);
  return runJob(db, viewer, access, {
    kind: "shoot",
    pictureKind: "scene",
    prompts: Array.from({ length: config.shoot_size }, () => ({ prompt, preset })),
    images,
    negative: [NEGATIVE_PROMPT, ...steer.negative].join(", "),
    model,
    tokens: opts.free ? 0 : input.own_key ? config.prices.own_key : config.prices.shoot[model.tier],
    choices: { ...input.choices, level: plan.level },
    place: plan.place,
    redoOf: opts.redoOf ?? null,
    ownKey: input.own_key === true,
  });
}

/* -------------------------------------------------- restyle -------------------------------------------------- */

/** A restyle's changes: a pick per look step or detail (LOOK_STEPS, LOOK_DETAILS), "none" taking a detail away. */
export type RestyleChanges = Partial<Record<RestyleKey, string>>;
export const RESTYLE_STEPS = ["hair_style", "hair_color", "eyes", "body", "breasts", "butt", "facial_hair"] as const;
export const RESTYLE_DETAILS = ["skin_tone", "marks", "makeup", "glasses", "piercings", "tattoos", "body_hair", "grooming"] as const;
export type RestyleKey = (typeof RESTYLE_STEPS)[number] | (typeof RESTYLE_DETAILS)[number];
/** What "none" says for a detail it can take away. */
const NONE_WORDS: Partial<Record<RestyleKey, string>> = {
  marks: "no freckles or beauty marks",
  makeup: "no makeup",
  glasses: "no glasses",
  piercings: "no piercings",
  tattoos: "no tattoos",
};

/** The restyle menu for a gender (null: only what doesn't depend on it). */
export function restyleMenu(gender: Gender | null): { id: RestyleKey; title: string; options: { id: string; label: string }[] }[] {
  const out: { id: RestyleKey; title: string; options: { id: string; label: string }[] }[] = [];
  for (const id of RESTYLE_STEPS) {
    const step = LOOK_STEPS.find((s) => s.id === id);
    if (!step) continue;
    if (!gender && (step.only || id === "hair_style" || id === "body")) continue;
    if (gender && step.only && step.only !== gender) continue;
    const opts = optionsFor(step, gender ?? "woman", true);
    out.push({ id, title: step.title.replace(/^Choose (an? )?/, "").replace(/^./, (x) => x.toUpperCase()), options: opts.map((x) => ({ id: x.id, label: gender === "man" && x.labelMan ? x.labelMan : x.label })) });
  }
  for (const id of RESTYLE_DETAILS) {
    const d = LOOK_DETAILS.find((x) => x.id === id);
    if (!d || (d.only && d.only !== gender)) continue;
    out.push({ id, title: d.title, options: [...d.options.map((x) => ({ id: x.id, label: x.label })), ...(NONE_WORDS[id] ? [{ id: "none", label: "None" }] : [])] });
  }
  return out;
}

/**
 * Their look now, as the restyle menu's picks: what they were made with (extras.looks), so the menu starts there and a
 * restyle sends only what's moved. After Dark's private picks (butt, grooming) only for their owner. A pick that isn't
 * on the menu for this gender is left out.
 */
export function restyleCurrent(looks: Looks | undefined, gender: Gender | null, owner: boolean): RestyleChanges {
  if (!looks) return {};
  const menu = restyleMenu(gender);
  const out: RestyleChanges = {};
  for (const g of menu) {
    const v = g.id === "butt" || g.id === "grooming" ? (owner ? looks.after_dark?.[g.id] : undefined) : looks[g.id];
    if (typeof v === "string" && g.options.some((x) => x.id === v)) out[g.id] = v;
  }
  return out;
}

/**
 * The example pictures the menus can show (David, 2026-10-24: "presets with pictures, like they do"): the looks
 * builder's own tiles for the restyle steps (After Dark's explicit one where there is one), by `restyle.<group>.<option>`,
 * and the Studio's own for the shoot's menus, by `shoot.<group>.<option>`.
 * Only tiles already drawn; a chip without one stays a word. None for "anyone" (no gender to draw).
 */
export async function menuTiles(db: Db, gender: Gender | null): Promise<Record<string, string>> {
  if (!gender) return {};
  const ready = new Set([...(await readyTiles(db, "pg").catch(() => [])), ...(await readyTiles(db, "nsfw").catch(() => []))]);
  const out: Record<string, string> = {};
  // The shoot's own (lib/adult/studio-tiles.ts), by `shoot.<group>.<option>`.
  for (const g of STUDIO_GROUPS) {
    if (!TILE_GROUPS.includes(g.id)) continue;
    for (const o of g.options) {
      const id = studioTileId(gender, g.id, o.id);
      if (ready.has(id)) out[`shoot.${g.id}.${o.id}`] = id;
    }
  }
  for (const g of restyleMenu(gender)) {
    if (!(RESTYLE_STEPS as readonly string[]).includes(g.id)) continue;
    for (const o of g.options) {
      const id = [tileId(gender, g.id as (typeof RESTYLE_STEPS)[number], o.id, true), tileId(gender, g.id as (typeof RESTYLE_STEPS)[number], o.id, false)].find((x) => ready.has(x));
      if (id) out[`restyle.${g.id}.${o.id}`] = id;
    }
  }
  return out;
}

/** A restyle's changes as words, or why not (an unknown pick). */
export function restyleWords(gender: Gender | null, changes: RestyleChanges): { ok: true; words: string[] } | { ok: false; message: string } {
  const g: Gender = gender ?? "woman";
  const words: string[] = [];
  const hairStyle = changes.hair_style;
  const hairColor = changes.hair_color;
  if (hairStyle || hairColor) {
    const step = (id: "hair_style" | "hair_color") => LOOK_STEPS.find((s) => s.id === id)!;
    if (hairStyle && !optionsFor(step("hair_style"), g).some((x) => x.id === hairStyle)) return { ok: false, message: "That hair style isn't on the menu." };
    if (hairColor && !optionsFor(step("hair_color"), g).some((x) => x.id === hairColor)) return { ok: false, message: "That hair colour isn't on the menu." };
    words.push(hairWords(g, hairStyle, hairColor) || "");
  }
  for (const id of RESTYLE_STEPS) {
    if (id === "hair_style" || id === "hair_color" || !changes[id]) continue;
    const step = LOOK_STEPS.find((s) => s.id === id)!;
    const opt = optionsFor(step, g, true).find((x) => x.id === changes[id]);
    if (!opt || (step.only && gender && step.only !== gender)) return { ok: false, message: `That ${step.title.toLowerCase()} pick isn't on the menu.` };
    words.push(optionPrompt(opt, g));
  }
  for (const id of RESTYLE_DETAILS) {
    const v = changes[id];
    if (!v) continue;
    if (v === "none" && NONE_WORDS[id]) {
      words.push(NONE_WORDS[id]!);
      continue;
    }
    const d = LOOK_DETAILS.find((x) => x.id === id)!;
    const opt = d.options.find((x) => x.id === v);
    if (!opt || (d.only && gender && d.only !== gender)) return { ok: false, message: `That ${d.title.toLowerCase()} pick isn't on the menu.` };
    words.push(opt.prompt);
  }
  const kept = words.filter(Boolean);
  return kept.length ? { ok: true, words: kept } : { ok: false, message: "Pick at least one thing to change." };
}

export async function restyle(db: Db, viewer: string, characterId: string, input: { changes: RestyleChanges; model?: string | null; own_key?: boolean }, baseUrl: string): Promise<JobResult> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config } = access;
  const model = studioModel(config, "edit", input.model);
  if (!model) return fail(422, "unknown_model", "Pick one of the Studio's edit models.");
  const w = restyleWords(access.gender, input.changes ?? {});
  if (!w.ok) return fail(422, "unknown_option", w.message);
  if (!wordsOk(w.words.join(" "))) return fail(422, "not_allowed", "That change crosses one of the lines After Dark never crosses.");
  const face = await faceLink(db, viewer, c, baseUrl);
  if (typeof face !== "string") return face;
  const subject = subjectOf(c, viewer, false);
  // Candidates in each preset's light in turn, like "Draw three": the framing stays a baseline's, so the face is compared.
  const prompts = Array.from({ length: config.restyle_candidates }, (_, i) => {
    const p = PICTURE_PRESETS[i % PICTURE_PRESETS.length];
    return { prompt: restylePrompt(subject, w.words, p.light), preset: p.id };
  });
  return runJob(db, viewer, access, {
    kind: "restyle", pictureKind: "baseline", prompts, images: [face], negative: NEGATIVE_PROMPT, model, tokens: input.own_key ? config.prices.own_key : config.prices.restyle,
    choices: { changes: input.changes }, place: null, ownKey: input.own_key === true,
  });
}

/**
 * "Save to their look": the restyle's picks written to the character's looks (extras.looks), so their appearance line
 * and every later picture say the same. Their own characters only, never a house character's. The appearance line is
 * rewritten only when it was the looks builder's own (or empty), never a line they wrote.
 */
export async function saveRestyleLooks(db: Db, viewer: string, characterId: string, changes: RestyleChanges): Promise<{ ok: true; appearance: string | null } | StudioFail> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const c = access.character;
  if (c.house || c.ownerId !== viewer) return fail(403, "not_yours", "Only your own characters' looks can be saved.");
  const w = restyleWords(access.gender, changes);
  if (!w.ok) return fail(422, "unknown_option", w.message);
  const before: Looks = { ...(c.extras?.looks ?? {}) };
  const next: Looks = { ...before, gender: before.gender ?? access.gender ?? undefined };
  const ad = { ...(before.after_dark ?? {}) };
  for (const [k, v] of Object.entries(changes) as [RestyleKey, string][]) {
    if (!v) continue;
    if (k === "butt") ad.butt = v as typeof ad.butt;
    else if (k === "grooming") ad.grooming = v as typeof ad.grooming;
    else if (v === "none") delete (next as Record<string, unknown>)[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(ad).length) next.after_dark = ad;
  const looks = normaliseLooks(next);
  const oldLine = looksAppearance(before);
  const newLine = looksAppearance(looks) || null;
  const keepLine = c.look.appearance && c.look.appearance !== oldLine;
  const set = `extras = jsonb_set(coalesce(extras, '{}'::jsonb), '{looks}', $2::jsonb, true)`;
  if (keepLine) await db.query(`update characters set ${set} where id = $1 and owner_id = $3`, [c.id, JSON.stringify(looks ?? {}), viewer]);
  else await db.query(`update characters set ${set}, appearance = $3 where id = $1 and owner_id = $4`, [c.id, JSON.stringify(looks ?? {}), newLine, viewer]);
  return { ok: true, appearance: keepLine ? c.look.appearance : newLine };
}

/* -------------------------------------------------- recast -------------------------------------------------- */

export async function recast(db: Db, viewer: string, characterId: string, input: { model?: string | null; own_key?: boolean }): Promise<JobResult> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config } = access;
  const model = studioModel(config, "new", input.model);
  if (!model) return fail(422, "unknown_model", "Pick one of the Studio's new-picture models.");
  const steer = await steeringFor(db, viewer, [c.id]).catch(() => NO_STEERING);
  const prompts = Array.from({ length: config.recast_candidates }, (_, i) => {
    const p = PICTURE_PRESETS[i % PICTURE_PRESETS.length];
    return { prompt: withSteering(baselinePrompt(c, viewer, p.light), steer, null), preset: p.id };
  });
  return runJob(db, viewer, access, {
    kind: "recast", pictureKind: "baseline", prompts, images: [], negative: [NEGATIVE_PROMPT, ...steer.negative].join(", "), model,
    tokens: input.own_key ? config.prices.own_key : config.prices.recast, choices: {}, place: null, ownKey: input.own_key === true,
  });
}

/* ----------------------------------------------- body reference ----------------------------------------------- */

export async function bodyShoot(db: Db, viewer: string, characterId: string, input: { nude?: boolean; model?: string | null; own_key?: boolean }, baseUrl: string): Promise<JobResult> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config } = access;
  const model = studioModel(config, "edit", input.model);
  if (!model) return fail(422, "unknown_model", "Pick one of the Studio's edit models.");
  const nude = input.nude === true;
  const identity = await identityOf(db, viewer, c.id);
  if (nude && shootLimits(identity, config).maxLevel < 2) return fail(422, "locked", "Nude is past their studio limit.");
  const face = await faceLink(db, viewer, c, baseUrl);
  if (typeof face !== "string") return face;
  const prompt = bodyPrompt(subjectOf(c, viewer, nude), nude);
  if (!wordsOk(subjectOf(c, viewer, nude).look)) return fail(422, "not_allowed", "Their look crosses one of the lines After Dark never crosses.");
  return runJob(db, viewer, access, {
    kind: "body", pictureKind: "scene", prompts: Array.from({ length: config.body_candidates }, () => ({ prompt, preset: null })), images: [face], negative: NEGATIVE_PROMPT,
    model, tokens: input.own_key ? config.prices.own_key : config.prices.body, choices: { nude }, place: null, ownKey: input.own_key === true,
  });
}

/** "Use as body reference": one of the viewer's pictures of the character alone; null takes it away. */
export async function setBodyReference(db: Db, viewer: string, characterId: string, imageId: string | null): Promise<{ ok: true; body: string | null } | StudioFail> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  if (imageId) {
    const m = (
      await db.query<{ id: string }>(
        `select id from adult_images where id = $1 and character_id = $2 and character_b is null and kind in ('scene', 'baseline') and status = 'ready'
            and (owner_id = $3 or exists (select 1 from admins a where a.user_id = $3))`,
        [imageId, characterId, viewer],
      )
    ).rows[0];
    if (!m) return fail(404, "not_found", "Pick one of your pictures of them alone.");
  }
  await upsertIdentity(db, viewer, characterId, "body_image_id", imageId);
  return { ok: true, body: imageId };
}

/** The studio's own limits for pictures of the character alone: intensity and hard nos. */
export async function setStudioLimits(db: Db, viewer: string, characterId: string, input: { intensity?: string; hard_nos?: string[] }): Promise<{ ok: true; identity: Identity } | StudioFail> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  if (input.intensity !== undefined) {
    if (!(INTENSITIES as readonly string[]).includes(input.intensity)) return fail(422, "invalid", "That intensity isn't one of the five.");
    await upsertIdentity(db, viewer, characterId, "intensity", input.intensity);
  }
  if (input.hard_nos !== undefined) await upsertIdentity(db, viewer, characterId, "hard_nos", [...new Set(input.hard_nos.filter((h) => HARD_NO_IDS.includes(h)))]);
  return { ok: true, identity: await identityOf(db, viewer, characterId) };
}

/** How strictly pictures keep the face (v3): loose, balanced or strict. */
export async function setStrength(db: Db, viewer: string, characterId: string, strength: string): Promise<{ ok: true; identity: Identity } | StudioFail> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  if (!(STRENGTHS as readonly string[]).includes(strength)) return fail(422, "invalid", "Loose, balanced or strict.");
  await upsertIdentity(db, viewer, characterId, "strength", strength);
  return { ok: true, identity: await identityOf(db, viewer, characterId) };
}

/* ------------------------------------------------- a pair shoot ------------------------------------------------- */

const KISSING = STAGES.indexOf("kissing");
const UNDRESSING = STAGES.indexOf("undressing");
const LAST_STAGE = STAGES.length - 1;
/** How far a pair shoot may go at each of the Studio's levels (`max_level`): dressed to kissing, suggestive to undressing. */
const STAGE_FOR_LEVEL: Record<Level, number> = { 0: KISSING, 1: UNDRESSING, 2: LAST_STAGE, 3: LAST_STAGE };

/**
 * A pair shoot's limits: the pair's own (their intensity and hard nos, set on the pair page) within the Studio's highest
 * level, explicit only at its top. Never how far their night has gone: a shoot is staged (the pair page's menu is the night).
 */
async function pairLimits(db: Db, viewer: string, pair: [string, string], config: StudioConfig): Promise<MediaLimits> {
  const own = await mediaLimits(db, viewer, ...pair);
  const level = config.max_level as Level;
  return { ...own, maxStage: Math.min(own.maxStage, STAGE_FOR_LEVEL[level]), explicit: own.explicit && level >= 3 };
}

/** Where a pair shoot can be: the places their night has been (with its drawn set), then the Studio's own. */
async function pairPlaces(db: Db, viewer: string, pair: [string, string]): Promise<{ id: string; label: string; place: string; public: boolean }[]> {
  const night = await reelNight(db, viewer, ...pair).catch(() => null);
  const theirs = night ? picturePlaces(night.where).map((p, i) => ({ id: `night:${i}`, label: `${p.place} (theirs)`, place: p.place, public: p.public })) : [];
  return [...theirs, ...groupById("place").options.map((o) => ({ id: o.id, label: o.label, place: o.words, public: Boolean(o.public) }))];
}

/** Who can be in a pair shoot with the character: everyone else in the viewer's After Dark. */
async function pairPartners(db: Db, viewer: string, characterId: string): Promise<{ id: string; name: string }[]> {
  const ids = [...(await eligibleIds(db, viewer))].filter((id) => id !== characterId);
  if (!ids.length) return [];
  return (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1) order by name`, [ids])).rows;
}

async function pairOf(db: Db, viewer: string, characterId: string, partnerId: string): Promise<{ pair: [string, string]; cast: ReturnType<typeof reelCast>; people: [Character, Character] } | null> {
  const pair = await eligiblePair(db, viewer, characterId, partnerId);
  if (!pair) return null;
  const [ca, cb] = await Promise.all([loadCharacter(db, pair[0]), loadCharacter(db, pair[1])]);
  return ca && cb ? { pair, cast: reelCast(ca, cb, viewer), people: [ca, cb] } : null;
}

/** A pair shoot's menu for one partner: the acts and outfits the limits allow, the framings, places and lights, the price. */
export type PairMenu = {
  partner: { id: string; name: string };
  acts: (MenuAct & { outfits: readonly string[] })[];
  outfits: { id: string; label: string; private: boolean }[];
  framings: { id: Framing; label: string }[];
  places: { id: string; label: string; public: boolean }[];
  lights: { id: string; label: string }[];
  price: StudioConfig["prices"]["pair"];
};

export async function pairMenu(db: Db, viewer: string, characterId: string, partnerId: string): Promise<{ ok: true; menu: PairMenu } | StudioFail> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const p = await pairOf(db, viewer, characterId, partnerId);
  if (!p) return fail(404, "not_found", "Pick someone in their After Dark.");
  const limits = await pairLimits(db, viewer, p.pair, access.config);
  const outfitOk = (o: (typeof OUTFITS)[number]) => o.minStage <= limits.maxStage && limits.hit(o.words) === null;
  const partner = p.people.find((x) => x.id !== characterId)!;
  return {
    ok: true,
    menu: {
      partner: { id: partner.id, name: partner.name },
      acts: actMenu({ stage: limits.maxStage, publicPlace: false }, p.cast, [p.people[0].name, p.people[1].name], limits).map((a) => ({
        ...a,
        outfits: actById(a.id)!.outfits.filter((id) => OUTFITS.some((o) => o.id === id && outfitOk(o))),
      })),
      outfits: OUTFITS.filter(outfitOk).map((o) => ({ id: o.id, label: o.label, private: o.dress >= UNDRESSING })),
      framings: FRAMINGS.map((id) => ({ id, label: FRAMING_LABEL[id] })),
      places: (await pairPlaces(db, viewer, p.pair)).map(({ id, label, public: pub }) => ({ id, label, public: pub })),
      lights: groupById("light").options.map((o) => ({ id: o.id, label: o.label })),
      price: access.config.prices.pair,
    },
  };
}

/** What a pair shoot asks for: the partner, the act (who leads swapped, or not), what they wear, the framing, place and light. */
export type PairInput = {
  partner: string;
  act: string;
  swap?: boolean;
  outfit: string;
  framing: Framing;
  place: string;
  light?: string | null;
  model?: string | null;
  own_key?: boolean;
  custom?: string;
  dialog?: string;
  /** Shot like one of the pair's pictures (David, 2026-10-25: their dates' media "to shoot with"): its pose, framing and place, as Picture 3. */
  reference?: string;
};

/**
 * A pair shoot: `shoot_size` pictures of the two of them, from their two faces (the nude ones from sex on, as the night's
 * pictures do) and the place's drawn set, planned by the picture menu's rules (lib/adult/pictures-menu.ts planPicture).
 */
export async function pairShoot(db: Db, viewer: string, characterId: string, input: PairInput, baseUrl: string): Promise<JobResult> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { config } = access;
  const model = studioModel(config, "edit", input.model);
  if (!model) return fail(422, "unknown_model", "Pick one of the Studio's edit models.");
  if (model.max_images < 2) return fail(422, "wrong_model", `${model.label} takes one picture, and a picture of two needs both faces.`);
  const p = await pairOf(db, viewer, characterId, input.partner);
  if (!p) return fail(404, "not_found", "Pick someone in their After Dark.");
  const limits = await pairLimits(db, viewer, p.pair, config);
  const places = await pairPlaces(db, viewer, p.pair);
  const where = places.find((x) => x.id === input.place);
  if (!where) return fail(422, "unknown_place", "Pick one of the places.");
  const light = input.light ? optionById("light", input.light) : null;
  if (input.light && !light) return fail(422, "unknown_option", "That light isn't on the menu.");
  const planned = planPicture(
    { act: input.act, swap: input.swap === true, outfit: input.outfit, framing: input.framing, place: where.place },
    // The owner's own words lead the picture too (David, 2026-10-24: the Together tab needs the Shoot tab's control); held to the lines by planPicture's own check.
    { cast: p.cast, stage: limits.maxStage, places: places.map((x) => ({ place: x.place, now: false, public: x.public, home: null })), limits, light: light?.words, custom: cleanCustom(input.custom, CUSTOM_MAX), dialog: cleanCustom(input.dialog, DIALOG_MAX), reference: Boolean(input.reference) },
  );
  if (!planned.ok) return fail(planned.status, planned.error, planned.message);
  // A picture to shoot like: one of the owner's of these two (together, or one of them alone), ready, a still.
  if (input.reference) {
    if (model.max_images < 3) return fail(422, "wrong_model", `${model.label} takes two pictures: pick a model that takes a third to shoot like one.`);
    const ok = (
      await db.query(
        `select 1 from adult_images where id = $1 and owner_id = $2 and status = 'ready' and mime like 'image/%' and kind in ('scene', 'baseline')
            and character_id in ($3, $4) and (character_b is null or character_b in ($3, $4))`,
        [input.reference, viewer, characterId, input.partner],
      )
    ).rows.length;
    if (!ok) return fail(404, "not_found", "That picture isn't one of these two's.");
  }
  const { plan } = planned;
  const [ca, cb] = p.people;
  let bases: [string, string] | null;
  try {
    for (const x of p.people) await ensureBaseline(db, viewer, x);
    // From sex on, their nude faces: an edit keeps what the pictures it starts from wear (lib/adult/attire.ts).
    bases = (plan.stage >= NUDE_FROM ? await nudeBaselines(db, viewer, ca, cb) : null) ?? (await baselines(db, ca.id, cb.id, viewer));
  } catch (err) {
    return fail(err instanceof HivePausedError ? 503 : 502, "no_face", `A first picture of each of them couldn't be made (${err instanceof Error ? err.message.slice(0, 160) : "error"}).`);
  }
  if (!bases) return fail(409, "no_face", "A picture of each of them is needed first.");
  const images = bases.map((id) => signedMediaUrl(id, baseUrl));
  // Picture 3 is the picture to shoot like, when there is one; otherwise the place's drawn set.
  const set = input.reference ? null : ((await setPictures(db, [plan.place])).get(plan.place) ?? null);
  const withSet = Boolean(set) && model.max_images >= 3;
  if (set && withSet) images.push(model.provider === "replicate" ? replicateSetImage(set, plan.place, baseUrl) : set);
  if (input.reference) images.push(signedMediaUrl(input.reference, baseUrl));
  const prompt = plan.promptFor(withSet);
  const preset = PICTURE_PRESETS.find((x) => x.id === input.light)?.id ?? null;
  return runJob(db, viewer, access, {
    kind: "pair",
    pictureKind: "scene",
    prompts: Array.from({ length: config.shoot_size }, () => ({ prompt, preset })),
    images,
    negative: NEGATIVE_PROMPT,
    model,
    tokens: input.own_key ? config.prices.own_key : config.prices.pair[model.tier],
    choices: { partner: input.partner, act: input.act, swap: input.swap === true, outfit: input.outfit, framing: input.framing, place: input.place, light: input.light ?? null, stage: plan.stage, ...(input.reference ? { reference: input.reference } : {}) },
    place: plan.place,
    partner: input.partner,
    ownKey: input.own_key === true,
  });
}

/* ------------------------------------------- more like this, upscale ------------------------------------------- */

type Solo = { id: string; kind: string; preset: PresetId | null; place: string | null; mime: string; level: Level; data: Buffer | Uint8Array | null; object_key: string | null };

/**
 * One of the viewer's ready pictures of the character alone, with its level: the Studio shoot's it came from, or (from
 * anywhere else) nude for a nude baseline or a nude body reference, else dressed.
 */
async function soloPicture(db: Db, viewer: string, characterId: string, imageId: string): Promise<Solo | null> {
  const r = (
    await db.query<Omit<Solo, "level"> & { shoot_level: number | null; nude: boolean }>(
      `select i.id, i.kind, i.preset, i.scene_place as place, i.mime, ${dataColumn("i")}, i.object_key,
              (select (s.choices->>'level')::int from adult_studio_shoots s where s.id = i.shoot_id and s.kind in ('shoot', 'variations', 'upscale')) as shoot_level,
              ((i.kind = 'baseline' and ${nudeSql("i")})
                or exists (select 1 from adult_studio_shoots s where s.id = i.shoot_id and s.kind = 'body' and (s.choices->>'nude')::boolean)) as nude
         from adult_images i
        where i.id = $1 and i.character_id = $2 and i.character_b is null and i.kind in ('scene', 'baseline') and i.status = 'ready'
          and (i.owner_id = $3 or exists (select 1 from admins a where a.user_id = $3))`,
      [imageId, characterId, viewer],
    )
  ).rows[0];
  if (!r) return null;
  const { shoot_level, nude, ...rest } = r;
  const level = (shoot_level !== null && shoot_level >= 0 && shoot_level <= 3 ? shoot_level : nude ? 2 : 0) as Level;
  return { ...rest, preset: PICTURE_PRESETS.find((x) => x.id === r.preset)?.id ?? null, level };
}

/**
 * One of the viewer's ready pictures of the character WITH a partner (a pair shoot), with its level: so a pair shoot can
 * be animated too (David, 2026-10-24: "from an image in the shoot we can generate a video… in the pair shoot transcript
 * is important"). The clip keeps both of them.
 */
async function pairSource(db: Db, viewer: string, characterId: string, imageId: string): Promise<Solo | null> {
  const r = (
    await db.query<Omit<Solo, "level"> & { shoot_level: number | null }>(
      `select i.id, i.kind, i.preset, i.scene_place as place, i.mime, ${dataColumn("i")}, i.object_key,
              (select (s.choices->>'level')::int from adult_studio_shoots s where s.id = i.shoot_id and s.kind = 'pair') as shoot_level
         from adult_images i
        where i.id = $1 and (i.character_id = $2 or i.character_b = $2) and i.character_b is not null and i.kind = 'scene' and i.status = 'ready'
          and (i.owner_id = $3 or exists (select 1 from admins a where a.user_id = $3))`,
      [imageId, characterId, viewer],
    )
  ).rows[0];
  if (!r) return null;
  const { shoot_level, ...rest } = r;
  const level = (shoot_level !== null && shoot_level >= 0 && shoot_level <= 3 ? shoot_level : 2) as Level;
  return { ...rest, preset: PICTURE_PRESETS.find((x) => x.id === r.preset)?.id ?? null, level };
}

/** "More like this": `shoot_size` pictures like one of theirs of the character alone, after the face and body. */
export async function moreLikeThis(db: Db, viewer: string, characterId: string, input: { image_id: string; model?: string | null; own_key?: boolean }, baseUrl: string): Promise<JobResult> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config } = access;
  const model = studioModel(config, "edit", input.model);
  if (!model) return fail(422, "unknown_model", "Pick one of the Studio's edit models.");
  if (model.max_images < 2) return fail(422, "wrong_model", `${model.label} takes one picture: pick one that takes the face and the picture it's like.`);
  const src = await soloPicture(db, viewer, c.id, input.image_id);
  if (!src) return fail(404, "not_found", "Pick one of your pictures of them alone.");
  const identity = await identityOf(db, viewer, c.id);
  const { maxLevel } = shootLimits(identity, config);
  if (src.level > maxLevel) return fail(422, "locked", `That picture is past ${LEVEL_LABEL[maxLevel].toLowerCase()}: their studio limit.`);
  const face = await faceLink(db, viewer, c, baseUrl);
  if (typeof face !== "string") return face;
  const images = [face];
  const body = Boolean(identity.body) && identity.strength !== "loose" && identity.body !== src.id && model.max_images >= 3;
  if (body) images.push(signedMediaUrl(identity.body!, baseUrl));
  images.push(signedMediaUrl(src.id, baseUrl));
  const subject = subjectOf(c, viewer, src.level >= 2);
  const prompts = Array.from({ length: config.shoot_size }, (_, i) => ({ prompt: variationPrompt(subject, src.level, { body }, VARIATION_HINTS[i % VARIATION_HINTS.length], identity.strength), preset: src.preset }));
  return runJob(db, viewer, access, {
    kind: "variations",
    pictureKind: "scene",
    prompts,
    images,
    negative: NEGATIVE_PROMPT,
    model,
    tokens: input.own_key ? config.prices.own_key : config.prices.variations,
    choices: { source: src.id, level: src.level },
    place: src.place,
    ownKey: input.own_key === true,
  });
}

/** Upscale: one of their pictures of the character alone made larger on Venice's upscaler, checked and kept beside it. */
export async function upscalePicture(db: Db, viewer: string, characterId: string, input: { image_id: string; own_key?: boolean }): Promise<JobResult> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config } = access;
  const src = await soloPicture(db, viewer, c.id, input.image_id);
  if (!src) return fail(404, "not_found", "Pick one of your pictures of them alone.");
  const bytes = await readBytes(src);
  if (!bytes) return fail(404, "not_found", "That picture's file is missing.");
  const model: StudioModel = { id: "upscale", provider: "venice", job: "edit", tier: "standard", label: "Venice's upscaler", runner: "venice", max_images: 1, note: "", usd: config.upscale.usd };
  return runJob(db, viewer, access, {
    kind: "upscale",
    pictureKind: "scene",
    prompts: [{ prompt: `Picture ${src.id}, upscaled ${config.upscale.scale}x`, preset: src.preset }],
    images: [],
    negative: "",
    model,
    tokens: input.own_key ? config.prices.own_key : config.prices.upscale,
    choices: { source: src.id, level: src.level, scale: config.upscale.scale },
    place: src.place,
    ownKey: input.own_key === true,
    cap: "upscales",
    draw: (keys) => {
      if (!keys.venice) throw new Error("No Venice key for the upscaler.");
      return veniceUpscale(keys.venice, bytes, config.upscale.scale);
    },
  });
}

/* ------------------------------------------------- saved setups ------------------------------------------------- */

/** A shoot's choices saved under a name (v3), run again on any of the owner's characters. */
export type Setup = { id: string; name: string; kind: "shoot" | "pair"; choices: Record<string, unknown>; model: string | null; created_at: string };
const SETUPS_MAX = 30;

export async function listSetups(db: Db, viewer: string): Promise<Setup[]> {
  const { rows } = await db.query<Omit<Setup, "created_at"> & { created_at: string | Date }>(
    `select id, name, kind, choices, model, created_at from adult_studio_setups where owner_id = $1 order by name limit ${SETUPS_MAX}`,
    [viewer],
  );
  return rows.map((r) => ({ ...r, choices: r.choices ?? {}, created_at: new Date(r.created_at).toISOString() }));
}

/**
 * Saves (or replaces, by name) a setup. A place of one character's own (their nights' places) isn't kept: it's theirs,
 * and the setup runs on any of the owner's characters. The choices are checked again when it runs.
 */
export async function saveSetup(
  db: Db,
  viewer: string,
  characterId: string,
  input: { name: string; kind: "shoot" | "pair"; choices: Record<string, unknown>; model?: string | null },
): Promise<{ ok: true; setup: Setup } | StudioFail> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 40) return fail(422, "invalid", "A name of up to 40 characters.");
  if (!checkAdultText({ name }).ok || crossesTaboo(name)) return fail(422, "not_allowed", "Pick another name.");
  const choices: Record<string, unknown> = { ...input.choices };
  if (typeof choices.place === "string" && /^(own|night):/.test(choices.place)) delete choices.place;
  delete choices.partner;
  const model = input.model && access.config.models.some((m) => m.id === input.model) ? input.model : null;
  const n = (await db.query<{ n: number; mine: boolean }>(`select count(*)::int as n, bool_or(name = $2) as mine from adult_studio_setups where owner_id = $1`, [viewer, name])).rows[0];
  if (n && n.n >= SETUPS_MAX && !n.mine) return fail(409, "too_many", `Up to ${SETUPS_MAX} setups: delete one first.`);
  const row = (
    await db.query<Omit<Setup, "created_at"> & { created_at: string | Date }>(
      `insert into adult_studio_setups (id, owner_id, name, kind, choices, model) values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (owner_id, name) do update set kind = excluded.kind, choices = excluded.choices, model = excluded.model, updated_at = now()
       returning id, name, kind, choices, model, created_at`,
      [crypto.randomUUID(), viewer, name, input.kind, JSON.stringify(choices), model],
    )
  ).rows[0];
  return { ok: true, setup: { ...row, created_at: new Date(row.created_at).toISOString() } };
}

export async function deleteSetup(db: Db, viewer: string, id: string): Promise<boolean> {
  return (await db.query(`delete from adult_studio_setups where id = $1 and owner_id = $2 returning id`, [id, viewer])).rows.length > 0;
}

/* ---------------------------------------------------- animate ---------------------------------------------------- */

/** On a Studio clip of one: away from anyone young-looking, and from what breaks a shot of one (a second person, a cut). */
const ANIMATE_NEGATIVE =
  "child, teen, minor, young-looking, cartoon, anime, distorted face, extra limbs, text, watermark, " +
  "a second person, extra people, a duplicate person, scene cut, scene change, morphing face";
/** On a clip of a pair: the same, but the second person is wanted — only a third, or a duplicate, is kept out. */
const ANIMATE_NEGATIVE_PAIR =
  "child, teen, minor, young-looking, cartoon, anime, distorted face, extra limbs, text, watermark, " +
  "a third person, extra people, a duplicate person, the two merging into one, scene cut, scene change, morphing face";
/** An animation not back after this long is given up, and its tokens come back. */
const ANIMATE_GIVE_UP_MS = 60 * 60 * 1000;

const animatingNow = async (db: Db, viewer: string): Promise<boolean> =>
  (
    await db.query(
      `select 1 from adult_studio_shoots where owner_id = $1 and kind = 'animate' and status = 'making' and created_at > now() - ($2::int * interval '1 millisecond') limit 1`,
      [viewer, ANIMATE_GIVE_UP_MS],
    )
  ).rows.length > 0;

export type AnimateInput = { image_id: string; motion?: string; seconds: number } & AnimateGuide;

/**
 * Animate (v3): one of their pictures of the character alone becomes a clip on After Dark's video model (Wan 3.0 on
 * Venice), 5 or 10 seconds. The motion is a chip, the owner's own `guide` (David, 2026-10-24: "guide it again if it
 * messed up"), or both; `dialog` is what they say, `transcript` the lines around the moment, for the mood. Queued now and
 * collected as the page polls (collectAnimations): the video is checked by Hive before it's kept, like every clip. One
 * video at a time; the month's clips cap; the price `animate_5` or `animate_10`, given back when it doesn't come through.
 */
export async function animatePicture(db: Db, viewer: string, characterId: string, input: AnimateInput, baseUrl: string): Promise<JobResult> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config, admin } = access;
  const motion = input.motion ? ANIMATE_MOTIONS.find((m) => m.id === input.motion) : undefined;
  if (input.motion && (!motion || config.disabled_options.includes(`motion.${motion.id}`))) return fail(422, "unknown_option", "Pick one of the motions.");
  const guide: AnimateGuide = { guide: input.guide, dialog: input.dialog, transcript: input.transcript };
  if (!motion && !(guide.guide ?? "").trim()) return fail(422, "no_motion", "Pick a motion or type what should happen.");
  // The owner's own words for the clip are held to the lines, like a shoot's.
  if (!wordsOk([guide.guide, guide.dialog, guide.transcript].filter(Boolean).join(" "))) return fail(422, "not_allowed", "That crosses one of the lines After Dark never crosses.");
  if (!(ANIMATE_SECONDS as readonly number[]).includes(input.seconds)) return fail(422, "invalid", "5 or 10 seconds.");
  const seconds = input.seconds as AnimateSeconds;
  // A picture of them alone, or (a pair shoot) of the two of them: the clip keeps whoever is in it.
  const solo = await soloPicture(db, viewer, c.id, input.image_id);
  const src = solo ?? (await pairSource(db, viewer, c.id, input.image_id));
  if (!src) return fail(404, "not_found", "Pick one of your pictures of them.");
  const pair = !solo;
  const { maxLevel } = shootLimits(await identityOf(db, viewer, c.id), config);
  if (src.level > maxLevel) return fail(422, "locked", `That picture is past ${LEVEL_LABEL[maxLevel].toLowerCase()}: their studio limit.`);
  const keys = await adultKeys(db);
  if (!keys.venice) return fail(409, "not_set_up", "Animating needs the Venice key in After Dark's settings.");
  // A video is checked by Hive alone (the alternatives read stills): none starts while it's out.
  const gate = await mediaGate(db, { video: true });
  if (!gate.ok) return fail(503, "hive_paused", gate.message);
  // One video at a time (an animation, a clip or a night's reel): Hive rate-limits a burst.
  if (await animatingNow(db, viewer)) return fail(409, "busy", "One is already being animated: it takes a few minutes.");
  const busy = await busyReel(db, viewer);
  if (busy) return fail(409, "busy", busyMessage(busy));
  const capped = await overCap(db, viewer, "clips");
  if (capped) return fail(429, "over_cap", capped);
  const tokens = seconds === 10 ? config.prices.animate_10 : config.prices.animate_5;
  const pays = tokens > 0 && !admin;
  if (pays && !(await spendBoughtTokens(db, viewer, tokens))) return fail(402, "needs_tokens", `That costs ${tokens} token${tokens === 1 ? "" : "s"}. Get more on the shop page.`);
  const model = config.animate.model ?? (await getAdultSettings(db)).reel_model;
  let queueId: string;
  let sent: LoggedRequest[] = [];
  try {
    const prompt = animatePrompt(subjectOf(c, viewer, src.level >= 2), src.level, motion?.words ?? "", guide, { pair });
    // What it sent rides on the shoot until the clip is kept (lib/adult/request-log.ts).
    ({ value: queueId, requests: sent } = await withRequestLog(() =>
      queueVideo(keys.venice!, { model, seconds, image_url: signedMediaUrl(src.id, baseUrl), prompt, negative: pair ? ANIMATE_NEGATIVE_PAIR : ANIMATE_NEGATIVE }),
    ));
  } catch (err) {
    if (pays) await refundBoughtTokens(db, viewer, tokens);
    return fail(502, "not_made", `It couldn't be animated (${err instanceof Error ? err.message.slice(0, 160) : "error"}).${pays ? " Your tokens are back." : ""}`);
  }
  const row = (
    await db.query<Parameters<typeof shootRow>[0]>(
      `insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, model, provider, tokens, asked, status)
       values ($1, $2, $3, 'animate', $4::jsonb, $5, 'venice', $6, 1, 'making')
       returning id, kind, status, model, provider, tokens, asked, made, pictures, redo_of, error, created_at`,
      [crypto.randomUUID(), viewer, c.id, JSON.stringify({ source: src.id, motion: motion?.id ?? null, seconds, queue_id: queueId, level: src.level, ...(guide.guide ? { guide: guide.guide } : {}), ...(guide.dialog ? { dialog: guide.dialog } : {}), ...(guide.transcript ? { transcript: guide.transcript } : {}), request: sent }), model, pays ? tokens : 0],
    )
  ).rows[0];
  return { ok: true, shoot: shootRow(row), pictures: [], refunded: false, message: `Animating: it takes a few minutes, and lands in the gallery.` };
}

/**
 * The viewer's animations still being made, collected (the page asks as it polls, a few at a time): a finished video
 * is checked by Hive and kept in the character's gallery, or discarded and logged; one not back in time is given up.
 * Anything not kept gives its tokens back. While Hive is out for the day they wait at Venice, unchecked.
 */
export async function collectAnimations(db: Db, viewer: string): Promise<void> {
  const { rows } = await db.query<{ id: string; character_id: string; model: string; tokens: number; choices: { source: string; motion: string | null; queue_id: string; guide?: string; request?: LoggedRequest[] }; created_at: string | Date }>(
    `select id, character_id, model, tokens, choices, created_at from adult_studio_shoots where owner_id = $1 and kind = 'animate' and status = 'making' order by created_at limit 3`,
    [viewer],
  );
  if (!rows.length) return;
  /** It didn't come through: failed, and its tokens back (only by the poll that settled it, so never twice). */
  const failed = async (r: (typeof rows)[number], error: string) => {
    const done = await db.query(`update adult_studio_shoots set status = 'failed', error = $2, tokens = 0, updated_at = now() where id = $1 and status = 'making' returning id`, [r.id, error.slice(0, 200)]);
    if (done.rows.length && r.tokens > 0) await refundBoughtTokens(db, viewer, r.tokens);
  };
  const keys = await adultKeys(db);
  if (await hivePausedUntil(db)) return;
  for (const r of rows) {
    if (Date.now() - new Date(r.created_at).getTime() > ANIMATE_GIVE_UP_MS) {
      await failed(r, "gave up waiting");
      continue;
    }
    if (!keys.venice) continue;
    const got = await retrieveVideo(keys.venice, r.model, r.choices.queue_id);
    if (got.state === "making") continue;
    if (got.state === "failed") {
      await failed(r, got.reason);
      continue;
    }
    const verdict = await checkMedia(db, { base64: got.bytes.toString("base64"), mime: "video/mp4" }, "video");
    // The check couldn't run: asked again on the next poll, and nothing more goes to Hive this one.
    if (!verdict.ok && verdict.reason.startsWith("the check couldn't run")) break;
    if (!verdict.ok) {
      await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'studio', $3)`, [crypto.randomUUID(), viewer, `studio animate: ${verdict.reason}`.slice(0, 300)]).catch(() => {});
      await failed(r, `the check discarded it (${verdict.reason.slice(0, 120)})`);
      await releaseVideo(keys.venice, r.model, r.choices.queue_id);
      continue;
    }
    // Claimed first: two polls at once never keep it twice.
    const vid = crypto.randomUUID();
    const claimed = await db.query(
      `update adult_studio_shoots set status = 'ready', made = 1, pictures = $2::jsonb, error = null, updated_at = now() where id = $1 and status = 'making' returning id`,
      [r.id, JSON.stringify([vid])],
    );
    if (!claimed.rows.length) continue;
    const kept = await keepBytes("after-dark", vid, got.bytes, "video/mp4");
    await db.query(
      `insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, object_key, status, source_image, provider, fell_back, model, shoot_id, request)
       values ($1, $2, $3, 'video', $4, 'video/mp4', $5, $6, 'ready', $7, 'venice', false, $8, $9, $10::jsonb)`,
      [vid, viewer, r.character_id, `Studio clip: ${r.choices.motion ?? (r.choices.guide ? "your direction" : "clip")}`, kept.data, kept.object_key, r.choices.source, r.model, r.id, requestJson(r.choices.request)],
    );
    await countUse(db, viewer, "clips");
    await releaseVideo(keys.venice, r.model, r.choices.queue_id);
  }
}

/* ----------------------------------------------------- redo ----------------------------------------------------- */

/** Whether a shoot can be redone free: the setting on, a shoot (not a restyle), every picture 👎'd by its owner, not redone. */
async function redoable(db: Db, viewer: string, s: Shoot, config: StudioConfig): Promise<boolean> {
  if (!config.free_redo || s.kind !== "shoot" || s.redo_of || !s.pictures.length) return false;
  const { rows } = await db.query<{ n: number; down: number; redone: boolean }>(
    `select count(*)::int as n, count(*) filter (where t.rating < 0)::int as down,
            exists (select 1 from adult_studio_shoots r where r.redo_of = $3) as redone
       from adult_images i left join adult_media_thumbs t on t.media_id = i.id and t.owner_id = $2
      where i.id = any($1)`,
    [s.pictures, viewer, s.id],
  );
  const r = rows[0];
  return Boolean(r && !r.redone && r.n === s.pictures.length && r.down === r.n);
}

/** The free redo: the same choices and model, no tokens, steered by what the 👎s said was off. */
export async function redoShoot(db: Db, viewer: string, shootId: string, baseUrl: string): Promise<JobResult> {
  const r = (
    await db.query<Parameters<typeof shootRow>[0] & { character_id: string; choices: ShootChoices & { level?: number }; own_key: boolean }>(
      `select id, kind, status, model, provider, tokens, asked, made, pictures, redo_of, error, created_at, character_id, choices, own_key from adult_studio_shoots where id = $1 and owner_id = $2`,
      [shootId, viewer],
    )
  ).rows[0];
  if (!r) return fail(404, "not_found", "No shoot of yours with that id.");
  const access = await studioAccess(db, viewer, r.character_id);
  if (!access.ok) return access;
  if (!(await redoable(db, viewer, shootRow(r), access.config))) return fail(409, "not_redoable", "A free redo is for a shoot whose every picture you 👎'd, once.");
  const { level: _level, ...choices } = r.choices ?? {};
  return shoot(db, viewer, r.character_id, { choices, model: r.model, own_key: r.own_key }, baseUrl, { redoOf: r.id, free: true });
}

/* ----------------------------------------------------- state ----------------------------------------------------- */

export type StudioState = {
  character: { id: string; name: string; noun: Noun; house: boolean; own: boolean };
  identity: Identity;
  menu: ReturnType<typeof studioMenu>;
  restyle: ReturnType<typeof restyleMenu>;
  /** Their look now, on the restyle menu (restyleCurrent): the menu starts there. */
  restyle_current: RestyleChanges;
  /** The drawn example pictures for menu options (look_tiles), by option: `restyle.<group>.<option>` → tile id. */
  tiles: Record<string, string>;
  places: { id: string; label: string; public: boolean }[];
  models: (StudioModel & { ready: boolean; price: number })[];
  prices: StudioConfig["prices"];
  sizes: { shoot: number; restyle: number; recast: number; body: number };
  free_redo: boolean;
  /** Bought tokens left (null: an admin, who doesn't pay); Studio pictures left this month (null: uncapped). */
  tokens: number | null;
  left: number | null;
  shoots: Shoot[];
  gallery: Media[];
  /** Which pictures came from which shoot. */
  shoot_of: Record<string, string>;
  /** Pair shoots (v2): everyone else in the viewer's After Dark, and the pictures of the pair shoots. */
  partners: { id: string; name: string }[];
  pair_gallery: Media[];
  /** Everything of theirs made in the Studio (alone or together), and everything from their dates, alone or with anyone. */
  studio_gallery: Media[];
  dates_gallery: Media[];
  /** Sharing (v2): who the character's pictures can go to (their own characters only), the switches, and where each went. */
  share_to: SharePartner[];
  share: { photos: boolean; after_dark: boolean };
  shares: Record<string, OutgoingShare[]>;
  /**
   * Their own key (v2, Connections' After Dark pictures): its provider, the model they picked there (the Studio's
   * default on it), whether the settings allow it, and why it can't be used now.
   */
  own_key: { provider: "venice" | "replicate" | null; model: string | null; allowed: boolean; problem: string | null };
  /** Upscales left this month (null: uncapped), and how much larger. */
  upscale: { scale: number; left: number | null };
  /** Saved setups (v3): the owner's, for any of their characters. */
  setups: Setup[];
  /** Animate (v3): the motions on offer, and the viewer's animations still being made (the page polls while there are). */
  motions: { id: string; label: string }[];
  animating: Shoot[];
};

export async function studioState(db: Db, viewer: string, characterId: string): Promise<{ ok: true; state: StudioState } | StudioFail> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config, admin, noun, gender } = access;
  // Animations finished since the page last asked: checked and kept first, so they're in the gallery below.
  await collectAnimations(db, viewer).catch((err) => console.log(JSON.stringify({ event: "studio_animate_collect_failed", detail: err instanceof Error ? err.message.slice(0, 200) : "error" })));
  const keys = await adultKeys(db);
  const checker = await checkReady(db);
  const identity = await identityOf(db, viewer, c.id);
  const mine = c.ownerId === viewer || (admin && c.house);
  const [places, gallery, shootRows, tokens, left, upscalesLeft, partners, shareTo, ownRow, usable] = await Promise.all([
    ownPlaces(db, viewer, c.id),
    listMedia(db, [c.id], viewer),
    db.query<Parameters<typeof shootRow>[0]>(
      `select id, kind, status, model, provider, tokens, asked, made, pictures, redo_of, error, created_at from adult_studio_shoots
        where owner_id = $1 and character_id = $2 order by created_at desc limit 20`,
      [viewer, c.id],
    ),
    admin ? Promise.resolve(null) : episodeAllowance(db, viewer).then((a) => a.pack_left),
    usageLeft(db, viewer, "studio"),
    usageLeft(db, viewer, "upscales"),
    pairPartners(db, viewer, c.id),
    mine ? sharePartners(db, viewer, c.id) : Promise.resolve([]),
    db.query<{ provider: string; model: string | null }>(`select provider, model from user_connection_jobs where user_id = $1 and job = 'after_dark'`, [viewer]),
    jobUsability(db, viewer, "after_dark"),
  ]);
  const shoots = shootRows.rows.map(shootRow);
  // The pair shoots' pictures, still there (a pair picture lives in the pair's gallery too).
  const pairIds = shoots.filter((s) => s.kind === "pair").flatMap((s) => s.pictures);
  const pair_gallery = await mediaByIds(db, pairIds, viewer);
  const ownProvider = ownRow.rows[0]?.provider === "venice" || ownRow.rows[0]?.provider === "replicate" ? (ownRow.rows[0].provider as "venice" | "replicate") : null;
  const solo = gallery.filter((g) => g.character_b === null);
  // Everything of theirs, alone and with anyone (lib/adult/media.ts characterMedia): the Gallery's Studio and After
  // Dark tabs, and the Together tab's media from their dates.
  const everything = await characterMedia(db, c.id, viewer);
  for (const s of shoots) s.redo = await redoable(db, viewer, s, config);
  const shoot_of: Record<string, string> = {};
  for (const s of shoots) for (const p of s.pictures) shoot_of[p] = s.id;
  const priceOf = (m: StudioModel) => (m.job === "edit" ? config.prices.shoot[m.tier] : config.prices.recast);
  return {
    ok: true,
    state: {
      character: { id: c.id, name: c.name, noun, house: c.house, own: c.ownerId === viewer },
      identity,
      menu: studioMenu(shootLimits(identity, config), noun),
      restyle: restyleMenu(gender),
      restyle_current: restyleCurrent(c.extras?.looks, gender, c.ownerId === viewer),
      tiles: await menuTiles(db, gender),
      places,
      models: config.models.map((m) => ({ ...m, ready: Boolean(m.provider === "venice" ? keys.venice : keys.replicate) && checker, price: priceOf(m) })),
      prices: config.prices,
      sizes: { shoot: config.shoot_size, restyle: config.restyle_candidates, recast: config.recast_candidates, body: config.body_candidates },
      free_redo: config.free_redo,
      tokens,
      left,
      shoots,
      gallery: solo,
      shoot_of,
      partners,
      pair_gallery,
      studio_gallery: everything.filter((m) => m.studio),
      dates_gallery: everything.filter((m) => !m.studio),
      share_to: shareTo,
      share: { photos: config.share.photos, after_dark: config.share.after_dark },
      shares: mine ? await sharesOf(db, viewer, solo.map((g) => g.id)) : {},
      own_key: {
        provider: ownProvider,
        model: ownProvider ? (ownRow.rows[0].model ?? null) : null,
        allowed: ownProvider ? config.own_keys[ownProvider] : false,
        problem: usable.state === "over_cap" || usable.state === "failing" ? usable.message : null,
      },
      upscale: { scale: config.upscale.scale, left: upscalesLeft },
      setups: await listSetups(db, viewer),
      motions: ANIMATE_MOTIONS.filter((m) => !config.disabled_options.includes(`motion.${m.id}`)).map(({ id, label }) => ({ id, label })),
      animating: shoots.filter((x) => x.kind === "animate" && x.status === "making"),
    },
  };
}
