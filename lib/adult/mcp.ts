/**
 * After dark over MCP (David, 2026-10-18: "my own agents, but other bots can make a request to the admins"). These
 * tools exist only for a call that carries the admin key (x-frontier-key): to any other agent they're not listed and
 * calling one is an unknown tool. Every other agent sees only request_after_dark (lib/mcp.ts), which asks the admins.
 */
import { afterDarkBase, afterDarkElsewhere } from "../after-dark-host";
import { USER_ROLEPLAY } from "../studio/library";
import { answerBeat, PICTURE_FIELD_MAX, pictureNow, previewPicture, redrawPicture, SCENE_CUSTOM_MAX, SCENE_DIALOG_MAX } from "./beats";
import { WHISPER_MAX } from "./director";
import { ROLEPLAY_IDS } from "./roleplays";
import { SCENARIOS } from "./scenarios";
import { AdultSettingsInput, SETTINGS_KEY_FIELDS } from "./settings-input";
import type { Db } from "../db";
import { eligibleIds, listSwitchable, setAdultSwitch } from "./characters";
import { hiveState, mediaPauses } from "./hive-limit";
import { baselinePrompt, listMedia, makePicture } from "./media";
import { loadCharacter } from "../character";
import { advanceReel, listReels, makeReel, reelNight } from "./reels";
import { siteUrl } from "../site";
import { adultAvailable } from "./mode";
import { HARD_NO_IDS, INTENSITIES, OWN_LEN, OWN_MAX, storedHardNos, type HardNos } from "./limits";
import { FRAMING_IDS, PROFILE_CONSENT_TEXT } from "./profile";
import { crisisCheck, crisisField } from "../crisis";
import {
  continueScene,
  forgetWhisper,
  listCastPairs,
  listNights,
  openScene,
  redoScene,
  resetScene,
  rewindScene,
  saveFraming,
  saveLimits,
  sceneNotes,
  SET_SCENE_MAX,
  setRoleplay,
  setSceneTo,
  startScenario,
  type LimitsInput,
} from "./scenes";
import { getAdultSettings, PROMPT_VERSIONS, saveAdultSettings, VOICE_MODELS } from "./settings";
import { USAGE_KINDS } from "./usage";

type JsonSchema = Record<string, unknown>;
const id = { type: "string", maxLength: 64 };

/**
 * The viewer's limits for the pair (lib/adult/limits.ts), as the Limits panel sets them (POST /api/admin/after-dark
 * {limits}): the same values, saved by the same saveLimits, so its rules hold here too (a "dirty_talk" hard no keeps
 * filthy written as explicit). after_dark_write saves them before the step; after_dark_scene saves them and writes nothing.
 */
const LIMIT_PROPS: Record<string, JsonSchema> = {
  intensity: {
    type: "string",
    enum: [...INTENSITIES],
    description: "Saves the pair's intensity, as the Limits panel does (explicit when never set). filthy: plain dirty talk from undressing on, unless dirty_talk is a hard no.",
  },
  hard_nos: {
    type: "object",
    description:
      "Replaces the pair's hard nos, as the Limits panel does: chips from the list, plus up to 8 of your own, a few words each. Stored only with consent: true " +
      "(or consent given on the page); without it after_dark_write holds them for this step only, and after_dark_scene refuses.",
    properties: {
      chips: { type: "array", items: { type: "string", enum: HARD_NO_IDS }, maxItems: HARD_NO_IDS.length },
      own: { type: "array", items: { type: "string", maxLength: OWN_LEN }, maxItems: OWN_MAX },
    },
  },
  consent: {
    type: "boolean",
    description: `true: the person agrees to this, which storing hard_nos needs (GDPR "sex life" data): "${PROFILE_CONSENT_TEXT}"`,
  },
};

/** The limits in a call's arguments, checked as the Limits panel's route checks them; null when there are none. */
export function limitsArg(args: Record<string, unknown>): { limits: LimitsInput | null } | { error: string } {
  const limits: LimitsInput = {};
  if (args.intensity !== undefined) {
    if (!(INTENSITIES as readonly unknown[]).includes(args.intensity)) return { error: `intensity is one of ${INTENSITIES.join(", ")}.` };
    limits.intensity = args.intensity as string;
  }
  if (args.hard_nos !== undefined) {
    const h = args.hard_nos && typeof args.hard_nos === "object" ? (args.hard_nos as { chips?: unknown; own?: unknown }) : null;
    const chips = h ? (h.chips ?? []) : null;
    const own = h ? (h.own ?? []) : null;
    if (!Array.isArray(chips) || !Array.isArray(own) || own.some((o) => typeof o !== "string")) return { error: "hard_nos is { chips: [...], own: [...] }." };
    const unknown = chips.find((c) => !HARD_NO_IDS.includes(c as string));
    if (unknown !== undefined) return { error: `${JSON.stringify(unknown)} isn't a hard no: chips are ${HARD_NO_IDS.join(", ")}.` };
    limits.hard_nos = { chips: chips as string[], own: own as string[] };
  }
  return { limits: Object.keys(limits).length ? limits : null };
}

export const ADULT_TOOLS: { name: string; title: string; description: string; inputSchema: JsonSchema; annotations: Record<string, boolean> }[] = [
  {
    name: "after_dark_pairs",
    title: "After dark: the pairs",
    description: "Admin only. Who can be in after dark (this season's cast and the switched-on characters), every pair, and how long each scene is.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "after_dark_scene",
    title: "After dark: read a scene",
    description:
      "Admin only. A pair's scene so far, their gallery (picture and clip ids, each with the provider that made it and whether that was the fallback), " +
      "and which text model wrote each chapter (written_by: from its steps, else the settings history, else 'not recorded'). " +
      "With intensity or hard_nos it saves those first (the pair's limits, as the Limits panel sets them) and writes no lines.",
    inputSchema: { type: "object", required: ["a", "b"], properties: { a: id, b: id, ...LIMIT_PROPS } },
    annotations: { readOnlyHint: false },
  },
  {
    name: "after_dark_write",
    title: "After dark: write the next lines",
    description:
      "Admin only. Writes the next lines of a pair's scene on after dark's model, optionally steered. Nobody under 18 and no real people, " +
      "always; anything else between the two adults is allowed. A picture comes when a chapter starts or the place changes, when they ask each other " +
      "for one, and at the moments that matter (scene.beats: after_dark_picture draws one now). " +
      "intensity and hard_nos, when given, are saved as the pair's limits first, and hold for this step and after. " +
      "The director, as on the page: whisper to one of them instead of a steer (it holds until it's done, or forget_whisper), redo (take the last step " +
      "back and write it again) or rewind (take it back only).",
    inputSchema: {
      type: "object",
      required: ["a", "b"],
      properties: {
        a: id,
        b: id,
        direction: { type: "string", maxLength: 300, description: 'With steer_mode direct, words in quotes ("…") are spoken nearly as written, by whoever the steer names.' },
        steer_mode: { type: "string", enum: ["nudge", "direct"], description: "nudge (default): worked toward at the scene's own pace. direct: done now, can skip ahead." },
        whisper: {
          type: "object",
          required: ["to", "text"],
          description: "A word in one ear (a or b), instead of a steer: only they hear it, and they act on it in their own time.",
          properties: { to: { type: "string", enum: ["a", "b"] }, text: { type: "string", minLength: 1, maxLength: WHISPER_MAX } },
        },
        forget_whisper: { type: "string", enum: ["a", "b"], description: "Drops a whisper still running for a or b; writes nothing." },
        redo: { type: "boolean", description: "true: takes the last step back and writes it again, with its steer or whisper." },
        rewind: { type: "boolean", description: "true: takes the last step back (its lines, stage and place); writes nothing." },
        ...LIMIT_PROPS,
      },
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "after_dark_set_scene",
    title: "After dark: set the scene",
    description:
      "Admin only. What the scene picker on the page sets, in this order when several are given: reset (Start over: the night so far is saved, a new one begins), " +
      "place (take them somewhere: held there until it's moved again; one the show doesn't know is drawn fresh), roleplay (this chapter's, or null to clear it), " +
      "framing (how the two are framed, or null), then scenario (starts a night from one of the show's openings and writes its first lines; it sets its own place). " +
      "Each is checked as on the page.",
    inputSchema: {
      type: "object",
      required: ["a", "b"],
      properties: {
        a: id,
        b: id,
        reset: { type: "boolean" },
        place: { type: "string", maxLength: SET_SCENE_MAX },
        roleplay: {
          type: ["object", "null"],
          required: ["id"],
          description: "One of the show's roleplays, or one of yours (u:<id> from /prompts). swap: true trades who plays which part.",
          properties: { id: { type: "string", description: `${ROLEPLAY_IDS.join(", ")}, or u:<id>` }, swap: { type: "boolean" } },
        },
        framing: { type: ["string", "null"], enum: [...FRAMING_IDS, null] },
        scenario: { type: "string", enum: SCENARIOS.map((x) => x.id) },
      },
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "after_dark_picture",
    title: "After dark: a picture of the scene",
    description:
      "Admin only. A scene picture, drawn from both of their faces and the moment, as the theater's 📸 does. One of: line (Picture this at that line of the " +
      "running chapter), beat_id with answer now or later (a moment the scene offered: after_dark_scene's scene.beats), or picture_id (Redraw a scene " +
      "picture from the gallery: the old one stays). preview: true says what it would be drawn from (fields and prompt) and draws nothing. custom leads " +
      "the picture, dialog is a speech-bubble line, and edit changes its context (happening, wearing, place, mood, extra); all held to After Dark's lines. " +
      "The picture is checked and lands in the gallery a little later (after_dark_scene).",
    inputSchema: {
      type: "object",
      required: ["a", "b"],
      properties: {
        a: id,
        b: id,
        line: { type: "integer", minimum: 0 },
        beat_id: id,
        answer: { type: "string", enum: ["now", "later"] },
        picture_id: id,
        preview: { type: "boolean" },
        custom: { type: "string", maxLength: SCENE_CUSTOM_MAX },
        dialog: { type: "string", maxLength: SCENE_DIALOG_MAX },
        edit: {
          type: "object",
          properties: {
            happening: { type: "string", maxLength: PICTURE_FIELD_MAX },
            wearing: { type: "string", maxLength: PICTURE_FIELD_MAX },
            place: { type: "string", maxLength: PICTURE_FIELD_MAX },
            mood: { type: "string", maxLength: PICTURE_FIELD_MAX },
            extra: { type: "string", maxLength: SCENE_CUSTOM_MAX },
          },
        },
      },
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "after_dark_settings",
    title: "After dark: models and on/off",
    description:
      "Admin only. Reads after dark's settings, and changes any of them that's given, as /admin/after-dark/settings does and with its checks: on or off, the models, " +
      "the media provider, prices, the writers, the Studio, the checks and the monthly caps. Keys are never shown or set here " +
      "(only on /admin/after-dark/settings). `hive` is the safety check's state: ok, failing (a check couldn't run), paused until a time (nothing is drawn), or probe_next, with the last error. " +
      "`pauses` lists what's paused: Hive (the safety check), which stops every picture and video until it answers again, " +
      "and a media provider cooling down after a 429 or 402.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        text_model: { type: "string", maxLength: 120, description: "An OpenRouter model id: the default writer when `writer` names none." },
        text_temperature: { type: ["number", "null"], minimum: 0, maximum: 2, description: "The scene writer's sampling (null: the default); so are the penalties." },
        frequency_penalty: { type: ["number", "null"], minimum: -2, maximum: 2 },
        presence_penalty: { type: ["number", "null"], minimum: -2, maximum: 2 },
        repetition_penalty: { type: ["number", "null"], minimum: 0, maximum: 2 },
        prompt_version: { type: "string", enum: [...PROMPT_VERSIONS] },
        writer: { type: "object", description: "The scene writers people can pick, and the default (as the settings page's Writer panel saves it)." },
        image_provider: { type: "string", enum: ["fal", "venice"], description: "Which of image_model or venice_image_model draws pictures." },
        image_model: { type: "string", maxLength: 120, description: "A fal.ai image model id (image_provider fal)." },
        venice_image_model: { type: "string", maxLength: 120, description: "A Venice image model id (image_provider venice)." },
        video_model: { type: "string", maxLength: 120, description: "A fal.ai video model id." },
        image_base: { type: "string", maxLength: 160, description: "For fal-ai/lora: the Hugging Face id of the base model." },
        reel_model: { type: "string", maxLength: 120 },
        replicate_picture_model: { type: "string", maxLength: 160, description: "owner/name or owner/name:version, or \"\" for the default; so are the other replicate_*_model." },
        replicate_keyframe_model: { type: "string", maxLength: 160 },
        replicate_video_model: { type: "string", maxLength: 160 },
        replicate_voice_model: { type: "string", maxLength: 160 },
        replicate_video_lora: { type: "string", maxLength: 1000, description: "Wan's LoRA: one or two https URLs, or \"\" for none." },
        voice_model: { type: "string", enum: [...VOICE_MODELS] },
        talk_model: { type: "string", maxLength: 120, description: "The talking moments' model (\"\" for the default); so are presence_loop_model and place_sound_model." },
        presence_loop_model: { type: "string", maxLength: 120 },
        place_sound_model: { type: "string", maxLength: 120 },
        place_sounds: { type: "boolean", description: "The sound of the place under the theater." },
        draw_ahead: { type: "boolean", description: "Draw the next pictures before the theater reaches them, so they show at once." },
        reel_shots: { type: "integer", minimum: 2, maximum: 12 },
        reel_tokens: { type: "integer", minimum: 0, maximum: 500, description: "What a person pays in bought tokens (admins never pay); so are the other *_tokens." },
        clip_tokens: { type: "integer", minimum: 0, maximum: 100 },
        menu_picture_tokens: { type: "integer", minimum: 0, maximum: 100 },
        chapter_tokens: { type: "integer", minimum: 0, maximum: 100 },
        pictures_per_chapter: { type: "integer", minimum: 0, maximum: 10 },
        studio: { type: "object", description: "The Studio's settings (checked on save, as the page's Studio panel)." },
        moderation: { type: "object", description: "Which checker checks pictures (checked on save)." },
        caps: { type: "object", description: `Monthly caps, each a whole number: ${USAGE_KINDS.join(", ")}.` },
        auto_scene_pictures: { type: "boolean", description: "A picture of the pair each time a chapter starts or the place changes (on by default)." },
        beat_pictures: { type: "boolean", description: "A picture of each moment that matters (undressing, sex, each new position, the climax, the afterglow), drawn when the chapter closes if the viewer never asked for it (on by default)." },
        media_provider: { type: "string", enum: ["venice", "replicate"], description: "Where pictures, keyframes, videos and voices are made." },
        media_fallback: {
          type: "boolean",
          description: "When the media provider is rate limited, out of credit or down, make the job on the other one (on by default; a running video stays where it started).",
        },
      },
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "after_dark_switch",
    title: "After dark: switch a character in or out",
    description: "Admin only. Switches one of your characters, or a house character, in or out of after dark (this season's cast is always in).",
    inputSchema: { type: "object", required: ["character_id", "on"], properties: { character_id: id, on: { type: "boolean" } } },
    annotations: { readOnlyHint: false },
  },
  {
    name: "after_dark_baseline",
    title: "After dark: a new portrait",
    description:
      "Admin only. Draws a new baseline portrait of one character in after dark (character_id) with the current media provider " +
      "(after_dark_settings media_provider), checked like every picture. The newest baseline is the face their later pictures and videos " +
      "keep; the older one stays in the gallery, to compare.",
    inputSchema: { type: "object", properties: { character_id: id }, required: ["character_id"] },
    annotations: { readOnlyHint: false },
  },
  {
    name: "after_dark_reel",
    title: "After dark: a video of the night",
    description:
      "Admin only. With a and b: makes a video of the pair's night (the model picks its strongest lines; one voiced shot per line of the " +
      "two of them together, started from a picture of both made from their portraits, in the night's place; every picture and shot is " +
      "checked before it's kept). `shots` sets its length (2-12, ~5-10s each). `scope`: \"night\" (the default) films the whole night, " +
      "every chapter since it began (Start over begins a new one); \"chapter\" only the chapter being written now. Starting takes a minute or so. " +
      "With reel_id: checks a video being made (call it every minute or so until it's ready). With list: the pair's videos.",
    inputSchema: {
      type: "object",
      properties: { a: id, b: id, shots: { type: "integer", minimum: 2, maximum: 12 }, scope: { type: "string", enum: ["night", "chapter"] }, reel_id: id, list: { type: "boolean" } },
    },
    annotations: { readOnlyHint: false },
  },
];

export const ADULT_TOOL_NAMES = new Set(ADULT_TOOLS.map((t) => t.name));

/** The model ids after_dark_settings leaves as they were when sent blank (it always has). */
const MODEL_FIELDS = new Set(["text_model", "image_model", "video_model", "image_base"]);

/** A whisper in a call's arguments, checked as the page's route checks it; null when there's none. */
function whisperArg(w: unknown): { to: "a" | "b"; text: string } | { error: string } | null {
  if (w === undefined || w === null) return null;
  const { to, text } = (typeof w === "object" ? w : {}) as { to?: unknown; text?: unknown };
  if ((to !== "a" && to !== "b") || typeof text !== "string" || !text.trim() || text.length > WHISPER_MAX) {
    return { error: `whisper is { to: "a" or "b", text: 1-${WHISPER_MAX} characters }.` };
  }
  return { to, text };
}

/** The account after-dark scenes over MCP belong to: the first admin. */
async function sceneOwner(db: Db): Promise<string | null> {
  return (await db.query<{ user_id: string }>(`select user_id from admins order by user_id limit 1`)).rows[0]?.user_id ?? null;
}

export async function runAdultTool(db: Db, name: string, args: Record<string, unknown>): Promise<{ data: Record<string, unknown> } | { error: string; details?: Record<string, unknown> }> {
  // After Dark on a host of its own (lib/after-dark-host.ts): its tools run there, never on the show's deployment.
  const elsewhere = afterDarkElsewhere();
  if (elsewhere) return { error: `After Dark runs on its own host now: connect to ${elsewhere}/api/mcp (with the admin key) for its tools.` };
  // The settings themselves are reachable while it's off (that's where it's turned on). Never the keys.
  if (name === "after_dark_settings") {
    // The settings page's own checks (lib/adult/settings-input.ts), less the keys. A model id sent blank is left as it was.
    const given = Object.fromEntries(Object.entries(args).filter(([k, v]) => !(MODEL_FIELDS.has(k) && typeof v === "string" && !v.trim())));
    const keys = SETTINGS_KEY_FIELDS.filter((k) => k in given);
    if (keys.length) return { error: `Keys are set only on /admin/after-dark/settings, never over MCP (${keys.join(", ")}).` };
    const parsed = AdultSettingsInput.safeParse(given);
    if (!parsed.success) return { error: `Not saved: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.` };
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    // Changes made here go in the settings history as "mcp". A Studio, writer or checks value that doesn't fit its rules is refused, with why.
    let settings;
    try {
      settings = Object.keys(patch).length ? await saveAdultSettings(db, patch, "mcp") : await getAdultSettings(db);
    } catch (err) {
      return { error: `Not saved: ${err instanceof Error ? err.message.slice(0, 300) : "invalid"}.` };
    }
    // Hive's breaker (lib/adult/hive-limit.ts): ok, failing, paused until a time, or probing next; with the last error.
    return { data: { settings, pauses: await mediaPauses(db), hive: await hiveState(db) } };
  }
  if (!(await adultAvailable(db))) return { error: "After dark is off: turn it on in its settings (/admin/after-dark/settings)." };
  const owner = await sceneOwner(db);
  if (!owner) return { error: "No admin account to hold the scenes: claim admin on /admin first." };
  const a = String(args.a ?? "");
  const b = String(args.b ?? "");
  // The self-harm check on a steer's own words (lib/crisis.ts): crisis_resources rides on whatever this answers.
  const whisper = whisperArg(args.whisper);
  const crisis = name === "after_dark_write" ? crisisCheck("mcp_after_dark", typeof args.direction === "string" ? args.direction : null, whisper && "text" in whisper ? whisper.text : null) : null;
  const crisisDetails = crisis ? { details: { crisis_resources: crisis } } : {};
  // The pair's limits, when a scene call carries them: saved first, through the Limits panel's path (lib/adult/scenes.ts).
  // Hard nos are stored only with consent: true (or consent given before, on the page); without it, after_dark_write
  // holds them for this step only and stores nothing of them, and after_dark_scene (which only saves) refuses.
  let sessionHardNos: HardNos | null = null;
  if (name === "after_dark_scene" || name === "after_dark_write") {
    const arg = limitsArg(args);
    if ("error" in arg) return { error: arg.error, ...crisisDetails };
    if (arg.limits) {
      const first = await saveLimits(db, owner, a, b, arg.limits, { consent: args.consent === true });
      let failure = first.ok ? null : first;
      if (failure?.consent_required && name === "after_dark_write" && arg.limits.hard_nos) {
        sessionHardNos = storedHardNos(arg.limits.hard_nos);
        failure = null;
        if (arg.limits.intensity !== undefined) {
          const again = await saveLimits(db, owner, a, b, { intensity: arg.limits.intensity });
          failure = again.ok ? null : again;
        }
      }
      if (failure) {
        const message = failure.consent_required ? `${failure.message} Send consent: true with hard_nos to store them.` : failure.message;
        return { error: failure.status === 404 ? "Pick two characters who are in after dark (after_dark_pairs lists them)." : message, ...crisisDetails };
      }
    }
  }
  switch (name) {
    case "after_dark_pairs":
      return { data: { pairs: await listCastPairs(db, owner), characters: await listSwitchable(db, owner) } };
    case "after_dark_scene": {
      const scene = await openScene(db, owner, a, b);
      if (!scene) return { error: "Pick two characters who are in after dark (after_dark_pairs lists them)." };
      // Which text model wrote each chapter (lib/adult/model-log.ts): the running one, then the saved nights, newest first.
      const notes = await sceneNotes(db, owner, scene.a.id, scene.b.id);
      const written_by = notes
        ? [{ chapter: notes.current.chapter, night_id: null, ...notes.current.written_by }, ...notes.nights.map((n) => ({ chapter: n.chapter, night_id: n.id, at: n.created_at, ...n.written_by }))]
        : [];
      return { data: { scene, gallery: await listMedia(db, [scene.a.id, scene.b.id], owner), written_by } };
    }
    case "after_dark_write": {
      // The director (lib/adult/director.ts), as the page's: take the last step back, forget a whisper, or write again.
      if (args.rewind === true) {
        const back = await rewindScene(db, owner, a, b);
        return back.ok ? { data: { scene: back.scene, rewound: back.rewound, nights: await listNights(db, owner, a, b) } } : { error: back.message };
      }
      if (args.forget_whisper !== undefined) {
        if (args.forget_whisper !== "a" && args.forget_whisper !== "b") return { error: 'forget_whisper is "a" or "b".' };
        const scene = await forgetWhisper(db, owner, a, b, args.forget_whisper);
        return scene ? { data: { scene } } : { error: "Pick two characters who are in after dark (after_dark_pairs lists them)." };
      }
      if (whisper && "error" in whisper) return { error: whisper.error, ...crisisDetails };
      const r =
        args.redo === true
          ? await redoScene(db, owner, a, b)
          : await continueScene(db, owner, a, b, typeof args.direction === "string" ? args.direction : null, args.steer_mode === "direct" ? "direct" : "nudge", { sessionHardNos, whisper });
      // Hard nos sent without consent held for this step and were never stored: said so, with what consent covers.
      const unsaved = sessionHardNos ? { hard_nos_saved: false, consent_needed: `${PROFILE_CONSENT_TEXT} (send consent: true to store them)` } : {};
      return r.ok
        ? {
            data: {
              ...crisisField(crisis),
              scene: r.scene, added: r.added, held: r.held, repeats: r.repeats, dropped: r.dropped, pictures: r.pictures,
              ...(r.picture_note ? { picture_note: r.picture_note } : {}), ...(r.auto_picture ? { auto_picture: "drawing" } : {}), ...unsaved,
            },
          }
        : { error: r.message, ...crisisDetails };
    }
    case "after_dark_set_scene": {
      if (args.scenario !== undefined && !SCENARIOS.some((x) => x.id === args.scenario)) return { error: `scenario is one of ${SCENARIOS.map((x) => x.id).join(", ")}.` };
      if (args.scenario !== undefined && args.place !== undefined) return { error: "A scenario sets its own place: send one or the other." };
      const roleplay = args.roleplay;
      if (roleplay !== undefined && roleplay !== null) {
        const pick = typeof roleplay === "object" ? (roleplay as { id?: unknown }).id : null;
        if (typeof pick !== "string" || !(ROLEPLAY_IDS.includes(pick) || USER_ROLEPLAY.test(pick))) return { error: `roleplay is { id, swap? }: id is one of ${ROLEPLAY_IDS.join(", ")}, or u:<id> for one of yours.` };
      }
      if (args.framing !== undefined && args.framing !== null && !FRAMING_IDS.includes(args.framing as string)) return { error: `framing is one of ${FRAMING_IDS.join(", ")}, or null.` };
      if (!(await openScene(db, owner, a, b))) return { error: "Pick two characters who are in after dark (after_dark_pairs lists them)." };
      const out: Record<string, unknown> = {};
      if (args.reset === true) await resetScene(db, owner, a, b);
      if (args.place !== undefined) {
        const moved = await setSceneTo(db, owner, a, b, String(args.place).slice(0, SET_SCENE_MAX));
        if (!moved.ok) return { error: moved.message };
        if (moved.auto_picture) out.auto_picture = "drawing";
      }
      if (roleplay !== undefined) {
        const r = roleplay as { id: string; swap?: unknown } | null;
        await setRoleplay(db, owner, a, b, r ? { id: r.id, swap: r.swap === true } : null);
      }
      if (args.framing !== undefined) await saveFraming(db, owner, a, b, (args.framing as string | null) ?? null);
      if (args.scenario !== undefined) {
        const r = await startScenario(db, owner, a, b, args.scenario as string);
        if (!r.ok) return { error: r.message };
        Object.assign(out, { added: r.added, held: r.held, repeats: r.repeats, dropped: r.dropped, pictures: r.pictures });
      }
      return { data: { scene: await openScene(db, owner, a, b), ...out, nights: await listNights(db, owner, a, b) } };
    }
    case "after_dark_picture": {
      const scene = await openScene(db, owner, a, b);
      if (!scene) return { error: "Pick two characters who are in after dark (after_dark_pairs lists them)." };
      const at = { ...scene, a: scene.a.id, b: scene.b.id, place: scene.set_place ?? scene.place };
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);
      const line = typeof args.line === "number" && Number.isInteger(args.line) && args.line >= 0 ? args.line : undefined;
      const beatId = str(args.beat_id);
      const pictureId = str(args.picture_id);
      const guide = { custom: str(args.custom), dialog: str(args.dialog), edit: args.edit && typeof args.edit === "object" ? args.edit : undefined };
      if (args.preview === true) {
        const plan = await previewPicture(db, owner, at, { beat: beatId, line, picture: pictureId }, guide.edit);
        return plan.ok ? { data: { preview: { fields: plan.fields, edit: plan.edit, prompt: plan.prompt } } } : { error: plan.message };
      }
      const base = afterDarkBase(siteUrl());
      // The admin's scenes: nothing is paid for, as on the page.
      const r = pictureId
        ? await redrawPicture(db, owner, pictureId, guide.edit, base, at)
        : beatId
          ? await answerBeat(db, owner, beatId, args.answer === "later" ? "later" : "now", base, guide)
          : line !== undefined
            ? await pictureNow(db, owner, at, line, base, guide)
            : null;
      if (!r) return { error: "Send line (Picture this at a line), beat_id (a moment in scene.beats), or picture_id (Redraw); preview: true to see what it would be drawn from." };
      return r.ok ? { data: { beat: r.beat, note: "Drawing: it lands in the gallery once it's checked (after_dark_scene)." } } : { error: r.message };
    }
    case "after_dark_switch": {
      const ok = await setAdultSwitch(db, owner, String(args.character_id ?? ""), args.on === true);
      return ok ? { data: { characters: await listSwitchable(db, owner) } } : { error: "Only the admin's own characters, and house characters, can be switched on." };
    }
    case "after_dark_baseline": {
      const id = String(args.character_id ?? "");
      if (!(await eligibleIds(db, owner)).has(id)) return { error: "Pick a character who is in after dark (after_dark_pairs lists them)." };
      const c = await loadCharacter(db, id);
      if (!c) return { error: "No such character." };
      try {
        return { data: { picture: await makePicture(db, owner, { prompt: baselinePrompt(c, owner), kind: "baseline", character_id: id }) } };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "The picture didn't come." };
      }
    }
    case "after_dark_reel": {
      if (typeof args.reel_id === "string") {
        const reel = await advanceReel(db, owner, args.reel_id);
        return reel ? { data: { reel } } : { error: "No video with that id." };
      }
      if (args.list === true) return { data: { reels: await listReels(db, owner, a, b) } };
      if (args.scope !== undefined && args.scope !== "night" && args.scope !== "chapter") return { error: 'scope is "night" (the whole night, the default) or "chapter" (the one being written now).' };
      const night = await reelNight(db, owner, a, b, null, args.scope === "chapter" ? "chapter" : "night");
      if (!night) return { error: "Pick two characters who are in after dark (after_dark_pairs lists them)." };
      const shots = typeof args.shots === "number" ? args.shots : undefined;
      const r = await makeReel(db, owner, a, b, night.lines, afterDarkBase(siteUrl()), { shots, where: night.where, night });
      return r.ok ? { data: { reel: r.reel } } : { error: r.message };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}
