/**
 * After dark over MCP (David, 2026-10-18: "my own agents, but other bots can make a request to the admins"). These
 * tools exist only for a call that carries the admin key (x-frontier-key): to any other agent they're not listed and
 * calling one is an unknown tool. Every other agent sees only request_after_dark (lib/mcp.ts), which asks the admins.
 */
import { afterDarkBase, afterDarkElsewhere } from "../after-dark-host";
import type { Db } from "../db";
import { eligibleIds, listSwitchable, setAdultSwitch } from "./characters";
import { hiveState, mediaPauses } from "./hive-limit";
import { baselinePrompt, listMedia, makePicture } from "./media";
import { loadCharacter } from "../character";
import { advanceReel, listReels, makeReel, reelNight } from "./reels";
import { siteUrl } from "../site";
import { adultAvailable } from "./mode";
import { HARD_NO_IDS, INTENSITIES, OWN_LEN, OWN_MAX } from "./limits";
import { continueScene, listCastPairs, openScene, saveLimits, sceneNotes, type LimitsInput } from "./scenes";
import { getAdultSettings, saveAdultSettings } from "./settings";

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
    description: "Replaces the pair's hard nos, as the Limits panel does: chips from the list, plus up to 8 of your own, a few words each.",
    properties: {
      chips: { type: "array", items: { type: "string", enum: HARD_NO_IDS }, maxItems: HARD_NO_IDS.length },
      own: { type: "array", items: { type: "string", maxLength: OWN_LEN }, maxItems: OWN_MAX },
    },
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
      "always; anything else between the two adults is allowed. Pictures come when the scene turns explicit, or when they ask each other for one. " +
      "intensity and hard_nos, when given, are saved as the pair's limits first, and hold for this step and after.",
    inputSchema: {
      type: "object",
      required: ["a", "b"],
      properties: {
        a: id,
        b: id,
        direction: { type: "string", maxLength: 300, description: 'With steer_mode direct, words in quotes ("…") are spoken nearly as written, by whoever the steer names.' },
        steer_mode: { type: "string", enum: ["nudge", "direct"], description: "nudge (default): worked toward at the scene's own pace. direct: done now, can skip ahead." },
        ...LIMIT_PROPS,
      },
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "after_dark_settings",
    title: "After dark: models and on/off",
    description:
      "Admin only. Reads after dark's settings, and changes the models, the media provider (venice or replicate) or turns it on or off when given. Keys are never shown or set here " +
      "(only on /admin/after-dark/settings). `hive` is the safety check's state: ok, failing (a check couldn't run), paused until a time (nothing is drawn), or probe_next, with the last error. " +
      "`pauses` lists what's paused: Hive (the safety check), which stops every picture and video until it answers again, " +
      "and a media provider cooling down after a 429 or 402.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        text_model: { type: "string", maxLength: 120, description: "An OpenRouter model id." },
        image_model: { type: "string", maxLength: 120, description: "A fal.ai image model id." },
        video_model: { type: "string", maxLength: 120, description: "A fal.ai video model id." },
        image_base: { type: "string", maxLength: 160, description: "For fal-ai/lora: the Hugging Face id of the base model." },
        auto_scene_pictures: { type: "boolean", description: "A picture of the pair each time a chapter starts or the place changes (on by default)." },
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

/** The account after-dark scenes over MCP belong to: the first admin. */
async function sceneOwner(db: Db): Promise<string | null> {
  return (await db.query<{ user_id: string }>(`select user_id from admins order by user_id limit 1`)).rows[0]?.user_id ?? null;
}

export async function runAdultTool(db: Db, name: string, args: Record<string, unknown>): Promise<{ data: Record<string, unknown> } | { error: string }> {
  // After Dark on a host of its own (lib/after-dark-host.ts): its tools run there, never on the show's deployment.
  const elsewhere = afterDarkElsewhere();
  if (elsewhere) return { error: `After Dark runs on its own host now: connect to ${elsewhere}/api/mcp (with the admin key) for its tools.` };
  // The settings themselves are reachable while it's off (that's where it's turned on). Never the keys.
  if (name === "after_dark_settings") {
    const patch: Record<string, unknown> = {};
    if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
    if (typeof args.auto_scene_pictures === "boolean") patch.auto_scene_pictures = args.auto_scene_pictures;
    for (const k of ["text_model", "image_model", "video_model", "image_base"]) if (typeof args[k] === "string" && (args[k] as string).trim()) patch[k] = (args[k] as string).trim();
    if (args.media_provider === "venice" || args.media_provider === "replicate") patch.media_provider = args.media_provider;
    if (typeof args.media_fallback === "boolean") patch.media_fallback = args.media_fallback;
    // Changes made here go in the settings history as "mcp".
    const settings = Object.keys(patch).length ? await saveAdultSettings(db, patch, "mcp") : await getAdultSettings(db);
    // Hive's breaker (lib/adult/hive-limit.ts): ok, failing, paused until a time, or probing next; with the last error.
    return { data: { settings, pauses: await mediaPauses(db), hive: await hiveState(db) } };
  }
  if (!(await adultAvailable(db))) return { error: "After dark is off: turn it on in its settings (/admin/after-dark/settings)." };
  const owner = await sceneOwner(db);
  if (!owner) return { error: "No admin account to hold the scenes: claim admin on /admin first." };
  const a = String(args.a ?? "");
  const b = String(args.b ?? "");
  // The pair's limits, when a scene call carries them: saved first, through the Limits panel's path (lib/adult/scenes.ts).
  if (name === "after_dark_scene" || name === "after_dark_write") {
    const arg = limitsArg(args);
    if ("error" in arg) return { error: arg.error };
    if (arg.limits) {
      const saved = await saveLimits(db, owner, a, b, arg.limits);
      if (!saved.ok) return { error: saved.status === 404 ? "Pick two characters who are in after dark (after_dark_pairs lists them)." : saved.message };
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
      const r = await continueScene(db, owner, a, b, typeof args.direction === "string" ? args.direction : null, args.steer_mode === "direct" ? "direct" : "nudge");
      return r.ok
        ? { data: { scene: r.scene, added: r.added, held: r.held, repeats: r.repeats, dropped: r.dropped, pictures: r.pictures, ...(r.picture_note ? { picture_note: r.picture_note } : {}), ...(r.auto_picture ? { auto_picture: "drawing" } : {}) } }
        : { error: r.message };
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
