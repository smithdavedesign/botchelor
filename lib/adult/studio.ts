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
 *  - **Price and caps:** a shoot's tokens are taken first (admins free), given back whole when nothing came through; one
 *    free redo for a shoot the viewer 👎'd whole; monthly caps per person (lib/adult/usage.ts).
 *  - **The check:** every picture passes the output check before it's kept (lib/adult/check.ts), as everywhere.
 */
import { isAdmin } from "../admins";
import { episodeAllowance, refundBoughtTokens, spendBoughtTokens } from "../allowance";
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import { LOOK_DETAILS, LOOK_STEPS, hairWords, looksAppearance, looksPictureWords, normaliseLooks, optionPrompt, optionsFor, type Gender, type Looks } from "../looks";
import { keepBytes } from "../object-store";
import { checkAdultText } from "../safety";
import { crossesTaboo } from "./acts";
import { eligibleIds } from "./characters";
import type { CheckResult } from "./check";
import { isPublicPlace } from "./continuity";
import { HivePausedError, hivePausedErrorMessage } from "./hive-limit";
import { checkMedia, checkReady, mediaGate } from "./moderation";
import { HARD_NO_IDS, INTENSITIES, type Intensity } from "./limits";
import { baselinePrompt, ensureBaseline, listMedia, NEGATIVE_PROMPT, physicalLook, replicatePictureInput, signedMediaUrl, venicePicture, type Media } from "./media";
import { PICTURE_PRESETS, type PresetId } from "./rating-tags";
import { drawKeyframe, replicateKeyframeInput, replicateSetImage, setPictures } from "./reels";
import { runModel } from "./replicate";
import { adultKeys, getAdultSettings } from "./settings";
import { choosePreset, faceReferenceId, NO_STEERING, steeringFor, withSteering } from "./steering";
import {
  bodyPrompt,
  LEVEL_FOR_INTENSITY,
  planShoot,
  restylePrompt,
  shootPrompt,
  STRENGTHS,
  studioMenu,
  type Level,
  type Noun,
  type ShootChoices,
  type ShootLimits,
  type Strength,
  type Subject,
} from "./studio-catalog";
import type { StudioConfig, StudioModel } from "./studio-config";
import { countUse, usageLeft } from "./usage";

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

export type Identity = { face: string | null; body: string | null; strength: Strength; intensity: Intensity; hard_nos: string[] };

/** The viewer's own settings for the character: the body reference (while it's still there), strength, studio limits. */
export async function identityOf(db: Db, viewer: string, characterId: string): Promise<Identity> {
  const r = (
    await db.query<{ body_image_id: string | null; strength: string | null; intensity: string | null; hard_nos: unknown; body_ready: boolean | null }>(
      `select i.body_image_id, i.strength, i.intensity, i.hard_nos, (select m.status = 'ready' from adult_images m where m.id = i.body_image_id) as body_ready
         from adult_identity i where i.owner_id = $1 and i.character_id = $2`,
      [viewer, characterId],
    )
  ).rows[0];
  const strength = (STRENGTHS as readonly string[]).includes(r?.strength ?? "") ? (r!.strength as Strength) : "balanced";
  const intensity = (INTENSITIES as readonly string[]).includes(r?.intensity ?? "") ? (r!.intensity as Intensity) : "explicit";
  const hard_nos = Array.isArray(r?.hard_nos) ? (r!.hard_nos as unknown[]).filter((x): x is string => typeof x === "string" && HARD_NO_IDS.includes(x)) : [];
  return { face: await faceReferenceId(db, viewer, characterId), body: r?.body_ready ? r.body_image_id : null, strength, intensity, hard_nos };
}

async function upsertIdentity(db: Db, viewer: string, characterId: string, col: "body_image_id" | "strength" | "intensity" | "hard_nos", value: unknown): Promise<void> {
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

export type ShootKind = "shoot" | "restyle" | "recast" | "body";
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
  const keys = await adultKeys(db);
  if (!(await checkReady(db))) return fail(409, "not_set_up", "Pictures need a checker in After Dark's settings (every picture is checked before it's kept).");
  if (spec.model.provider === "venice" ? !keys.venice : !keys.replicate) {
    return fail(409, "not_set_up", `${spec.model.label} needs the ${spec.model.provider === "venice" ? "Venice" : "Replicate"} key in After Dark's settings.`);
  }
  const asked = spec.prompts.length;
  const left = await usageLeft(db, viewer, "studio");
  if (left !== null && left < asked) return fail(429, "over_cap", `That's ${asked} pictures and ${left} are left this month. They reset on the 1st.`);
  const gate = await mediaGate(db);
  if (!gate.ok) return fail(503, "hive_paused", gate.message);
  const pays = spec.tokens > 0 && !access.admin;
  if (pays && !(await spendBoughtTokens(db, viewer, spec.tokens))) {
    return fail(402, "needs_tokens", `That costs ${spec.tokens} token${spec.tokens === 1 ? "" : "s"}. Get more on the shop page.`);
  }
  const id = crypto.randomUUID();
  await db.query(
    `insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, model, provider, own_key, tokens, asked, status, redo_of)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, false, $8, $9, 'making', $10)`,
    [id, viewer, c.id, spec.kind, JSON.stringify(spec.choices ?? {}), spec.model.id, spec.model.provider, pays ? spec.tokens : 0, asked, spec.redoOf ?? null],
  );
  // Every picture at once (each a minute or so), then checked one at a time.
  const drawn = await Promise.all(
    spec.prompts.map((p) =>
      drawOne(db, spec.model, keys, p.prompt, spec.images, spec.negative).then(
        (file) => ({ file, p }),
        (err: unknown) => ({ error: err instanceof Error ? err.message.slice(0, 200) : "error" }),
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
    const verdict: CheckResult = await checkMedia(db, { base64: d.file.bytes.toString("base64"), mime: d.file.mime }, "image");
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
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, fell_back, model, preset, scene_place, shoot_id, nsfw_score)
       values ($1, $2, $3, null, $4, $5, $6, $7, $8, 'ready', $9, false, $10, $11, $12, $13, $14)`,
      [pid, viewer, c.id, spec.pictureKind, d.p.prompt.slice(0, 2000), d.file.mime, store.data, store.object_key, spec.model.provider, spec.model.id, d.p.preset, spec.place?.slice(0, 120) ?? null, id, verdict.nsfw ?? null],
    );
    await countUse(db, viewer, "studio");
    kept.push({
      id: pid, character_id: c.id, character_b: null, kind: spec.pictureKind, status: "ready", created_at: new Date().toISOString(), mime: d.file.mime, clip: false,
      place: spec.place, provider: spec.model.provider, fell_back: false, note: null, preset: d.p.preset, rating: null, tags: [], face: false,
    });
  }
  const made = kept.length;
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

/** The words a check reads: the choices and the look, never the prompt's fixed words. */
const wordsOk = (words: string): boolean => checkAdultText({ words }).ok && !crossesTaboo(words);

/* --------------------------------------------------- a shoot --------------------------------------------------- */

export type ShootInput = { choices: ShootChoices; model?: string | null };

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
  if (!wordsOk(`${plan.parts.map((p) => p.words).join(" ")} ${subject.look}`)) return fail(422, "not_allowed", "That shoot crosses one of the lines After Dark never crosses.");
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
  // Picture 1 the face, Picture 2 their body reference (when they have one and the model takes it), then the place's set.
  const images = [face];
  const refs = { body: false, set: false };
  if (identity.body && model.max_images >= 2) {
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
    tokens: opts.free ? 0 : config.prices.shoot[model.tier],
    choices: { ...input.choices, level: plan.level },
    place: plan.place,
    redoOf: opts.redoOf ?? null,
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

export async function restyle(db: Db, viewer: string, characterId: string, input: { changes: RestyleChanges; model?: string | null }, baseUrl: string): Promise<JobResult> {
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
    kind: "restyle", pictureKind: "baseline", prompts, images: [face], negative: NEGATIVE_PROMPT, model, tokens: config.prices.restyle, choices: { changes: input.changes }, place: null,
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

export async function recast(db: Db, viewer: string, characterId: string, input: { model?: string | null }): Promise<JobResult> {
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
    kind: "recast", pictureKind: "baseline", prompts, images: [], negative: [NEGATIVE_PROMPT, ...steer.negative].join(", "), model, tokens: config.prices.recast, choices: {}, place: null,
  });
}

/* ----------------------------------------------- body reference ----------------------------------------------- */

export async function bodyShoot(db: Db, viewer: string, characterId: string, input: { nude?: boolean; model?: string | null }, baseUrl: string): Promise<JobResult> {
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
    model, tokens: config.prices.body, choices: { nude }, place: null,
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
    await db.query<Parameters<typeof shootRow>[0] & { character_id: string; choices: ShootChoices & { level?: number } }>(
      `select id, kind, status, model, provider, tokens, asked, made, pictures, redo_of, error, created_at, character_id, choices from adult_studio_shoots where id = $1 and owner_id = $2`,
      [shootId, viewer],
    )
  ).rows[0];
  if (!r) return fail(404, "not_found", "No shoot of yours with that id.");
  const access = await studioAccess(db, viewer, r.character_id);
  if (!access.ok) return access;
  if (!(await redoable(db, viewer, shootRow(r), access.config))) return fail(409, "not_redoable", "A free redo is for a shoot whose every picture you 👎'd, once.");
  const { level: _level, ...choices } = r.choices ?? {};
  return shoot(db, viewer, r.character_id, { choices, model: r.model }, baseUrl, { redoOf: r.id, free: true });
}

/* ----------------------------------------------------- state ----------------------------------------------------- */

export type StudioState = {
  character: { id: string; name: string; noun: Noun; house: boolean; own: boolean };
  identity: Identity;
  menu: ReturnType<typeof studioMenu>;
  restyle: ReturnType<typeof restyleMenu>;
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
};

export async function studioState(db: Db, viewer: string, characterId: string): Promise<{ ok: true; state: StudioState } | StudioFail> {
  const access = await studioAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config, admin, noun, gender } = access;
  const keys = await adultKeys(db);
  const checker = await checkReady(db);
  const identity = await identityOf(db, viewer, c.id);
  const [places, gallery, shootRows, tokens, left] = await Promise.all([
    ownPlaces(db, viewer, c.id),
    listMedia(db, [c.id], viewer),
    db.query<Parameters<typeof shootRow>[0]>(
      `select id, kind, status, model, provider, tokens, asked, made, pictures, redo_of, error, created_at from adult_studio_shoots
        where owner_id = $1 and character_id = $2 order by created_at desc limit 20`,
      [viewer, c.id],
    ),
    admin ? Promise.resolve(null) : episodeAllowance(db, viewer).then((a) => a.pack_left),
    usageLeft(db, viewer, "studio"),
  ]);
  const shoots = shootRows.rows.map(shootRow);
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
      places,
      models: config.models.map((m) => ({ ...m, ready: Boolean(m.provider === "venice" ? keys.venice : keys.replicate) && checker, price: priceOf(m) })),
      prices: config.prices,
      sizes: { shoot: config.shoot_size, restyle: config.restyle_candidates, recast: config.recast_candidates, body: config.body_candidates },
      free_redo: config.free_redo,
      tokens,
      left,
      shoots,
      gallery: gallery.filter((g) => g.character_b === null),
      shoot_of,
    },
  };
}
