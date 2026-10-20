/**
 * After dark over MCP (David, 2026-10-18: "my own agents, but other bots can make a request to the admins"). These
 * tools exist only for a call that carries the admin key (x-frontier-key): to any other agent they're not listed and
 * calling one is an unknown tool. Every other agent sees only request_after_dark (lib/mcp.ts), which asks the admins.
 */
import type { Db } from "../db";
import { listSwitchable, setAdultSwitch } from "./characters";
import { listMedia } from "./media";
import { adultAvailable } from "./mode";
import { continueScene, listCastPairs, openScene } from "./scenes";
import { getAdultSettings, saveAdultSettings } from "./settings";

type JsonSchema = Record<string, unknown>;
const id = { type: "string", maxLength: 64 };

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
    description: "Admin only. A pair's scene so far, and their gallery (picture and clip ids).",
    inputSchema: { type: "object", required: ["a", "b"], properties: { a: id, b: id } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "after_dark_write",
    title: "After dark: write the next lines",
    description:
      "Admin only. Writes the next lines of a pair's scene on after dark's model, optionally steered. Nobody under 18 and no real people, " +
      "always; anything else between the two adults is allowed. Pictures come when the scene turns explicit, or when they ask each other for one.",
    inputSchema: { type: "object", required: ["a", "b"], properties: { a: id, b: id, direction: { type: "string", maxLength: 300 }, steer_mode: { type: "string", enum: ["nudge", "direct"], description: "nudge (default): worked toward at the scene's own pace. direct: done now, can skip ahead." } } },
    annotations: { readOnlyHint: false },
  },
  {
    name: "after_dark_settings",
    title: "After dark: models and on/off",
    description:
      "Admin only. Reads after dark's settings, and changes the models or turns it on or off when given. Keys are never shown or set here " +
      "(only on /admin/after-dark/settings).",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        text_model: { type: "string", maxLength: 120, description: "An OpenRouter model id." },
        image_model: { type: "string", maxLength: 120, description: "A fal.ai image model id." },
        video_model: { type: "string", maxLength: 120, description: "A fal.ai video model id." },
        image_base: { type: "string", maxLength: 160, description: "For fal-ai/lora: the Hugging Face id of the base model." },
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
];

export const ADULT_TOOL_NAMES = new Set(ADULT_TOOLS.map((t) => t.name));

/** The account after-dark scenes over MCP belong to: the first admin. */
async function sceneOwner(db: Db): Promise<string | null> {
  return (await db.query<{ user_id: string }>(`select user_id from admins order by user_id limit 1`)).rows[0]?.user_id ?? null;
}

export async function runAdultTool(db: Db, name: string, args: Record<string, unknown>): Promise<{ data: Record<string, unknown> } | { error: string }> {
  // The settings themselves are reachable while it's off (that's where it's turned on). Never the keys.
  if (name === "after_dark_settings") {
    const patch: Record<string, unknown> = {};
    if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
    for (const k of ["text_model", "image_model", "video_model", "image_base"]) if (typeof args[k] === "string" && (args[k] as string).trim()) patch[k] = (args[k] as string).trim();
    return { data: { settings: Object.keys(patch).length ? await saveAdultSettings(db, patch) : await getAdultSettings(db) } };
  }
  if (!(await adultAvailable(db))) return { error: "After dark is off: turn it on in its settings (/admin/after-dark/settings)." };
  const owner = await sceneOwner(db);
  if (!owner) return { error: "No admin account to hold the scenes: claim admin on /admin first." };
  const a = String(args.a ?? "");
  const b = String(args.b ?? "");
  switch (name) {
    case "after_dark_pairs":
      return { data: { pairs: await listCastPairs(db, owner), characters: await listSwitchable(db, owner) } };
    case "after_dark_scene": {
      const scene = await openScene(db, owner, a, b);
      return scene ? { data: { scene, gallery: await listMedia(db, [scene.a.id, scene.b.id]) } } : { error: "Pick two characters who are in after dark (after_dark_pairs lists them)." };
    }
    case "after_dark_write": {
      const r = await continueScene(db, owner, a, b, typeof args.direction === "string" ? args.direction : null, args.steer_mode === "direct" ? "direct" : "nudge");
      return r.ok ? { data: { scene: r.scene, added: r.added, held: r.held, pictures: r.pictures, ...(r.picture_note ? { picture_note: r.picture_note } : {}) } } : { error: r.message };
    }
    case "after_dark_switch": {
      const ok = await setAdultSwitch(db, owner, String(args.character_id ?? ""), args.on === true);
      return ok ? { data: { characters: await listSwitchable(db, owner) } } : { error: "Only the admin's own characters, and house characters, can be switched on." };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}
