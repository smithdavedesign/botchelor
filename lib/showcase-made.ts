import type { Db } from "./db";
import { loadCharacter, type Character } from "./character";
import { checkPgPictureText } from "./safety";
import type { LoggedRequest } from "./adult/request-log";
import { firstTwinPrompt, TWIN_PLACEHOLDERS, twinTags } from "./adult/sfw-twin";
import { postMedia, type ShowcaseViewer } from "./showcase";

/**
 * How a showcase post was made (David, 2026-10-29: "when someone clicks on the image showcase the model we used to
 * make it. so every asset should have meta data of model used and prompt used, character(s)"): the model and where it
 * ran, the prompt it was given, who's in it and what made it (a Studio shoot, a date, an SFW twin…), shown in the
 * showcase's viewer.
 *
 * - **The model:** as the item kept it. A video kept before its row named one, its reel's shot's (lib/db.ts backfills
 *   it); else the request it was made with (lib/adult/request-log.ts). Never guessed: before 2026-10-24 a picture kept
 *   only its provider, and says so.
 * - **The prompt:** as kept. A video's is the request's (its row keeps the line it was a shot of); a twin kept before
 *   2026-10-29 kept a placeholder, so its prompt is made again exactly as sfwTwin made it, and kept from then on.
 * - **Hidden:** when the creator chose to publish without it (showcase_posts.show_prompt), and on a pg or suggestive post
 *   whose prompt doesn't pass the show's own word check (an After Dark picture's words never reach the PG side).
 * - **Derived:** a boomerang, a loop, a still cut from a clip or an upscale says what it is, and the clip or picture it
 *   came from, with that one's model and prompt.
 * - **Who sees it:** whoever may see the post (postMedia), nobody else.
 */

export type MadeModel = { id: string; label: string; provider: string | null };
export type MadeStep = { how: string; model: MadeModel | null; model_note: string | null; prompt: string | null; prompt_note: string | null; made_at: string };
export type Made = MadeStep & { characters: { id: string; name: string }[]; from: MadeStep | null };

/** Every model the show has made pictures and clips with, by a name a person reads; any other shows as its id. */
const MODEL_LABELS: Record<string, string> = {
  "qwen-edit-uncensored": "Qwen Edit (uncensored)",
  "qwen-image-2-1-turbo-edit": "Qwen Image 2.1 Turbo Edit",
  "qwen-image-2-1-pro-edit": "Qwen Image 2.1 Pro Edit",
  "qwen-image-3": "Qwen Image 3",
  "qwen/qwen-image": "Qwen Image",
  "qwen/qwen-image-edit-2511": "Qwen Image Edit 2511",
  "seedream-v5-pro-edit": "Seedream 5 Pro Edit",
  "lustify-sdxl": "Lustify SDXL",
  "wan-3-0-image-to-video": "Wan 3.0 (image to video)",
  "wan-2.6-image-to-video": "Wan 2.6 (image to video)",
  "wan-video/wan-2.2-i2v-fast": "Wan 2.2 (image to video, fast)",
  upscale: "Venice's upscaler",
  ffmpeg: "ffmpeg (from the clip itself)",
  moment: "ffmpeg (a frame of the clip)",
};
const PROVIDER_LABELS: Record<string, string> = { venice: "Venice", replicate: "Replicate", fal: "fal.ai", "studio-pg": "Venice", mixed: "Venice and Replicate" };

export function modelOf(id: string | null | undefined, provider: string | null | undefined): MadeModel | null {
  if (!id) return null;
  const p = provider ? (PROVIDER_LABELS[provider] ?? provider) : id.includes("/") ? "Replicate" : null;
  return { id, label: MODEL_LABELS[id] ?? id, provider: p };
}

/** When the model started being kept on every picture. */
const MODELS_KEPT_FROM = "2026-10-24";

/** The video's own request among those logged (its queue, not the keyframe drawn first), else the last with a prompt. */
function fromRequest(requests: LoggedRequest[] | null): { prompt: string | null; model: string | null } {
  const withPrompt = (requests ?? []).filter((r) => {
    const b = r.body as Record<string, unknown> | null;
    return typeof b?.prompt === "string" || typeof (b?.input as Record<string, unknown> | undefined)?.prompt === "string";
  });
  const r = withPrompt.find((x) => /\/video|predictions/.test(x.at)) ?? withPrompt.at(-1);
  if (!r) return { prompt: null, model: null };
  const b = r.body as Record<string, unknown>;
  const input = (b.input ?? {}) as Record<string, unknown>;
  const replicate = /\/models\/([^/]+\/[^/]+)\/predictions/.exec(r.at)?.[1] ?? null;
  const model = [b.model, b.modelId, b.model_id].find((x): x is string => typeof x === "string") ?? replicate;
  return { prompt: typeof b.prompt === "string" ? b.prompt : typeof input.prompt === "string" ? input.prompt : null, model };
}

type ImageRow = {
  id: string; kind: string; mime: string; prompt: string | null; model: string | null; provider: string | null; request: LoggedRequest[] | null;
  created_at: Date | string; source_image: string | null; derived: string | null; moment_at: number | null; fixed_from: string | null; twin_of: string | null;
  owner_id: string; character_id: string | null; character_b: string | null; shoot_kind: string | null; reel_kind: string | null; shot_model: string | null; shot_motion: string | null;
  /** A living portrait (lib/showcase-loops.ts): a safe picture brought to life. */
  loop: boolean;
};

async function imageRow(db: Db, id: string): Promise<ImageRow | null> {
  return (
    await db.query<ImageRow>(
      `select i.id, i.kind, i.mime, i.prompt, i.model, i.provider, i.request, i.created_at, i.source_image, i.derived, i.moment_at, i.fixed_from, i.twin_of,
              i.owner_id, i.character_id, i.character_b, s.kind as shoot_kind, shot.reel_kind, shot.model as shot_model, shot.motion as shot_motion,
              exists (select 1 from showcase_loops l where l.media_id = i.id) as loop
         from adult_images i
         left join adult_studio_shoots s on s.id = i.shoot_id
         left join lateral (select r.kind as reel_kind, x->>'model' as model, x->>'motion' as motion from adult_reels r cross join lateral jsonb_array_elements(r.shots) x
                             where r.owner_id = i.owner_id and x->>'media_id' = i.id limit 1) shot on true
        where i.id = $1`,
      [id],
    )
  ).rows[0] ?? null;
}

const SHOOT_HOW: Record<string, string> = {
  shoot: "A Studio shoot",
  pair: "A Studio shoot of the two of them",
  carousel: "A carousel: the same moment from another angle",
  variations: "A variation of another Studio picture",
  restyle: "A Studio restyle",
  upscale: "Upscaled from another Studio picture",
  identity: "A view from the identity pack",
};

function howOf(r: ImageRow): string {
  if (r.twin_of) return "An SFW twin: another picture made again safe for work";
  if (r.kind === "baseline") return "Their After Dark portrait";
  if (r.kind === "video") {
    if (r.loop) return "A living portrait: their safe picture, brought to life";
    if (r.derived === "boomerang") return "A boomerang of a clip";
    if (r.derived === "loop") return "A loop of a clip";
    return r.reel_kind && r.reel_kind !== "clip" ? "A shot of a date's video" : "A clip";
  }
  if (r.moment_at !== null && r.moment_at !== undefined) return "A still cut from a clip";
  if (r.fixed_from) return "Faces fixed on another picture";
  if (r.model === "upscale") return "Upscaled from another picture";
  return r.shoot_kind ? (SHOOT_HOW[r.shoot_kind] ?? "Made in the Studio") : "A picture from one of their dates";
}

/** The prompt a twin was made with, put back on a twin kept with a placeholder (the same words sfwTwin used). */
async function twinPromptOf(db: Db, r: { id: string; owner_id: string; character_id: string | null; character_b: string | null }, table: "adult_images" | "studio_pg_pictures"): Promise<string | null> {
  const people = (await Promise.all([r.character_id, r.character_b].filter((x): x is string => Boolean(x)).map((id) => loadCharacter(db, id)))).filter((c): c is Character => Boolean(c));
  if (!people.length) return null;
  // Only twins made before their prompt was kept have a placeholder: they were all made with the first prompt.
  const prompt = firstTwinPrompt(twinTags(people, r.owner_id));
  await db.query(`update ${table} set prompt = $1 where id = $2 and prompt = any($3::text[])`, [prompt, r.id, TWIN_PLACEHOLDERS]).catch(() => {});
  return prompt;
}

const iso = (d: Date | string) => new Date(d).toISOString();

async function stepOf(db: Db, r: ImageRow): Promise<MadeStep> {
  const sent = fromRequest(r.request);
  const isVideo = r.kind === "video" && !r.derived;
  const modelId = r.model ?? r.shot_model ?? sent.model;
  let prompt = isVideo ? (sent.prompt ?? null) : r.prompt;
  let prompt_note: string | null = null;
  if (r.twin_of && (!prompt || TWIN_PLACEHOLDERS.includes(prompt))) prompt = await twinPromptOf(db, r, "adult_images");
  if (isVideo && !prompt) {
    prompt = r.shot_motion ?? null;
    prompt_note = prompt ? "The full prompt wasn't kept for this one: this is the movement it was asked for." : "The prompt wasn't kept for this one.";
  }
  if (r.derived) {
    prompt = null;
    prompt_note = "Cut from the clip by ffmpeg: no model and no prompt of its own.";
  }
  const created = iso(r.created_at);
  return {
    how: howOf(r),
    model: modelOf(modelId, r.provider),
    model_note: modelId ? null : r.provider ? `Made on ${PROVIDER_LABELS[r.provider] ?? r.provider}; the model wasn't kept${created < MODELS_KEPT_FROM ? ` (before ${MODELS_KEPT_FROM})` : ""}.` : "The model wasn't kept for this one.",
    prompt,
    prompt_note: prompt || prompt_note ? prompt_note : "The prompt wasn't kept for this one.",
    made_at: created,
  };
}

const PG_HOW: Record<string, string> = {
  shoot: "A PG Studio shoot",
  carousel: "A carousel: the same moment from another angle",
  identity: "A view from the identity pack",
  twin: "An SFW twin: another picture made again safe for work",
};

/** How the post was made, for a viewer who may see it; null for anyone else (or no such post). */
export async function madeOf(db: Db, v: ShowcaseViewer, postId: string): Promise<Made | null> {
  const m = await postMedia(db, v, postId);
  if (!m) return null;
  const post = (
    await db.query<{ show_prompt: boolean; character_id: string; character_b: string | null; a_name: string | null; b_name: string | null }>(
      `select p.show_prompt, p.character_id, p.character_b, ca.name as a_name, cb.name as b_name
         from showcase_posts p left join characters ca on ca.id = p.character_id left join characters cb on cb.id = p.character_b where p.id = $1`,
      [postId],
    )
  ).rows[0];
  if (!post) return null;
  const characters = [
    { id: post.character_id, name: post.a_name ?? post.character_id },
    ...(post.character_b ? [{ id: post.character_b, name: post.b_name ?? post.character_b }] : []),
  ];
  let step: MadeStep;
  let from: MadeStep | null = null;
  if (m.source === "pg") {
    const r = (
      await db.query<{ id: string; owner_id: string; character_id: string; prompt: string | null; model: string | null; created_at: Date | string; twin_of: string | null; tags: { kind: string; value: string }[] | null }>(
        `select id, owner_id, character_id, prompt, model, created_at, twin_of, tags from studio_pg_pictures where id = $1`,
        [m.media_id],
      )
    ).rows[0];
    if (!r) return null;
    const made = (r.tags ?? []).find((t) => t.kind === "made")?.value ?? (r.twin_of ? "twin" : null);
    let prompt = r.prompt;
    if (r.twin_of && (!prompt || TWIN_PLACEHOLDERS.includes(prompt))) prompt = await twinPromptOf(db, { ...r, character_b: null }, "studio_pg_pictures");
    step = {
      how: (made && PG_HOW[made]) || "A PG Studio picture",
      model: modelOf(r.model, "venice"),
      model_note: r.model ? null : "The model wasn't kept for this one.",
      prompt,
      prompt_note: prompt ? null : "The prompt wasn't kept for this one.",
      made_at: iso(r.created_at),
    };
  } else {
    const r = await imageRow(db, m.media_id);
    if (!r) return null;
    step = await stepOf(db, r);
    // A boomerang, loop or still of a clip, an upscale or a fixed-faces picture: and what it came from. Never a twin's
    // original: that's an After Dark picture, not for the side a twin is for.
    const parent = r.twin_of ? null : (r.derived || r.moment_at !== null || r.model === "upscale" ? r.source_image : null) ?? r.fixed_from;
    const p = parent ? await imageRow(db, parent) : null;
    if (p && p.owner_id === r.owner_id) from = await stepOf(db, p);
  }
  const hide = (s: MadeStep): MadeStep => {
    if (!s.prompt) return s;
    if (!post.show_prompt) return { ...s, prompt: null, prompt_note: "The creator published this one without its prompt." };
    // A pg or suggestive post shows only words the show's own lines allow.
    if (m.rating !== "nsfw" && !checkPgPictureText({ prompt: s.prompt }).ok) return { ...s, prompt: null, prompt_note: "Its prompt has After Dark's words, so it isn't shown here." };
    return s;
  };
  return { ...hide(step), characters, from: from ? hide(from) : null };
}
